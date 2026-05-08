# Write Claw

基于 **pywebview** + **React（Vite 静态构建）** 的本地写作桌面壳：Python 暴露 JS API，数据保存在项目目录 `.data/books.json`。

## 环境要求

- Python 3.10+
- Node.js 18+（仅用于构建前端，运行桌面应用不需要常驻 Node）
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
