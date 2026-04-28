#!/usr/bin/env node

const path = require("path");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const setupExePath = path.join(__dirname, "dist", "School Services.exe");
  const iconPath = path.join(__dirname, "..", "favicon.ico");
  const moduleRef = await import("rcedit");
  let lastError = null;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await moduleRef.rcedit(setupExePath, {
        icon: iconPath,
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      await sleep(1200 * attempt);
    }
  }

  if (lastError) {
    throw lastError;
  }

  console.log(`Applied icon ${iconPath} to ${setupExePath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exit(1);
});
