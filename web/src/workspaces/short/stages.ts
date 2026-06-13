export const PLOT_STAGE_ID = 'plot_design' as const

export const PLOT_CHILD_STAGES = [
  { id: 'plot_design', label: '剧情设计' },
  { id: 'intro_design', label: '导语设计' },
  { id: 'plot_refine', label: '剧情细化' },
] as const

export type PlotChildStageId = (typeof PLOT_CHILD_STAGES)[number]['id']

/**
 * 统一的短篇工作台可见阶段定义。
 * 「剧情」在 UI 上是父阶段，内容仍拆分保存在 PLOT_CHILD_STAGES 三个槽位。
 */
export const SHORT_WORKSPACE_STAGES = [
  { id: 'character_design', label: '人物设计' },
  { id: 'plot_design', label: '剧情' },
  { id: 'outline', label: '大纲' },
  { id: 'draft', label: '正文编写' },
] as const

/**
 * 存储/读取/导出的完整内容槽位。
 * 不直接等同左侧可见阶段，因为「剧情」父阶段包含三个子文本。
 */
export const SHORT_WORKSPACE_CONTENT_STAGES = [
  { id: 'character_design', label: '人物设计' },
  ...PLOT_CHILD_STAGES,
  { id: 'outline', label: '大纲' },
  { id: 'draft', label: '正文编写' },
] as const

export type ShortStageId = (typeof SHORT_WORKSPACE_CONTENT_STAGES)[number]['id']

export const LEGACY_SHORT_WORKSPACE_STAGES = [
  { id: 'draft_review', label: '正文审阅' },
  { id: 'format_conversion', label: '格式转换' },
] as const

export type LegacyShortStageId =
  (typeof LEGACY_SHORT_WORKSPACE_STAGES)[number]['id']

export type StoredShortStageId = ShortStageId | LegacyShortStageId

export const SHORT_STAGE_LABELS: Record<StoredShortStageId, string> =
  [...SHORT_WORKSPACE_CONTENT_STAGES, ...LEGACY_SHORT_WORKSPACE_STAGES].reduce(
    (acc, s) => {
      acc[s.id] = s.label
      return acc
    },
    {} as Record<StoredShortStageId, string>,
  )

export function normalizeShortStages(
  raw?: Partial<Record<StoredShortStageId, string>> | null,
): Record<ShortStageId, string> {
  const out = {} as Record<ShortStageId, string>
  for (const s of SHORT_WORKSPACE_CONTENT_STAGES) {
    out[s.id] = raw?.[s.id] ?? ''
  }
  return out
}

/**
 * 旧版情感阶段键到统一阶段键的映射
 * 用于数据迁移
 */
export const LEGACY_QINGGAN_STAGE_MAPPING: Record<string, StoredShortStageId> = {
  'qinggan_character': 'character_design',
  'qinggan_intro': 'intro_design',
  'qinggan_plot_refine': 'plot_refine',
  'qinggan_outline': 'outline',
  'qinggan_draft': 'draft',
  'qinggan_draft_review': 'draft_review',
}

/**
 * 迁移旧版阶段数据到统一阶段键
 */
export function migrateLegacyStages(
  raw?: Partial<Record<string, string>> | null,
): Partial<Record<StoredShortStageId, string>> {
  if (!raw) return {}
  const result: Partial<Record<StoredShortStageId, string>> = {}
  const validIds = new Set(
    [...SHORT_WORKSPACE_CONTENT_STAGES, ...LEGACY_SHORT_WORKSPACE_STAGES].map(
      (s) => s.id,
    ),
  )

  for (const [key, value] of Object.entries(raw)) {
    // 如果已经是新键，直接保留
    if (validIds.has(key as StoredShortStageId)) {
      result[key as StoredShortStageId] = value
    }
    // 如果是旧版情感键，映射到新键
    else if (key in LEGACY_QINGGAN_STAGE_MAPPING) {
      const newKey = LEGACY_QINGGAN_STAGE_MAPPING[key]
      // 只有新键不存在时才迁移，避免覆盖
      if (!(newKey in result)) {
        result[newKey] = value
      }
    }
    // 保留其他键（如世情旧键，它们大部分与新键一致）
    else {
      result[key as ShortStageId] = value
    }
  }

  return result
}
