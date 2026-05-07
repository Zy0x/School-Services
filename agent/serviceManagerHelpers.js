const path = require("path");
const { getConfigTargetsForService } = require("./serviceConfigs");

function escapePowerShellSingleQuotedString(value) {
  return String(value || "").replace(/'/g, "''");
}

function getPowerShellPath() {
  const systemRoot = process.env.SystemRoot || "C:\Windows";
  return path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function getSystem32Path() {
  const systemRoot = process.env.SystemRoot || "C:\Windows";
  return path.join(systemRoot, "System32");
}

function getCmdPath() {
  return path.join(getSystem32Path(), "cmd.exe");
}

function getScPath() {
  return path.join(getSystem32Path(), "sc.exe");
}

function getTaskkillPath() {
  return path.join(getSystem32Path(), "taskkill.exe");
}

function resolveSystemCommandPath(command) {
  const normalized = String(command || "").trim().toLowerCase();
  if (normalized === "cmd.exe" || normalized === "cmd") return getCmdPath();
  if (normalized === "sc.exe" || normalized === "sc") return getScPath();
  if (normalized === "taskkill.exe" || normalized === "taskkill") return getTaskkillPath();
  if (normalized === "powershell.exe" || normalized === "powershell") return getPowerShellPath();
  return command;
}

function normalizeCommand(commandConfig) {
  if (!commandConfig) return null;
  if (typeof commandConfig === "string") {
    return { command: getCmdPath(), args: ["/c", commandConfig] };
  }
  return {
    command: resolveSystemCommandPath(commandConfig.command),
    args: commandConfig.args || [],
    cwd: commandConfig.cwd,
    env: commandConfig.env,
    shell: Boolean(commandConfig.shell),
  };
}

function formatCommand(command) {
  const parts = [command.command].concat(command.args || []);
  return parts.join(" ");
}

function extractExecutablePath(pathName) {
  const value = String(pathName || "").trim();
  if (!value) return null;
  if (value.startsWith('"')) {
    const closingIndex = value.indexOf('"', 1);
    return closingIndex > 1 ? value.slice(1, closingIndex) : null;
  }
  const exeIndex = value.toLowerCase().indexOf(".exe");
  if (exeIndex === -1) return value;
  return value.slice(0, exeIndex + 4);
}

function getConfigTargets(definition) {
  return getConfigTargetsForService(definition).filter(Boolean);
}

function isUsableConfigTargetCandidatePath(candidatePath) {
  const normalized = String(candidatePath || "").trim();
  if (!normalized) return false;
  if (/^[\\/](?![\\/])/.test(normalized)) return false;
  return true;
}

function getConfigTargetCandidatePaths(target) {
  const candidates = [];
  if (target?.path) candidates.push(target.path);
  if (Array.isArray(target?.pathCandidates)) candidates.push(...target.pathCandidates);
  return Array.from(new Set(candidates.filter((candidate) => isUsableConfigTargetCandidatePath(candidate))));
}

function isSameConfigTarget(left, right) {
  if (!left || !right) return false;
  const leftId = left.targetId || null;
  const rightId = right.targetId || null;
  if (leftId || rightId) return leftId === rightId;
  return left.key === right.key && left.type === right.type;
}

module.exports = {
  escapePowerShellSingleQuotedString,
  extractExecutablePath,
  formatCommand,
  getCmdPath,
  getConfigTargetCandidatePaths,
  getConfigTargets,
  getPowerShellPath,
  getScPath,
  getSystem32Path,
  getTaskkillPath,
  isSameConfigTarget,
  isUsableConfigTargetCandidatePath,
  normalizeCommand,
  resolveSystemCommandPath,
};
