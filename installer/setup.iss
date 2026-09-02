; James PDF V4.2.0.0 standalone installer

#define MyAppName "James PDF"
#define MyAppVersion "4.2.1"
#define MyAppPublisher "Cybereun"
#define MyAppExeName "JamePDF.exe"

[Setup]
AppId={{B0F8261D-E59F-478D-AB13-EC6B76E87F4D}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL=https://github.com/cybereun
AppSupportURL=https://github.com/cybereun/JamesPDF-V4
DefaultDirName={localappdata}\JamesPDF
DefaultGroupName=James PDF
AllowNoIcons=yes
OutputDir=Output
OutputBaseFilename=JamesPDF_Setup
Compression=lzma2/ultra64
SolidCompression=yes
SetupIconFile=images\app_icon.ico
WizardImageFile=images\sidebar.bmp
WizardSmallImageFile=images\logo.bmp
DisableWelcomePage=no
DisableFinishedPage=no
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
CloseApplications=yes
RestartApplications=no
UninstallDisplayIcon={app}\{#MyAppExeName}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription=James PDF {#MyAppVersion} standalone PDF studio
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[InstallDelete]
Type: filesandordirs; Name: "{app}\JamePDF_v3.0.0"
Type: filesandordirs; Name: "{app}\JamePDF V3.0.0"
Type: filesandordirs; Name: "{app}\JamesPDF_V3.0.0_Final"
Type: filesandordirs; Name: "{app}\JamesPDF V2.0.0"
Type: filesandordirs; Name: "{app}\james-app"
Type: filesandordirs; Name: "{app}\james-portal"
Type: filesandordirs; Name: "{app}\새 폴더"
Type: filesandordirs; Name: "{app}\installer\Output"
Type: filesandordirs; Name: "{app}\app\public (1)"
Type: files; Name: "{app}\JamesPDF_Setup.exe"
Type: files; Name: "{app}\run-portal.bat"

[Dirs]
Name: "{app}\app\uploads"
Name: "{app}\app\data"
Name: "{app}\app\outputs"

[Files]
Source: "..\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion; Excludes: ".git\*,.github\*,JamesPDF_Setup.exe,installer\Output\*,새 폴더\*,node\*,app\uploads\*,app\outputs\*,app\data\*,app\test\*"
Source: "images\app_icon.ico"; DestDir: "{app}\installer\images"; Flags: ignoreversion

[Icons]
Name: "{group}\James PDF {#MyAppVersion}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\installer\images\app_icon.ico"
Name: "{group}\{cm:UninstallProgram,James PDF}"; Filename: "{uninstallexe}"
Name: "{userdesktop}\James PDF {#MyAppVersion}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\installer\images\app_icon.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch James PDF {#MyAppVersion}"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent

