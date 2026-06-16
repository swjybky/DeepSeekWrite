import type {
  Book,
  BookStatus,
  BookSummary,
  BookType,
} from '../domain/workspaceCore'

// ==================== 素材提示词类型 ====================
export const MATERIAL_MANAGER_AGENT_ID = 'material_manager' as const
export const MATERIAL_MANAGER_PROMPT_KIND = 'material_manager' as const
export type MaterialPromptKind = typeof MATERIAL_MANAGER_PROMPT_KIND
export const SKILL_MANAGER_AGENT_ID = 'skill_manager' as const
export const SKILL_MANAGER_PROMPT_KIND = 'skill_manager' as const
export type SkillPromptKind = typeof SKILL_MANAGER_PROMPT_KIND

// ==================== 素材类型定义 ====================

export type MaterialType = 'long' | 'short' | 'script'
export type SkillType = 'long' | 'short' | 'script'

export const LIBRARY_TYPE_LABELS: Record<MaterialType, string> = {
  short: '短篇',
  long: '长篇',
  script: '剧本',
}

export type MaterialStageId =
  | 'character'
  | 'intro'
  | 'gimmick'
  | 'plot_refine'
  | 'pacing'
  | 'draft_excerpt'

export const MATERIAL_STAGE_LABELS: Record<MaterialStageId, string> = {
  character: '人设素材',
  intro: '导语素材',
  gimmick: '梗素材',
  plot_refine: '剧情细化素材',
  pacing: '剧情设计素材',
  draft_excerpt: '正文片段',
}

export const SHORT_MATERIAL_GENRES: Record<string, string[]> = {
  '世情': ['家庭', '职场', '婚恋', '邻里', '亲子', '继承', '养老'],
  '追妻': ['甜宠', '虐恋', '重生', '穿越', '暗恋', '破镜重圆', '先婚后爱'],
  '科幻': ['未来都市', '星际', '人工智能', '赛博朋克', '末日', '时间旅行', '异星文明'],
  '悬疑': ['刑侦', '推理', '惊悚', '密室', '民俗', '心理', '反转'],
  '其他': [],
}

export const SCRIPT_MATERIAL_GENRES: Record<string, string[]> = {
  '世情': ['家庭', '职场', '婚恋', '邻里', '亲子', '继承', '养老'],
  '追妻': ['甜宠', '虐恋', '重生', '穿越', '暗恋', '破镜重圆', '先婚后爱'],
  '科幻': ['未来都市', '星际', '人工智能', '赛博朋克', '末日', '时间旅行', '异星文明'],
  '悬疑': ['刑侦', '推理', '惊悚', '密室', '民俗', '心理', '反转'],
  '其他': [],
}

export function libraryTypeLabel(type: MaterialType | SkillType): string {
  return LIBRARY_TYPE_LABELS[type]
}

export function materialTypeLabel(type: MaterialType): string {
  return `${libraryTypeLabel(type)}素材`
}

export function skillTypeLabel(type: SkillType): string {
  return `${libraryTypeLabel(type)}技能`
}

/** 素材大分类兼容映射（旧名称 → 新名称） */
const MATERIAL_GENRE_COMPAT: Record<string, string> = {
  '现实情感': '追妻',
  '情感': '追妻',
}

/** 将旧素材大分类名称映射为新名称 */
export function resolveMaterialParentGenre(genre: string): string {
  return MATERIAL_GENRE_COMPAT[genre] || genre
}

/** 获取指定大分类下的子分类（兼容旧名称） */
export function getMaterialSubGenres(genre: string): string[] {
  return SHORT_MATERIAL_GENRES[resolveMaterialParentGenre(genre)] || []
}

export function getMaterialParentGenres(type: MaterialType): string[] {
  if (type === 'script') return Object.keys(SCRIPT_MATERIAL_GENRES)
  if (type === 'short') return Object.keys(SHORT_MATERIAL_GENRES)
  return []
}

export interface MaterialSummary {
  id: string
  title: string
  material_type: MaterialType
  parent_genre?: string  // 世情/追妻（short/script 时有效）
  sub_genre?: string     // legacy: 旧版子分类
  output_dir?: string
}

export interface Material extends MaterialSummary {
  stages?: Partial<Record<MaterialStageId, string>>
  created_at?: string
  updated_at?: string
}

export function normalizeMaterialStages(
  raw?: Partial<Record<MaterialStageId, string>> | null,
): Record<MaterialStageId, string> {
  const out: Record<MaterialStageId, string> = {
    character: '',
    intro: '',
    gimmick: '',
    plot_refine: '',
    pacing: '',
    draft_excerpt: '',
  }
  if (!raw) return out
  for (const k of Object.keys(out) as MaterialStageId[]) {
    if (k in raw) out[k] = String(raw[k] ?? '')
  }
  return out
}

// ==================== 技能类型定义 ====================

export type SkillStageId =
  | 'character_design'
  | 'plot_design'
  | 'outline'
  | 'draft'
  | 'expert_section_writer'

type LegacySkillStageId =
  | 'intro_design'
  | 'plot_refine'
  | 'draft_review'
  | 'format_conversion'
  | 'expert_draft_coordinator'

export const SKILL_STAGE_LABELS: Record<SkillStageId, string> = {
  character_design: '人物技能',
  plot_design: '剧情技能',
  outline: '大纲技能',
  draft: '正文专家编写技能',
  expert_section_writer: '分节写手技能',
}

export const SKILL_STAGE_KEYS = Object.keys(SKILL_STAGE_LABELS) as SkillStageId[]
const LEGACY_SKILL_STAGES_TO_PLOT: LegacySkillStageId[] = [
  'intro_design',
  'plot_refine',
]
const LEGACY_SKILL_STAGES_TO_DRAFT: LegacySkillStageId[] = [
  'draft_review',
  'format_conversion',
  'expert_draft_coordinator',
]

export interface SkillSummary {
  id: string
  title: string
  skill_type: SkillType
  stage_counts?: Partial<Record<SkillStageId, number>>
  stage_skill_count?: number
  output_dir?: string
}

export interface Skill extends SkillSummary {
  stages: Record<SkillStageId, SkillStageEntry[]>
  created_at?: string
  updated_at?: string
}

export interface SkillStageEntry {
  id: string
  title: string
  body: string
  created_at?: string
  updated_at?: string
}

function newLocalSkillStageEntryId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
}

export function normalizeSkillStages(
  raw?: Partial<Record<SkillStageId | LegacySkillStageId, unknown>> | null,
): Record<SkillStageId, SkillStageEntry[]> {
  const out = {} as Record<SkillStageId, SkillStageEntry[]>
  for (const k of SKILL_STAGE_KEYS) {
    out[k] = normalizeSkillStageEntries(k, raw?.[k])
  }
  if (raw) {
    out.plot_design = [
      ...out.plot_design,
      ...LEGACY_SKILL_STAGES_TO_PLOT.flatMap((stageId) =>
        normalizeSkillStageEntries('plot_design', raw[stageId]),
      ),
    ]
    out.draft = [
      ...out.draft,
      ...LEGACY_SKILL_STAGES_TO_DRAFT.flatMap((stageId) =>
        normalizeSkillStageEntries('draft', raw[stageId]),
      ),
    ]
  }
  return out
}

export function normalizeSkillStageId(raw: unknown): SkillStageId {
  if (SKILL_STAGE_KEYS.includes(raw as SkillStageId)) {
    return raw as SkillStageId
  }
  if (LEGACY_SKILL_STAGES_TO_PLOT.includes(raw as LegacySkillStageId)) {
    return 'plot_design'
  }
  if (LEGACY_SKILL_STAGES_TO_DRAFT.includes(raw as LegacySkillStageId)) {
    return 'draft'
  }
  return 'character_design'
}

function normalizeSkillStageEntries(
  stageId: SkillStageId,
  raw: unknown,
): SkillStageEntry[] {
  const fallbackTitle = SKILL_STAGE_LABELS[stageId]
  if (raw == null) return []
  if (typeof raw === 'string') {
    return raw.trim()
      ? [{ id: newLocalSkillStageEntryId(), title: fallbackTitle, body: raw }]
      : []
  }
  if (Array.isArray(raw)) {
    return raw.flatMap((item, index) => normalizeSkillStageEntry(stageId, item, index))
  }
  return normalizeSkillStageEntry(stageId, raw, 0)
}

function normalizeSkillStageEntry(
  stageId: SkillStageId,
  raw: unknown,
  index: number,
): SkillStageEntry[] {
  const fallbackTitle =
    index > 0 ? `${SKILL_STAGE_LABELS[stageId]} ${index + 1}` : SKILL_STAGE_LABELS[stageId]
  if (typeof raw === 'string') {
    return raw.trim()
      ? [{ id: newLocalSkillStageEntryId(), title: fallbackTitle, body: raw }]
      : []
  }
  if (!raw || typeof raw !== 'object') return []
  const item = raw as Partial<SkillStageEntry>
  const body = typeof item.body === 'string' ? item.body : ''
  const explicitTitle = typeof item.title === 'string' ? item.title.trim() : ''
  if (!body.trim() && !explicitTitle && !item.id) return []
  const title = explicitTitle || fallbackTitle
  return [
    {
      id: typeof item.id === 'string' && item.id ? item.id : newLocalSkillStageEntryId(),
      title,
      body,
      created_at: typeof item.created_at === 'string' ? item.created_at : undefined,
      updated_at: typeof item.updated_at === 'string' ? item.updated_at : undefined,
    },
  ]
}

export function normalizeBookStatus(raw: unknown): BookStatus {
  return raw === 'completed' ? 'completed' : 'editing'
}

export function normalizeBookType(raw: unknown): BookType {
  if (raw === 'short' || raw === 'long' || raw === 'script') return raw
  return 'short'
}

export function normalizeMaterialType(raw: unknown): MaterialType {
  if (raw === 'short' || raw === 'long' || raw === 'script') return raw
  return 'short'
}

export function normalizeSkillType(raw: unknown): SkillType {
  if (raw === 'short' || raw === 'long' || raw === 'script') return raw
  return 'short'
}

export function normalizeBookSummary(raw: Partial<BookSummary> & { id: string }): BookSummary {
  const book_type = normalizeBookType(raw.book_type)
  return {
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title : '未命名',
    book_type,
    categories: Array.isArray(raw.categories) ? [...raw.categories] : [],
    status: normalizeBookStatus(raw.status),
    output_dir: typeof raw.output_dir === 'string' ? raw.output_dir : undefined,
    linked_material_id:
      typeof raw.linked_material_id === 'string' ? raw.linked_material_id : undefined,
    linked_skill_id:
      typeof raw.linked_skill_id === 'string' ? raw.linked_skill_id : undefined,
  }
}

export function normalizeBook(raw: Partial<Book> & { id: string }): Book {
  const summary = normalizeBookSummary(raw)
  return {
    ...summary,
    content: typeof raw.content === 'string' ? raw.content : '',
    stages: raw.stages,
    expert_draft: raw.expert_draft,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : undefined,
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : undefined,
  }
}

export function normalizeMaterialSummary(
  raw: Partial<MaterialSummary> & { id: string },
): MaterialSummary {
  return {
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title : '未命名素材',
    material_type: normalizeMaterialType(raw.material_type),
    parent_genre: typeof raw.parent_genre === 'string' ? raw.parent_genre : '',
    sub_genre: typeof raw.sub_genre === 'string' ? raw.sub_genre : '',
    output_dir: typeof raw.output_dir === 'string' ? raw.output_dir : undefined,
  }
}

export function normalizeMaterial(raw: Partial<Material> & { id: string }): Material {
  const summary = normalizeMaterialSummary(raw)
  return {
    ...summary,
    stages: normalizeMaterialStages(raw.stages),
    created_at: typeof raw.created_at === 'string' ? raw.created_at : undefined,
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : undefined,
  }
}

export function normalizeSkillSummary(raw: Partial<SkillSummary> & { id: string }): SkillSummary {
  const stage_counts: Partial<Record<SkillStageId, number>> = {}
  if (raw.stage_counts && typeof raw.stage_counts === 'object') {
    for (const stageId of SKILL_STAGE_KEYS) {
      const count = Number(raw.stage_counts[stageId])
      if (Number.isFinite(count) && count > 0) stage_counts[stageId] = count
    }
  }
  const stage_skill_count =
    typeof raw.stage_skill_count === 'number'
      ? raw.stage_skill_count
      : SKILL_STAGE_KEYS.reduce((sum, stageId) => sum + (stage_counts[stageId] ?? 0), 0)
  return {
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title : '未命名技能',
    skill_type: normalizeSkillType(raw.skill_type),
    stage_counts,
    stage_skill_count,
    output_dir: typeof raw.output_dir === 'string' ? raw.output_dir : undefined,
  }
}

export function normalizeSkill(
  raw: Partial<Skill> & { id: string } & { stages?: unknown; stage_id?: unknown; body?: unknown },
): Skill {
  const stages = normalizeSkillStages(raw.stages as Partial<Record<SkillStageId, unknown>>)
  if (raw.stage_id != null) {
    const stageId = normalizeSkillStageId(raw.stage_id)
    if (stages[stageId].length === 0) {
      stages[stageId] = [
        {
          id: newLocalSkillStageEntryId(),
          title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : SKILL_STAGE_LABELS[stageId],
          body: typeof raw.body === 'string' ? raw.body : '',
          created_at: typeof raw.created_at === 'string' ? raw.created_at : undefined,
          updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : undefined,
        },
      ]
    }
  }
  const stage_counts = Object.fromEntries(
    SKILL_STAGE_KEYS.map((stageId) => [stageId, stages[stageId].length]),
  ) as Partial<Record<SkillStageId, number>>
  const summary = normalizeSkillSummary({
    ...raw,
    stage_counts,
    stage_skill_count: SKILL_STAGE_KEYS.reduce(
      (sum, stageId) => sum + stages[stageId].length,
      0,
    ),
  })
  return {
    ...summary,
    stages,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : undefined,
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : undefined,
  }
}
