const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

function loadPackagedRuntimeConfig(repoRoot) {
  const envPath = path.join(repoRoot, ".env");
  const runtimeConfigPath = path.join(repoRoot, "agent.runtime.json");
  const runtimeTemplatePath = path.join(repoRoot, "agent.runtime.example.json");
  const envValues = fs.existsSync(envPath)
    ? dotenv.parse(fs.readFileSync(envPath, "utf8"))
    : {};
  const runtimeConfigSource = fs.existsSync(runtimeConfigPath)
    ? runtimeConfigPath
    : fs.existsSync(runtimeTemplatePath)
      ? runtimeTemplatePath
      : null;
  const runtimeConfig = runtimeConfigSource
    ? JSON.parse(fs.readFileSync(runtimeConfigSource, "utf8"))
    : {};

  const packaged = JSON.parse(JSON.stringify(runtimeConfig));
  packaged.supabase = {
    ...(packaged.supabase || {}),
    url:
      envValues.SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      packaged.supabase?.url ||
      "",
    anonKey:
      envValues.SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      packaged.supabase?.anonKey ||
      "",
    serviceKey:
      envValues.SUPABASE_SERVICE_ROLE_KEY ||
      envValues.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      packaged.supabase?.serviceKey ||
      packaged.supabase?.secretKey ||
      "",
  };
  const packagedLogPath = String(packaged.localLogPath || "").replace(/\//g, "\\").toLowerCase();
  if (!packaged.localLogPath || packagedLogPath.endsWith("\\logs\\agent.log")) {
    packaged.localLogPath = ".\\logs\\school-services.log";
  }
  packaged.localLogMaxBytes = Number(packaged.localLogMaxBytes || 5 * 1024 * 1024);

  return packaged;
}

module.exports = { loadPackagedRuntimeConfig };
