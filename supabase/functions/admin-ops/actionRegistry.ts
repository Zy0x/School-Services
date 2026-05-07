const SETUP_ACTIONS = new Set([
  "createJob",
  "cancelJob",
  "signArtifact",
  "promoteArchive",
  "setupStatus",
]);

const ACCOUNT_ACTIONS = new Set([
  "listAccounts",
  "createAccount",
  "approveAccount",
  "rejectAccount",
  "disableAccount",
  "deleteAccount",
  "extendApproval",
  "resetPassword",
]);

const DEVICE_ACTIONS = new Set([
  "listDashboard",
  "linkGuestDevice",
  "unlinkDeviceAssignment",
  "updateDeviceAlias",
  "updateDeviceStatus",
  "assignDevice",
  "unassignDevice",
  "syncGuestLink",
]);

const COMMAND_ACTIONS = new Set([
  "queueCommand",
  "cancelCommand",
  "start",
  "stop",
  "restart",
  "kill",
  "agent_start",
  "agent_stop",
  "agent_restart",
  "update",
  "configure_tunnel",
]);

const FILE_ACTIONS = new Set([
  "createJob",
  "cancelJob",
  "signArtifact",
  "promoteArchive",
  "listTransferHistory",
  "listStorageArtifacts",
  "deleteStorageArtifact",
]);

const ENVIRONMENT_ACTIONS = new Set([
  "listEnvironments",
  "createEnvironment",
  "rotateReferralCode",
  "inviteUser",
  "updateAuthPolicy",
]);

export function isSetupAction(action: string) {
  return SETUP_ACTIONS.has(action);
}

export const ADMIN_OPS_ACTION_REGISTRY = {
  setup: SETUP_ACTIONS,
  accounts: ACCOUNT_ACTIONS,
  devices: DEVICE_ACTIONS,
  commands: COMMAND_ACTIONS,
  files: FILE_ACTIONS,
  environments: ENVIRONMENT_ACTIONS,
};
