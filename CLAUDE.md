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
- `ai_env.py` — 从 `app/.env` 加载可选的 AI 默认配置（`model_name`、`model_api_key`、`model_source`）。

### 前端（`web/src/`）
- `main.tsx` — 入口文件；等待 `pywebviewready` 事件后再启动 React 应用。
- `App.tsx` — 使用 `HashRouter`，包含两条路由：`/`（首页/书架）和 `/book/:id`（书籍编辑页）。
- `bridge.ts` — 关键桥接层。桌面端通过 `window.pywebview.api` 调用 Python API；浏览器开发模式（无 pywebview）下回退到 `localStorage` 模拟数据。调用后端方法前务必使用 `getBridgeApi()`，以避免竞态条件。
- `pages/Home.tsx` — 书架页，含创建书籍表单。
- `pages/BookEditor.tsx` — 书籍工作台。当短篇且分类解析为世情或情感工作台（见 `workspaces/resolveWorkspace.ts`）时渲染完整三栏工作台；其余组合显示「开发中」占位状态。
- `components/WorkspaceAiChat.tsx` — 集成 Pi Web UI 的 AI 聊天面板。
- `pi/` — Pi AI 集成：`setupPiWorkspace.ts` 初始化基于 IndexedDB 的 Pi 会话/设置存储；`resolveWorkspaceChatModel.ts` 和 `writingAssistantPrompt.ts` 配置 AI 助手。

### 数据模型
- **阶段（工作台）随书籍类型与分类而定**，并非全局一套固定栏位。`book_type` 为 `short` 且 `categories` 含「世情」时使用世情工作台阶段键；短篇且含「现实情感」或「情感」（且不与世情工作台冲突时）使用情感工作台阶段键。两端约定见 `web/src/workspaces/*/stages.ts` 与 `app/models.py` 中的 `SHIQING_STAGE_KEYS` / `QINGGAN_STAGE_KEYS`。
- 持久化时 `stages` 为上述两套键的**并集**（缺省补空串），TypeScript 中 `StageId` 为 `ShiqingStageId | QingganStageId`，UI 只展示当前工作台对应的子集（`resolveWorkspaceStagesForBook`）。
- 通过 `save_book` 保存时，传入 `stages` 会合并阶段内容，并将顶层 `content` 同步为「正文编写」阶段：`primary_draft_stage_key` 在世情短篇为 `draft`，在情感短篇为 `qinggan_draft`；仅传入 `content` 则只更新顶层 `content` 字段。
- 书籍数据存储在 `.data/books.json` 中。工作空间根目录（上次选定的文件夹）存储在 `.data/preferences.json` 中。
- 如果书籍设有 `output_dir`，每次保存时各阶段内容还会以 `.txt` 文件形式写入该目录。

### 开发注意事项
- 前端构建配置 `base: './'`，以确保在 pywebview 内通过 `file://` 协议正确加载资源。
- `app/.env` 为可选文件且已被 gitignore；用于预填充 Pi 的 AI 模型凭证，让用户跳过初始设置。
- `.cursor/skills/` 目录包含 Impeccable 前端设计技能集（与运行时代码无关）。
