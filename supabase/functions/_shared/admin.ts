import { createClient } from "npm:@supabase/supabase-js@2";

export function createServiceClient() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createAnonClient() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_ANON_KEY") || "";
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function getAuthPolicy(service = createServiceClient()) {
  const { data } = await service
    .from("app_settings")
    .select("value")
    .eq("key", "auth_policy")
    .maybeSingle();

  return {
    operatorAutoApproveHours: Math.max(
      1,
      Number(
        data?.value?.operatorAutoApproveHours ??
          data?.value?.approvalWindowHours ??
          24
      )
    ),
    environmentUserAutoApproveHours: Math.max(
      1,
      Number(data?.value?.environmentUserAutoApproveHours ?? 8)
    ),
    standaloneUserApprovalMode:
      data?.value?.standaloneUserApprovalMode
        ? String(data.value.standaloneUserApprovalMode).toLowerCase() === "auto"
          ? "auto"
          : "manual"
        : data?.value?.standaloneUserManualMode === false
          ? "auto"
          : "manual",
    standaloneUserAutoApproveHours: Math.max(
      1,
      Number(data?.value?.standaloneUserAutoApproveHours ?? 24)
    ),
    maintenanceIntervalMinutes: Math.max(
      1,
      Number(data?.value?.maintenanceIntervalMinutes ?? 15)
    ),
    passwordResetRedirectUrl:
      String(data?.value?.passwordResetRedirectUrl || "").trim() ||
      "https://school-services.netlify.app/auth/reset-password",
    raw: data?.value || {},
  };
}

function buildOperatorEnvironmentName(profile: Record<string, unknown> | null) {
  const displayName = String(profile?.display_name || "").trim();
  const email = String(profile?.email || "").trim();
  const seed = displayName || email.split("@")[0] || "Operator";
  return `${seed} Workspace`;
}

async function ensureOperatorEnvironment(
  service: ReturnType<typeof createServiceClient>,
  profile: Record<string, unknown> | null
) {
  const userId = String(profile?.user_id || "").trim();
  const primaryEnvironmentId = String(profile?.primary_environment_id || "").trim();
  const role = String(profile?.role || "").trim().toLowerCase();

  if (!userId || role !== "operator") {
    return null;
  }

  const environmentQuery = service
    .from("operator_environments")
    .select("id, operator_id, name, referral_code, is_active, created_at, updated_at");

  let environment = null;

  if (primaryEnvironmentId) {
    const { data } = await environmentQuery.eq("id", primaryEnvironmentId).maybeSingle();
    environment = data || null;
  }

  if (!environment) {
    const { data } = await environmentQuery.eq("operator_id", userId).maybeSingle();
    environment = data || null;
  }

  if (!environment) {
    const referral = await service.rpc("generate_referral_code");
    if (referral.error) {
      throw referral.error;
    }

    const { data, error } = await service
      .from("operator_environments")
      .insert({
        operator_id: userId,
        name: buildOperatorEnvironmentName(profile),
        referral_code: String(referral.data || "").trim(),
        is_active: true,
        created_by: userId,
        updated_at: new Date().toISOString(),
      })
      .select("id, operator_id, name, referral_code, is_active, created_at, updated_at")
      .single();

    if (error) {
      throw error;
    }

    environment = data;
  }

  if (environment?.id && primaryEnvironmentId !== String(environment.id)) {
    const { error } = await service
      .from("admin_profiles")
      .update({
        primary_environment_id: environment.id,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (error) {
      throw error;
    }
  }

  return environment;
}

async function loadEnvironmentContext(service: ReturnType<typeof createServiceClient>, profile: Record<string, unknown> | null) {
  const primaryEnvironmentId = String(profile?.primary_environment_id || "").trim();
  const userId = String(profile?.user_id || "").trim();
  const isOperator = String(profile?.role || "").trim().toLowerCase() === "operator";
  if (!primaryEnvironmentId && !isOperator) {
    return {
      environment: null,
      memberships: [],
    };
  }

  const ensuredEnvironment = await ensureOperatorEnvironment(service, profile);
  const environmentQuery = service
    .from("operator_environments")
    .select("id, operator_id, name, referral_code, is_active, created_at, updated_at");
  const [{ data: environment }, { data: memberships }] = await Promise.all([
    ensuredEnvironment
      ? Promise.resolve({ data: ensuredEnvironment })
      : (primaryEnvironmentId
      ? environmentQuery.eq("id", primaryEnvironmentId)
      : environmentQuery.eq("operator_id", userId)
    ).maybeSingle(),
    service
      .from("environment_memberships")
      .select("id, environment_id, user_id, role, status, joined_via, approved_at, created_at, updated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  return {
    environment: environment || null,
    memberships: memberships || [],
  };
}

export async function getRequestActor(request: Request) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    throw new Error("Missing Authorization header.");
  }

  const service = createServiceClient();
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const {
    data: { user },
    error: userError,
  } = await service.auth.getUser(token);

  if (userError || !user) {
    throw new Error("Invalid admin session.");
  }

  const { data: profile, error: profileError } = await service
    .from("admin_profiles")
    .select(
      "user_id, email, role, status, approval_due_at, display_name, device_scope, registration_source, managed_by, primary_environment_id, standalone_state, approved_at, approved_by, rejected_at, rejected_by, rejection_reason, disabled_at, disabled_by"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    throw profileError;
  }

  const { environment, memberships } = await loadEnvironmentContext(service, profile);

  return {
    service,
    user,
    profile,
    environment,
    memberships,
  };
}

export function isApprovedActor(actor: Awaited<ReturnType<typeof getRequestActor>>) {
  return Boolean(actor.profile && actor.profile.status === "approved");
}

export async function requireApprovedActor(request: Request) {
  const actor = await getRequestActor(request);
  if (!isApprovedActor(actor)) {
    throw new Error("Account access is pending or unavailable.");
  }
  return actor;
}

export async function requireSuperAdmin(request: Request) {
  const actor = await requireApprovedActor(request);
  if (!actor.profile || actor.profile.role !== "super_admin") {
    throw new Error("Admin access denied.");
  }

  return actor;
}

export async function requireAdmin(request: Request) {
  const actor = await getRequestActor(request);
  if (!actor.profile || !["super_admin", "operator"].includes(actor.profile.role) || actor.profile.status !== "approved") {
    throw new Error("Admin/Operator access denied.");
  }

  return actor;
}

