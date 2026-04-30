import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function maskEmail(email) {
  const [name, domain] = String(email || "").split("@");
  if (!domain) {
    return "<invalid-email>";
  }
  return `${name.slice(0, 2)}***@${domain}`;
}

const supabaseUrl = requiredEnv("SUPABASE_URL");
const serviceKey =
  String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim() ||
  requiredEnv("SUPABASE_SECRET_KEY");
const adminEmail = requiredEnv("ADMIN_EMAIL").toLowerCase();
const adminPassword = requiredEnv("ADMIN_PASSWORD");

if (adminPassword.length < 8) {
  throw new Error("ADMIN_PASSWORD must be at least 8 characters.");
}

const service = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUserByEmail(email) {
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw error;
    }

    const user = (data?.users || []).find(
      (entry) => String(entry.email || "").toLowerCase() === email
    );
    if (user) {
      return user;
    }
    if (!data?.users?.length || data.users.length < perPage) {
      return null;
    }
    page += 1;
  }
}

const existing = await findUserByEmail(adminEmail);
let user = existing;

if (!user) {
  const { data, error } = await service.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
  });
  if (error || !data?.user) {
    throw error || new Error("Failed to create SuperAdmin auth user.");
  }
  user = data.user;
} else {
  const { error } = await service.auth.admin.updateUserById(user.id, {
    password: adminPassword,
    email_confirm: true,
  });
  if (error) {
    throw error;
  }
}

const now = new Date().toISOString();
const { error: profileError } = await service.from("admin_profiles").upsert({
  user_id: user.id,
  email: adminEmail,
  display_name: "SuperAdmin",
  role: "super_admin",
  status: "approved",
  approved_at: now,
  updated_at: now,
});

if (profileError) {
  throw profileError;
}

console.log(
  JSON.stringify(
    {
      ok: true,
      email: maskEmail(adminEmail),
      userId: user.id,
      profile: "super_admin:approved",
      passwordSource: "ADMIN_PASSWORD",
    },
    null,
    2
  )
);
