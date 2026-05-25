# 素材库新增阶段 —— 各文件修改点

新增一个素材阶段（例如 `theme`）需要在以下 8 处进行修改。

## 后端（Python）

### 1. `app/models.py`

在 `MATERIAL_STAGE_KEYS` 元组末尾追加新阶段键：

```python
MATERIAL_STAGE_KEYS: tuple[str, ...] = (
    "character",
    "intro",
    "gimmick",
    "pacing",
    "theme",  # 新增
)
```

同时更新上方注释（如 `# 素材阶段键（人设、导语、梗、节奏、主题）`）。

### 2. `app/prompt_store.py`

两处修改：

**a)** 在 `MATERIAL_STAGES_ORDER` 追加新键：

```python
MATERIAL_STAGES_ORDER: tuple[str, ...] = (
    "character",
    "intro",
    "gimmick",
    "pacing",
    "theme",  # 新增
)
```

**b)** 在 `MATERIAL_STAGE_LABELS` 追加标签映射：

```python
MATERIAL_STAGE_LABELS: dict[str, str] = {
    "character": "人设素材",
    "intro": "导语素材",
    "gimmick": "梗素材",
    "pacing": "节奏素材",
    "theme": "主题素材",  # 新增
}
```

### 3–5. 默认提示词模板文件

在三个素材分类目录下各新增同名 `.txt` 文件：

```
app/prompt_defaults/material/long/{stage_key}.txt
app/prompt_defaults/material/short_shiqing/{stage_key}.txt
app/prompt_defaults/material/short_qinggan/{stage_key}.txt
```

文件内容至少包含占位符说明，例如：

```text
你正在协助作者整理「主题素材」。

素材：{{BOOK_TITLE}}

当前阶段已保存内容：
{{STAGE_BODY}}

其它阶段摘要：
{{OTHER_STAGES_EXCERPT}}

请根据作者需求生成或完善主题素材内容。
```

## 前端（TypeScript）

### 6. `web/src/bridge.ts`

三处修改：

**a)** `MaterialStageId` 类型追加字面量：

```typescript
export type MaterialStageId = 'character' | 'intro' | 'gimmick' | 'pacing' | 'theme'
```

**b)** `MATERIAL_STAGE_LABELS` 追加映射：

```typescript
export const MATERIAL_STAGE_LABELS: Record<MaterialStageId, string> = {
  character: '人设素材',
  intro: '导语素材',
  gimmick: '梗素材',
  pacing: '节奏素材',
  theme: '主题素材',
}
```

**c)** `normalizeMaterialStages` 函数返回值补齐新键：

```typescript
const out: Record<MaterialStageId, string> = {
  character: '',
  intro: '',
  gimmick: '',
  pacing: '',
  theme: '',  // 新增
}
```

### 7. `web/src/pages/MaterialEditor.tsx`

在组件顶部 `MATERIAL_STAGE_KEYS` 数组末尾追加：

```typescript
const MATERIAL_STAGE_KEYS: MaterialStageId[] = ['character', 'intro', 'gimmick', 'pacing', 'theme']
```

### 8. `web/src/workspaces/material/materialStageAgents.ts`

在 `buildReadMaterialContentTool` 的 `Type.Union` 中追加新 `Type.Literal`：

```typescript
stage_id: Type.Union(
  [
    Type.Literal('character'),
    Type.Literal('intro'),
    Type.Literal('gimmick'),
    Type.Literal('pacing'),
    Type.Literal('theme'),  // 新增
  ],
  {
    description:
      '素材阶段键名：character=人设素材，intro=导语素材，gimmick=梗素材，pacing=节奏素材，theme=主题素材；单次只读取该阶段',
  },
),
```

## 无需手动修改的文件

- `web/src/prompt/embeddedDefaults.ts`：通过 `import.meta.glob('../../../app/prompt_defaults/material/*/*.txt')` 在构建时自动发现新增 `.txt` 模板，无需手动注册。
- `app/main.py`：素材 API（`save_material`、`render_material_system_prompt` 等）均通过 `stage_id` 字符串传参，后端无硬编码阶段列表，无需修改。

## 验证清单

修改完成后，按以下顺序验证：

1. 后端类型检查：`python -m py_compile app/models.py app/prompt_store.py`
2. 前端构建：`cd web && npm run build`（`embeddedDefaults.ts` 的 glob 会包含新模板）
3. 启动桌面端：`python -m app.main`，进入素材库编辑器确认左侧导航出现新阶段
4. 切换新阶段，点击「编辑提示词」确认能加载默认模板
5. 在 AI 面板中测试 `read_material_content` 工具，确认新阶段可被读取
