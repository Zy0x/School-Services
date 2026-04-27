import { createClient } from "jsr:@supabase/supabase-js@2";

export function createServiceClient() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireSuperAdmin(request: Request) {
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
    .select("user_id, email, role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    throw profileError;
  }

  if (!profile || profile.role !== "super_admin") {
    throw new Error("Admin access denied.");
  }

  return {
    service,
    user,
    profile,
  };
}
