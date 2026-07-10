# Deep Write Windows release build
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

Write-Host "==> Build frontend"
Set-Location (Join-Path $Root "web")
npm install
npm run build

Write-Host "==> PyInstaller"
Set-Location $Root
pyinstaller (Join-Path $Root "packaging\DeepSeekWrite.spec") --noconfirm --distpath (Join-Path $Root "dist") --workpath (Join-Path $Root "build")

$OutDir = Join-Path $Root "dist\Deep Write"

$ResetBat = Join-Path $Root "packaging\reset_and_start.bat"
if (Test-Path $ResetBat) { Copy-Item $ResetBat $OutDir -Force }

$ExeConfig = Join-Path $Root "packaging\DeepSeekWrite.exe.config"
if (Test-Path $ExeConfig) {
    Copy-Item $ExeConfig (Join-Path $OutDir "Deep Write.exe.config") -Force
}

$ZipPath = Join-Path $Root "dist\Deep Write.zip"
if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Compress-Archive -Path $OutDir -DestinationPath $ZipPath -Force

$exe = Join-Path $OutDir "Deep Write.exe"
$zipMb = [math]::Round((Get-Item $ZipPath).Length / 1MB, 2)
Write-Host ""
Write-Host "Done."
Write-Host "  Output dir: $OutDir"
Write-Host "  Executable: $exe"
Write-Host ('  Zip archive: {0} ({1:N2} megabytes)' -f $ZipPath, $zipMb)
