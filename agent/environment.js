const fs = require("fs");
const path = require("path");

function getRequiredPathEntries() {
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  const candidates = [
    path.join(systemRoot, "System32"),
    path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0"),
    path.join(systemRoot, "System32", "Wbem"),
  ];

  return candidates.filter((entry, index, array) => {
    if (!entry || array.indexOf(entry) !== index) {
      return false;
    }

    try {
      return fs.existsSync(entry);
    } catch (error) {
      return false;
    }
  });
}

function splitPathEntries(value) {
  return String(value || "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function ensureProcessPathEntries() {
  const current = process.env.Path || process.env.PATH || "";
  const existing = splitPathEntries(current);
  const seen = new Set(existing.map((entry) => entry.toLowerCase()));
  const required = getRequiredPathEntries();
  let changed = false;

  for (const entry of required) {
    const normalized = entry.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }

    existing.unshift(entry);
    seen.add(normalized);
    changed = true;
  }

  if (!changed) {
    return {
      changed: false,
      path: current,
      required,
    };
  }

  const nextValue = existing.join(";");
  process.env.Path = nextValue;
  process.env.PATH = nextValue;

  return {
    changed: true,
    path: nextValue,
    required,
  };
}

module.exports = {
  ensureProcessPathEntries,
  getRequiredPathEntries,
};
