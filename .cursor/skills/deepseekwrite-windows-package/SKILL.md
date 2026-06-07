---
name: deepseekwrite-windows-package
description: >-
  为 Write Claw（DeepseekWrite）构建 Windows 便携发布包（deepseekwrite.exe + zip）。
  在用户要求打包、发布 Windows 版、打 deepseekwrite 包、PyInstaller 构建时使用。
---

# DeepseekWrite Windows 打包

## 一键构建（首选）

在项目根目录执行：

```powershell
.\packaging\build_windows.ps1
```

脚本依次完成：前端构建 → 下载/缓存 WebView2 离线安装包 → PyInstaller 打包 → 复制 WebView2 安装器 → 生成 `dist\deepseekwrite.zip`。

**不要**用 `&&` 链接命令（旧版 PowerShell 不支持）；用 `;` 或分步执行。

## 产出物

| 路径 | 说明 |
|------|------|
| `dist/deepseekwrite/deepseekwrite.exe` | 主程序 |
| `dist/deepseekwrite/_internal/` | 运行时依赖（必须与 exe 同发） |
| `dist/deepseekwrite/MicrosoftEdgeWebView2RuntimeInstallerX64.exe` | WebView2 离线安装器（本机无 WebView2 时自动静默安装） |
| `dist/deepseekwrite.zip` | 可直接分发的压缩包 |

应用名固定为 **deepseekwrite**（非 WriteClaw）。

## 环境要求

- Windows 10/11 x64
- Python 3.10+（推荐 Miniconda/Anaconda，需含 OpenSSL DLL）
- Node.js 18+（仅构建前端）
- 已安装：`pip install -r requirements.txt pyinstaller`

打包前确认 `web/dist/index.html` 存在；脚本会自动 `npm install && npm run build`。

## 手动分步（脚本失败时）

```powershell
Set-Location web; npm install; npm run build; Set-Location ..
python packaging/prepare_webview2.py
pyinstaller packaging/Deepseekwrite.spec --noconfirm
Copy-Item packaging/vendor/MicrosoftEdgeWebView2RuntimeInstallerX64.exe dist/deepseekwrite/ -Force
Compress-Archive -Path dist/deepseekwrite -DestinationPath dist/deepseekwrite.zip -Force
```

## 打包后验证

1. 结束已运行的 `deepseekwrite` 进程（否则 zip 可能失败）
2. 启动 `dist/deepseekwrite/deepseekwrite.exe`，等待 5 秒确认未立即退出
3. 确认 `_internal/libssl-3-x64.dll` 存在（缺失会导致 `_ssl` 加载失败）

## 已知坑（勿删改除非明确需要）

`packaging/Deepseekwrite.spec` 已处理以下问题，**不要**回退：

1. **platformdirs**：`collect_all("platformdirs")` + 预加载 hook `pyi_rth_preload_platformdirs.py` + 排除 `pyi_rth_pkgres`
2. **OpenSSL DLL**：从 `{sys.prefix}/Library/bin` 收集 `libssl-3-x64.dll` 等（Miniconda 必需）
3. **WebView2**：`app/main.py` 的 `_ensure_windows_webview2()` 会在缺少运行时静默安装捆绑的离线包

## 分发注意

- **不要**将 `.env` / API Key 打入 zip
- 提醒用户：更新时需**整目录替换**（含 `_internal`），不能只换 exe
- `packaging/vendor/` 已在 `.gitignore`，WebView2 安装器由 `prepare_webview2.py` 自动下载缓存（约 192 MB）

## 相关文件

- `packaging/Deepseekwrite.spec` — PyInstaller 配置
- `packaging/build_windows.ps1` — 一键构建脚本
- `packaging/prepare_webview2.py` — WebView2 离线安装包下载
- `packaging/pyi_entry.py` — 冻结入口
- `app/main.py` — WebView2 自动安装逻辑
