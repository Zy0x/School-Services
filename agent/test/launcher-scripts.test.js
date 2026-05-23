const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createPowerShellScripts,
  createScheduledTaskVbsScript,
} = require("../launcherWriter/scripts");
const {
  RESTART_SERVICE_TASK_NAME,
  START_SERVICE_TASK_NAME,
  STOP_SERVICE_TASK_NAME,
  WATCHDOG_TASK_NAME,
} = require("../appConstants");

test("admin helper VBS files run pre-registered SYSTEM tasks without UAC runas", () => {
  const scripts = createPowerShellScripts();
  const helperNames = [
    "School Services Start Service.vbs",
    "School Services Stop Service.vbs",
    "School Services Restart Service.vbs",
  ];

  for (const name of helperNames) {
    assert.match(scripts[name], /schtasks\.exe \/Run \/TN/i);
    assert.doesNotMatch(scripts[name], /runas/i);
  }

  assert.match(scripts["School Services Start Service.vbs"], new RegExp(START_SERVICE_TASK_NAME));
  assert.match(scripts["School Services Stop Service.vbs"], new RegExp(STOP_SERVICE_TASK_NAME));
  assert.match(scripts["School Services Restart Service.vbs"], new RegExp(RESTART_SERVICE_TASK_NAME));
});

test("startup registration provisions manual service control tasks", () => {
  const scripts = createPowerShellScripts();
  const register = scripts["register-startup.ps1"];

  assert.match(register, new RegExp(START_SERVICE_TASK_NAME));
  assert.match(register, new RegExp(STOP_SERVICE_TASK_NAME));
  assert.match(register, new RegExp(RESTART_SERVICE_TASK_NAME));
  assert.match(register, new RegExp(WATCHDOG_TASK_NAME));
  assert.match(register, /Grant-TaskRunAccess/);
  assert.match(register, /New-ScheduledTaskPrincipal -UserId 'SYSTEM'/);
});

test("startup registration provisions a SYSTEM watchdog for user switch recovery", () => {
  const scripts = createPowerShellScripts();
  const register = scripts["register-startup.ps1"];

  assert.match(register, /Register-WatchdogTask/);
  assert.match(register, /New-ScheduledTaskTrigger -AtLogOn/);
  assert.match(register, /RepetitionInterval \(New-TimeSpan -Minutes 1\)/);
  assert.match(register, /start-supervisor\.ps1/);
});

test("post install starts supervisor through the SYSTEM watchdog task", () => {
  const scripts = createPowerShellScripts();
  const postInstall = scripts["post-install.ps1"];

  assert.match(postInstall, /schtasks\.exe/);
  assert.match(postInstall, /\/Run \/TN \$watchdogTaskName/);
  assert.match(postInstall, /Falling back to direct bootstrap/);
});

test("local stop disables the watchdog while start and restart re-enable it", () => {
  const scripts = createPowerShellScripts();

  assert.match(scripts["School Services Stop Service.ps1"], /Disable-ScheduledTask -TaskName \$watchdogTaskName/);
  assert.match(scripts["School Services Start Service.ps1"], /Enable-ScheduledTask -TaskName \$watchdogTaskName/);
  assert.match(scripts["School Services Restart Service.ps1"], /Enable-ScheduledTask -TaskName \$watchdogTaskName/);
});

test("scheduled task VBS escapes task names for schtasks", () => {
  const script = createScheduledTaskVbsScript('Task "Quoted" Name');

  assert.match(script, /schtasks\.exe \/Run \/TN/);
  assert.match(script, /Task ""Quoted"" Name/);
});
