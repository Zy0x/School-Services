#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const packageJson = require("./package.json");

const repoRoot = path.join(__dirname, "..");
const payloadDir = path.join(__dirname, "dist", "payload");
const releaseDir = path.join(__dirname, "dist", "release");
const installerScriptPath = path.join(repoRoot, "installer", "SchoolServices.iss");

function getCandidateCompilerPaths() {
  return [
    process.env.ISCC_PATH || "",
    "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe",
    "C:\\Program Files\\Inno Setup 6\\ISCC.exe",
  ].filter(Boolean);
}

function resolveIsccPath() {
  for (const candidate of getCandidateCompilerPaths()) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const whereResult = spawnSync("where.exe", ["ISCC.exe"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (whereResult.status === 0) {
    const match = String(whereResult.stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (match && fs.existsSync(match)) {
      return match;
    }
  }

  throw new Error(
    "ISCC.exe was not found. Install Inno Setup 6 or set ISCC_PATH before running the build."
  );
}

function main() {
  if (!fs.existsSync(installerScriptPath)) {
    throw new Error(`Installer script not found: ${installerScriptPath}`);
  }

  if (!fs.existsSync(payloadDir)) {
    throw new Error(`Payload directory not found: ${payloadDir}`);
  }

  fs.mkdirSync(releaseDir, { recursive: true });
  const isccPath = resolveIsccPath();
  const args = [
    installerScriptPath,
    `/DAppVersion=${packageJson.version}`,
    `/DPayloadDir=${payloadDir}`,
    `/DOutputDir=${releaseDir}`,
  ];

  const result = spawnSync(isccPath, args, {
    cwd: repoRoot,
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.status !== 0) {
    throw new Error(`ISCC exited with code ${result.status}`);
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exit(1);
}
