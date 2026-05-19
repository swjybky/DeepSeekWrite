# Write Claw

基于 **pywebview** + **React（Vite 静态构建）** 的本地写作桌面壳：Python 暴露 JS API，数据保存在项目目录 `.data/books.json`。

## 环境要求

- Python 3.10+
- Node.js 18+（仅用于构建前端，运行桌面应用不需要常驻 Node）
- **macOS 桌面壳默认使用系统 WKWebView（pywebview Cocoa 后端）**。首次安装请执行
  `pip install -r requirements.txt`，其中会通过平台条件安装 `pyobjc`。不要在 macOS 上
  强制 `PYWEBVIEW_GUI=qt`，除非你正在专门排查 Qt 后端问题。
- **Linux 桌面壳默认使用 Qt（PySide6，见 `requirements.txt`）**，与内嵌 AI 界面（Pi / Lit）兼容性更好。
- 若坚持使用 **GTK + WebKitGTK** 后端，需额外安装系统库（示例 Debian/Ubuntu）：

```bash
sudo apt-get update
sudo apt-get install -y python3-gi gir1.2-webkit2-4.1 libwebkit2gtk-4.1-0
```

安装后需设置 `PYWEBVIEW_GUI=gtk`。说明：在常见 Ubuntu/WebKitGTK 环境下，右侧 AI 助手可能出现空白（引擎布局限制）；如遇此情况请改用默认 Qt（勿设置 `PYWEBVIEW_GUI`，或显式 `PYWEBVIEW_GUI=qt`）。

### Linux：Qt 下中文输入法（IME）

Qt WebEngine 需要 `QT_IM_MODULE` 指向系统输入法模块；从**终端**启动时若未继承桌面会话变量，可能出现无法输入中文。程序会在未设置时尽量根据 `GTK_IM_MODULE` / `XMODIFIERS` 推断（与 Fcitx / IBus 对齐），仍无效时可手动指定后启动：

```bash
# Fcitx / Fcitx5（常见）
export QT_IM_MODULE=fcitx
python -m app.main

# IBus
export QT_IM_MODULE=ibus
python -m app.main
```

Fcitx5 用户请安装 Qt6 前端插件，例如：`sudo apt install fcitx5-frontend-qt6`（包名因发行版而异）。

### macOS：白屏排查

macOS 使用系统自带的 WKWebView 渲染前端，并通过 PyObjC 暴露给 pywebview。如果窗口打开后白屏，优先检查以下几项：

```bash
# 建议在项目根目录使用虚拟环境
python3 -m venv .venv
source .venv/bin/activate

pip install -r requirements.txt
cd web
npm install
npm run build
cd ..

unset PYWEBVIEW_GUI
python -m app.main
```

- 若控制台提示缺少 `AppKit` / `WebKit` / `objc`，说明 PyObjC 没装进当前虚拟环境，重新执行 `pip install -r requirements.txt`。
- 若曾在 shell 配置里设置 `PYWEBVIEW_GUI=qt`，请先 `unset PYWEBVIEW_GUI`，本项目在 macOS 默认使用 `cocoa`。
- 排查前端控制台错误：`WRITECLAW_DEBUG=1 python -m app.main`。
- 当前构建已将 Vite 目标设置为较保守的 Safari/WebKit 版本，以兼容较旧 macOS 的系统 WKWebView。

### Windows：白屏与 WebView2

桌面壳依赖 **Microsoft Edge WebView2 Runtime**（Chromium 内核）。若本机仅有旧版内核或未安装运行时，pywebview 可能退回 **MSHTML（IE）**，无法执行 Vite 构建的现代 JavaScript，**窗口会一片空白**。

- 请先安装 Evergreen：**[WebView2 Runtime 下载页](https://developer.microsoft.com/microsoft-edge/webview2/)**（选择「Evergreen Bootstrapper」或独立安装包均可）。
- 启动前未完成 `npm run build`、或 `web/dist` 不完整时，控制台会报错并退出（不会进入白窗口）。
- 排查前端错误：PowerShell 中执行 `$env:WRITECLAW_DEBUG='1'; python -m app.main`（或 CMD：`set WRITECLAW_DEBUG=1` 后在同一会话运行），窗口内可打开开发者工具查看控制台。

## 构建前端

```bash
cd web
npm install
npm run build
```

## 安装 Python 依赖并启动

在项目根目录：

```bash
pip install -r requirements.txt
python -m app.main
```

首次打开前必须先执行 `npm run build` 生成 `web/dist/`，否则程序会提示缺少构建产物。

## 开发前端（浏览器）

```bash
cd web
npm run dev
```

浏览器中没有 `pywebview` 时，前端会使用 `localStorage` 做简易模拟数据，便于单独调试界面。

## 项目结构

- `app/main.py`：pywebview 窗口与 `Api`（`list_books` / `create_book` / `get_book` / `save_book`）
- `app/storage.py`：JSON 原子写入
- `web/`：Vite + React + TypeScript，`base: './'` 以支持 `file://` 加载资源
