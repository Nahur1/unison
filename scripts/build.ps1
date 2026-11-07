param([switch]$Release, [switch]$Test, [string]$Filter, [switch]$Ignored)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location $projectRoot
$portableSetup = Join-Path $projectRoot '.tools\msvc\setup_x64.bat'
if (Test-Path -LiteralPath $portableSetup) {
    cmd /c "`"$portableSetup`" && set" | ForEach-Object {
        if ($_ -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process') }
    }
    $env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = (Get-Command link.exe).Source
    $env:UNISON_RC_DIR = Split-Path (Get-Command rc.exe).Source -Parent
}
$cargo = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
if (!(Test-Path -LiteralPath $cargo)) { $cargo = (Get-Command cargo).Source }
if (!(Test-Path '.tools\mpv.lib')) {
    New-Item -ItemType Directory -Force .tools | Out-Null
    $dll = Join-Path $projectRoot 'runtime\libmpv-2.dll'
    if (!(Test-Path -LiteralPath $dll)) { throw 'Place libmpv-2.dll in runtime before building.' }
    $exports = & dumpbin /exports $dll | ForEach-Object {
        if ($_ -match '^\s+\d+\s+[0-9A-F]+\s+[0-9A-F]{8}\s+(\S+)') { $Matches[1] }
    }
    @('LIBRARY libmpv-2', 'EXPORTS') + $exports | Set-Content .tools/mpv.def
    & lib /nologo /def:.tools/mpv.def /name:libmpv-2.dll /out:.tools/mpv.lib /machine:x64
    if ($LASTEXITCODE) { throw 'mpv import library generation failed' }
}
$env:MPV_LIB_DIR = Join-Path $projectRoot '.tools'
$env:PATH = (Join-Path $projectRoot 'runtime') + ';' + $env:PATH
$cargoArgs = @('build', '--locked')
if ($Test) { $cargoArgs[0] = 'test' }
if ($Release) { $cargoArgs += '--release' }
if ($Test -and $Filter) { $cargoArgs += $Filter }
if ($Test -and $Ignored) { $cargoArgs += @('--', '--ignored', '--nocapture') }
& $cargo @cargoArgs
if ($LASTEXITCODE) { throw "Cargo failed: $LASTEXITCODE" }
