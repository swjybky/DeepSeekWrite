# Write Claw

基于 **pywebview** + **React（Vite 静态构建）** 的本地写作桌面壳：Python 暴露 JS API，数据保存在项目目录 `.data/books.json`。

## 环境要求

- Python 3.10+
- Node.js 18+（仅用于构建前端，运行桌面应用不需要常驻 Node）
- Linux 桌面需安装 WebView 相关系统库（示例为 Debian/Ubuntu）：

```bash
sudo apt-get update
sudo apt-get install -y python3-gi gir1.2-webkit2-4.1 libwebkit2gtk-4.1-0
```

若启动报错与 GTK/WebKit 相关，请按发行版文档补齐 `webkit2gtk` / `PyGObject` 等依赖。

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
