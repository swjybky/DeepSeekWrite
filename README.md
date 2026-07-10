# Deep Write

面向网文与短篇小说创作的**本地桌面写作应用**。Python（pywebview）提供桌面壳与数据持久化，React 构建前端界面，内嵌 [Pi](https://github.com/badlogic/pi) 框架实现多阶段 AI 协作写作。所有数据保存在本机，无需联网服务器。

## 功能概览

### 创作空间（书籍工作台）

- **短篇创作**：世情、追妻、科幻、悬疑四类，共用统一的 **8 阶段**流水线——人物设计 → 剧情设计 → 导语设计 → 剧情细化 → 大纲纲要 → 正文编写 → 正文审阅 → 格式转换
- **三栏工作台**：左侧阶段导航、中间编辑区、右侧可拖拽宽度的 AI 聊天面板
- **专家正文模式**：在「正文编写」阶段可切换为多智能体协作——总控智能体规划小节与人物状态，后台串行调用分节写手逐段生成正文
- **关联素材与技能**：创建书籍时可绑定素材库或技能库，智能体按配置读取关联内容
- **阶段落地**：指定工作目录后，各阶段内容自动导出为 `{stage_key}.txt`
- **封面生成**：配置图像模型后，可为书籍生成 AI 封面
- **长篇**：书架支持创建，工作台尚在开发中

### 素材库

管理可复用的写作素材，按大类（世情 / 追妻 / 科幻 / 悬疑）与子分类组织，包含 **6 个阶段**：人设、导语、梗、剧情细化、剧情设计、正文片段。支持导入 / 导出单个素材包。

### 技能库

将创作经验沉淀为可复用的「技能」文档，覆盖 8 个创作阶段及 2 个专家智能体（总控、分节写手）。创建短篇书籍时可绑定技能库，智能体在对话中按需加载技能内容。支持导入 / 导出。

### 提示词与智能体

- 每个阶段对应独立的系统提示词模板（`app/prompt_defaults/`），可在「创作空间设置」中覆盖
- 可为每个智能体单独配置**读取范围**（可读哪些阶段、关联素材等）
- 书籍分类作为 `{{BOOK_GENRE}}` 上下文传入，不影响阶段定义与工具集
- 智能体架构详见 [`docs/智能体设计.md`](docs/智能体设计.md)

### 其它

- **界面风格**：古风 / 现代两套视觉主题，偏好持久化到本地
- **模型配置**：首页可配置文字模型列表与图像模型，保存至 `.data/preferences.json`；也支持通过 `.env` 预填（见下文）
- **浏览器开发模式**：`npm run dev` 下无需 Python 后端，使用 `localStorage` 模拟数据

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面壳 | Python 3.10+、pywebview |
| 前端 | React 19、TypeScript、Vite、React Router |
| AI | Pi（`@earendil-works/pi-agent-core` / `pi-ai` / `pi-web-ui`） |
| 持久化 | 项目目录 `.data/` 下的 JSON 文件 |

## 快速开始

### 1. 克隆并安装依赖

```bash
git clone <仓库地址>
cd "Deep Write"

# Python 虚拟环境（推荐）
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

pip install -r requirements.txt
```

### 2. 构建前端

```bash
cd web
npm install
npm run build
cd ..
```

### 3. 启动应用

```bash
python -m app.main
```

首次启动前**必须**完成 `npm run build`，否则程序会提示缺少 `web/dist/` 并退出。

启动后，在首页选择**工作目录**（本机文件夹），再创建书籍或素材。

## 环境要求

- **Python** 3.10+
- **Node.js** 18+（仅构建前端时需要，运行桌面应用不需要常驻 Node）

### macOS

默认使用系统 **WKWebView**（pywebview Cocoa 后端）。`requirements.txt` 会通过平台条件安装 `pyobjc`。

```bash
unset PYWEBVIEW_GUI   # 若曾设置过 qt，请先取消
python -m app.main
```

**白屏排查：**

- 控制台提示缺少 `AppKit` / `WebKit` / `objc` → 重新 `pip install -r requirements.txt`
- 排查前端控制台：`DEEPSEEKWRITE_DEBUG=1 python -m app.main`

### Windows

依赖 **Microsoft Edge WebView2 Runtime**（Chromium 内核）。未安装时可能退回 MSHTML（IE），无法执行现代 JavaScript，窗口会一片空白。

- 安装 Evergreen：[WebView2 Runtime 下载页](https://developer.microsoft.com/microsoft-edge/webview2/)
- 排查：`DEEPSEEKWRITE_DEBUG=1 python -m app.main`（PowerShell：`$env:DEEPSEEKWRITE_DEBUG='1'`）

### Linux

默认使用 **Qt（PySide6）**，与内嵌 AI 界面兼容性更好。程序会自动配置 `PYWEBVIEW_GUI=qt` 及中文输入法相关环境变量。

若坚持使用 GTK + WebKitGTK：

```bash
sudo apt-get update
sudo apt-get install -y python3-gi gir1.2-webkit2-4.1 libwebkit2gtk-4.1-0
export PYWEBVIEW_GUI=gtk
```

> GTK 后端下右侧 AI 面板可能出现空白，建议改用默认 Qt。

**中文输入法（Qt）：** 从终端启动时若无法输入中文，可手动指定：

```bash
export QT_IM_MODULE=fcitx   # 或 ibus
python -m app.main
```

Fcitx5 用户请安装 Qt6 前端插件，例如 `sudo apt install fcitx5-frontend-qt6`。

## 开发

### 浏览器中调试前端

```bash
cd web
npm run dev
```

浏览器中没有 `pywebview` 时，前端自动回退到 `localStorage` 模拟数据。

### 代码检查

```bash
cd web
npm run lint
```

### 桌面端端到端

```bash
cd web && npm run build && cd ..
python -m app.main
```

## 项目结构

```
Deep Write/
├── app/                          # Python 后端
│   ├── main.py                   # pywebview 窗口、本地 HTTP 服务、JS API
│   ├── storage.py                # JSON 原子读写、阶段 txt 导出
│   ├── models.py                 # Book / Material / Skill 数据模型
│   ├── prompt_store.py           # 提示词模板读取、覆盖与占位符渲染
│   ├── ai_env.py                 # .env 模型配置解析
│   ├── image_generate.py         # AI 封面生成
│   └── prompt_defaults/          # 内置提示词模板
│       ├── short/shared/         # 创作空间（8 阶段 + 2 专家智能体）
│       └── material/             # 素材库（按长篇 / 短篇分类）
├── web/                          # 前端（Vite + React + TypeScript）
│   └── src/
│       ├── bridge.ts             # pywebview API 桥接层（核心）
│       ├── pages/                # 首页、书籍/素材/技能编辑器、设置页
│       ├── components/           # AI 聊天面板、卡片列表等
│       ├── pi/                   # Pi 会话存储、模型解析、工具注册
│       └── workspaces/           # 创作空间 / 素材库 / 技能库 / 专家模式
├── packaging/                    # PyInstaller 打包配置
├── docs/                         # 设计文档
│   ├── 智能体设计.md
│   └── page-design-ai-writing.md
└── .data/                        # 运行时数据（gitignore，首次运行后生成）
    ├── books.json
    ├── materials.json
    ├── skills.json
    ├── preferences.json          # 工作目录、模型配置、界面风格等
    └── prompt_overrides/         # 用户自定义提示词覆盖
```

## 数据存储

所有用户数据保存在本机，不上传云端：

| 文件 | 内容 |
|------|------|
| `.data/books.json` | 书籍列表与各阶段内容 |
| `.data/materials.json` | 素材库 |
| `.data/skills.json` | 技能库 |
| `.data/preferences.json` | 工作目录、AI 模型配置、界面风格、智能体读取范围等 |
| `.data/prompt_overrides/` | 用户覆盖的系统提示词 |
| `{工作目录}/{书名}/` | 每本书的阶段 `.txt` 导出（需指定工作目录） |
| `{工作目录}/素材库/` | 素材文件夹 |

## AI 配置

### 方式一：应用内配置（推荐）

启动应用后，在首页点击 **「模型配置」**，添加文字模型（支持多模型切换）和可选的图像模型（用于封面生成）。配置保存在 `.data/preferences.json`。

### 方式二：环境文件预填

适合首次部署或打包分发时预置模型。配置文件**已被 `.gitignore` 排除**，请勿将含密钥的文件提交到仓库。

**读取路径（按优先级）：**

1. 项目根目录（`writable_root()`）
2. `app/` 模块同级目录
3. `app/` 包目录

PyInstaller 打包版优先读取**可执行文件同级目录**。

支持的文件名：`.env`、`.deepseek.env`、`.kimi.env`

#### 配置模式

通过 `models_type` 控制行为：

- **`models_type=pi`**（默认）：用户在 Pi 界面内自行填写 API Key 和选择模型
- **`models_type=owner`**：后端锁定模型列表，用户只能在预设模型中切换

#### owner 模式：多模型配置

```ini
models_type=owner
model_list=deepseekflash,kimi

deepseekflash_model_name=deepseek-chat
deepseekflash_model_key=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
deepseekflash_model_source=deepseek
deepseekflash_label=DeepSeek Chat
deepseekflash_model_url=https://api.deepseek.com
deepseekflash_model_like=openai

kimi_model_name=kimi-k2-0711-preview
kimi_model_key=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
kimi_model_source=kimi
kimi_label=Kimi K2
kimi_model_url=https://api.moonshot.cn
kimi_model_like=openai
kimi_model_reasoning=true

default_model=deepseekflash
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `models_type` | 是 | 填 `owner` 启用此模式 |
| `model_list` | 是 | 模型 ID 列表，逗号分隔 |
| `{id}_model_name` | 是 | 模型 ID |
| `{id}_model_key` | 是 | API Key（也支持 `{id}_api_key` 等别名） |
| `{id}_model_source` | 是 | 提供商标识：`deepseek`、`kimi`、`openai` 等 |
| `{id}_label` | 否 | 前端下拉框显示名称 |
| `{id}_model_url` | 否 | 自定义 API Base URL |
| `{id}_model_like` | 否 | API 格式：`openai`（默认）、`claude`、`gemini` 等 |
| `{id}_model_reasoning` | 否 | 是否支持推理链：`true` / `false` |
| `default_model` | 否 | 默认选中的模型 ID |

#### owner 模式：单模型（旧格式，仍兼容）

```ini
models_type=owner
model_name_main=deepseek-chat
model_api_key=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
model_source=deepseek
```

#### 图像模型（封面生成）

项目已内置公用图像模型（`gpt-image-2`，sucloud 代理），新用户无需配置即可生成封面。如需覆盖，可在 `.env` 或应用内「模型配置」中填写：

```ini
image_model=gpt-image-2
image_model_key=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
image_model_url=https://sucloud.vip   # 可选
```

### 安全提醒

- 不要将含 API Key 的 `.env` 文件提交到 git 或打入公开分发包
- 打包版用户应将密钥文件放在可执行文件同级目录自行管理

## 打包 Windows 便携版

```bash
# 1. 构建前端
cd web && npm install && npm run build && cd ..

# 2. 安装 PyInstaller
pip install pyinstaller

# 3. 打包
pyinstaller packaging/DeepSeekWrite.spec
```

产出 `dist/Deep Write/` 目录，压缩后分发。用户需安装 WebView2 Runtime。

## 文档

- [智能体设计](docs/智能体设计.md) — AI 智能体架构、提示词管线、工具注册、专家模式
- [页面设计说明](docs/page-design-ai-writing.md) — 前端页面设计文档
- [AGENTS.md](AGENTS.md) — 面向 AI 编码代理的项目指南（架构与约定）

## 常见问题

| 现象 | 排查方向 |
|------|---------|
| 窗口白屏（Windows） | 安装 WebView2 Runtime；确认 `web/dist/` 已构建 |
| 窗口白屏（macOS） | 检查 PyObjC 是否安装；`unset PYWEBVIEW_GUI` |
| Linux 无法输入中文 | 设置 `QT_IM_MODULE=fcitx` 或 `ibus` |
| 提示词修改未生效 | 检查 `.data/prompt_overrides/` 是否有同名覆盖 |
| 阶段 txt 未写出 | 确认已选择工作目录且目录有写入权限 |
| AI 面板空白（Linux GTK） | 改用 Qt 后端（默认），勿设置 `PYWEBVIEW_GUI=gtk` |

## 参与贡献

欢迎提交 Issue 与 Pull Request。开发前建议阅读 [AGENTS.md](AGENTS.md) 了解项目架构与代码约定。

## 许可证

本项目采用 [PolyForm Noncommercial License 1.0.0](LICENSE) 授权。

源码可供学习、研究、修改和非商业用途使用。未经版权持有人事先书面许可，不允许将本项目用于商业产品、付费服务、SaaS 服务、应用商店分发或其它商业场景。

如需商业授权，请通过 GitHub Issues 或仓库主页联系作者。
