import { corsHeaders, json } from "../_shared/cors.ts";
import {
  createAnonClient,
  getAuthPolicy,
  getRequestActor,
  requireSuperAdmin,
} from "../_shared/admin.ts";
import {
  applyLatestReleaseToDevice,
  getLatestGitHubRelease,
  REMOTE_UPDATE_MIN_VERSION,
  supportsRemoteUpdate,
} from "../_shared/github-release.ts";

const TEMP_BUCKET = "agent-temp-artifacts";
const ARCHIVE_BUCKET = "agent-archives";
const FILE_BUCKETS = [
  "agent-temp-artifacts",
  "agent-archives",
  "agent-preview-cache",
  "admin-upload-staging",
];
const LOG_LIMIT = 120;
const JOB_LIMIT = 80;
const TRANSFER_HISTORY_LIMIT = 120;
const DASHBOARD_PUBLIC_URL =
  (Deno.env.get("DASHBOARD_PUBLIC_URL") || "https://school-services.netlify.app").replace(/\/+$/, "");

function sanitizeSelection(selection: unknown) {
  if (!Array.isArray(selection)) {
    return [];
  }

  return selection
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function safeFileNameFromKey(objectKey: string) {
  const clean = String(objectKey || "").split("?")[0];
  return clean.split("/").filter(Boolean).pop() || clean || "berkas";
}

function normalizeStorageKey(value: unknown) {
  return String(value || "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
}

function isStorageFolderEntry(entry: Record<string, unknown> | null | undefined) {
  return Boolean(entry) && !entry?.id && !entry?.updated_at && !entry?.created_at;
}

async function storageObjectExists(
  service: Awaited<ReturnType<typeof getRequestActor>>["service"],
  bucket: string,
  objectKey: string
) {
  const cleanKey = normalizeStorageKey(objectKey);
  if (!bucket || !cleanKey) {
    return false;
  }

  const slashIndex = cleanKey.lastIndexOf("/");
  const folder = slashIndex >= 0 ? cleanKey.slice(0, slashIndex) : "";
  const fileName = slashIndex >= 0 ? cleanKey.slice(slashIndex + 1) : cleanKey;
  const { data, error } = await service.storage.from(bucket).list(folder, {
    limit: 100,
    search: fileName,
  });
  if (error) {
    throw error;
  }

  return (data || []).some((entry) => String(entry.name || "").trim() === fileName);
}

async function collectStorageKeysByPrefix(
  service: Awaited<ReturnType<typeof getRequestActor>>["service"],
  bucket: string,
  prefix: string
) {
  const normalizedPrefix = normalizeStorageKey(prefix);
  if (!bucket || !normalizedPrefix) {
    return [];
  }

  const folders = [normalizedPrefix];
  const keys = new Set<string>();

  while (folders.length) {
    const currentPrefix = folders.pop() || "";
    const { data, error } = await service.storage.from(bucket).list(currentPrefix, {
      limit: 1000,
      sortBy: { column: "name", order: "asc" },
    });

    if (error) {
      throw error;
    }

    for (const entry of data || []) {
      const name = String(entry.name || "").trim();
      if (!name) {
        continue;
      }
      const childKey = currentPrefix ? `${currentPrefix}/${name}` : name;
      if (isStorageFolderEntry(entry as Record<string, unknown>)) {
        folders.push(childKey);
      } else {
        keys.add(childKey);
      }
    }
  }

  return [...keys];
}

function normalizeArtifactJob(job: Record<string, unknown>, deviceName = "") {
  const bucket = String(job.artifact_bucket || "").trim();
  const objectKey = String(job.artifact_object_key || "").trim();
  const result =
    job.result && typeof job.result === "object"
      ? (job.result as Record<string, unknown>)
      : {};
  const fileName =
    String(job.artifact_file_name || result.fileName || "").trim() ||
    safeFileNameFromKey(objectKey);

  return {
    id: `${bucket}:${objectKey || job.id}`,
    jobId: job.id,
    bucket,
    objectKey,
    fileName,
    deviceId: job.device_id || null,
    deviceName:
      String(job.artifact_device_name || deviceName || job.device_id || "").trim() ||
      "Device tidak diketahui",
    sourcePath: job.source_path || job.artifact_source_label || null,
    destinationPath: job.destination_path || null,
    jobType: job.job_type || null,
    status: job.artifact_deleted_at ? "deleted" : job.status,
    deliveryMode: job.delivery_mode || null,
    size: Number(job.artifact_size || result.size || 0) || null,
    contentType: job.artifact_content_type || result.mimeType || null,
    createdAt: job.created_at || null,
    completedAt: job.completed_at || null,
    expiresAt: job.artifact_expires_at || result.expiresAt || null,
    deletedAt: job.artifact_deleted_at || null,
    fromJob: true,
    isFolder: false,
  };
}

function sanitizeRole(value: unknown) {
  const role = String(value || "").trim().toLowerCase();
  if (role === "operator" || role === "user") {
    return role;
  }
  throw new Error("Unsupported account role.");
}

function sanitizeStatus(value: unknown) {
  const status = String(value || "").trim().toLowerCase();
  if (["pending", "approved", "rejected", "disabled"].includes(status)) {
    return status;
  }
  throw new Error("Unsupported account status.");
}

function sanitizeApprovalHours(value: unknown, fallback = 24) {
  const next = Number(value);
  if (!Number.isFinite(next) || next < 1) {
    return fallback;
  }
  return Math.max(1, Math.min(720, Math.round(next)));
}

function buildGuestPath(deviceId: string) {
  return `/guest/${encodeURIComponent(String(deviceId || "").trim())}`;
}

function buildOperatorEnvironmentName(displayName: string | null, email: string) {
  const seed = displayName || email.split("@")[0] || "Operator";
  return `${seed} Workspace`;
}

function isApprovedProfile(profile: Record<string, unknown> | null) {
  return Boolean(profile && profile.status === "approved");
}

function isSuperAdminProfile(profile: Record<string, unknown> | null) {
  return Boolean(profile && profile.role === "super_admin" && isApprovedProfile(profile));
}

function isOperatorProfile(profile: Record<string, unknown> | null) {
  return Boolean(profile && profile.role === "operator" && isApprovedProfile(profile));
}

async function requireApprovedActor(request: Request) {
  const actor = await getRequestActor(request);
  if (!isApprovedProfile(actor.profile)) {
    throw new Error("Account access is pending or unavailable.");
  }
  return actor;
}

async function generateReferralCode(service: Awaited<ReturnType<typeof getRequestActor>>["service"]) {
  const referral = await service.rpc("generate_referral_code");
  if (referral.error) {
    throw referral.error;
  }
  return String(referral.data || "").trim();
}

async function getAccessibleDeviceIds(service: Awaited<ReturnType<typeof getRequestActor>>["service"], actor: Awaited<ReturnType<typeof getRequestActor>>) {
  if (isSuperAdminProfile(actor.profile)) {
    return null;
  }

  if (isOperatorProfile(actor.profile)) {
    const environmentId = String(actor.environment?.id || actor.profile?.primary_environment_id || "").trim();
    if (!environmentId) {
      return [];
    }

    const { data, error } = await service
      .from("device_assignments")
      .select("device_id")
      .eq("environment_id", environmentId)
      .eq("status", "active");

    if (error) {
      throw error;
    }

    return [...new Set((data || []).map((row) => String(row.device_id || "").trim()).filter(Boolean))];
  }

  const { data, error } = await service
    .from("device_assignments")
    .select("device_id")
    .eq("user_id", actor.user.id)
    .eq("status", "active");

  if (error) {
    throw error;
  }

  return [...new Set((data || []).map((row) => String(row.device_id || "").trim()).filter(Boolean))];
}

async function canAccessDevice(service: Awaited<ReturnType<typeof getRequestActor>>["service"], actor: Awaited<ReturnType<typeof getRequestActor>>, deviceId: string) {
  const accessible = await getAccessibleDeviceIds(service, actor);
  return accessible === null || accessible.includes(deviceId);
}

async function requireDeviceAccess(
  service: Awaited<ReturnType<typeof getRequestActor>>["service"],
  actor: Awaited<ReturnType<typeof getRequestActor>>,
  deviceId: string
) {
  if (!deviceId) {
    throw new Error("deviceId wajib diisi.");
  }
  if (!(await canAccessDevice(service, actor, deviceId))) {
    throw new Error("Anda tidak memiliki akses ke device ini.");
  }
}

function sanitizeCommandAction(value: unknown) {
  const action = String(value || "").trim().toLowerCase();
  if (["start", "stop", "kill", "update", "agent_start", "agent_stop", "agent_restart"].includes(action)) {
    return action;
  }
  throw new Error("Aksi command tidak dikenali.");
}

function sanitizeDeviceStatus(value: unknown) {
  const status = String(value || "").trim().toLowerCase();
  if (["active", "blocked"].includes(status)) {
    return status;
  }
  throw new Error("Status device tidak dikenali.");
}

function sanitizeDeviceAlias(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

async function ensureDeviceExists(
  service: Awaited<ReturnType<typeof getRequestActor>>["service"],
  deviceId: string
) {
  const { data, error } = await service
    .from("devices")
    .select("device_id, device_name, status")
    .eq("device_id", deviceId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("Device tidak ditemukan atau belum pernah terhubung ke School Services.");
  }

  return data;
}

async function assertDeviceLinkAvailable(
  service: Awaited<ReturnType<typeof getRequestActor>>["service"],
  deviceId: string,
  userId: string
) {
  const { data, error } = await service
    .from("device_assignments")
    .select("user_id")
    .eq("device_id", deviceId)
    .eq("status", "active")
    .eq("is_primary", true)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (data?.user_id && String(data.user_id) !== userId) {
    throw new Error("Device ini sudah tertaut ke akun lain. Minta Operator atau SuperAdmin untuk memindahkan aksesnya.");
  }
}

function getActorEnvironmentId(actor: Awaited<ReturnType<typeof getRequestActor>>) {
  return String(
    actor.profile?.primary_environment_id ||
      actor.environment?.id ||
      actor.memberships?.find((membership: Record<string, unknown>) => membership.status === "approved")
        ?.environment_id ||
      ""
  ).trim();
}

async function getScopedAccounts(service: Awaited<ReturnType<typeof getRequestActor>>["service"], actor: Awaited<ReturnType<typeof getRequestActor>>) {
  if (isSuperAdminProfile(actor.profile)) {
    const [{ data: profiles, error: profileError }, { data: memberships, error: membershipError }] =
      await Promise.all([
        service.from("admin_profiles").select("*").order("created_at", { ascending: false }),
        service
          .from("environment_memberships")
          .select("user_id, environment_id, role, status, joined_via, approved_at, updated_at"),
      ]);

    if (profileError) {
      throw profileError;
    }
    if (membershipError) {
      throw membershipError;
    }

    const membershipMap = new Map(
      (memberships || []).map((membership) => [String(membership.user_id), membership])
    );

    return (profiles || []).map((profile) => ({
      ...profile,
      membership: membershipMap.get(String(profile.user_id)) || null,
    }));
  }

  if (!isOperatorProfile(actor.profile)) {
    return [];
  }

  const environmentId = String(actor.environment?.id || actor.profile?.primary_environment_id || "").trim();
  if (!environmentId) {
    return [];
  }

  const { data: memberships, error: membershipError } = await service
    .from("environment_memberships")
    .select("user_id, environment_id, role, status, joined_via, approved_at, updated_at")
    .eq("environment_id", environmentId)
    .order("created_at", { ascending: false });

  if (membershipError) {
    throw membershipError;
  }

  const userIds = [...new Set((memberships || []).map((row) => String(row.user_id || "").trim()).filter(Boolean))];
  if (!userIds.length) {
    return [];
  }

  const { data: profiles, error: profileError } = await service
    .from("admin_profiles")
    .select("*")
    .in("user_id", userIds)
    .order("created_at", { ascending: false });

  if (profileError) {
    throw profileError;
  }

  const membershipMap = new Map(
    (memberships || []).map((membership) => [String(membership.user_id), membership])
  );

  return (profiles || []).map((profile) => ({
    ...profile,
    membership: membershipMap.get(String(profile.user_id)) || null,
  }));
}

async function getScopedEnvironments(service: Awaited<ReturnType<typeof getRequestActor>>["service"], actor: Awaited<ReturnType<typeof getRequestActor>>) {
  if (isSuperAdminProfile(actor.profile)) {
    const { data, error } = await service
      .from("operator_environments")
      .select("id, operator_id, name, referral_code, is_active, created_at, updated_at")
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return data || [];
  }

  if (!isOperatorProfile(actor.profile) || !actor.environment) {
    return [];
  }

  return [actor.environment];
}

async function getDeviceAliases(
  service: Awaited<ReturnType<typeof getRequestActor>>["service"],
  actor: Awaited<ReturnType<typeof getRequestActor>>,
  accessibleDeviceIds: string[] | null
) {
  let query = service
    .from("device_aliases")
    .select("device_id, alias, updated_at")
    .eq("user_id", actor.user.id);

  if (accessibleDeviceIds !== null) {
    if (!accessibleDeviceIds.length) {
      return [];
    }
    query = query.in("device_id", accessibleDeviceIds);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }
  return data || [];
}

async function getDashboardPayload(service: Awaited<ReturnType<typeof getRequestActor>>["service"], actor: Awaited<ReturnType<typeof getRequestActor>>) {
  const accessibleDeviceIds = await getAccessibleDeviceIds(service, actor);
  const superAdmin = isSuperAdminProfile(actor.profile);
  const operator = isOperatorProfile(actor.profile);

  const buildQuery = <T extends string>(table: T, columns = "*") => {
    const query = service.from(table).select(columns);
    if (accessibleDeviceIds === null) {
      return query;
    }
    if (!accessibleDeviceIds.length) {
      return query.in("device_id", ["__none__"]);
    }
    return query.in("device_id", accessibleDeviceIds);
  };

  const [
    servicesResult,
    devicesResult,
    logsResult,
    jobsResult,
    rootsResult,
    accounts,
    environments,
    authPolicy,
    aliases,
  ] = await Promise.all([
    buildQuery("services")
      .select(
        "device_id, service_name, port, status, desired_state, last_error, public_url, last_ping, location_status, resolved_path, location_details"
      )
      .order("device_id", { ascending: true })
      .order("service_name", { ascending: true }),
    buildQuery("devices")
      .select("device_id, device_name, status, last_seen, app_version, release_tag, build_commit, built_at, latest_release_tag, latest_version, update_available, update_status, update_checked_at, update_started_at, update_error, update_asset_name")
      .order("device_name", { ascending: true }),
    buildQuery("agent_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(LOG_LIMIT),
    superAdmin
      ? service.from("file_jobs").select("*").order("created_at", { ascending: false }).limit(JOB_LIMIT)
      : Promise.resolve({ data: [], error: null }),
    superAdmin
      ? service.from("file_roots").select("*").order("root_type", { ascending: true }).order("label", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    getScopedAccounts(service, actor),
    getScopedEnvironments(service, actor),
    superAdmin ? getAuthPolicy(service) : Promise.resolve(null),
    getDeviceAliases(service, actor, accessibleDeviceIds),
  ]);

  if (servicesResult.error) {
    throw servicesResult.error;
  }
  if (devicesResult.error) {
    throw devicesResult.error;
  }
  if (logsResult.error) {
    throw logsResult.error;
  }
  if (jobsResult.error) {
    throw jobsResult.error;
  }
  if (rootsResult.error) {
    throw rootsResult.error;
  }

  const latestRelease = await getLatestGitHubRelease();
  const devicesWithLatest = (devicesResult.data || []).map((device) =>
    applyLatestReleaseToDevice(device, latestRelease)
  );
  const deviceMap = new Map(devicesWithLatest.map((device) => [String(device.device_id), device]));
  const services = (servicesResult.data || []).map((row) => ({
    ...row,
    devices: deviceMap.get(String(row.device_id)) || null,
  }));

  return {
    ok: true,
    scope: {
      isSuperAdmin: superAdmin,
      isOperator: operator,
      environment: actor.environment || null,
      accessibleDeviceIds: accessibleDeviceIds || [],
    },
    services,
    logs: logsResult.data || [],
    fileJobs: jobsResult.data || [],
    roots: rootsResult.data || [],
    accounts,
    environments,
    authPolicy: authPolicy?.raw || null,
    deviceAliases: aliases,
  };
}

async function createManagedAccount(service: Awaited<ReturnType<typeof getRequestActor>>["service"], actor: Awaited<ReturnType<typeof getRequestActor>>, body: Record<string, unknown>) {
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "").trim();
  const role = sanitizeRole(body.role);
  const displayName = String(body.displayName || "").trim() || null;
  const requestedDeviceId = role === "user" ? String(body.deviceId || "").trim() : "";
  const approveImmediately = Boolean(body.approveImmediately);
  const authPolicy = await getAuthPolicy(service);
  const actorIsSuperAdmin = isSuperAdminProfile(actor.profile);
  const actorIsOperator = isOperatorProfile(actor.profile);

  if (!email || !password) {
    throw new Error("Email dan password wajib diisi.");
  }
  if (!actorIsSuperAdmin && !actorIsOperator) {
    throw new Error("Hanya SuperAdmin atau Operator yang dapat membuat akun.");
  }
  if (role === "operator" && !actorIsSuperAdmin) {
    throw new Error("Hanya SuperAdmin yang dapat membuat akun Operator.");
  }
  if (actorIsOperator && role !== "user") {
    throw new Error("Operator hanya dapat membuat akun user.");
  }

  let environmentId = String(body.environmentId || "").trim();
  if (actorIsOperator) {
    environmentId = String(actor.environment?.id || actor.profile?.primary_environment_id || "").trim();
  }

  let approvalDueAt: string | null = null;
  let status = "approved";
  let registrationSource = actorIsOperator ? "operator_created" : "super_admin_created";
  let standaloneState = "standalone";

  if (role === "operator") {
    status = approveImmediately ? "approved" : "pending";
    approvalDueAt = status === "pending"
      ? new Date(Date.now() + authPolicy.operatorAutoApproveHours * 60 * 60 * 1000).toISOString()
      : null;
  } else if (environmentId) {
    status = approveImmediately ? "approved" : "pending";
    approvalDueAt = status === "pending"
      ? new Date(Date.now() + authPolicy.environmentUserAutoApproveHours * 60 * 60 * 1000).toISOString()
      : null;
    standaloneState = status === "approved" ? "linked" : "pending_environment";
  } else {
    registrationSource = "direct_superadmin";
    if (authPolicy.standaloneUserApprovalMode === "auto" && !approveImmediately) {
      status = "pending";
      approvalDueAt = new Date(Date.now() + authPolicy.standaloneUserAutoApproveHours * 60 * 60 * 1000).toISOString();
    } else {
      status = approveImmediately ? "approved" : "pending";
      approvalDueAt = null;
    }
  }

  if (requestedDeviceId) {
    if (!(await canAccessDevice(service, actor, requestedDeviceId))) {
      throw new Error("Device awal berada di luar cakupan akun Anda.");
    }

    await ensureDeviceExists(service, requestedDeviceId);
    await assertDeviceLinkAvailable(service, requestedDeviceId, "");
  }

  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !created.user) {
    throw createError || new Error("Failed to create user.");
  }

  const { error: profileError } = await service.from("admin_profiles").upsert({
    user_id: created.user.id,
    email,
    display_name: displayName,
    role,
    status,
    approval_due_at: approvalDueAt,
    approved_at: status === "approved" ? new Date().toISOString() : null,
    approved_by: status === "approved" ? actor.user.id : null,
    updated_at: new Date().toISOString(),
    registration_source: registrationSource,
    managed_by: actor.user.id,
    primary_environment_id: environmentId || null,
    standalone_state: standaloneState,
  });

  if (profileError) {
    throw profileError;
  }

  if (role === "operator") {
    const { error: environmentError } = await service.from("operator_environments").upsert({
      operator_id: created.user.id,
      name: buildOperatorEnvironmentName(displayName, email),
      referral_code: await generateReferralCode(service),
      is_active: true,
      created_by: actor.user.id,
      updated_at: new Date().toISOString(),
    });

    if (environmentError) {
      throw environmentError;
    }
  }

  if (role === "user" && environmentId) {
    const { error: membershipError } = await service.from("environment_memberships").upsert({
      environment_id: environmentId,
      user_id: created.user.id,
      role: "user",
      status: status === "approved" ? "approved" : "pending",
      joined_via: actorIsOperator ? "operator_created" : "super_admin_created",
      requested_by_user_id: actor.user.id,
      approved_by: status === "approved" ? actor.user.id : null,
      approved_at: status === "approved" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    });

    if (membershipError) {
      throw membershipError;
    }
  }

  if (role === "user" && requestedDeviceId) {
    const { error: assignmentError } = await service.from("device_assignments").upsert({
      device_id: requestedDeviceId,
      user_id: created.user.id,
      environment_id: environmentId || null,
      assignment_role: "owner",
      status: "active",
      is_primary: true,
      assigned_by: actor.user.id,
      updated_at: new Date().toISOString(),
    });

    if (assignmentError) {
      throw assignmentError;
    }
  }

  return {
    ok: true,
    userId: created.user.id,
    status,
    approvalDueAt,
  };
}

async function updateAccountStatus(service: Awaited<ReturnType<typeof getRequestActor>>["service"], actor: Awaited<ReturnType<typeof getRequestActor>>, action: string, body: Record<string, unknown>) {
  const userId = String(body.userId || "").trim();
  if (!userId) {
    throw new Error("userId is required.");
  }
  if (!isSuperAdminProfile(actor.profile) && !isOperatorProfile(actor.profile)) {
    throw new Error("Hanya SuperAdmin atau Operator yang dapat mengubah status akun.");
  }

  const { data: target, error: targetError } = await service
    .from("admin_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (targetError) {
    throw targetError;
  }
  if (!target) {
    throw new Error("Account not found.");
  }

  if (!isSuperAdminProfile(actor.profile)) {
    const environmentId = String(actor.environment?.id || "").trim();
    if (!environmentId || target.role !== "user") {
      throw new Error("Anda tidak memiliki izin untuk mengubah akun ini.");
    }

    const { data: membership } = await service
      .from("environment_memberships")
      .select("id")
      .eq("environment_id", environmentId)
      .eq("user_id", userId)
      .in("status", ["pending", "approved"])
      .maybeSingle();

    if (!membership) {
      throw new Error("Akun target berada di luar lingkungan operator Anda.");
    }
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (action === "approveAccount") {
    patch.status = "approved";
    patch.approved_at = new Date().toISOString();
    patch.approved_by = actor.user.id;
    patch.approval_due_at = null;
    patch.rejected_at = null;
    patch.rejected_by = null;
    patch.rejection_reason = null;
    patch.disabled_at = null;
    patch.disabled_by = null;
    if (target.primary_environment_id) {
      patch.standalone_state = "linked";
      await service
        .from("environment_memberships")
        .update({
          status: "approved",
          approved_by: actor.user.id,
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("environment_id", String(target.primary_environment_id));
    }
  } else if (action === "rejectAccount") {
    patch.status = "rejected";
    patch.rejected_at = new Date().toISOString();
    patch.rejected_by = actor.user.id;
    patch.rejection_reason = String(body.reason || "").trim() || "Permintaan akun ditolak oleh administrator.";
    await service
      .from("environment_memberships")
      .update({
        status: "rejected",
        rejected_by: actor.user.id,
        rejected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .in("status", ["pending", "approved"]);
  } else {
    patch.status = "disabled";
    patch.disabled_at = new Date().toISOString();
    patch.disabled_by = actor.user.id;
  }

  const { data, error } = await service
    .from("admin_profiles")
    .update(patch)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return { ok: true, account: data };
}

async function deleteManagedAccount(
  service: Awaited<ReturnType<typeof getRequestActor>>["service"],
  actor: Awaited<ReturnType<typeof getRequestActor>>,
  body: Record<string, unknown>
) {
  if (!isSuperAdminProfile(actor.profile)) {
    throw new Error("Hanya SuperAdmin yang dapat menghapus akun.");
  }

  const userId = String(body.userId || "").trim();
  if (!userId) {
    throw new Error("userId is required.");
  }
  if (userId === actor.user.id) {
    throw new Error("Akun SuperAdmin aktif tidak dapat dihapus dari sesi ini.");
  }

  const { data: target, error: targetError } = await service
    .from("admin_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (targetError) {
    throw targetError;
  }
  if (!target) {
    throw new Error("Akun target tidak ditemukan.");
  }
  if (!["operator", "user"].includes(String(target.role || ""))) {
    throw new Error("Hanya akun Operator dan User yang dapat dihapus lewat fitur ini.");
  }

  const { data: ownedEnvironments, error: envError } = await service
    .from("operator_environments")
    .select("id")
    .eq("operator_id", userId);

  if (envError) {
    throw envError;
  }

  const environmentIds = (ownedEnvironments || [])
    .map((environment) => String(environment.id || "").trim())
    .filter(Boolean);

  if (environmentIds.length) {
    await service
      .from("admin_profiles")
      .update({
        primary_environment_id: null,
        standalone_state: "standalone",
        managed_by: null,
        updated_at: new Date().toISOString(),
      })
      .in("primary_environment_id", environmentIds);

    await service
      .from("device_assignments")
      .delete()
      .in("environment_id", environmentIds);

    await service
      .from("environment_memberships")
      .delete()
      .in("environment_id", environmentIds);

    await service
      .from("environment_invitations")
      .delete()
      .in("environment_id", environmentIds);

    await service
      .from("operator_environments")
      .delete()
      .in("id", environmentIds);
  }

  await service
    .from("admin_profiles")
    .update({
      managed_by: null,
      primary_environment_id: null,
      standalone_state: "standalone",
      updated_at: new Date().toISOString(),
    })
    .eq("managed_by", userId);

  await service.from("device_assignments").delete().eq("user_id", userId);
  await service.from("environment_memberships").delete().eq("user_id", userId);
  await service.from("environment_invitations").delete().eq("created_by", userId);
  await service.from("environment_invitations").delete().eq("accepted_by", userId);
  await service.from("admin_profiles").delete().eq("user_id", userId);

  const { error: deleteError } = await service.auth.admin.deleteUser(userId);
  if (deleteError) {
    throw deleteError;
  }

  return {
    ok: true,
    deletedUserId: userId,
    role: target.role,
    email: target.email,
  };
}

async function linkGuestDevice(
  service: Awaited<ReturnType<typeof getRequestActor>>["service"],
  actor: Awaited<ReturnType<typeof getRequestActor>>,
  body: Record<string, unknown>
) {
  const deviceId = String(body.deviceId || "").trim();
  if (!deviceId) {
    throw new Error("deviceId wajib diisi.");
  }
  const role = String(actor.profile?.role || "");
  if (!["user", "operator"].includes(role)) {
    throw new Error("Penautan dari Guest Mode hanya tersedia untuk akun User atau Operator.");
  }

  const device = await ensureDeviceExists(service, deviceId);
  await assertDeviceLinkAvailable(service, deviceId, actor.user.id);

  const environmentId = getActorEnvironmentId(actor);
  const { data, error } = await service
    .from("device_assignments")
    .upsert({
      device_id: deviceId,
      user_id: actor.user.id,
      environment_id: environmentId || null,
      assignment_role: "owner",
      status: "active",
      is_primary: true,
      assigned_by: actor.user.id,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  await service
    .from("admin_profiles")
    .update({
      standalone_state: environmentId ? "linked" : "standalone",
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", actor.user.id)
    .in("role", ["user", "operator"]);

  return {
    ok: true,
    device,
    assignment: data,
  };
}

async function updateDeviceAlias(
  service: Awaited<ReturnType<typeof getRequestActor>>["service"],
  actor: Awaited<ReturnType<typeof getRequestActor>>,
  body: Record<string, unknown>
) {
  const deviceId = String(body.deviceId || "").trim();
  const alias = sanitizeDeviceAlias(body.alias);
  await requireDeviceAccess(service, actor, deviceId);

  if (!alias) {
    const { error } = await service
      .from("device_aliases")
      .delete()
      .eq("user_id", actor.user.id)
      .eq("device_id", deviceId);
    if (error) {
      throw error;
    }
    return { ok: true, deviceId, alias: "" };
  }

  const { data, error } = await service
    .from("device_aliases")
    .upsert({
      user_id: actor.user.id,
      device_id: deviceId,
      alias,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return { ok: true, alias: data };
}

async function queueScopedCommand(
  service: Awaited<ReturnType<typeof getRequestActor>>["service"],
  actor: Awaited<ReturnType<typeof getRequestActor>>,
  body: Record<string, unknown>
) {
  const deviceId = String(body.deviceId || "").trim();
  const action = sanitizeCommandAction(body.commandAction || body.command || body.actionName);
  const deviceWideAction = ["kill", "update", "agent_start", "agent_stop", "agent_restart"].includes(action);
  const serviceName = deviceWideAction ? null : String(body.serviceName || "").trim();
  await requireDeviceAccess(service, actor, deviceId);

  if (!deviceWideAction && !serviceName) {
    throw new Error("Nama service wajib diisi untuk aksi start/stop.");
  }
  if ((action === "kill" || action.startsWith("agent_")) && !isSuperAdminProfile(actor.profile) && !isOperatorProfile(actor.profile)) {
    throw new Error("Hanya SuperAdmin atau Operator yang dapat menghentikan agent.");
  }
  if (action === "update") {
    const { data: device, error: deviceError } = await service
      .from("devices")
      .select("device_id, app_version, release_tag")
      .eq("device_id", deviceId)
      .maybeSingle();

    if (deviceError) {
      throw deviceError;
    }
    if (!supportsRemoteUpdate(device)) {
      throw new Error(
        `Agent versi ini belum mendukung update jarak jauh. Jalankan installer School Services v${REMOTE_UPDATE_MIN_VERSION} atau lebih baru langsung di komputer ini.`
      );
    }
  }

  const { data, error } = await service
    .from("commands")
    .insert({
      device_id: deviceId,
      service_name: serviceName,
      action,
      status: "pending",
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return { ok: true, command: data };
}

async function updateScopedDeviceStatus(
  service: Awaited<ReturnType<typeof getRequestActor>>["service"],
  actor: Awaited<ReturnType<typeof getRequestActor>>,
  body: Record<string, unknown>
) {
  if (!isSuperAdminProfile(actor.profile)) {
    throw new Error("Hanya SuperAdmin yang dapat memblokir atau membuka blokir device.");
  }

  const deviceId = String(body.deviceId || "").trim();
  const status = sanitizeDeviceStatus(body.status);
  await requireDeviceAccess(service, actor, deviceId);

  const { data, error } = await service
    .from("devices")
    .update({ status })
    .eq("device_id", deviceId)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return { ok: true, device: data };
}

async function listTransferHistory(
  service: Awaited<ReturnType<typeof getRequestActor>>["service"],
  actor: Awaited<ReturnType<typeof getRequestActor>>,
  body: Record<string, unknown>
) {
  if (!isSuperAdminProfile(actor.profile)) {
    throw new Error("Riwayat transfer data hanya tersedia untuk SuperAdmin.");
  }

  const deviceId = String(body.deviceId || "").trim();
  let jobsQuery = service
    .from("file_jobs")
    .select("*")
    .in("status", ["completed", "failed", "cancelled"])
    .order("created_at", { ascending: false })
    .limit(TRANSFER_HISTORY_LIMIT);
  let auditQuery = service
    .from("file_audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(TRANSFER_HISTORY_LIMIT);

  if (deviceId) {
    await requireDeviceAccess(service, actor, deviceId);
    jobsQuery = jobsQuery.eq("device_id", deviceId);
    auditQuery = auditQuery.eq("device_id", deviceId);
  }

  const [jobsResult, auditResult] = await Promise.all([jobsQuery, auditQuery]);
  if (jobsResult.error) {
    throw jobsResult.error;
  }
  if (auditResult.error) {
    throw auditResult.error;
  }

  return {
    ok: true,
    jobs: jobsResult.data || [],
    auditLogs: auditResult.data || [],
  };
}

async function listStorageArtifacts(
  service: Awaited<ReturnType<typeof getRequestActor>>["service"],
  actor: Awaited<ReturnType<typeof getRequestActor>>,
  body: Record<string, unknown>
) {
  if (!isSuperAdminProfile(actor.profile)) {
    throw new Error("Inventaris bucket hanya tersedia untuk SuperAdmin.");
  }

  const requestedDeviceId = String(body.deviceId || "").trim();
  const requestedBucket = String(body.bucket || "").trim();
  const buckets = requestedBucket && FILE_BUCKETS.includes(requestedBucket)
    ? [requestedBucket]
    : FILE_BUCKETS;

  let jobsQuery = service
    .from("file_jobs")
    .select("*")
    .not("artifact_bucket", "is", null)
    .order("created_at", { ascending: false })
    .limit(300);

  if (requestedDeviceId) {
    await requireDeviceAccess(service, actor, requestedDeviceId);
    jobsQuery = jobsQuery.eq("device_id", requestedDeviceId);
  }
  if (requestedBucket) {
    jobsQuery = jobsQuery.eq("artifact_bucket", requestedBucket);
  }

  const [{ data: jobs, error: jobsError }, { data: devices, error: devicesError }] = await Promise.all([
    jobsQuery,
    service.from("devices").select("device_id, device_name"),
  ]);

  if (jobsError) {
    throw jobsError;
  }
  if (devicesError) {
    throw devicesError;
  }

  const deviceMap = new Map(
    (devices || []).map((device) => [String(device.device_id), String(device.device_name || "")])
  );
  const artifacts: Record<string, unknown>[] = [];
  for (const job of jobs || []) {
    const normalized = normalizeArtifactJob(job, deviceMap.get(String(job.device_id)) || "");
    if (normalized.deletedAt) {
      const exists = normalized.bucket && normalized.objectKey
        ? await storageObjectExists(service, String(normalized.bucket), String(normalized.objectKey))
        : false;
      if (!exists) {
        continue;
      }
      artifacts.push({
        ...normalized,
        status: "orphaned",
        error: "Berkas ditandai terhapus tetapi object masih ada di storage.",
      });
      continue;
    }
    artifacts.push(normalized);
  }
  const knownKeys = new Set(
    artifacts
      .filter((artifact) => artifact.bucket && artifact.objectKey)
      .map((artifact) => `${artifact.bucket}:${artifact.objectKey}`)
  );

  const orphanedObjects: Record<string, unknown>[] = [];
  for (const bucket of buckets) {
    const { data, error } = await service.storage.from(bucket).list("", {
      limit: 1000,
      sortBy: { column: "created_at", order: "desc" },
    });
    if (error) {
      orphanedObjects.push({
        id: `${bucket}:__error`,
        bucket,
        objectKey: "",
        fileName: "Bucket belum bisa dibaca",
        status: "error",
        error: error.message,
        fromJob: false,
      });
      continue;
    }

    for (const object of data || []) {
      const objectName = String(object.name || "").trim();
      if (!objectName || knownKeys.has(`${bucket}:${objectName}`)) {
        continue;
      }
      const isFolder = isStorageFolderEntry(object as Record<string, unknown>);
      orphanedObjects.push({
        id: `${bucket}:${objectName}`,
        bucket,
        objectKey: objectName,
        fileName: safeFileNameFromKey(objectName),
        deviceId: null,
        deviceName: "Tidak diketahui",
        sourcePath: null,
        jobId: null,
        jobType: "storage_object",
        status: "orphaned",
        deliveryMode: bucket === ARCHIVE_BUCKET ? "persistent" : "temp",
        size: isFolder ? null : Number(object.metadata?.size || 0) || null,
        contentType: object.metadata?.mimetype || null,
        createdAt: object.created_at || object.updated_at || null,
        expiresAt: null,
        deletedAt: null,
        fromJob: false,
        isFolder,
      });
    }
  }

  return {
    ok: true,
    buckets,
    artifacts: [...artifacts, ...orphanedObjects],
  };
}

async function deleteStorageArtifact(
  service: Awaited<ReturnType<typeof getRequestActor>>["service"],
  actor: Awaited<ReturnType<typeof getRequestActor>>,
  body: Record<string, unknown>
) {
  if (!isSuperAdminProfile(actor.profile)) {
    throw new Error("Hanya SuperAdmin yang dapat menghapus berkas bucket.");
  }

  const bucket = String(body.bucket || "").trim();
  const objectKey = normalizeStorageKey(body.objectKey);
  const jobId = Number(body.jobId || 0);
  const isFolder = body.isFolder === true;

  if (!FILE_BUCKETS.includes(bucket)) {
    throw new Error("Bucket tidak dikenali.");
  }
  if (!objectKey) {
    throw new Error("objectKey wajib diisi.");
  }

  let updatedJob = null;
  let jobRecord: Record<string, unknown> | null = null;
  const removalTargets = new Map<string, Set<string>>();

  function addRemovalTarget(nextBucket: string, nextObjectKey: string) {
    if (!nextBucket || !nextObjectKey || !FILE_BUCKETS.includes(nextBucket)) {
      return;
    }
    if (!removalTargets.has(nextBucket)) {
      removalTargets.set(nextBucket, new Set());
    }
    removalTargets.get(nextBucket)?.add(nextObjectKey);
  }

  if (isFolder) {
    if (await storageObjectExists(service, bucket, objectKey)) {
      addRemovalTarget(bucket, objectKey);
    }
    for (const childKey of await collectStorageKeysByPrefix(service, bucket, objectKey)) {
      addRemovalTarget(bucket, childKey);
    }
  } else {
    addRemovalTarget(bucket, objectKey);
  }

  if (jobId) {
    const { data: job, error: jobError } = await service
      .from("file_jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();

    if (jobError) {
      throw jobError;
    }

    jobRecord = job || null;
    addRemovalTarget(String(job?.artifact_bucket || ""), String(job?.artifact_object_key || ""));

    const result = job?.result && typeof job.result === "object"
      ? job.result as Record<string, unknown>
      : null;
    const parts = Array.isArray(result?.parts) ? result.parts : [];
    for (const part of parts) {
      if (!part || typeof part !== "object") {
        continue;
      }
      addRemovalTarget(String((part as Record<string, unknown>).bucket || ""), String((part as Record<string, unknown>).objectKey || ""));
    }
  }

  for (const [targetBucket, objectKeys] of removalTargets.entries()) {
    const keys = [...objectKeys].filter(Boolean);
    if (!keys.length) {
      continue;
    }
    const { error: removeError } = await service.storage.from(targetBucket).remove(keys);
    if (removeError) {
      throw removeError;
    }
  }

  if (jobId) {
    const { data, error } = await service
      .from("file_jobs")
      .update({
        artifact_deleted_at: new Date().toISOString(),
        artifact_deleted_by: actor.user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .select("*")
      .maybeSingle();

    if (error) {
      throw error;
    }
    updatedJob = data || null;
  }

  await service.from("file_audit_logs").insert({
    device_id: String(updatedJob?.device_id || jobRecord?.device_id || body.deviceId || "storage"),
    requested_by: actor.user.id,
    job_id: jobId || null,
    action: "delete_artifact",
    target_path: objectKey,
      details: {
        bucket,
        objectKey,
        isFolder,
        fileName: String(body.fileName || safeFileNameFromKey(objectKey)),
        removedTargetCount: [...removalTargets.values()].reduce((total, keys) => total + keys.size, 0),
      },
  });

  return {
    ok: true,
    bucket,
    objectKey,
    job: updatedJob,
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await request.json();
    const action = String(body.action || "").trim();

    if (["createJob", "cancelJob", "signArtifact", "promoteArchive", "setupStatus"].includes(action)) {
      const { service, user } = await requireSuperAdmin(request);

      if (action === "createJob") {
        const payload = {
          device_id: String(body.deviceId || "").trim(),
          requested_by: user.id,
          job_type: String(body.jobType || "").trim(),
          delivery_mode: String(body.deliveryMode || "temp").trim(),
          source_path: body.sourcePath ? String(body.sourcePath) : null,
          destination_path: body.destinationPath ? String(body.destinationPath) : null,
          selection: sanitizeSelection(body.selection),
          options: body.options && typeof body.options === "object" ? body.options : {},
          status: "pending",
        };

        const { data, error } = await service
          .from("file_jobs")
          .insert(payload)
          .select("*")
          .single();

        if (error) {
          throw error;
        }

        await service.from("file_audit_logs").insert({
          device_id: payload.device_id,
          requested_by: user.id,
          job_id: data.id,
          action: `create:${payload.job_type}`,
          target_path: payload.source_path || payload.destination_path,
          details: {
            deliveryMode: payload.delivery_mode,
            selectionCount: payload.selection.length,
          },
        });

        return json({ ok: true, job: data });
      }

      if (action === "cancelJob") {
        const jobId = Number(body.jobId);
        const { data, error } = await service
          .from("file_jobs")
          .update({
            status: "cancelled",
            updated_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          })
          .eq("id", jobId)
          .select("*")
          .single();

        if (error) {
          throw error;
        }

        return json({ ok: true, job: data });
      }

      if (action === "signArtifact") {
        const bucket = String(body.bucket || TEMP_BUCKET);
        const objectKey = String(body.objectKey || "").trim();

        if (!objectKey) {
          throw new Error("Artifact object key is required.");
        }

        const { data, error } = await service.storage
          .from(bucket)
          .createSignedUrl(objectKey, 60 * 15, {
            download: body.downloadFileName ? String(body.downloadFileName) : undefined,
          });

        if (error) {
          throw error;
        }

        return json({ ok: true, signedUrl: data.signedUrl });
      }

      if (action === "promoteArchive") {
        const jobId = Number(body.jobId);
        const { data: job, error: jobError } = await service
          .from("file_jobs")
          .select("*")
          .eq("id", jobId)
          .single();

        if (jobError) {
          throw jobError;
        }

        if (!job.artifact_object_key || !job.artifact_bucket) {
          throw new Error("Job has no artifact to promote.");
        }

        const nextKey = `${job.device_id}/${job.id}/${Date.now()}-${job.artifact_object_key.split("/").pop()}`;
        const { data: sourceData, error: sourceError } = await service.storage
          .from(job.artifact_bucket)
          .download(job.artifact_object_key);

        if (sourceError) {
          throw sourceError;
        }

        const { error: uploadError } = await service.storage
          .from(ARCHIVE_BUCKET)
          .upload(nextKey, sourceData, {
            upsert: true,
            contentType: sourceData.type || "application/octet-stream",
          });

        if (uploadError) {
          throw uploadError;
        }

        const { data: updatedJob, error: updateError } = await service
          .from("file_jobs")
          .update({
            delivery_mode: "persistent",
            artifact_bucket: ARCHIVE_BUCKET,
            artifact_object_key: nextKey,
            artifact_expires_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id)
          .select("*")
          .single();

        if (updateError) {
          throw updateError;
        }

        await service.from("file_audit_logs").insert({
          device_id: job.device_id,
          requested_by: user.id,
          job_id: job.id,
          action: "promote_archive",
          target_path: job.source_path,
          details: {
            fromBucket: job.artifact_bucket,
            toBucket: ARCHIVE_BUCKET,
            nextKey,
          },
        });

        return json({ ok: true, job: updatedJob });
      }

      const [adminProfiles, fileJobs, fileRoots, authPolicy, guestShortcuts] = await Promise.all([
        service.from("admin_profiles").select("user_id", { count: "exact", head: true }),
        service.from("file_jobs").select("id", { count: "exact", head: true }),
        service.from("file_roots").select("id", { count: "exact", head: true }),
        getAuthPolicy(service),
        service.from("guest_shortcuts").select("device_id", { count: "exact", head: true }),
      ]);

      return json({
        ok: true,
        counts: {
          adminProfiles: adminProfiles.count || 0,
          fileJobs: fileJobs.count || 0,
          fileRoots: fileRoots.count || 0,
          guestShortcuts: guestShortcuts.count || 0,
        },
        authPolicy: authPolicy.raw || null,
      });
    }

    const actor = await requireApprovedActor(request);
    const { service } = actor;

    if (action === "listDashboard") {
      return json(await getDashboardPayload(service, actor));
    }

    if (action === "listAccounts") {
      return json({ ok: true, accounts: await getScopedAccounts(service, actor) });
    }

    if (action === "listEnvironments") {
      return json({ ok: true, environments: await getScopedEnvironments(service, actor) });
    }

    if (action === "createEnvironment") {
      if (!isSuperAdminProfile(actor.profile)) {
        throw new Error("Hanya SuperAdmin yang dapat membuat lingkungan operator.");
      }

      const operatorUserId = String(body.operatorUserId || "").trim();
      const name = String(body.name || "").trim();
      if (!operatorUserId || !name) {
        throw new Error("operatorUserId dan nama lingkungan wajib diisi.");
      }

      const { data, error } = await service
        .from("operator_environments")
        .upsert({
          operator_id: operatorUserId,
          name,
          referral_code: await generateReferralCode(service),
          is_active: true,
          created_by: actor.user.id,
          updated_at: new Date().toISOString(),
        })
        .select("*")
        .single();

      if (error) {
        throw error;
      }

      await service
        .from("admin_profiles")
        .update({
          primary_environment_id: data.id,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", operatorUserId);

      return json({ ok: true, environment: data });
    }

    if (action === "rotateReferralCode") {
      const requestedEnvironmentId = String(body.environmentId || actor.environment?.id || "").trim();
      if (!requestedEnvironmentId) {
        throw new Error("environmentId is required.");
      }
      if (!isSuperAdminProfile(actor.profile) && requestedEnvironmentId !== String(actor.environment?.id || "")) {
        throw new Error("Anda tidak dapat mengubah referral code di luar lingkungan Anda.");
      }

      const { data, error } = await service
        .from("operator_environments")
        .update({
          referral_code: await generateReferralCode(service),
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestedEnvironmentId)
        .select("*")
        .single();

      if (error) {
        throw error;
      }

      return json({ ok: true, environment: data });
    }

    if (action === "inviteUser") {
      const environmentId = String(body.environmentId || actor.environment?.id || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      if (!environmentId || !email) {
        throw new Error("environmentId dan email wajib diisi.");
      }
      if (!isSuperAdminProfile(actor.profile) && environmentId !== String(actor.environment?.id || "")) {
        throw new Error("Anda tidak dapat membuat undangan di luar lingkungan Anda.");
      }

      const { data, error } = await service
        .from("environment_invitations")
        .upsert({
          environment_id: environmentId,
          email,
          invite_role: "user",
          status: "pending",
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          created_by: actor.user.id,
          metadata: {
            invitedByRole: actor.profile?.role,
          },
          updated_at: new Date().toISOString(),
        })
        .select("*")
        .single();

      if (error) {
        throw error;
      }

      return json({ ok: true, invitation: data });
    }

    if (action === "createAccount") {
      return json(await createManagedAccount(service, actor, body));
    }

    if (action === "linkGuestDevice") {
      return json(await linkGuestDevice(service, actor, body));
    }

    if (action === "updateDeviceAlias") {
      return json(await updateDeviceAlias(service, actor, body));
    }

    if (action === "queueCommand") {
      return json(await queueScopedCommand(service, actor, body));
    }

    if (action === "updateDeviceStatus") {
      return json(await updateScopedDeviceStatus(service, actor, body));
    }

    if (action === "listTransferHistory") {
      return json(await listTransferHistory(service, actor, body));
    }

    if (action === "listStorageArtifacts") {
      return json(await listStorageArtifacts(service, actor, body));
    }

    if (action === "deleteStorageArtifact") {
      return json(await deleteStorageArtifact(service, actor, body));
    }

    if (action === "approveAccount" || action === "rejectAccount" || action === "disableAccount") {
      return json(await updateAccountStatus(service, actor, action, body));
    }

    if (action === "deleteAccount") {
      return json(await deleteManagedAccount(service, actor, body));
    }

    if (action === "extendApproval") {
      const userId = String(body.userId || "").trim();
      const hours = sanitizeApprovalHours(body.hours, 24);
      const dueAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

      if (!userId) {
        throw new Error("userId is required.");
      }
      if (!isSuperAdminProfile(actor.profile) && !isOperatorProfile(actor.profile)) {
        throw new Error("Hanya SuperAdmin atau Operator yang dapat memperpanjang approval akun.");
      }

      if (!isSuperAdminProfile(actor.profile)) {
        const { data: membership } = await service
          .from("environment_memberships")
          .select("id")
          .eq("environment_id", String(actor.environment?.id || ""))
          .eq("user_id", userId)
          .in("status", ["pending", "approved"])
          .maybeSingle();

        if (!membership) {
          throw new Error("Akun target berada di luar lingkungan operator Anda.");
        }
      }

      const { data, error } = await service
        .from("admin_profiles")
        .update({
          status: "pending",
          approval_due_at: dueAt,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .select("*")
        .single();

      if (error) {
        throw error;
      }

      return json({ ok: true, account: data });
    }

    if (action === "updateAuthPolicy") {
      if (!isSuperAdminProfile(actor.profile)) {
        throw new Error("Hanya SuperAdmin yang dapat mengubah policy auth.");
      }

      const current = await getAuthPolicy(service);
      const value = {
        ...current.raw,
        operatorAutoApproveHours: sanitizeApprovalHours(body.operatorAutoApproveHours, current.operatorAutoApproveHours),
        environmentUserAutoApproveHours: sanitizeApprovalHours(
          body.environmentUserAutoApproveHours,
          current.environmentUserAutoApproveHours
        ),
        standaloneUserApprovalMode:
          String(body.standaloneUserApprovalMode || current.standaloneUserApprovalMode).trim().toLowerCase() === "auto"
            ? "auto"
            : "manual",
        standaloneUserAutoApproveHours: sanitizeApprovalHours(
          body.standaloneUserAutoApproveHours,
          current.standaloneUserAutoApproveHours
        ),
        maintenanceIntervalMinutes: sanitizeApprovalHours(
          body.maintenanceIntervalMinutes,
          current.maintenanceIntervalMinutes
        ),
        passwordResetRedirectUrl:
          String(body.passwordResetRedirectUrl || current.passwordResetRedirectUrl).trim() ||
          `${DASHBOARD_PUBLIC_URL}/auth/reset-password`,
      };

      const { error } = await service.from("app_settings").upsert({
        key: "auth_policy",
        value,
        updated_at: new Date().toISOString(),
      });

      if (error) {
        throw error;
      }

      return json({ ok: true, settings: value });
    }

    if (action === "resetPassword") {
      if (!isSuperAdminProfile(actor.profile) && !isOperatorProfile(actor.profile)) {
        throw new Error("Akses reset password tidak diizinkan.");
      }

      const email = String(body.email || "").trim().toLowerCase();
      if (!email) {
        throw new Error("Email is required.");
      }

      if (isOperatorProfile(actor.profile)) {
        const scopedAccounts = await getScopedAccounts(service, actor);
        if (!scopedAccounts.some((account) => String(account.email || "").toLowerCase() === email)) {
          throw new Error("Email target berada di luar lingkungan operator Anda.");
        }
      }

      const authPolicy = await getAuthPolicy(service);
      const redirectTo =
        String(authPolicy.passwordResetRedirectUrl || "").trim() ||
        `${DASHBOARD_PUBLIC_URL}/auth/reset-password`;
      const anon = createAnonClient();
      const { error } = await anon.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) {
        throw error;
      }

      return json({ ok: true, email, redirectTo });
    }

    if (action === "assignDevice") {
      const deviceId = String(body.deviceId || "").trim();
      const userId = String(body.userId || "").trim();
      let environmentId = String(body.environmentId || actor.environment?.id || "").trim();

      if (!deviceId || !userId) {
        throw new Error("deviceId dan userId wajib diisi.");
      }
      if (!isSuperAdminProfile(actor.profile) && !isOperatorProfile(actor.profile)) {
        throw new Error("Hanya SuperAdmin atau Operator yang dapat menautkan device ke akun lain.");
      }

      if (!isSuperAdminProfile(actor.profile)) {
        if (!environmentId || environmentId !== String(actor.environment?.id || "")) {
          throw new Error("Device assignment hanya dapat dilakukan di lingkungan operator Anda.");
        }
      }

      if (!environmentId) {
        const { data: targetProfile } = await service
          .from("admin_profiles")
          .select("primary_environment_id")
          .eq("user_id", userId)
          .maybeSingle();
        environmentId = String(targetProfile?.primary_environment_id || "").trim();
      }

      const { data, error } = await service
        .from("device_assignments")
        .upsert({
          device_id: deviceId,
          user_id: userId,
          environment_id: environmentId || null,
          assignment_role: "owner",
          status: "active",
          is_primary: true,
          assigned_by: actor.user.id,
          updated_at: new Date().toISOString(),
        })
        .select("*")
        .single();

      if (error) {
        throw error;
      }

      return json({ ok: true, assignment: data });
    }

    if (action === "unassignDevice") {
      const assignmentId = String(body.assignmentId || "").trim();
      if (!assignmentId) {
        throw new Error("assignmentId wajib diisi.");
      }
      if (!isSuperAdminProfile(actor.profile) && !isOperatorProfile(actor.profile)) {
        throw new Error("Hanya SuperAdmin atau Operator yang dapat melepas assignment device.");
      }

      let assignmentQuery = service
        .from("device_assignments")
        .update({
          status: "revoked",
          is_primary: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", assignmentId);

      if (!isSuperAdminProfile(actor.profile)) {
        assignmentQuery = assignmentQuery.eq("environment_id", String(actor.environment?.id || ""));
      }

      const { data, error } = await assignmentQuery.select("*").single();

      if (error) {
        throw error;
      }

      return json({ ok: true, assignment: data });
    }

    if (action === "syncGuestLink") {
      const deviceId = String(body.deviceId || "").trim();
      if (!deviceId) {
        throw new Error("deviceId is required.");
      }
      if (!(await canAccessDevice(service, actor, deviceId))) {
        throw new Error("Anda tidak memiliki akses ke device ini.");
      }

      const guestPath = buildGuestPath(deviceId);
      const guestUrl = `${DASHBOARD_PUBLIC_URL}${guestPath}`;
      const { error } = await service.from("guest_shortcuts").upsert({
        device_id: deviceId,
        guest_path: guestPath,
        guest_url: guestUrl,
        service_name: "rapor",
        updated_at: new Date().toISOString(),
      });

      if (error) {
        throw error;
      }

      return json({ ok: true, deviceId, guestPath, guestUrl });
    }

    throw new Error(`Unsupported action: ${action}`);
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 400 }
    );
  }
});
