const APP_NAME = "School Services";
const APP_PUBLISHER = "School Services";
const AGENT_EXE_NAME = "School Services Agent.exe";
const LAUNCHER_EXE_NAME = "School Services.exe";
const SUPERVISOR_EXE_NAME = "School Services Supervisor.exe";
const STARTUP_TASK_NAME = "School Services Agent Startup";
const STARTUP_TASK_DESCRIPTION =
  "Starts School Services agent automatically at system startup with highest privileges.";
const START_SERVICE_TASK_NAME = "School Services Agent Start";
const START_SERVICE_TASK_DESCRIPTION =
  "Starts School Services supervisor and agent with highest privileges.";
const STOP_SERVICE_TASK_NAME = "School Services Agent Stop";
const STOP_SERVICE_TASK_DESCRIPTION =
  "Stops School Services supervisor, agent, and tunnel processes with highest privileges.";
const RESTART_SERVICE_TASK_NAME = "School Services Agent Restart";
const RESTART_SERVICE_TASK_DESCRIPTION =
  "Restarts School Services supervisor, agent, and tunnel processes with highest privileges.";
const VERSIONED_INSTALLER_PREFIX = "School Services v";
const LEGACY_GUEST_SHORTCUT_NAME = "School Services.url";

module.exports = {
  AGENT_EXE_NAME,
  APP_NAME,
  APP_PUBLISHER,
  LAUNCHER_EXE_NAME,
  LEGACY_GUEST_SHORTCUT_NAME,
  RESTART_SERVICE_TASK_DESCRIPTION,
  RESTART_SERVICE_TASK_NAME,
  START_SERVICE_TASK_DESCRIPTION,
  START_SERVICE_TASK_NAME,
  SUPERVISOR_EXE_NAME,
  STOP_SERVICE_TASK_DESCRIPTION,
  STOP_SERVICE_TASK_NAME,
  STARTUP_TASK_DESCRIPTION,
  STARTUP_TASK_NAME,
  VERSIONED_INSTALLER_PREFIX,
};
