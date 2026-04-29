import { corsHeaders, json } from "../_shared/cors.ts";
import { createAnonClient, requireSuperAdmin, requireAdmin } from "../_shared/admin.ts";

const TEMP_BUCKET = "agent-temp-artifacts";
const ARCHIVE_BUCKET = "agent-archives";
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
  return `/guest/${encodeURIComponent(deviceId)}`;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const actor = await requireAdmin(request);
    const { service, user, profile } = actor;
    const isSuperAdmin = profile.role === "super_admin";
    const body = await request.json();
    const action = String(body.action || "").trim();

    if (["createJob", "cancelJob", "signArtifact", "promoteArchive", "updateAuthPolicy"].includes(action)) {
      if (!isSuperAdmin) throw new Error("Super admin access required.");
    }

    if (action === "createEnvironment") {
      const name = String(body.name || "").trim();
      if (!name) throw new Error("Environment name required");
      const operatorId = isSuperAdmin ? (body.operatorId || user.id) : user.id;
      const { data, error } = await service.from("operator_environments").insert({
        operator_id: operatorId,
        name
      }).select("*").single();
      if (error) throw error;
      return json({ ok: true, environment: data });
    }

    if (action === "generateReferralCode") {
      let targetEnvId = body.environmentId;
      if (!isSuperAdmin) {
        const { data: env } = await service.from("operator_environments").select("id").eq("operator_id", user.id).maybeSingle();
        if (!env) throw new Error("No environment found");
        targetEnvId = env.id;
      }
      if (!targetEnvId) throw new Error("Environment ID required");
      
      const code = Math.random().toString(36).substring(2, 10).toUpperCase();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      
      const { data, error } = await service.from("environment_invitations").insert({
        environment_id: targetEnvId,
        referral_code: code,
        created_by: user.id,
        expires_at: expiresAt
      }).select("*").single();
      if (error) throw error;
      return json({ ok: true, invitation: data });
    }

    if (action === "assignDevice") {
      const targetUserId = String(body.userId || "").trim();
      const targetDeviceId = String(body.deviceId || "").trim();
      if (!targetUserId || !targetDeviceId) throw new Error("userId and deviceId required");
      
      if (!isSuperAdmin) {
        const { data: env } = await service.from("operator_environments").select("id").eq("operator_id", user.id).maybeSingle();
        if (!env) throw new Error("Not authorized");
        const { data: member } = await service.from("environment_memberships").select("*").eq("environment_id", env.id).eq("user_id", targetUserId).maybeSingle();
        if (!member && targetUserId !== user.id) throw new Error("Not authorized to manage this user");
      }
      
      const { error } = await service.from("device_assignments").upsert({
        device_id: targetDeviceId,
        user_id: targetUserId,
        assigned_by: user.id,
        assigned_at: new Date().toISOString()
      });
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "unassignDevice") {
      const targetUserId = String(body.userId || "").trim();
      const targetDeviceId = String(body.deviceId || "").trim();
      if (!isSuperAdmin) {
        const { data: env } = await service.from("operator_environments").select("id").eq("operator_id", user.id).maybeSingle();
        if (!env) throw new Error("Not authorized");
        const { data: member } = await service.from("environment_memberships").select("*").eq("environment_id", env.id).eq("user_id", targetUserId).maybeSingle();
        if (!member && targetUserId !== user.id) throw new Error("Not authorized");
      }
      const { error } = await service.from("device_assignments").delete().match({
        device_id: targetDeviceId,
        user_id: targetUserId
      });
      if (error) throw error;
      return json({ ok: true });
    }

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

    if (action === "listAccounts") {
      const { data, error } = await service
        .from("admin_profiles")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        throw error;
      }

      return json({ ok: true, accounts: data || [] });
    }

    if (action === "createAccount") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "").trim();
      const role = sanitizeRole(body.role);
      const displayName = String(body.displayName || "").trim() || null;
      const approvalHours = sanitizeApprovalHours(body.approvalWindowHours, 24);
      const autoApprove = Boolean(body.autoApprove);
      const status = autoApprove ? "pending" : "approved";
      const approvalDueAt =
        status === "pending"
          ? new Date(Date.now() + approvalHours * 60 * 60 * 1000).toISOString()
          : null;

      if (!email || !password) {
        throw new Error("Email and password are required.");
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
        approved_by: status === "approved" ? user.id : null,
        updated_at: new Date().toISOString(),
      });

      if (profileError) {
        throw profileError;
      }

      return json({ ok: true, userId: created.user.id, status, approvalDueAt });
    }

    if (action === "approveAccount" || action === "rejectAccount" || action === "disableAccount") {
      const userId = String(body.userId || "").trim();
      if (!userId) {
        throw new Error("userId is required.");
      }

      const patch: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (action === "approveAccount") {
        patch.status = "approved";
        patch.approved_at = new Date().toISOString();
        patch.approved_by = user.id;
        patch.approval_due_at = null;
        patch.rejected_at = null;
        patch.rejected_by = null;
        patch.rejection_reason = null;
        patch.disabled_at = null;
        patch.disabled_by = null;
      } else if (action === "rejectAccount") {
        patch.status = "rejected";
        patch.rejected_at = new Date().toISOString();
        patch.rejected_by = user.id;
        patch.rejection_reason = String(body.reason || "").trim() || "Rejected by administrator.";
      } else {
        patch.status = "disabled";
        patch.disabled_at = new Date().toISOString();
        patch.disabled_by = user.id;
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

      return json({ ok: true, account: data });
    }

    if (action === "extendApproval") {
      const userId = String(body.userId || "").trim();
      const hours = sanitizeApprovalHours(body.hours, 24);
      const dueAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

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
      const approvalWindowHours = sanitizeApprovalHours(body.approvalWindowHours, 24);
      const autoApproveEnabled = body.autoApproveEnabled !== false;
      const passwordResetRedirectUrl =
        String(body.passwordResetRedirectUrl || "").trim() ||
        `${DASHBOARD_PUBLIC_URL}/reset-password`;

      const value = {
        autoApproveEnabled,
        approvalWindowHours,
        maintenanceIntervalMinutes: sanitizeApprovalHours(body.maintenanceIntervalMinutes, 15),
        passwordResetRedirectUrl,
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
      const email = String(body.email || "").trim().toLowerCase();
      if (!email) {
        throw new Error("Email is required.");
      }

      const { data: authPolicy } = await service
        .from("app_settings")
        .select("value")
        .eq("key", "auth_policy")
        .maybeSingle();

      const redirectTo =
        String(authPolicy?.value?.passwordResetRedirectUrl || "").trim() ||
        `${DASHBOARD_PUBLIC_URL}/reset-password`;
      const anon = createAnonClient();
      const { error } = await anon.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) {
        throw error;
      }

      await service.from("file_audit_logs").insert({
        device_id: body.deviceId ? String(body.deviceId) : "auth",
        requested_by: user.id,
        action: "reset_password",
        target_path: email,
        details: { redirectTo },
      });

      return json({ ok: true, email, redirectTo });
    }

    if (action === "syncGuestLink") {
      const deviceId = String(body.deviceId || "").trim();
      if (!deviceId) {
        throw new Error("deviceId is required.");
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

      const nextKey = `${job.device_id}/${job.id}/${Date.now()}-${job.artifact_object_key
        .split("/")
        .pop()}`;

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

    if (action === "setupStatus") {
      const [adminProfiles, fileJobs, fileRoots, authPolicy, guestShortcuts] = await Promise.all([
        service.from("admin_profiles").select("user_id", { count: "exact", head: true }),
        service.from("file_jobs").select("id", { count: "exact", head: true }),
        service.from("file_roots").select("id", { count: "exact", head: true }),
        service.from("app_settings").select("value").eq("key", "auth_policy").maybeSingle(),
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
        authPolicy: authPolicy.data?.value || null,
      });
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
