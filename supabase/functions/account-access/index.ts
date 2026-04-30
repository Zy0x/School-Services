import { corsHeaders, json } from "../_shared/cors.ts";
import {
  createAnonClient,
  createServiceClient,
  getAuthPolicy,
  getRequestActor,
} from "../_shared/admin.ts";

class HttpError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function sanitizeRole(value: unknown) {
  const role = String(value || "").trim().toLowerCase();
  if (role === "operator" || role === "user") {
    return role;
  }
  throw new HttpError("Role pendaftaran tidak didukung.", 400);
}

function sanitizeRegistrationMode(role: string, value: unknown) {
  if (role === "operator") {
    return "open_operator_signup";
  }

  const mode = String(value || "direct_superadmin").trim().toLowerCase();
  if (["invite_email", "referral_code", "direct_superadmin"].includes(mode)) {
    return mode;
  }
  throw new HttpError("Mode pendaftaran tidak dikenali.", 400);
}

function normalizePublicRedirect(value: unknown) {
  const fallback = "https://school-services.netlify.app/auth/reset-password";
  const raw = String(value || "").trim();
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return fallback;
    }

    return parsed.toString();
  } catch (_error) {
    return fallback;
  }
}

function inferErrorStatus(error: unknown) {
  if (error instanceof HttpError) {
    return error.status;
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/missing authorization header|invalid admin session|account access is pending/i.test(message)) {
    return 401;
  }
  if (/rate limit/i.test(message)) {
    return 429;
  }
  return 400;
}

function buildOperatorEnvironmentName(displayName: string | null, email: string) {
  const seed = displayName || email.split("@")[0] || "Operator";
  return `${seed} Workspace`;
}

function buildRegistrationMessage(mode: string, approvalDueAt: string | null) {
  if (!approvalDueAt && mode === "direct_superadmin") {
    return "Pendaftaran diterima. Permintaan Anda akan ditinjau oleh SuperAdmin sebelum akses dashboard diaktifkan.";
  }

  return "Pendaftaran diterima. Akun akan aktif otomatis setelah proses persetujuan selesai.";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const service = createServiceClient();
    const body = await request.json();
    const action = String(body.action || "register").trim();

    if (action === "sessionProfile") {
      const actor = await getRequestActor(request);
      return json({
        ok: true,
        profile: actor.profile,
        environment: actor.environment,
        memberships: actor.memberships,
        user: {
          id: actor.user.id,
          email: actor.user.email,
        },
      });
    }

    if (action === "forgotPassword") {
      const email = String(body.email || "").trim().toLowerCase();
      const redirectTo = normalizePublicRedirect(body.redirectTo);

      if (!email) {
        throw new HttpError("Email wajib diisi.", 400);
      }

      const anon = createAnonClient();
      const { error } = await anon.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) {
        throw error;
      }

      return json({
        ok: true,
        email,
        message: "Tautan reset password sudah dikirim ke email Anda.",
      });
    }

    if (action !== "register") {
      throw new HttpError(`Aksi account tidak didukung: ${action}`, 400);
    }

    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "").trim();
    const displayName = String(body.displayName || "").trim() || null;
    const role = sanitizeRole(body.role);
    const registrationMode = sanitizeRegistrationMode(role, body.registrationMode);
    const referralCode = String(body.referralCode || "").trim().toUpperCase();

    if (!email || !password) {
      throw new HttpError("Email dan password wajib diisi.", 400);
    }

    const authPolicy = await getAuthPolicy(service);
    let environment: Record<string, unknown> | null = null;
    let invitation: Record<string, unknown> | null = null;
    let managedByUserId: string | null = null;
    let approvalDueAt: string | null = null;
    let standaloneState = "standalone";
    let primaryEnvironmentId: string | null = null;
    let registrationSource = registrationMode;

    if (role === "user" && registrationMode === "invite_email") {
      const { data } = await service
        .from("environment_invitations")
        .select("id, environment_id, created_by, status, expires_at")
        .eq("email", email)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!data) {
        throw new HttpError("Undangan untuk email ini tidak ditemukan atau sudah tidak berlaku.", 404);
      }

      if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
        throw new HttpError("Undangan sudah kedaluwarsa. Minta undangan baru dari operator atau SuperAdmin.", 400);
      }

      invitation = data;
      primaryEnvironmentId = String(data.environment_id);
      managedByUserId = data.created_by ? String(data.created_by) : null;
      standaloneState = "pending_environment";
      approvalDueAt = new Date(
        Date.now() + authPolicy.environmentUserAutoApproveHours * 60 * 60 * 1000
      ).toISOString();
    }

    if (role === "user" && registrationMode === "referral_code") {
      if (!referralCode) {
        throw new HttpError("Kode lingkungan operator wajib diisi.", 400);
      }

      const { data } = await service
        .from("operator_environments")
        .select("id, operator_id, name, referral_code, is_active")
        .eq("referral_code", referralCode)
        .eq("is_active", true)
        .maybeSingle();

      if (!data) {
        throw new HttpError("Kode lingkungan operator tidak ditemukan atau sudah tidak aktif.", 404);
      }

      environment = data;
      primaryEnvironmentId = String(data.id);
      managedByUserId = String(data.operator_id);
      standaloneState = "pending_environment";
      approvalDueAt = new Date(
        Date.now() + authPolicy.environmentUserAutoApproveHours * 60 * 60 * 1000
      ).toISOString();
    }

    if (role === "user" && registrationMode === "direct_superadmin") {
      standaloneState = "standalone";
      if (authPolicy.standaloneUserApprovalMode === "auto") {
        approvalDueAt = new Date(
          Date.now() + authPolicy.standaloneUserAutoApproveHours * 60 * 60 * 1000
        ).toISOString();
      } else {
        approvalDueAt = null;
      }
    }

    if (role === "operator") {
      approvalDueAt = new Date(
        Date.now() + authPolicy.operatorAutoApproveHours * 60 * 60 * 1000
      ).toISOString();
      standaloneState = "standalone";
    }

    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError || !created.user) {
      throw createError || new Error("Gagal membuat akun.");
    }

    const nextStatus =
      role === "user" && registrationMode === "direct_superadmin" && !approvalDueAt
        ? "pending"
        : "pending";

    const profilePayload = {
      user_id: created.user.id,
      email,
      display_name: displayName,
      role,
      status: nextStatus,
      approval_due_at: approvalDueAt,
      updated_at: new Date().toISOString(),
      registration_source: registrationSource,
      managed_by: managedByUserId,
      primary_environment_id: primaryEnvironmentId,
      standalone_state: standaloneState,
    };

    const { error: profileError } = await service.from("admin_profiles").upsert(profilePayload);
    if (profileError) {
      throw profileError;
    }

    if (role === "operator") {
      const referral = await service.rpc("generate_referral_code");
      if (referral.error) {
        throw referral.error;
      }

      const { error: environmentError } = await service.from("operator_environments").upsert({
        operator_id: created.user.id,
        name: buildOperatorEnvironmentName(displayName, email),
        referral_code: String(referral.data || "").trim() || crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase(),
        is_active: true,
        created_by: created.user.id,
        updated_at: new Date().toISOString(),
      });

      if (environmentError) {
        throw environmentError;
      }
    }

    if (role === "user" && primaryEnvironmentId) {
      const joinedVia = registrationMode === "invite_email" ? "invite_email" : "referral_code";
      const { error: membershipError } = await service.from("environment_memberships").upsert({
        environment_id: primaryEnvironmentId,
        user_id: created.user.id,
        role: "user",
        status: "pending",
        joined_via: joinedVia,
        requested_by_user_id: created.user.id,
        updated_at: new Date().toISOString(),
      });

      if (membershipError) {
        throw membershipError;
      }
    }

    if (invitation?.id) {
      await service
        .from("environment_invitations")
        .update({
          status: "accepted",
          accepted_by: created.user.id,
          accepted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", String(invitation.id));
    }

    return json({
      ok: true,
      pending: true,
      approvalDueAt,
      role,
      registrationMode,
      message: buildRegistrationMessage(registrationMode, approvalDueAt),
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: inferErrorStatus(error) }
    );
  }
});
