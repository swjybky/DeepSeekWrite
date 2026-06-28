# DeepseekWrite Windows release build
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

Write-Host "==> Build frontend"
Set-Location (Join-Path $Root "web")
npm install
npm run build

Write-Host "==> Prepare WebView2 offline installer"
Set-Location $Root
python packaging/prepare_webview2.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> PyInstaller"
pyinstaller (Join-Path $Root "packaging\Deepseekwrite.spec") --noconfirm --distpath (Join-Path $Root "dist") --workpath (Join-Path $Root "build")

$OutDir = Join-Path $Root "dist\deepseekwrite"
$Installer = Join-Path $Root "packaging\vendor\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
Copy-Item $Installer $OutDir -Force

$ResetBat = Join-Path $Root "packaging\reset_and_start.bat"
if (Test-Path $ResetBat) { Copy-Item $ResetBat $OutDir -Force }

$ZipPath = Join-Path $Root "dist\deepseekwrite.zip"
if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Compress-Archive -Path $OutDir -DestinationPath $ZipPath -Force

$exe = Join-Path $OutDir "deepseekwrite.exe"
$zipMb = [math]::Round((Get-Item $ZipPath).Length / 1MB, 2)
Write-Host ""
Write-Host "Done."
Write-Host "  Output dir: $OutDir"
Write-Host "  Executable: $exe"
Write-Host ('  Zip archive: {0} ({1:N2} megabytes)' -f $ZipPath, $zipMb)
