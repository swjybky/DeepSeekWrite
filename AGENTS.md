# Write Claw（DeepseekWrite）项目指南

本文件为 AI 编码代理提供在操作本仓库代码时的指引。读者应被假设为对项目一无所知。

---

## 项目概述

Write Claw（DeepseekWrite）是一款**本地桌面写作应用**，面向网文、短篇小说与**剧本**创作。采用**混合架构**：

- **后端**：Python 3.10+，基于 [pywebview](https://pywebview.flowrl.com/) 提供桌面壳窗口，通过 `js_api` 向前端暴露原生 API。
- **前端**：React 19 + TypeScript + Vite 构建的静态 SPA。
- **数据持久化**：全部保存在项目目录下 `.data/` 的 JSON 文件中（`books.json`、`materials.json`、`skills.json`、`preferences.json`），无远程服务器。
- **AI 集成**：内嵌 [Pi](https://github.com/badlogic/pi)（`@mariozechner/pi-ai` / `pi-web-ui` / `pi-agent-core`）框架，支持多阶段 AI 协作写作。

### 核心功能

1. **书架管理**：创建/删除短篇、长篇或**剧本**书籍，选择本机工作文件夹（`output_dir`），并可绑定**技能库**。
2. **短篇创作空间**：针对「世情」「追妻」「科幻」「悬疑」「其他」等分类，提供统一的 8 阶段三栏工作台（左阶段导航、中编辑区、右 AI 聊天面板）。
3. **剧本创作空间**：提供面向剧本格式的 4 阶段工作台；左侧「剧情」为父阶段，实际内容分散在 `plot_design` / `intro_design` / `plot_refine` 三个子槽位。
4. **素材库**：独立管理「人设素材」「导语素材」「梗素材」「剧情细化素材」「剧情设计素材」「正文片段」，支持**短篇 / 长篇 / 剧本**三种类型。
5. **技能库**：新增独立能力库，按阶段管理可复用技能条目；支持**短篇 / 长篇 / 剧本**，创建书籍时可绑定到工作台。
6. **提示词系统**：每个阶段对应一份系统提示词模板（`app/prompt_defaults/` 下的 `.txt` 文件），支持运行时覆盖。

---

## 环境要求

- **Python**：3.10+
- **Node.js**：18+（仅用于构建前端，运行桌面应用时不需要常驻 Node）
- **操作系统**：Windows、macOS、Linux
  - **Windows**：依赖 Microsoft Edge WebView2 Runtime（Evergreen）。若缺失，窗口会**白屏**。
  - **Linux**：默认使用 **Qt（PySide6）** 作为 pywebview 后端。若需 GTK + WebKitGTK，需额外安装系统库并设置 `PYWEBVIEW_GUI=gtk`。
  - **Linux 中文输入法**：Qt WebEngine 需要 `QT_IM_MODULE`。程序会尝试自动推断，终端启动时若无法输入中文，可手动 `export QT_IM_MODULE=fcitx`（或 `ibus`）后再启动。

---

## 常用命令

### 构建前端（运行桌面应用前**必须**执行）

```bash
cd web
npm install
npm run build
```

构建产物输出到 `web/dist/`。`app/main.py` 会在启动时检查该目录，缺失则直接退出。

### 运行桌面应用

在项目根目录（`write-claw/`）执行：

```bash
pip install -r requirements.txt
python -m app.main
```

### 浏览器中独立开发前端

```bash
cd web
npm run dev
```

浏览器中没有 `pywebview` 时，前端会自动回退到 `localStorage` 模拟数据，便于单独调试界面。

### 代码检查

```bash
cd web
npm run lint
```

前端使用 ESLint 10 + `typescript-eslint` + `eslint-plugin-react-hooks` + `eslint-plugin-react-refresh`。配置位于 `web/eslint.config.js`。

### 打包 Windows 便携版

```bash
# 1. 确保前端已构建
cd web && npm install && npm run build && cd ..

# 2. 安装 PyInstaller
pip install pyinstaller

# 3. 执行打包
pyinstaller packaging/WriteClaw.spec
```

产出 `dist/WriteClaw/` 文件夹，压缩后分发。用户需安装 WebView2 Runtime。

---

## 项目结构

```
write-claw/
├── app/                          # Python 后端
│   ├── main.py                   # pywebview 窗口、Api 类、本地 HTTP 服务
│   ├── storage.py                # BookStore：原子化 JSON 读写 + 磁盘阶段文件导出
│   ├── models.py                 # Book / Material / Skill 数据类、阶段键定义、数据迁移
│   ├── ai_env.py                 # 读取 .env / .deepseek.env / .kimi.env 的 AI 默认配置
│   ├── prompt_store.py           # 提示词模板读取、覆盖、服务端占位符渲染
│   ├── runtime_paths.py          # bundle_root() / writable_root()：区分源码与 PyInstaller 冻结环境
│   ├── prompt_defaults/          # 默认提示词模板（.txt）
│   │   ├── short/shared/         # 短篇创作空间共享提示词（8 阶段 + 2 个专家智能体）
│   │   ├── script/shared/        # 剧本创作空间共享提示词（8 阶段 + 2 个专家智能体）
│   │   ├── material/             # 素材库提示词
│   │   │   ├── long/             # 长篇素材默认阶段提示词
│   │   │   ├── short/shared/     # 短篇素材管理智能体提示词
│   │   │   ├── script/shared/    # 剧本素材管理智能体提示词
│   │   │   └── shared/           # 素材库通用管理提示词
│   │   └── skill/                # 技能库提示词
│   │       ├── default_skill_template.json  # 默认技能模板（如追妻情绪文）
│   │       ├── long/shared/
│   │       ├── short/shared/
│   │       ├── script/shared/
│   │       └── shared/
│   └── assets/                   # 应用图标（.ico / .png）
├── web/                          # 前端（Vite + React + TypeScript）
│   ├── src/
│   │   ├── main.tsx              # React 入口；处理 pywebviewready 延迟挂载
│   │   ├── App.tsx               # HashRouter：首页、创作空间设置、书籍编辑、素材编辑、技能编辑
│   │   ├── bridge.ts             # **核心桥接层**：封装 pywebview API / localStorage Mock / 工作目录同步
│   │   ├── pages/
│   │   │   ├── Home.tsx          # 书架首页 + 素材库 + 技能库（卡片布局）
│   │   │   ├── BookEditor.tsx    # 书籍三栏工作台（左导航、中编辑、右 AI）
│   │   │   ├── WorkspaceSettings.tsx # 全局创作空间智能体设置（short / script）
│   │   │   ├── MaterialEditor.tsx # 素材编辑器
│   │   │   ├── MaterialSettings.tsx # 素材库提示词设置
│   │   │   ├── SkillEditor.tsx   # 技能编辑器
│   │   │   └── SkillSettings.tsx # 技能库提示词设置
│   │   ├── components/
│   │   │   ├── WorkspaceAiChat.tsx   # Pi Web UI 集成的 AI 聊天面板
│   │   │   ├── WorkspaceTreeNav.tsx  # 工作台左侧阶段树（含剧情子方向折叠）
│   │   │   ├── CardGrid.tsx          # 卡片列表组件
│   │   │   └── MaterialGenreSelector.tsx # 素材分类选择器
│   │   ├── pi/                         # Pi AI 集成
│   │   │   ├── setupPiWorkspace.ts         # IndexedDB 存储初始化
│   │   │   ├── resolveWorkspaceChatModel.ts # 模型与 API Key 解析
│   │   │   ├── workspaceStageAgents.ts      # 工作台 Agent 工具分发
│   │   │   ├── stageAssistantExtractStream.ts # 流式抽取助手内容
│   │   │   └── writingAssistantPrompt.ts    # 通用写作助手提示词片段
│   │   ├── workspaces/
│   │   │   ├── short/              # 短篇工作空间
│   │   │   │   ├── stages.ts
│   │   │   │   ├── stageReadAccess.ts
│   │   │   │   ├── stageAgents.ts
│   │   │   │   ├── expertDraft/    # 短篇专家分节写作
│   │   │   │   └── loadSkill.ts
│   │   │   ├── script/             # 剧本工作空间
│   │   │   │   ├── stages.ts
│   │   │   │   ├── stageReadAccess.ts
│   │   │   │   ├── stageAgents.ts
│   │   │   │   ├── expertDraft/    # 剧本专家分节写作
│   │   │   │   └── loadSkill.ts
│   │   │   ├── material/           # 素材库 Agent
│   │   │   │   ├── long/
│   │   │   │   ├── short/
│   │   │   │   └── script/
│   │   │   ├── skill/              # 技能库 Agent
│   │   │   │   ├── long/
│   │   │   │   ├── short/
│   │   │   │   ├── script/
│   │   │   │   └── skillStageAgents.ts
│   │   │   └── shared/
│   │   │       └── piToolkit.ts    # Pi 工具集共享逻辑
│   │   └── prompt/
│   │       ├── embeddedDefaults.ts # 浏览器开发模式下的嵌入式默认提示词
│   │       └── renderTemplate.ts   # 前端本地提示词模板渲染
│   ├── package.json
│   ├── vite.config.ts              # base: './'，支持 file:// 加载
│   └── tsconfig.json
├── packaging/
│   ├── WriteClaw.spec              # PyInstaller onedir 配置
│   └── pyi_entry.py                # PyInstaller 入口脚本
├── docs/
│   └── page-design-ai-writing.md   # 前端页面设计文档（中文）
└── requirements.txt                # Python 依赖
```

---

## 架构详解

### 后端（`app/`）

- **`main.py`**：
  - 启动一个**本机回环 HTTP 服务器**（`127.0.0.1:随机端口`）来提供 `web/dist`，避免 `file://` 协议下的 fetch 异常。
  - 自定义 `DistHTTPRequestHandler` 强制修正 `.js` 的 MIME 类型为 `application/javascript`（Windows 注册表问题会导致 MSHTML/Edge 拒绝执行 module script）。
  - `Api` 类通过 `js_api` 暴露给前端，方法包括：`list_books`、`create_book`、`get_book`、`save_book`、`delete_book`、`pick_folder`、`get_workspace_root`、`set_workspace_root`、`get_ai_defaults`，以及对应的**素材库 API**、**技能库 API**和**提示词管理 API**。
  - Windows 启动时检测 WebView2 Runtime 注册表，未安装则在控制台输出警告。
  - Linux 启动时自动配置 `PYWEBVIEW_GUI=qt`、中文输入法环境变量和 `GI_TYPELIB_PATH`。

- **`storage.py`**：
  - `BookStore` 管理内存中的书籍/素材/技能映射，所有写入均为**原子操作**（先写 `.tmp` 文件再 `os.replace`）。
  - 书籍保存时，若 `output_dir` 非空，会将各阶段内容以 `{stage_key}.txt` 形式写入磁盘目录。
  - 素材保存在 `.data/materials.json` 中，文件夹创建于工作目录下的 `素材库/` 子目录。
  - 技能保存在 `.data/skills.json` 中，首次创建时会从 `app/prompt_defaults/skill/default_skill_template.json` 播种默认技能条目。

- **`models.py`**：
  - `Book` dataclass：包含 `id`、`title`、`book_type`（`short` | `long` | `script`）、`categories`、`content`、`output_dir`、`linked_material_id`、`linked_skill_id`、`status`、`stages`、时间戳。
  - `Material` dataclass：包含 `id`、`title`、`material_type`（`long` | `short` | `script`）、`parent_genre`、`sub_genre`、`stages`、时间戳。
  - `Skill` dataclass：包含 `id`、`title`、`skill_type`（`long` | `short` | `script`）、`stages`（每个阶段下多条技能条目）、时间戳。
  - **统一短篇阶段键**（8 个）：`character_design`、`plot_design`、`intro_design`、`plot_refine`、`outline`、`draft`、`draft_review`、`format_conversion`。所有短篇分类共用同一套阶段、智能体与提示词。
  - **剧本工作台阶段**：UI 可见 4 个阶段（人物设计 / 剧情 / 大纲 / 正文编写）；「剧情」父阶段的内容分散在 `plot_design` / `intro_design` / `plot_refine` 三个子槽位。
  - **素材阶段键**（6 个）：`character`、`intro`、`gimmick`、`plot_refine`、`pacing`、`draft_excerpt`。
  - **技能阶段键**（5 个）：`character_design`、`plot_design`、`outline`、`draft`、`expert_section_writer`。
  - **数据迁移**：自动将旧版追妻阶段键（如 `qinggan_character`）迁移到统一键；技能库兼容旧阶段字符串和误拆单阶段数据。

- **`ai_env.py`**：
  - 按优先级读取 `.env`、`.deepseek.env`、`.kimi.env`（先 `writable_root()`，再模块目录，再 `app/` 目录）。
  - 支持配置：`model_name_main`（或旧键 `model_name`）、`model_name_flash`、`model_api_key`、`model_source`。
  - 返回 `provider`、`model_id`、`api_key`，可选 `model_id_flash`。

- **`prompt_store.py`**：
  - 创作空间共享提示词、素材库提示词、技能库提示词各有独立的读取/覆盖/渲染管线。
  - 创作空间读取优先级：`.data/prompt_overrides/{short,script}/shared/` > `app/prompt_defaults/{short,script}/shared/`。
  - 首次加载会将旧 `.data/prompt_overrides/short/qinggan/` 覆盖复制到共享目录；旧分类目录之后不再参与运行时选择。
  - 剧本提示词首次使用时，会从短篇当前生效提示词复制一份独立覆盖到 `.data/prompt_overrides/script/shared/`。
  - 创作空间支持占位符：`{{BOOK_TITLE}}`、`{{BOOK_GENRE}}`、`{{STAGE_BODY}}`、`{{OTHER_STAGES_EXCERPT}}`；专家总控额外支持 `{{EXPERT_DRAFT_CONTEXT}}`。
  - 素材库提示词支持占位符：`{{MATERIAL_TITLE}}`、`{{MATERIAL_TYPE}}`、`{{MATERIAL_GENRE}}`、`{{STAGE_BODY}}` 等。
  - 技能库提示词支持占位符：`{{SKILL_TITLE}}`、`{{SKILL_TYPE}}`、`{{STAGE_BODY}}` 等。

### 前端（`web/src/`）

- **`main.tsx`**：
  - 桌面壳（`file://` 或 `?pywebview=1`）下，等待 `pywebviewready` 事件或轮询 `window.pywebview.api` 就绪后才挂载 React。
  - 普通浏览器/Vite dev 模式下立即挂载。

- **`bridge.ts`**（**最关键的文件**）：
  - 统一封装所有后端调用。桌面端走 `window.pywebview.api`；浏览器端走 `localStorage` mock。
  - 处理 `pywebview` 注入时机的不确定性：单例等待 + 超时轮询，避免并发调用抢先返回 mock。
  - 工作文件夹持久化：桌面端以 Python 的 `preferences.json` 为准，浏览器端用 `localStorage`。
  - 提示词模板在浏览器开发模式下回退到 `embeddedDefaults.ts` 和 `localStorage` 覆盖。
  - `isWorkspaceBook()` 判断 `short` 和 `script` 拥有完整创作空间；`long` 暂未开放工作台。
  - 提供 `resolveWorkspaceStagesForBook()` 和 `normalizeStagesForWorkspaceBook()` 分别为短篇/剧本书籍返回正确的阶段集合与数据迁移。

- **`pages/BookEditor.tsx`**：
  - 三栏布局：左侧阶段导航、中间富文本编辑区、右侧可拖拽宽度的 AI 面板。
  - AI 面板基于 `ChatPanel`（Pi Web UI），集成了自定义 Agent 工具（如 `apply_to_stage_editor`）。
  - 短篇和剧本进入完整创作空间；长篇显示「开发中」占位状态。
  - 根据 `book_type` 分发短篇或剧本的专家起草编辑器与 AI 面板。

- **`pages/WorkspaceSettings.tsx`**：
  - 集中管理短篇与剧本创作空间 8 个普通阶段与 2 个专家智能体的共享系统提示词和读取范围。
  - 书籍分类仅作为 `{{BOOK_GENRE}}` 上下文传入模板，不影响提示词路径、工具集或会话标识。

- **`pi/` 目录**：
  - `setupPiWorkspace.ts`：初始化 IndexedDB 后端（`dbName: 'write_claw_pi'`），存储会话、API Key、设置。
  - `resolveWorkspaceChatModel.ts`：从 `app/.env` 或 Pi 的 `ProviderKeysStore` 解析模型与密钥；未配置时回退到 `openai/gpt-4o-mini`。
  - `workspaceStageAgents.ts`：根据 `book_type` 分发短篇/剧本/素材/技能工作台的 Agent 工具。

---

## 数据模型约定

### 书籍（Book）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | UUID |
| `title` | string | 书名 |
| `book_type` | `"short" \| "long" \| "script"` | 短篇 / 长篇 / 剧本 |
| `categories` | `string[]` | 分类（如 `["世情"]`、`["追妻"]`、`["科幻"]`、`["其他"]`） |
| `content` | string | 顶层正文（与 `stages.draft` 同步） |
| `output_dir` | string | 本机落地目录（空表示未指定） |
| `linked_material_id` | string | 关联素材库 ID |
| `linked_skill_id` | string | 绑定技能库 ID |
| `status` | `"editing" \| "completed"` | 书籍状态 |
| `stages` | `Record<StageId, string>` | 阶段内容 |
| `expert_draft` | `ExpertDraft` | 专家分节写作结构 |
| `created_at` / `updated_at` | string | ISO 8601 UTC（`%Y-%m-%dT%H:%M:%SZ`） |

### 短篇统一阶段（`SHORT_WORKSPACE_STAGES`）

阶段顺序固定为：

1. `character_design` — 人物设计
2. `plot_design` — 剧情设计
3. `intro_design` — 导语设计
4. `plot_refine` — 剧情细化
5. `outline` — 大纲纲要
6. `draft` — 正文编写
7. `draft_review` — 正文审阅
8. `format_conversion` — 格式转换

**注意**：所有短篇分类共用上述阶段定义和 `short/shared/` 提示词；分类仅作为 `{{BOOK_GENRE}}` 上下文传入。

### 剧本工作台阶段（`SCRIPT_WORKSPACE_STAGES`）

UI 可见阶段：

1. `character_design` — 人物设计
2. `plot_design` — 剧情（父阶段）
3. `outline` — 大纲
4. `draft` — 正文编写

存储/导出时，「剧情」父阶段拆分为三个子槽位：

- `plot_design` — 剧情设计
- `intro_design` — 导语设计
- `plot_refine` — 剧情细化

因此剧本书籍的完整阶段键与短篇一致（沿用 `SHORT_STAGE_KEYS`），前端通过 `normalizeStagesForWorkspaceBook()` 做数据归一化与迁移。

### 素材（Material）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | UUID |
| `title` | string | 素材标题 |
| `material_type` | `"short" \| "long" \| "script"` | 短篇 / 长篇 / 剧本素材 |
| `parent_genre` | string | 世情 / 追妻 / 科幻 / 悬疑 / 其他（short/script 时有效） |
| `sub_genre` | string | legacy 子分类；新建素材不再填写 |
| `stages` | `Record<MaterialStageId, string>` | 6 个阶段内容 |
| `output_dir` | string | 本机落地目录 |

素材阶段键：

- `character` — 人设素材
- `intro` — 导语素材
- `gimmick` — 梗素材
- `plot_refine` — 剧情细化素材
- `pacing` — 剧情设计素材
- `draft_excerpt` — 正文片段

### 技能（Skill）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | UUID |
| `title` | string | 技能集合标题 |
| `skill_type` | `"short" \| "long" \| "script"` | 短篇 / 长篇 / 剧本技能 |
| `stages` | `Record<SkillStageId, SkillStageEntry[]>` | 每个阶段下的技能条目列表 |
| `output_dir` | string | 本机落地目录 |

技能阶段键：

- `character_design` — 人物设计技能
- `plot_design` — 剧情技能（旧 `intro_design` / `plot_refine` 会合并至此）
- `outline` — 大纲技能
- `draft` — 正文专家编写技能（旧 `draft_review` / `format_conversion` / `expert_draft_coordinator` 会合并至此）
- `expert_section_writer` — 分节写手技能

每个技能条目包含 `id`、`title`、`body`、`created_at`、`updated_at`。

---

## 代码风格与开发约定

### Python

- 所有 `.py` 文件开头使用 `from __future__ import annotations`。
- 使用类型注解（PEP 484），函数返回类型明确标注。
- 字符串格式化优先使用 f-string。
- 文件路径操作统一使用 `pathlib.Path`。
- JSON 数据写入必须走原子操作（`tempfile.mkstemp` + `os.replace`），参考 `storage.py` 中的实现。
- 环境变量和平台判断放在函数内部或模块级初始化时处理，避免运行时重复计算。

### TypeScript / React

- 使用函数组件 + Hooks（`useState`、`useEffect`、`useCallback`、`useRef`、`useMemo`）。
- 类型定义文件内聚在 `bridge.ts` 或同级 `.ts` 中，避免散落。
- 桥接层调用后端方法前**必须使用 `getBridgeApi()`**，避免竞态条件。
- 全局 `window.pywebview` 类型声明在 `bridge.ts` 中。
- CSS 按页面/组件分文件（`Home.css`、`BookEditor.css`、`CardGrid.css` 等）。
- `vite.config.ts` 中 `base: './'` 不可随意更改，否则 pywebview 的 `file://` 加载会失败。

---

## 测试策略

**本代码库目前没有自动化测试**（无单元测试、无集成测试、无 E2E 测试）。

验证改动的推荐方式：

1. **前端界面**：`cd web && npm run dev`，在浏览器中操作书架/工作台/素材库/技能库全流程。
2. **桌面端到端**：`npm run build` 后执行 `python -m app.main`，测试 pywebview 桥接、文件夹选择、保存/导出 `.txt`、AI 面板、剧本阶段导航、技能绑定。
3. **数据迁移验证**：若修改 `models.py` 中的阶段键或迁移逻辑，需用包含旧版追妻键（`qinggan_*`）的 `books.json` 测试加载是否正确迁移。

---

## 安全与隐私注意事项

- **AI API Key**：存储在 Pi 的 IndexedDB（前端）或从 `app/.env` 读取（后端注入）。**不要将含密钥的 `.env` 文件提交到 git 或打入公开分发包**。
- `app/.env`、`.deepseek.env`、`.kimi.env` 已被 `.gitignore` 排除。
- PyInstaller 冻结版会优先读取 `exe` 同级目录的 env 文件，而不是包内 `_internal`，以便用户自行放置密钥而不影响重新分发。
- 所有用户数据（书籍、素材、技能、偏好、提示词覆盖）保存在本地 `.data/` 目录，不上传云端。
- `pick_folder()` 仅返回用户主动选择的文件夹路径，无后台遍历行为。

---

## 常见问题排查

| 现象 | 排查方向 |
|------|----------|
| 窗口白屏（Windows） | 检查是否安装 WebView2 Runtime；检查 `web/dist/` 是否已构建；设置 `WRITECLAW_DEBUG=1` 后启动打开 DevTools 查看控制台。 |
| 前端未构建报错 | 执行 `cd web && npm install && npm run build`。 |
| Linux 无法输入中文 | 检查 `QT_IM_MODULE`；尝试 `export QT_IM_MODULE=fcitx` 后启动；确保安装了 `fcitx5-frontend-qt6`。 |
| 提示词修改未生效 | 检查 `.data/prompt_overrides/` 下是否有同名覆盖文件；覆盖优先级高于内置默认。 |
| 素材/书籍保存后 `.txt` 未写出 | 检查书籍/素材是否设置了 `output_dir`（工作文件夹）；检查目录写入权限。 |
| 剧本「剧情」阶段内容不显示 | 确认数据保存在 `plot_design` / `intro_design` / `plot_refine` 三个子槽位，前端通过 `WorkspaceTreeNav` 聚合展示。 |
| 技能库创建后没有默认条目 | 检查 `app/prompt_defaults/skill/default_skill_template.json` 是否存在且可被读取。 |

---
