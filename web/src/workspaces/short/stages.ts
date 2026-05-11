/**
 * 统一的短篇工作台阶段定义
 * 世情和情感共用同一套阶段，仅在提示词层面区分
 */
export const SHORT_WORKSPACE_STAGES = [
  { id: 'character_design', label: '人物设计' },
  { id: 'intro_design', label: '导语设计' },
  { id: 'plot_design', label: '剧情设计' },
  { id: 'plot_refine', label: '剧情细化' },
  { id: 'outline', label: '大纲纲要' },
  { id: 'draft', label: '正文编写' },
  { id: 'draft_review', label: '正文审阅' },
  { id: 'format_conversion', label: '格式转换' },
] as const

export type ShortStageId = (typeof SHORT_WORKSPACE_STAGES)[number]['id']

export const SHORT_STAGE_LABELS: Record<ShortStageId, string> =
  SHORT_WORKSPACE_STAGES.reduce(
    (acc, s) => {
      acc[s.id] = s.label
      return acc
    },
    {} as Record<ShortStageId, string>,
  )

export function normalizeShortStages(
  raw?: Partial<Record<ShortStageId, string>> | null,
): Record<ShortStageId, string> {
  const out = {} as Record<ShortStageId, string>
  for (const s of SHORT_WORKSPACE_STAGES) {
    out[s.id] = raw?.[s.id] ?? ''
  }
  return out
}

/**
 * 旧版情感阶段键到统一阶段键的映射
 * 用于数据迁移
 */
export const LEGACY_QINGGAN_STAGE_MAPPING: Record<string, ShortStageId> = {
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
): Partial<Record<ShortStageId, string>> {
  if (!raw) return {}
  const result: Partial<Record<ShortStageId, string>> = {}

  for (const [key, value] of Object.entries(raw)) {
    // 如果已经是新键，直接保留
    if (SHORT_WORKSPACE_STAGES.some(s => s.id === key)) {
      result[key as ShortStageId] = value
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
