export const SHIQING_WORKSPACE_STAGES = [
  { id: 'intro_design', label: '导语设计' },
  { id: 'character_design', label: '人设设计' },
  { id: 'plot_design', label: '剧情设计' },
  { id: 'plot_refine', label: '剧情细化' },
  { id: 'outline', label: '大纲纲要' },
  { id: 'draft', label: '正文编写' },
  { id: 'review', label: '编辑审阅' },
] as const

export type ShiqingStageId = (typeof SHIQING_WORKSPACE_STAGES)[number]['id']

export const SHIQING_STAGE_LABELS: Record<ShiqingStageId, string> =
  SHIQING_WORKSPACE_STAGES.reduce(
    (acc, s) => {
      acc[s.id] = s.label
      return acc
    },
    {} as Record<ShiqingStageId, string>,
  )

export function normalizeShiqingStages(
  raw?: Partial<Record<ShiqingStageId, string>> | null,
): Record<ShiqingStageId, string> {
  const out = {} as Record<ShiqingStageId, string>
  for (const s of SHIQING_WORKSPACE_STAGES) {
    out[s.id] = raw?.[s.id] ?? ''
  }
  return out
}
