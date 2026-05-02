import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(repoRoot, ".env");
const command = process.argv[2] || "apply";

function readEnvFile() {
  const content = fs.readFileSync(envPath, "utf8");
  return Object.fromEntries(
    content
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]])
  );
}

function updateEnvValues(nextValues) {
  const original = fs.readFileSync(envPath, "utf8");
  const lines = original.split(/\r?\n/);
  const touched = new Set();

  const nextLines = lines.map((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (!match) {
      return line;
    }

    const key = match[1];
    if (!(key in nextValues)) {
      return line;
    }

    touched.add(key);
    return `${key}=${nextValues[key]}`;
  });

  for (const [key, value] of Object.entries(nextValues)) {
    if (!touched.has(key)) {
      nextLines.push(`${key}=${value}`);
    }
  }

  fs.writeFileSync(envPath, `${nextLines.join("\n").replace(/\n+$/, "\n")}`, "utf8");
}

function resolveExecutable(commandName) {
  if (process.platform === "win32" && !path.extname(commandName)) {
    return `${commandName}.cmd`;
  }

  return commandName;
}

function getSupabaseCliPath() {
  const localCliPath =
    process.platform === "win32"
      ? path.join(repoRoot, "node_modules", "supabase", "bin", "supabase.exe")
      : path.join(repoRoot, "node_modules", ".bin", "supabase");

  return fs.existsSync(localCliPath) ? localCliPath : "supabase";
}

function run(commandName, args, options = {}) {
  const executable = resolveExecutable(commandName);
  const result = spawnSync(executable, args, {
    cwd: repoRoot,
    stdio: options.captureOutput ? "pipe" : "inherit",
    shell: false,
    env: { ...process.env, ...(options.env || {}) },
  });

  if (result.error || result.status !== 0) {
    const stderr = result.stderr ? String(result.stderr) : "";
    const stdout = result.stdout ? String(result.stdout) : "";
    const spawnError = result.error ? `\n${result.error.message}` : "";
    throw new Error(
      `Command failed: ${commandName} ${args.join(" ")}${
        stderr || stdout ? `\n${(stderr || stdout).trim()}` : ""
      }${spawnError}`
    );
  }

  return {
    stdout: result.stdout ? String(result.stdout) : "",
    stderr: result.stderr ? String(result.stderr) : "",
  };
}

function createServiceClient(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getProjectRef(env) {
  return new URL(env.SUPABASE_URL).host.split(".")[0];
}

function getDbUrl(env) {
  const password = encodeURIComponent(env.SUPABASE_DB_PASSWORD);
  const projectRef = getProjectRef(env);
  return `postgresql://postgres:${password}@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`;
}

async function ensureAdminCredentials(env) {
  const next = {};

  if (!env.ADMIN_PASSWORD) {
    next.ADMIN_PASSWORD = crypto.randomBytes(18).toString("base64url");
  }

  if (Object.keys(next).length > 0) {
    updateEnvValues(next);
    Object.assign(env, next);
  }
}

async function ensureBuckets(env) {
  const service = createServiceClient(env);
  const desiredBuckets = [
    { id: "agent-temp-artifacts", public: false },
    { id: "agent-archives", public: false },
    { id: "agent-preview-cache", public: false },
    { id: "admin-upload-staging", public: false },
  ];

  const { data: existing } = await service.storage.listBuckets();
  const existingMap = new Map((existing || []).map((bucket) => [bucket.id, bucket]));

  for (const bucket of desiredBuckets) {
    if (!existingMap.has(bucket.id)) {
      const { error } = await service.storage.createBucket(bucket.id, {
        public: bucket.public,
      });
      if (error) {
        throw error;
      }
      continue;
    }

    const { error } = await service.storage.updateBucket(bucket.id, {
      public: bucket.public,
    });
    if (error) {
      throw error;
    }
  }
}

async function ensureAdminUser(env, options = {}) {
  const service = createServiceClient(env);
  const adminEmail = env.ADMIN_EMAIL;
  const adminPassword = env.ADMIN_PASSWORD;
  const resetExistingPassword = options.resetExistingPassword === true;

  if (!adminEmail) {
    throw new Error("ADMIN_EMAIL is required in .env for admin seeding.");
  }

  const { data: listData, error: listError } = await service.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listError) {
    throw listError;
  }

  let adminUser = listData.users.find((user) => user.email === adminEmail);

  if (!adminUser) {
    const { data, error } = await service.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    });

    if (error) {
      throw error;
    }

    adminUser = data.user;
  } else if (resetExistingPassword) {
    const { error } = await service.auth.admin.updateUserById(adminUser.id, {
      password: adminPassword,
      email_confirm: true,
    });

    if (error) {
      throw error;
    }
  }

  const { error: profileError } = await service.from("admin_profiles").upsert({
    user_id: adminUser.id,
    email: adminEmail,
    role: "super_admin",
    updated_at: new Date().toISOString(),
  });

  if (profileError) {
    throw profileError;
  }
}

function deployFunctions(env) {
  const projectRef = getProjectRef(env);
  const supabaseCli = getSupabaseCliPath();
  try {
    for (const fn of ["admin-ops", "cleanup", "guest-access", "account-access"]) {
      run(
        supabaseCli,
        ["functions", "deploy", fn, "--project-ref", projectRef],
        { captureOutput: true }
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/necessary privileges|access control|403/i.test(message)) {
      throw new Error(
        [
          "Supabase Edge Function deploy is blocked by account privileges.",
          `Project ref: ${projectRef}`,
          "Set SUPABASE_ACCESS_TOKEN in .env (or run `npx supabase login --token <PAT>`) using the Supabase account that owns this project, then rerun `npm run supabase:apply`.",
          "Create the PAT from https://supabase.com/dashboard/account/tokens",
        ].join("\n")
      );
    }
    throw error;
  }
}

function pushMigrations(env) {
  run(getSupabaseCliPath(), ["db", "push", "--yes", "--db-url", getDbUrl(env)]);
}

async function verify(env) {
  const service = createServiceClient(env);
  const checks = await Promise.all([
    service.from("admin_profiles").select("user_id", { count: "exact", head: true }),
    service.from("file_jobs").select("id", { count: "exact", head: true }),
    service.from("file_roots").select("id", { count: "exact", head: true }),
    service.from("guest_shortcuts").select("device_id", { count: "exact", head: true }),
    service.from("app_settings").select("value").eq("key", "auth_policy").maybeSingle(),
    service.storage.listBuckets(),
  ]);

  const bucketIds = (checks[5].data || []).map((bucket) => bucket.id);
  console.log(
    JSON.stringify(
      {
        adminProfiles: checks[0].count || 0,
        fileJobs: checks[1].count || 0,
        fileRoots: checks[2].count || 0,
        guestShortcuts: checks[3].count || 0,
        authPolicy: checks[4].data?.value || null,
        buckets: bucketIds,
      },
      null,
      2
    )
  );
}

async function main() {
  const env = readEnvFile();
  await ensureAdminCredentials(env);

  if (command === "seed-admin") {
    await ensureAdminUser(env, { resetExistingPassword: true });
    return;
  }

  if (command === "verify") {
    await verify(env);
    return;
  }

  if (command === "deploy-functions") {
    deployFunctions(env);
    return;
  }

  if (command === "apply-storage") {
    await ensureBuckets(env);
    return;
  }

  pushMigrations(env);
  await ensureBuckets(env);
  await ensureAdminUser(env, { resetExistingPassword: false });
  deployFunctions(env);
  await verify(env);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
