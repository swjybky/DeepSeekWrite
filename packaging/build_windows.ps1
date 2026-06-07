# DeepseekWrite Windows 发布包一键构建
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

Write-Host "==> 构建前端"
Set-Location (Join-Path $Root "web")
npm install
npm run build

Write-Host "==> 准备 WebView2 离线安装包"
Set-Location $Root
python packaging/prepare_webview2.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> PyInstaller 打包"
pyinstaller (Join-Path $Root "packaging\Deepseekwrite.spec") --noconfirm --distpath (Join-Path $Root "dist") --workpath (Join-Path $Root "build")

$OutDir = Join-Path $Root "dist\deepseekwrite"
$Installer = Join-Path $Root "packaging\vendor\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
Copy-Item $Installer $OutDir -Force

$ZipPath = Join-Path $Root "dist\deepseekwrite.zip"
if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Compress-Archive -Path $OutDir -DestinationPath $ZipPath -Force

$exe = Join-Path $OutDir "deepseekwrite.exe"
$zipMb = [math]::Round((Get-Item $ZipPath).Length / 1MB, 2)
Write-Host ""
Write-Host "完成。"
Write-Host "  程序目录: $OutDir"
Write-Host "  主程序:   $exe"
Write-Host "  发布压缩: $ZipPath ($zipMb MB)"
