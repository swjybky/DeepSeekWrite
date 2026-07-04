export type LongRootStageId =
  | 'worldbuilding'
  | 'character_design'
  | 'plot_design'
  | 'draft'
  | 'continuity_ledger'

export type LongStageId = string

export type LongStageDefinition = {
  id: LongStageId
  label: string
  rootId: LongRootStageId
}

export type LongDraftStageParts = {
  volumeNumber: number
  arcNumber: number
  chapterNumber: number
}

export type LongDraftChapterNode = {
  id: LongStageId
  label: string
  chapterNumber: number
}

export type LongDraftArcNode = {
  id: string
  label: string
  volumeNumber: number
  arcNumber: number
  chapters: LongDraftChapterNode[]
}

export type LongDraftVolumeNode = {
  id: string
  label: string
  volumeNumber: number
  arcs: LongDraftArcNode[]
}

export const LONG_WORKSPACE_STAGES = [
  { id: 'worldbuilding', label: '世界观' },
  { id: 'character_design', label: '人物' },
  { id: 'plot_design', label: '剧情' },
  { id: 'draft', label: '正文' },
  { id: 'continuity_ledger', label: '状态账本' },
] as const satisfies readonly { id: LongRootStageId; label: string }[]

export const LONG_ROOT_STAGE_IDS = LONG_WORKSPACE_STAGES.map(
  (stage) => stage.id,
) as readonly LongRootStageId[]

export const LONG_WORLDBUILDING_STAGES = [
  { id: 'worldbuilding.rules', label: '规则', rootId: 'worldbuilding' },
  { id: 'worldbuilding.factions', label: '势力', rootId: 'worldbuilding' },
  { id: 'worldbuilding.geography', label: '地理', rootId: 'worldbuilding' },
  { id: 'worldbuilding.history', label: '历史', rootId: 'worldbuilding' },
  { id: 'worldbuilding.terminology', label: '术语', rootId: 'worldbuilding' },
  { id: 'worldbuilding.items', label: '物品', rootId: 'worldbuilding' },
] as const satisfies readonly LongStageDefinition[]

export const LONG_CHARACTER_STAGES = [
  { id: 'character_design.protagonists', label: '主角', rootId: 'character_design' },
  { id: 'character_design.major_supporting', label: '主要配角', rootId: 'character_design' },
  { id: 'character_design.minor_supporting', label: '次要配角', rootId: 'character_design' },
  { id: 'character_design.passersby', label: '路人', rootId: 'character_design' },
] as const satisfies readonly LongStageDefinition[]

export const LONG_PLOT_STAGES = [
  { id: 'plot_design.book_line', label: '全书线', rootId: 'plot_design' },
  { id: 'plot_design.volumes', label: '分卷', rootId: 'plot_design' },
  { id: 'plot_design.story_arcs', label: '剧情弧', rootId: 'plot_design' },
  { id: 'plot_design.chapter_cards', label: '章卡', rootId: 'plot_design' },
  { id: 'plot_design.foreshadowing', label: '伏笔', rootId: 'plot_design' },
] as const satisfies readonly LongStageDefinition[]

export const LONG_DEFAULT_DRAFT_STAGES = [
  { id: 'draft.volume-1.arc-1.chapter-1', label: '第一章', rootId: 'draft' },
  { id: 'draft.volume-2.arc-1.chapter-1', label: '第一章', rootId: 'draft' },
] as const satisfies readonly LongStageDefinition[]

export const LONG_CONTINUITY_STAGES = [
  { id: 'continuity_ledger.timeline', label: '时间线', rootId: 'continuity_ledger' },
  { id: 'continuity_ledger.character_states', label: '人物状态', rootId: 'continuity_ledger' },
  { id: 'continuity_ledger.open_foreshadowing', label: '未回收伏笔', rootId: 'continuity_ledger' },
  { id: 'continuity_ledger.continuity_notes', label: '连续性记录', rootId: 'continuity_ledger' },
] as const satisfies readonly LongStageDefinition[]

export const LONG_WORKSPACE_CONTENT_STAGES = [
  ...LONG_WORLDBUILDING_STAGES,
  ...LONG_CHARACTER_STAGES,
  ...LONG_PLOT_STAGES,
  ...LONG_DEFAULT_DRAFT_STAGES,
  ...LONG_CONTINUITY_STAGES,
] as const satisfies readonly LongStageDefinition[]

export const LONG_INITIAL_STAGE_ID = 'worldbuilding.rules'

export const LONG_STAGE_LABELS: Record<string, string> =
  LONG_WORKSPACE_CONTENT_STAGES.reduce<Record<string, string>>((acc, stage) => {
    acc[stage.id] = stage.label
    return acc
  }, {})

const LONG_DEFAULT_CONTENT_STAGE_IDS: readonly string[] = LONG_WORKSPACE_CONTENT_STAGES.map(
  (stage) => stage.id,
)
const LONG_DEFAULT_CONTENT_STAGE_ID_SET = new Set<string>(
  LONG_DEFAULT_CONTENT_STAGE_IDS,
)
const LONG_ROOT_STAGE_ID_SET = new Set<string>(LONG_ROOT_STAGE_IDS)
const LONG_DRAFT_STAGE_RE = /^draft\.volume-(\d+)\.arc-(\d+)\.chapter-(\d+)$/

export function isLongRootStageId(id: string): id is LongRootStageId {
  return LONG_ROOT_STAGE_ID_SET.has(id)
}

export function parseLongDraftStageId(
  id: string,
): LongDraftStageParts | null {
  const match = LONG_DRAFT_STAGE_RE.exec(id)
  if (!match) return null
  return {
    volumeNumber: Number(match[1]),
    arcNumber: Number(match[2]),
    chapterNumber: Number(match[3]),
  }
}

export function buildLongDraftStageId(
  volumeNumber: number,
  arcNumber: number,
  chapterNumber: number,
): LongStageId {
  return `draft.volume-${Math.max(1, volumeNumber)}.arc-${Math.max(
    1,
    arcNumber,
  )}.chapter-${Math.max(1, chapterNumber)}`
}

export function isLongStageId(id: string): id is LongStageId {
  if (LONG_DEFAULT_CONTENT_STAGE_ID_SET.has(id)) return true
  if (parseLongDraftStageId(id)) return true
  return false
}

export function longRootStageIdForStage(stageId: string): LongRootStageId {
  if (stageId.startsWith('worldbuilding.')) return 'worldbuilding'
  if (stageId.startsWith('character_design.')) return 'character_design'
  if (stageId.startsWith('plot_design.')) return 'plot_design'
  if (stageId.startsWith('continuity_ledger.')) return 'continuity_ledger'
  if (stageId.startsWith('draft.')) return 'draft'
  return isLongRootStageId(stageId) ? stageId : 'draft'
}

export function defaultLongStageForRoot(rootId: LongRootStageId): LongStageId {
  if (rootId === 'worldbuilding') return LONG_WORLDBUILDING_STAGES[0]!.id
  if (rootId === 'character_design') return LONG_CHARACTER_STAGES[0]!.id
  if (rootId === 'plot_design') return LONG_PLOT_STAGES[0]!.id
  if (rootId === 'continuity_ledger') return LONG_CONTINUITY_STAGES[0]!.id
  return LONG_DEFAULT_DRAFT_STAGES[0]!.id
}

export function coerceLongStageId(stageId: string | null | undefined): LongStageId {
  const value = String(stageId ?? '').trim()
  if (isLongStageId(value)) return value
  if (isLongRootStageId(value)) return defaultLongStageForRoot(value)
  return LONG_INITIAL_STAGE_ID
}

function chineseNumber(n: number): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  if (n <= 0 || !Number.isFinite(n)) return String(n)
  if (n < 10) return digits[n]!
  if (n === 10) return '十'
  if (n < 20) return `十${digits[n % 10]}`
  if (n < 100) {
    const ones = n % 10
    return `${digits[Math.floor(n / 10)]}十${ones === 0 ? '' : digits[ones]}`
  }
  return String(n)
}

export function longDraftVolumeLabel(volumeNumber: number): string {
  return `第${chineseNumber(volumeNumber)}卷`
}

export function longDraftArcLabel(arcNumber: number): string {
  return `剧情弧线${chineseNumber(arcNumber)}`
}

export function longDraftChapterLabel(chapterNumber: number): string {
  return `第${chineseNumber(chapterNumber)}章`
}

export function longStageLabel(stageId: string): string {
  const direct = LONG_STAGE_LABELS[stageId]
  if (direct) return direct
  const draft = parseLongDraftStageId(stageId)
  if (draft) return longDraftChapterLabel(draft.chapterNumber)
  const root = LONG_WORKSPACE_STAGES.find((stage) => stage.id === stageId)
  return root?.label ?? stageId
}

function stageSortKey(stageId: string): string {
  const staticIndex = LONG_DEFAULT_CONTENT_STAGE_IDS.indexOf(stageId)
  if (staticIndex >= 0) return `0:${String(staticIndex).padStart(4, '0')}`
  const draft = parseLongDraftStageId(stageId)
  if (draft) {
    return [
      '1',
      String(draft.volumeNumber).padStart(5, '0'),
      String(draft.arcNumber).padStart(5, '0'),
      String(draft.chapterNumber).padStart(5, '0'),
    ].join(':')
  }
  const rootIndex = LONG_ROOT_STAGE_IDS.indexOf(longRootStageIdForStage(stageId))
  return `2:${String(rootIndex).padStart(2, '0')}:${stageId}`
}

export function longContentStageRowsFromStages(
  stages?: Partial<Record<string, string>> | null,
): LongStageDefinition[] {
  const ids = new Set<string>(LONG_DEFAULT_CONTENT_STAGE_IDS)
  for (const key of Object.keys(stages ?? {})) {
    if (isLongStageId(key)) ids.add(key)
  }
  return [...ids]
    .sort((a, b) => stageSortKey(a).localeCompare(stageSortKey(b)))
    .map((id) => ({
      id,
      label: longStageLabel(id),
      rootId: longRootStageIdForStage(id),
    }))
}

export function collectLongDraftTree(
  stages?: Partial<Record<string, string>> | null,
): LongDraftVolumeNode[] {
  const volumeMap = new Map<number, Map<number, LongDraftChapterNode[]>>()
  for (const row of longContentStageRowsFromStages(stages)) {
    const parts = parseLongDraftStageId(row.id)
    if (!parts) continue
    if (!volumeMap.has(parts.volumeNumber)) {
      volumeMap.set(parts.volumeNumber, new Map())
    }
    const arcMap = volumeMap.get(parts.volumeNumber)!
    if (!arcMap.has(parts.arcNumber)) arcMap.set(parts.arcNumber, [])
    arcMap.get(parts.arcNumber)!.push({
      id: row.id,
      label: longDraftChapterLabel(parts.chapterNumber),
      chapterNumber: parts.chapterNumber,
    })
  }

  return [...volumeMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([volumeNumber, arcMap]) => ({
      id: `draft.volume-${volumeNumber}`,
      label: longDraftVolumeLabel(volumeNumber),
      volumeNumber,
      arcs: [...arcMap.entries()]
        .sort(([a], [b]) => a - b)
        .map(([arcNumber, chapters]) => ({
          id: `draft.volume-${volumeNumber}.arc-${arcNumber}`,
          label: longDraftArcLabel(arcNumber),
          volumeNumber,
          arcNumber,
          chapters: chapters.sort((a, b) => a.chapterNumber - b.chapterNumber),
        })),
    }))
}

function maxNumber(values: number[]): number {
  return values.length > 0 ? Math.max(...values) : 0
}

export function nextLongDraftVolumeStageId(
  stages?: Partial<Record<string, string>> | null,
): LongStageId {
  const volumeNumbers = collectLongDraftTree(stages).map((item) => item.volumeNumber)
  return buildLongDraftStageId(maxNumber(volumeNumbers) + 1, 1, 1)
}

export function nextLongDraftArcStageId(
  stages: Partial<Record<string, string>> | null | undefined,
  volumeNumber: number,
): LongStageId {
  const volume = collectLongDraftTree(stages).find(
    (item) => item.volumeNumber === volumeNumber,
  )
  const arcNumbers = volume?.arcs.map((item) => item.arcNumber) ?? []
  return buildLongDraftStageId(volumeNumber, maxNumber(arcNumbers) + 1, 1)
}

export function nextLongDraftChapterStageId(
  stages: Partial<Record<string, string>> | null | undefined,
  volumeNumber: number,
  arcNumber: number,
): LongStageId {
  const volume = collectLongDraftTree(stages).find(
    (item) => item.volumeNumber === volumeNumber,
  )
  const arc = volume?.arcs.find((item) => item.arcNumber === arcNumber)
  const chapterNumbers = arc?.chapters.map((item) => item.chapterNumber) ?? []
  return buildLongDraftStageId(
    volumeNumber,
    arcNumber,
    maxNumber(chapterNumbers) + 1,
  )
}

export function normalizeLongStages(
  raw?: Partial<Record<string, string>> | null,
): Record<LongStageId, string> {
  const out: Record<string, string> = {}
  for (const stage of LONG_WORKSPACE_CONTENT_STAGES) {
    out[stage.id] = String(raw?.[stage.id] ?? '')
  }
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (!isLongStageId(key)) continue
    out[key] = String(value ?? '')
  }
  return out
}
