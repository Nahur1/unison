; Inno Setup script. scripts/release.ps1 passes /DAppVersion=... and /DSrcDir=...
; Installs per user (no administrator prompt), so updates can install silently.
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SrcDir
  #define SrcDir "..\..\dist\unison-" + AppVersion
#endif

#define SysEnv "SYSTEM\CurrentControlSet\Control\Session Manager\Environment"

[Setup]
AppId={{13A77F89-D5AC-4ECC-A660-FE6C31B12D79}
AppName=Unison Player
AppVersion={#AppVersion}
AppPublisher=Mohammad Fakhari (Nahur1)
AppPublisherURL=https://github.com/Nahur1/unison
AppUpdatesURL=https://github.com/Nahur1/unison/releases
AppVerName=Unison Player {#AppVersion}
VersionInfoVersion={#AppVersion}
VersionInfoCompany=Mohammad Fakhari (Nahur1)
AppCopyright=Copyright (c) 2026 Mohammad Fakhari (Nahur1). See LICENSE for scope.
LicenseFile=..\..\LICENSE
DefaultDirName={autopf}\Unison
DefaultGroupName=Unison
DisableProgramGroupPage=yes
; A new version replaces the installed one, like an app store update: once
; Unison is installed, setup goes straight to its folder without asking.
UsePreviousAppDir=yes
DisableDirPage=auto
PrivilegesRequired=lowest
OutputDir=..\..\dist
OutputBaseFilename=unison-setup-{#AppVersion}
; Updates close a running Unison before replacing its files.
CloseApplications=force
CloseApplicationsFilter=unison.exe
RestartApplications=no
SetupIconFile=unison.ico
UninstallDisplayIcon={app}\unison.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
ChangesEnvironment=yes

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "addtopath"; Description: "Add unison to PATH (for the command line)"; Flags: unchecked

[Files]
Source: "{#SrcDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs

[Icons]
Name: "{group}\Unison Player"; Filename: "{app}\unison.exe"
Name: "{autodesktop}\Unison Player"; Filename: "{app}\unison.exe"; Tasks: desktopicon

[Registry]
; PATH lives in different places for "just me" and "all users" installs.
Root: HKCU; Subkey: "Environment"; ValueType: expandsz; ValueName: "Path"; ValueData: "{olddata};{app}"; Tasks: addtopath; Check: (not IsAdminInstallMode) and NeedsAddPath(ExpandConstant('{app}'))
Root: HKLM; Subkey: "{#SysEnv}"; ValueType: expandsz; ValueName: "Path"; ValueData: "{olddata};{app}"; Tasks: addtopath; Check: IsAdminInstallMode and NeedsAddPath(ExpandConstant('{app}'))

[InstallDelete]
; Files from earlier versions that are no longer shipped.
Type: filesandordirs; Name: "{app}\runtime\llama*"
Type: filesandordirs; Name: "{app}\runtime\ggml*"
Type: filesandordirs; Name: "{app}\models\*.gguf"

[Run]
Filename: "{app}\unison.exe"; Description: "{cm:LaunchProgram,Unison Player}"; Flags: nowait postinstall skipifsilent
; "Restart and update" from inside Unison: open it again after a silent install.
Filename: "{app}\unison.exe"; Flags: nowait; Check: WizardSilent and Relaunch

[Code]
const
  UninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{13A77F89-D5AC-4ECC-A660-FE6C31B12D79}_is1';

function Relaunch: Boolean;
begin
  Result := ExpandConstant('{param:relaunch|0}') = '1';
end;

{ The installed copy, if any: its folder and uninstaller. }
function PreviousInstall(var Dir, Uninstaller: String): Boolean;
begin
  Result := RegQueryStringValue(HKCU, UninstallKey, 'InstallLocation', Dir)
    and RegQueryStringValue(HKCU, UninstallKey, 'UninstallString', Uninstaller);
  if not Result then
    Result := RegQueryStringValue(HKLM, UninstallKey, 'InstallLocation', Dir)
      and RegQueryStringValue(HKLM, UninstallKey, 'UninstallString', Uninstaller);
end;

{ Only one Unison on the computer: if the new version goes to another folder,
  the old copy is uninstalled first (settings and library are kept). }
procedure CurStepChanged(CurStep: TSetupStep);
var
  Dir, Uninstaller: String;
  Code: Integer;
begin
  if CurStep <> ssInstall then exit;
  if not PreviousInstall(Dir, Uninstaller) then exit;
  if CompareText(RemoveBackslashUnlessRoot(Dir), RemoveBackslashUnlessRoot(ExpandConstant('{app}'))) = 0 then exit;
  Uninstaller := RemoveQuotes(Uninstaller);
  if not FileExists(Uninstaller) then exit;
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM unison.exe', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Exec(Uninstaller, '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

procedure EnvKey(var Root: Integer; var Key: string);
begin
  if IsAdminInstallMode then
  begin
    Root := HKEY_LOCAL_MACHINE;
    Key := '{#SysEnv}';
  end
  else
  begin
    Root := HKEY_CURRENT_USER;
    Key := 'Environment';
  end;
end;

function NeedsAddPath(Dir: string): boolean;
var
  Root: Integer;
  Key, Paths: string;
begin
  EnvKey(Root, Key);
  if not RegQueryStringValue(Root, Key, 'Path', Paths) then
  begin
    Result := True;
    exit;
  end;
  Result := Pos(';' + Uppercase(Dir) + ';', ';' + Uppercase(Paths) + ';') = 0;
end;

{ Take our folder back out of PATH on uninstall. }
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Root, P: Integer;
  Key, Paths, Dir: string;
begin
  if CurUninstallStep <> usPostUninstall then exit;
  EnvKey(Root, Key);
  if not RegQueryStringValue(Root, Key, 'Path', Paths) then exit;
  Dir := ExpandConstant('{app}');
  P := Pos(';' + Uppercase(Dir), Uppercase(Paths));
  if P > 0 then
  begin
    Delete(Paths, P, Length(Dir) + 1);
    RegWriteExpandStringValue(Root, Key, 'Path', Paths);
  end;
end;
