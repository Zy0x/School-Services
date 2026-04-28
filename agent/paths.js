const path = require("path");
const {
  AGENT_EXE_NAME,
  APP_NAME,
  LAUNCHER_EXE_NAME,
} = require("./appConstants");

function isPackagedRuntime() {
  return Boolean(process.pkg);
}

function getInstallDir() {
  return isPackagedRuntime() ? path.dirname(process.execPath) : __dirname;
}

function getRepoRoot() {
  return path.resolve(__dirname, "..");
}

function getProgramDataRoot() {
  return process.env.ProgramData || "C:\\ProgramData";
}

function getDataDir() {
  if (process.env.SCHOOL_SERVICES_DATA_DIR) {
    return path.resolve(process.env.SCHOOL_SERVICES_DATA_DIR);
  }

  if (isPackagedRuntime()) {
    return path.join(getProgramDataRoot(), APP_NAME);
  }

  return path.join(getInstallDir(), "runtime");
}

function getLogsDir() {
  return path.join(getDataDir(), "logs");
}

function getStateDir() {
  return path.join(getDataDir(), "state");
}

function getCacheDir() {
  return path.join(getDataDir(), "cache");
}

function getRuntimeDir() {
  return path.join(getDataDir(), "runtime");
}

function getUpdatesDir() {
  return path.join(getDataDir(), "updates");
}

function getFileJobsRoot() {
  return path.join(getRuntimeDir(), "file-jobs");
}

function getRuntimeConfigPath() {
  if (process.env.AGENT_CONFIG_PATH) {
    return path.resolve(process.env.AGENT_CONFIG_PATH);
  }

  return path.join(getDataDir(), "agent.runtime.json");
}

function getBuildInfoPath() {
  return path.join(getInstallDir(), "agent-build.json");
}

function getAgentExePath() {
  return path.join(getInstallDir(), AGENT_EXE_NAME);
}

function getLauncherExePath() {
  return path.join(getInstallDir(), LAUNCHER_EXE_NAME);
}

module.exports = {
  getAgentExePath,
  getBuildInfoPath,
  getCacheDir,
  getDataDir,
  getFileJobsRoot,
  getInstallDir,
  getLauncherExePath,
  getLogsDir,
  getProgramDataRoot,
  getRepoRoot,
  getRuntimeConfigPath,
  getRuntimeDir,
  getStateDir,
  getUpdatesDir,
  isPackagedRuntime,
};
