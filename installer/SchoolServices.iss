#define MyAppName "School Services"
#define MyAppId "{{A9A403AE-DA9D-4B98-B8A0-08A4FA3D8299}"
#ifndef AppVersion
#define AppVersion "2.0.3"
#endif
#ifndef PayloadDir
  #error PayloadDir preprocessor variable is required.
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#AppVersion}
VersionInfoVersion={#AppVersion}
VersionInfoTextVersion=v{#AppVersion}
AppPublisher=School Services
DefaultDirName={autopf}\School Services
DefaultGroupName=School Services
DisableDirPage=yes
DisableProgramGroupPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
OutputDir={#OutputDir}
OutputBaseFilename=School Services v{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile={#PayloadDir}\favicon.ico
UninstallDisplayIcon={app}\favicon.ico
UsePreviousTasks=yes

[Dirs]
Name: "{commonappdata}\School Services"; Permissions: users-modify

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\School Services"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\School Services Guest Web.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\favicon.ico"
Name: "{autodesktop}\School Services"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\School Services Guest Web.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\favicon.ico"

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\post-install.ps1"""; Flags: runhidden waituntilterminated

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\uninstall-cleanup.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "SchoolServicesUninstallCleanup"

[Code]
var
  InstallModePage: TInputOptionWizardPage;
  PreviousInstallDetected: Boolean;
  PreviousInstallHandled: Boolean;
  PreviousInstallDir: string;
  PreviousDataDir: string;
  PreviousStopScriptPath: string;
  PreviousUninstallerPath: string;

function GetPreviousInstallDir(): string;
begin
  Result := ExpandConstant('{autopf}\School Services');
end;

function GetPreviousDataDir(): string;
begin
  Result := ExpandConstant('{commonappdata}\School Services');
end;

procedure DetectPreviousInstall();
begin
  PreviousInstallDir := GetPreviousInstallDir();
  PreviousDataDir := GetPreviousDataDir();
  PreviousStopScriptPath := AddBackslash(PreviousInstallDir) + 'stop-agent.ps1';
  PreviousUninstallerPath := AddBackslash(PreviousInstallDir) + 'unins000.exe';
  PreviousInstallDetected :=
    DirExists(PreviousInstallDir) and
    (
      FileExists(PreviousUninstallerPath) or
      FileExists(PreviousStopScriptPath) or
      FileExists(AddBackslash(PreviousInstallDir) + 'School Services.exe') or
      FileExists(AddBackslash(PreviousInstallDir) + 'School Services Agent.exe')
    );
end;

procedure StopPreviousProcesses();
var
  ResultCode: Integer;
  PowerShellPath: string;
  Params: string;
begin
  Log('Stopping previous School Services processes.');

  if FileExists(PreviousStopScriptPath) then
  begin
    PowerShellPath := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
    Params := '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + PreviousStopScriptPath + '"';
    if Exec(PowerShellPath, Params, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
      Log(Format('Previous stop script exited with code %d.', [ResultCode]))
    else
      Log('Previous stop script could not be started. Continuing with fallback stop.');
  end;

  Exec(ExpandConstant('{sys}\cmd.exe'), '/C taskkill /F /IM "School Services Agent.exe" /T', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(ExpandConstant('{sys}\cmd.exe'), '/C taskkill /F /IM "School Services.exe" /T', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(ExpandConstant('{sys}\cmd.exe'), '/C taskkill /F /IM cloudflared.exe /T', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(ExpandConstant('{sys}\schtasks.exe'), '/Delete /TN "School Services Agent Startup" /F', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

function RunPreviousUninstaller(): Boolean;
var
  ResultCode: Integer;
begin
  Result := True;

  if not FileExists(PreviousUninstallerPath) then
  begin
    Log('Previous uninstaller was not found. Clean install will continue with manual cleanup.');
    exit;
  end;

  Log('Running previous uninstaller: ' + PreviousUninstallerPath);
  if not Exec(
    PreviousUninstallerPath,
    '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART',
    '',
    SW_HIDE,
    ewWaitUntilTerminated,
    ResultCode
  ) then
  begin
    SuppressibleMsgBox(
      'Instalasi lama tidak dapat dihapus otomatis. Tutup aplikasi yang masih berjalan lalu coba lagi.',
      mbCriticalError,
      MB_OK,
      IDOK
    );
    Result := False;
    exit;
  end;

  Log(Format('Previous uninstaller exited with code %d.', [ResultCode]));
  if ResultCode <> 0 then
  begin
    SuppressibleMsgBox(
      'Proses clean install dihentikan karena uninstall versi lama gagal.',
      mbCriticalError,
      MB_OK,
      IDOK
    );
    Result := False;
  end;
end;

procedure RemovePreviousDirectories();
begin
  if DirExists(PreviousInstallDir) then
  begin
    Log('Removing previous install directory: ' + PreviousInstallDir);
    DelTree(PreviousInstallDir, True, True, True);
  end;

  if DirExists(PreviousDataDir) then
  begin
    Log('Removing previous data directory: ' + PreviousDataDir);
    DelTree(PreviousDataDir, True, True, True);
  end;
end;

function HandlePreviousInstall(CleanInstall: Boolean): Boolean;
begin
  Result := True;

  if PreviousInstallHandled or (not PreviousInstallDetected) then
    exit;

  StopPreviousProcesses();

  if CleanInstall then
  begin
    if not RunPreviousUninstaller() then
    begin
      Result := False;
      exit;
    end;

    RemovePreviousDirectories();
  end;

  PreviousInstallHandled := True;
end;

procedure InitializeWizard();
begin
  DetectPreviousInstall();

  if PreviousInstallDetected and (not WizardSilent) then
  begin
    InstallModePage := CreateInputOptionPage(
      wpWelcome,
      'Instalasi lama terdeteksi',
      'Pilih cara melanjutkan pemasangan',
      'School Services sudah terpasang di perangkat ini. Pilih Upgrade untuk mempertahankan konfigurasi dan hanya memperbarui file aplikasi, atau Clean Install untuk menghapus instalasi lama beserta data lokal sebelum memasang ulang.',
      True,
      False
    );
    InstallModePage.Add('Upgrade');
    InstallModePage.Add('Clean Install');
    InstallModePage.Values[0] := True;
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;

  if (InstallModePage <> nil) and (CurPageID = InstallModePage.ID) then
  begin
    if InstallModePage.Values[1] then
      Result := HandlePreviousInstall(True)
    else
      Result := HandlePreviousInstall(False);
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';

  if not PreviousInstallDetected then
    exit;

  if not PreviousInstallHandled then
  begin
    if not HandlePreviousInstall(False) then
      Result := 'School Services lama tidak dapat dihentikan. Tutup proses yang masih aktif lalu jalankan installer lagi.';
  end;
end;
