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
AppPublisher=Reza Hashemian and Mohammad Fakhari (Nahur1)
AppPublisherURL=https://github.com/Nahur1/unison
AppUpdatesURL=https://github.com/Nahur1/unison/releases
AppVerName=Unison Player {#AppVersion}
VersionInfoVersion={#AppVersion}
VersionInfoCompany=Reza Hashemian and Mohammad Fakhari (Nahur1)
AppCopyright=Copyright (c) 2026 Reza Hashemian and Mohammad Fakhari (Nahur1). See LICENSE for scope.
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
  { Kaghaz Player, the app Unison replaces. Only its program files are removed;
    its data folders are left alone, and Unison never reads them. }
  KaghazKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{3B1C2C37-4876-48D1-93EC-94014678813D}_is1';

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

{ An installed Kaghaz Player, if any. }
function KaghazUninstaller(var Uninstaller: String): Boolean;
begin
  Result := RegQueryStringValue(HKCU, KaghazKey, 'UninstallString', Uninstaller)
    or RegQueryStringValue(HKLM, KaghazKey, 'UninstallString', Uninstaller);
  if Result then
  begin
    Uninstaller := RemoveQuotes(Uninstaller);
    Result := FileExists(Uninstaller);
  end;
end;


{ Unison takes over from Kaghaz Player: close it and uninstall it silently. }
procedure RemoveKaghaz;
var
  Uninstaller: String;
  Code: Integer;
begin
  if not KaghazUninstaller(Uninstaller) then exit;
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM kaghaz.exe', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Exec(Uninstaller, '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

{ "Unison 0.5.1", for the messages. }
function PreviousLabel: String;
var
  Version: String;
begin
  if not RegQueryStringValue(HKCU, UninstallKey, 'DisplayVersion', Version) then
    RegQueryStringValue(HKLM, UninstallKey, 'DisplayVersion', Version);
  Result := 'Unison';
  if Version <> '' then Result := Result + ' ' + Version;
end;

{ A copy installed into a source checkout (a folder with .git) is never
  uninstalled automatically: its uninstaller would also remove project files
  that the installer overwrote. }
function InSourceCheckout(Dir: String): Boolean;
begin
  Result := DirExists(AddBackslash(Dir) + '.git');
end;

{ Every new version first uninstalls the previous one (also from the same
  folder), so nothing of an old version stays on the computer. Settings,
  library and sessions live in the user's profile and are kept. }
procedure CurStepChanged(CurStep: TSetupStep);
var
  Dir, Uninstaller, Name: String;
  Code: Integer;
begin
  if CurStep <> ssInstall then exit;
  RemoveKaghaz;
  if not PreviousInstall(Dir, Uninstaller) then exit;
  if InSourceCheckout(RemoveBackslashUnlessRoot(Dir)) then exit;
  Uninstaller := RemoveQuotes(Uninstaller);
  if not FileExists(Uninstaller) then exit;
  Name := PreviousLabel;
  WizardForm.StatusLabel.Caption := 'Removing the previous version (' + Name + ')...';
  WizardForm.FilenameLabel.Caption := Dir;
  WizardForm.Refresh;
  Log('Uninstalling ' + Name + ' from ' + Dir + ' before installing the new version');
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM unison.exe', '', SW_HIDE, ewWaitUntilTerminated, Code);
  if not Exec(Uninstaller, '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART', '', SW_HIDE, ewWaitUntilTerminated, Code) or (Code <> 0) then
    Log('The previous version''s uninstaller did not finish cleanly (code ' + IntToStr(Code) + '); installing over it');
  WizardForm.StatusLabel.Caption := 'Installing Unison Player {#AppVersion}...';
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo,
  MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
var
  Dir, Uninstaller: String;
begin
  Result := MemoDirInfo;
  if MemoTasksInfo <> '' then
  begin
    if Result <> '' then Result := Result + NewLine + NewLine;
    Result := Result + MemoTasksInfo;
  end;
  if KaghazUninstaller(Uninstaller) then
  begin
    if Result <> '' then Result := Result + NewLine + NewLine;
    Result := Result + 'Kaghaz Player:' + NewLine + Space +
      'Unison replaces it. Kaghaz Player will be closed and uninstalled.';
  end;
  if PreviousInstall(Dir, Uninstaller) and not InSourceCheckout(RemoveBackslashUnlessRoot(Dir)) then
  begin
    if Result <> '' then Result := Result + NewLine + NewLine;
    Result := Result + 'Previous version:' + NewLine + Space +
      PreviousLabel + ' will be closed and uninstalled first, so nothing of it is left behind.' +
      NewLine + Space + 'Your settings, library and sessions are kept.';
  end;
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
