param([switch]$Publish, [string]$Notes = '')
# Build the installer and its update manifest. With -Publish, upload both as a
# GitHub Release; installed copies of Unison then update themselves.
# Bump `version` in Cargo.toml first; each release needs a new version.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location $projectRoot
$repo = 'Nahur1/unison'
$version = (Select-String -Path 'Cargo.toml' -Pattern '^version = "(.+)"' | Select-Object -First 1).Matches[0].Groups[1].Value

& "$PSScriptRoot\build.ps1" -Release
& "$PSScriptRoot\package.ps1"

$iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe") |
    Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (!$iscc) { throw 'Inno Setup 6 is needed: winget install JRSoftware.InnoSetup' }
& $iscc /Q "/DAppVersion=$version" "/DSrcDir=$projectRoot\dist\unison-$version" 'packaging\windows\unison.iss'
if ($LASTEXITCODE) { throw "Installer build failed: $LASTEXITCODE" }

$setup = Join-Path $projectRoot "dist\unison-setup-$version.exe"
$sha = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLower()
$manifest = [ordered]@{
    version = $version
    url = "https://github.com/$repo/releases/download/v$version/unison-setup-$version.exe"
    sha256 = $sha
}
$latest = Join-Path $projectRoot 'dist\latest.json'
[IO.File]::WriteAllText($latest, ($manifest | ConvertTo-Json))
Write-Host ("Installer: {0} ({1:N0} MB)" -f $setup, ((Get-Item $setup).Length / 1MB))

if ($Publish) {
    if (!$Notes) { $Notes = "Unison Player $version" }
    gh release create "v$version" $setup $latest --repo $repo --title "Unison Player $version" --notes $Notes
    if ($LASTEXITCODE) { throw 'Publishing the release failed' }
    Write-Host "Published v$version. Installed copies will pick it up automatically."
}
