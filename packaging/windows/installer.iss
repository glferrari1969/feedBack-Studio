#ifndef MyAppVersion
  #define MyAppVersion "0.1.0-alpha.4"
#endif

#define MyAppName "feedBack Studio"
#define MyAppPublisher "feedBack Studio contributors"
#define MyAppExeName "feedBackStudio.exe"

[Setup]
AppId={{A865B7CA-6F74-48C9-951D-53B974A6EA7D}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL=https://github.com/glferrari1969/feedBack-Studio
AppSupportURL=https://github.com/glferrari1969/feedBack-Studio/issues
AppUpdatesURL=https://github.com/glferrari1969/feedBack-Studio/releases
DefaultDirName={localappdata}\Programs\feedBack Studio
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
LicenseFile=..\..\LICENSE
PrivilegesRequired=lowest
OutputDir=..\..\release
OutputBaseFilename=feedBack-Studio-{#MyAppVersion}-Windows-x64-Setup
SetupIconFile=feedBackStudio.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
VersionInfoVersion=0.1.0.4
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription={#MyAppName} Windows installer
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion=0.1.0.4

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "italian"; MessagesFile: "compiler:Languages\Italian.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked
Name: "aifeatures"; Description: "Install AI stem separation and lyric transcription (large download)"; GroupDescription: "Optional components:"; Flags: unchecked

[Files]
Source: "..\..\build\windows\feedBackStudio\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "install-ai.ps1"; DestDir: "{app}\support"; Flags: ignoreversion
Source: "..\..\backend\requirements-ai.txt"; DestDir: "{app}\support"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\support\install-ai.ps1"""; StatusMsg: "Installing optional AI components. This can take several minutes..."; Flags: runhidden waituntilterminated; Tasks: aifeatures
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent
