# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 提供在操作本仓库代码时的指引。

## 项目概述

Write Claw 是一款本地桌面写作应用（网文/短篇小说创作工具），后端基于 **pywebview**（Python），前端基于 **React 19 + TypeScript + Vite**。Python 后端通过 `js_api` 向前端暴露 API，数据持久化存储在项目目录下 `.data/` 的 JSON 文件中。

## 常用命令

### 构建前端（运行桌面应用前必须执行）
```bash
cd web
npm install
npm run build
```

### 运行桌面应用
在项目根目录执行（需先完成 `npm run build`）：
```bash
pip install -r requirements.txt
python -m app.main
```

### 浏览器中开发前端
```bash
cd web
npm run dev
```

### 代码检查
```bash
cd web
npm run lint
```

本代码库中没有测试。

## 架构

### 后端（`app/`）
- `main.py` — pywebview 窗口设置及暴露给 JS 的 `Api` 类（`list_books`、`create_book`、`get_book`、`save_book`、`pick_folder`、`get_workspace_root`、`set_workspace_root`、`get_ai_defaults`）。
- `storage.py` — `BookStore` 负责向 `.data/books.json` 和 `.data/preferences.json` 执行原子化 JSON 写入，同时会将各阶段的 `.txt` 文件写入每本书的 `output_dir` 目录。
- `models.py` — `Book` 数据类，包含 `id`、`title`、`book_type`（`short`|`long`）、`categories`、`content`、`output_dir`、`stages` 和时间戳。
- `ai_env.py` — 从 `app/.env` 加载可选的 AI 默认配置（主模型 `model_name_main` 或 `model_name`、可选快速模型 `model_name_flash`、`model_api_key`、`model_source`）；`get_ai_defaults` 返回 `model_id` 与可选 `model_id_flash`。

### 前端（`web/src/`）
- `main.tsx` — 入口文件；等待 `pywebviewready` 事件后再启动 React 应用。
- `App.tsx` — 使用 `HashRouter`，包含首页、创作空间设置、书籍编辑和素材编辑路由。
- `bridge.ts` — 关键桥接层。桌面端通过 `window.pywebview.api` 调用 Python API；浏览器开发模式（无 pywebview）下回退到 `localStorage` 模拟数据。调用后端方法前务必使用 `getBridgeApi()`，以避免竞态条件。
- `pages/Home.tsx` — 书架页，含创建书籍表单。
- `pages/BookEditor.tsx` — 书籍工作台。所有短篇书籍渲染完整三栏工作台；长篇显示「开发中」占位状态。
- `pages/WorkspaceSettings.tsx` — 集中管理 8 个普通阶段与 2 个专家智能体的共享提示词和读取范围。
- `components/WorkspaceAiChat.tsx` — 集成 Pi Web UI 的 AI 聊天面板。
- `pi/` — Pi AI 集成：`setupPiWorkspace.ts` 初始化基于 IndexedDB 的 Pi 会话/设置存储；`resolveWorkspaceChatModel.ts` 和 `writingAssistantPrompt.ts` 配置 AI 助手。

### 数据模型
- **统一阶段定义**：`book_type` 为 `short` 时，所有分类共用同一套 8 阶段定义（`SHORT_STAGE_KEYS` / `SHORT_WORKSPACE_STAGES`）：人物设计、剧情设计、导语设计、剧情细化、大纲纲要、正文编写、正文审阅、格式转换。
- **共享提示词**：所有短篇创作空间智能体读取 `app/prompt_defaults/short/shared/`；书籍分类仅作为 `{{BOOK_GENRE}}` 上下文传入，不影响智能体、工具集或会话标识。
- **数据迁移**：后端自动将旧版追妻阶段键（`qinggan_character` 等）迁移到统一键（`character_design` 等），详见 `app/models.py` 中的 `migrate_legacy_stages`。
- 通过 `save_book` 保存时，传入 `stages` 会合并阶段内容，并将顶层 `content` 同步为「正文编写」阶段（统一使用 `draft` 键）；仅传入 `content` 则只更新顶层 `content` 字段。
- 书籍数据存储在 `.data/books.json` 中。工作空间根目录（上次选定的文件夹）存储在 `.data/preferences.json` 中。
- 如果书籍设有 `output_dir`，每次保存时各阶段内容还会以 `.txt` 文件形式写入该目录。

### 开发注意事项
- 前端构建配置 `base: './'`，以确保在 pywebview 内通过 `file://` 协议正确加载资源。
- `app/.env` 为可选文件且已被 gitignore；用于预填充 Pi 的 AI 模型凭证，让用户跳过初始设置。
- `.cursor/skills/` 目录包含 Impeccable 前端设计技能集（与运行时代码无关）。
