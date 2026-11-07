param([switch]$IncludeFFmpeg)
# Portable Windows folder: the player, libmpv, fonts and the 22 MB Persian model.
# FFmpeg is optional (it only lets embedded tracks be read ahead); it adds ~230 MB.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$version = (Select-String -Path (Join-Path $projectRoot 'Cargo.toml') -Pattern '^version = "(.+)"' | Select-Object -First 1).Matches[0].Groups[1].Value
$out = Join-Path $projectRoot "dist\unison-$version"
New-Item -ItemType Directory -Force $out, "$out\runtime\fonts", "$out\models\enfa" | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'target\release\unison.exe') -Destination $out -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'runtime\libmpv-2.dll') -Destination $out -Force
foreach ($font in 'Vazirmatn.ttf', 'Vazirmatn-LICENSE.txt', 'Inter-Medium.ttf', 'Inter-LICENSE.txt') {
    Copy-Item -LiteralPath (Join-Path $projectRoot "ui\fonts\$font") -Destination "$out\runtime\fonts" -Force
}
$model = Join-Path $projectRoot 'models\enfa'
foreach ($file in 'model.enfa.intgemm.alphas.bin', 'vocab.enfa.spm', 'lex.50.50.enfa.s2t.bin') {
    $path = Join-Path $model $file
    if (!(Test-Path -LiteralPath $path)) { throw "Missing $path. Run: python scripts/prepare-offline.py" }
    Copy-Item -LiteralPath $path -Destination "$out\models\enfa" -Force
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\MODEL-LICENSE.txt') -Destination "$out\models\enfa\LICENSE.txt" -Force
if ($IncludeFFmpeg) {
    Copy-Item -LiteralPath (Join-Path $projectRoot 'runtime\ffmpeg.exe') -Destination "$out\runtime" -Force
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'README.fa.md'),(Join-Path $projectRoot 'README.md'),(Join-Path $projectRoot 'LICENSE'),(Join-Path $projectRoot 'COPYRIGHT.md'),(Join-Path $projectRoot 'THIRD_PARTY.md') -Destination $out -Force
New-Item -ItemType Directory -Force (Join-Path $out 'licenses') | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'licenses\LEGACY-MIT.txt') -Destination (Join-Path $out 'licenses') -Force
$size = (Get-ChildItem -LiteralPath $out -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host ("Portable app: {0}\unison.exe  ({1:N0} MB)" -f $out, $size)
