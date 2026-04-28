#define MyAppName "School Services"
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef PayloadDir
  #error PayloadDir preprocessor variable is required.
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif

[Setup]
AppId={{A9A403AE-DA9D-4B98-B8A0-08A4FA3D8299}
AppName={#MyAppName}
AppVersion={#AppVersion}
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
