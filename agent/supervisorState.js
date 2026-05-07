const fs = require("fs");
const path = require("path");
const { getStateDir } = require("./paths");

const COMMAND_STALE_MS = 5 * 60 * 1000;

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return null;
  }
}

function getAgentLockPath() {
  return path.join(getStateDir(), "agent.lock");
}

function getSupervisorStatePath() {
  return path.join(getStateDir(), "supervisor-state.json");
}

function readSupervisorState() {
  return readJsonFile(getSupervisorStatePath()) || { desiredAgentState: "running" };
}

function writeSupervisorState(patch) {
  const statePath = getSupervisorStatePath();
  const next = {
    ...readSupervisorState(),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function getDesiredAgentState() {
  const value = String(readSupervisorState().desiredAgentState || "running").toLowerCase();
  return value === "stopped" ? "stopped" : "running";
}

function getLockedAgentPid() {
  const lock = readJsonFile(getAgentLockPath());
  const pid = Number(lock?.pid);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function normalizeTime(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function shouldClaimCommand(command) {
  if (command.status === "pending") {
    return true;
  }
  if (command.claimed_by === "supervisor" || command.claimed_by === "school-services-supervisor") {
    return true;
  }
  return Date.now() - normalizeTime(command.updated_at || command.started_at) > COMMAND_STALE_MS;
}

module.exports = {
  COMMAND_STALE_MS,
  getAgentLockPath,
  getDesiredAgentState,
  getLockedAgentPid,
  getSupervisorStatePath,
  normalizeTime,
  readJsonFile,
  readSupervisorState,
  shouldClaimCommand,
  writeSupervisorState,
};
