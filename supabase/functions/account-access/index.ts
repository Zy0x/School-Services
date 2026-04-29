import { corsHeaders, json } from "../_shared/cors.ts";
import { createAnonClient, createServiceClient, getRequestActor } from "../_shared/admin.ts";

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
  throw new Error("Unsupported registration role.");
}

function normalizePublicRedirect(value: unknown) {
  const fallback = "https://school-services.netlify.app/reset-password";
  const raw = String(value || "").trim();
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1"
    ) {
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
  if (/missing authorization header|invalid admin session|admin access denied/i.test(message)) {
    return 401;
  }
  if (/rate limit/i.test(message)) {
    return 429;
  }
  return 400;
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
        throw new HttpError("Email is required.", 400);
      }

      const anon = createAnonClient();
      const { error } = await anon.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) {
        throw error;
      }

      return json({
        ok: true,
        email,
        message: "Password reset email sent.",
      });
    }

    if (action !== "register") {
      throw new Error(`Unsupported account action: ${action}`);
    }

    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "").trim();
    const displayName = String(body.displayName || "").trim() || null;
    const role = sanitizeRole(body.role);
    const referralCode = String(body.referralCode || "").trim();
    const inviteToken = String(body.inviteToken || "").trim();
    const isDirectSuperadmin = body.isDirectSuperadmin === true;

    if (!email || !password) {
      throw new HttpError("Email and password are required.", 400);
    }

    let environmentId: string | null = null;
    let managedBy: string | null = null;
    let source = "direct";
    
    const { data: settings } = await service
      .from("app_settings")
      .select("value")
      .eq("key", "auth_policy")
      .maybeSingle();
      
    let approvalWindowHours: number | null = null;

    if (isDirectSuperadmin) {
      // Validate caller is superadmin
      const actor = await getRequestActor(request);
      if (actor.profile.role !== "super_admin") {
        throw new HttpError("Only super_admin can use direct_superadmin mode.", 403);
      }
      source = "direct_superadmin";
      // Superadmin creations are automatically approved immediately, so no window needed.
      approvalWindowHours = 0; 
    } else if (role === "operator") {
      approvalWindowHours = Math.max(1, Number(settings?.value?.operatorAutoApproveHours || 24));
    } else if (referralCode) {
      const { data: inv } = await service.from("environment_invitations")
        .select("environment_id, created_by, expires_at")
        .eq("referral_code", referralCode)
        .maybeSingle();
      if (!inv) throw new HttpError("Invalid referral code.", 400);
      if (inv.expires_at && new Date(inv.expires_at) < new Date()) throw new HttpError("Referral code expired.", 400);
      
      environmentId = inv.environment_id;
      managedBy = inv.created_by;
      source = "referral_code";
      approvalWindowHours = Math.max(1, Number(settings?.value?.environmentUserAutoApproveHours || 8));
    } else if (inviteToken) {
      const { data: inv } = await service.from("environment_invitations")
        .select("environment_id, created_by, expires_at, email")
        .eq("id", inviteToken)
        .maybeSingle();
      if (!inv || (inv.email && inv.email.toLowerCase() !== email)) {
        throw new HttpError("Invalid invite token.", 400);
      }
      if (inv.expires_at && new Date(inv.expires_at) < new Date()) throw new HttpError("Invite expired.", 400);
      
      environmentId = inv.environment_id;
      managedBy = inv.created_by;
      source = "invite_email";
      approvalWindowHours = Math.max(1, Number(settings?.value?.environmentUserAutoApproveHours || 8));
    } else {
      // Standalone user
      const isManual = settings?.value?.standaloneUserManualMode ?? true;
      if (!isManual) {
        approvalWindowHours = Math.max(1, Number(settings?.value?.approvalWindowHours || 24));
      }
    }

    const approvalDueAt = approvalWindowHours !== null
      ? new Date(Date.now() + approvalWindowHours * 60 * 60 * 1000).toISOString()
      : null;

    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError || !created.user) {
      throw createError || new Error("Failed to create account.");
    }

    const { error: profileError } = await service.from("admin_profiles").upsert({
      user_id: created.user.id,
      email,
      display_name: displayName,
      role,
      status: approvalWindowHours === 0 ? "approved" : "pending",
      approval_due_at: approvalWindowHours === 0 ? null : approvalDueAt,
      approved_at: approvalWindowHours === 0 ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
      registration_source: source,
      managed_by: managedBy
    });

    if (profileError) {
      throw profileError;
    }

    if (environmentId) {
      await service.from("environment_memberships").insert({
        environment_id: environmentId,
        user_id: created.user.id,
        joined_at: new Date().toISOString(),
      });
    }

    return json({
      ok: true,
      pending: approvalWindowHours !== 0,
      approvalDueAt,
      message: approvalWindowHours === 0 
        ? "Account created and approved." 
        : "Registration received. Your account will be reviewed before full access is granted.",
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
