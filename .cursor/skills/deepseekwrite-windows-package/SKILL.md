---
name: deepseekwrite-windows-package
description: >-
  为 DeepSeekWrite（DeepSeekWrite）构建 Windows 便携发布包（DeepSeekWrite.exe + zip）。
  在用户要求打包、发布 Windows 版、打 DeepSeekWrite 包、PyInstaller 构建时使用。
---

# DeepSeekWrite Windows 打包

## 一键构建（首选）

在项目根目录执行：

```powershell
.\packaging\build_windows.ps1
```

脚本依次完成：前端构建 → PyInstaller 打包 → 生成 `dist\DeepSeekWrite.zip`。

**不要**用 `&&` 链接命令（旧版 PowerShell 不支持）；用 `;` 或分步执行。

## 产出物

| 路径 | 说明 |
|------|------|
| `dist/DeepSeekWrite/DeepSeekWrite.exe` | 主程序 |
| `dist/DeepSeekWrite/_internal/` | 运行时依赖（必须与 exe 同发） |
| `dist/DeepSeekWrite.zip` | 可直接分发的压缩包（约 50–60 MB） |

应用名固定为 **DeepSeekWrite**。

**不捆绑** `MicrosoftEdgeWebView2RuntimeInstallerX64.exe`（约 192 MB），以控制分发包体积。用户本机需已安装 [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)；未安装时应用会显示 `webview2-required.html` 页面弹窗，引导用户下载安装。

## 环境要求

- Windows 10/11 x64
- Python 3.10+（推荐 Miniconda/Anaconda，需含 OpenSSL DLL）
- Node.js 18+（仅构建前端）
- 已安装：`pip install -r requirements.txt pyinstaller`

打包前确认 `web/dist/index.html` 存在；脚本会自动 `npm install && npm run build`。

## 手动分步（脚本失败时）

```powershell
Set-Location web; npm install; npm run build; Set-Location ..
pyinstaller packaging/DeepSeekWrite.spec --noconfirm
Compress-Archive -Path dist/DeepSeekWrite -DestinationPath dist/DeepSeekWrite.zip -Force
```

## 打包后验证

1. 结束已运行的 `DeepSeekWrite` 进程（否则 zip 可能失败）
2. 启动 `dist/DeepSeekWrite/DeepSeekWrite.exe`，等待 5 秒确认未立即退出
3. 确认 `_internal/libssl-3-x64.dll` 存在（缺失会导致 `_ssl` 加载失败）

## 已知坑（勿删改除非明确需要）

`packaging/DeepSeekWrite.spec` 已处理以下问题，**不要**回退：

1. **platformdirs**：`collect_all("platformdirs")` + 预加载 hook `pyi_rth_preload_platformdirs.py` + 排除 `pyi_rth_pkgres`
2. **OpenSSL DLL**：从 `{sys.prefix}/Library/bin` 收集 `libssl-3-x64.dll` 等（Miniconda 必需）
3. **WebView2**：未检测到运行时时，窗口加载 `webview2-required.html` 页面弹窗提示用户安装；`app/main.py` 不再向控制台打印警告

## 分发注意

- **不要**将 `.env` / API Key 打入 zip
- 提醒用户：更新时需**整目录替换**（含 `_internal`），不能只换 exe
- 提醒用户：首次运行若提示安装 WebView2，按页面指引安装后重启即可

## 相关文件

- `packaging/DeepSeekWrite.spec` — PyInstaller 配置
- `packaging/build_windows.ps1` — 一键构建脚本
- `packaging/pyi_entry.py` — 冻结入口
- `app/main.py` — WebView2 运行时检测与提示
