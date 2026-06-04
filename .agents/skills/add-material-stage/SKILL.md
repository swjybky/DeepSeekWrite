---
name: add-material-stage
description: >
  在 Write Claw（DeepseekWrite）项目的素材库中新增一个阶段。当用户需要为素材库
  （人设/导语/梗/节奏等之外）增加新的素材阶段时使用。涉及后端 Python 模型定义、
  提示词管线、默认模板文件，以及前端 TypeScript 类型、标签、编辑器导航和 AI 工具
  的联动修改。
---

# 素材库新增阶段

## 核心流程

新增素材阶段需要**后端 + 前端**联动修改，共涉及 **8 个修改点**。按以下顺序执行：

1. **定义阶段键**：在后端 `app/models.py` 的 `MATERIAL_STAGE_KEYS` 和前端的 `web/src/bridge.ts` 的 `MaterialStageId` 类型中同时追加新键。
2. **注册标签映射**：在后端 `app/prompt_store.py` 的 `MATERIAL_STAGE_LABELS` 和前端的 `web/src/bridge.ts` 的 `MATERIAL_STAGE_LABELS` 中同步追加中文标签。
3. **注册顺序**：在后端 `app/prompt_store.py` 的 `MATERIAL_STAGES_ORDER` 中追加新键，决定左侧导航的显示顺序。
4. **补齐前端归一化**：在 `web/src/bridge.ts` 的 `normalizeMaterialStages` 函数中为新键提供默认空字符串。
5. **更新编辑器导航**：在 `web/src/pages/MaterialEditor.tsx` 的 `MATERIAL_STAGE_KEYS` 数组中追加新键。
6. **更新 AI 读取工具**：在 `web/src/workspaces/material/materialStageAgents.ts` 的 `buildReadMaterialContentTool` 的 `Type.Union` 中追加新 `Type.Literal`，并更新 description 中的阶段说明。
7. **创建默认提示词模板**：在 `app/prompt_defaults/material/` 下的三个子目录（`long`、`short_shiqing`、`short_qinggan`）中各新增同名 `.txt` 文件。
8. **构建并验证**：执行 `npm run build` 后启动桌面端，确认新阶段出现在素材编辑器左侧导航，且提示词模板和 AI 工具正常。

## 详细修改点

每个文件的具体位置、代码片段和注意事项见 [references/files.md](references/files.md)。

## 重要约定

- **键名保持一致**：后端 `MATERIAL_STAGE_KEYS`、前端 `MaterialStageId`、以及所有提示词目录下的文件名必须使用**完全相同的英文字段名**（如 `theme`）。
- **前后端标签同步**：`MATERIAL_STAGE_LABELS` 在后端（`app/prompt_store.py`）和前端（`web/src/bridge.ts`）各有一份，必须同步更新。
- **提示词模板不可缺失**：若 `app/prompt_defaults/material/{subdir}/{stage_key}.txt` 缺失，前端会显示「缺少默认提示模板文件」的占位文本。
- **无需修改 `embeddedDefaults.ts`**：Vite 的 `import.meta.glob` 会在构建时自动将新增的 `.txt` 模板打包进前端降级缓存。
- **无需修改 `app/main.py`**：素材 API 通过字符串传参，后端无硬编码阶段列表。
