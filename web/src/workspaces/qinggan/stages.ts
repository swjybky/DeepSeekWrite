export const QINGGAN_WORKSPACE_STAGES = [
  { id: 'qinggan_character', label: '人物设计' },
  { id: 'qinggan_intro', label: '导语设计' },
  { id: 'qinggan_plot_refine', label: '剧情细化' },
  { id: 'qinggan_outline', label: '大纲纲要' },
  { id: 'qinggan_outline_review', label: '大纲审阅' },
  { id: 'qinggan_draft', label: '正文编写' },
  { id: 'qinggan_draft_review', label: '正文审阅' },
] as const

export type QingganStageId = (typeof QINGGAN_WORKSPACE_STAGES)[number]['id']

export const QINGGAN_STAGE_LABELS: Record<QingganStageId, string> =
  QINGGAN_WORKSPACE_STAGES.reduce(
    (acc, s) => {
      acc[s.id] = s.label
      return acc
    },
    {} as Record<QingganStageId, string>,
  )

export function normalizeQingganStages(
  raw?: Partial<Record<QingganStageId, string>> | null,
): Record<QingganStageId, string> {
  const out = {} as Record<QingganStageId, string>
  for (const s of QINGGAN_WORKSPACE_STAGES) {
    out[s.id] = raw?.[s.id] ?? ''
  }
  return out
}
