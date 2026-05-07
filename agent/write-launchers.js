const fs = require("fs");
const path = require("path");
const { buildInfoPayload } = require("./buildMetadata");
const packageJson = require("./package.json");
const { ensureDirectory, writeTextFile } = require("./launcherWriter/fileUtils");
const { loadPackagedRuntimeConfig } = require("./launcherWriter/runtimeConfig");
const { createPowerShellScripts } = require("./launcherWriter/scripts");

const repoRoot = path.join(__dirname, "..");
const distDir = path.join(__dirname, "dist");
const payloadDir = path.join(distDir, "payload");
const runtimeConfigOutputPath = path.join(payloadDir, "agent.runtime.json");
const buildInfoPath = path.join(payloadDir, "agent-build.json");
const faviconSourcePath = path.join(repoRoot, "favicon.ico");
const faviconOutputPath = path.join(payloadDir, "favicon.ico");
const ngrokSourcePath = path.join(repoRoot, "ngrok.exe");
const ngrokOutputPath = path.join(payloadDir, "ngrok.exe");

function main() {
  ensureDirectory(payloadDir);

  const scripts = createPowerShellScripts();
  for (const [fileName, content] of Object.entries(scripts)) {
    writeTextFile(path.join(payloadDir, fileName), content, "utf8");
  }

  writeTextFile(
    runtimeConfigOutputPath,
    `${JSON.stringify(loadPackagedRuntimeConfig(repoRoot), null, 2)}\n`,
    "utf8"
  );
  writeTextFile(
    buildInfoPath,
    `${JSON.stringify(buildInfoPayload({ packageVersion: packageJson.version, repoRoot }), null, 2)}\n`,
    "utf8"
  );

  if (fs.existsSync(faviconSourcePath)) {
    fs.copyFileSync(faviconSourcePath, faviconOutputPath);
  }

  if (fs.existsSync(ngrokSourcePath)) {
    fs.copyFileSync(ngrokSourcePath, ngrokOutputPath);
  }

  console.log(`Wrote installer payload files to ${payloadDir}`);
}

main();
