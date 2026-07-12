import type {
  Book,
  BookStatus,
  BookSummary,
  BookType,
} from '../domain/workspaceCore'
import { normalizeMemoryEntries } from '../domain/workspaceCore'
import { normalizeLongWorkspace } from '../workspaces/long/longWorkspace'

// ==================== 素材提示词类型 ====================
export const MATERIAL_MANAGER_AGENT_ID = 'material_manager' as const
export const MATERIAL_MANAGER_PROMPT_KIND = 'material_manager' as const
export const MATERIAL_KIND_PROMPT_PREFIX = 'material_kind_' as const
export type MaterialKindPromptKind =
  | 'material_kind_character'
  | 'material_kind_gimmick'
  | 'material_kind_plot'
  | 'material_kind_draft'
  | 'material_kind_other'
export type MaterialPromptKind =
  | typeof MATERIAL_MANAGER_PROMPT_KIND
  | MaterialKindPromptKind
export const SKILL_MANAGER_AGENT_ID = 'skill_manager' as const
export const SKILL_MANAGER_PROMPT_KIND = 'skill_manager' as const
export const SKILL_KIND_PROMPT_PREFIX = 'skill_kind_' as const
export type SkillKindPromptKind =
  | 'skill_kind_general'
  | 'skill_kind_plot'
  | 'skill_kind_style'
  | 'skill_kind_other'
export type SkillPromptKind =
  | typeof SKILL_MANAGER_PROMPT_KIND
  | SkillKindPromptKind

// ==================== 素材类型定义 ====================

export type MaterialType = 'long' | 'short' | 'script'
export type SkillType = 'long' | 'short' | 'script'

export const LIBRARY_TYPE_LABELS: Record<MaterialType, string> = {
  short: '短篇',
  long: '长篇',
  script: '剧本',
}

export type MaterialStageId =
  | 'gimmick'
  | 'character'
  | 'pacing'
  | 'intro'
  | 'plot_refine'
  | 'draft_excerpt'
  | 'other'

export const MATERIAL_STAGE_KEYS: MaterialStageId[] = [
  'gimmick',
  'character',
  'pacing',
  'intro',
  'plot_refine',
  'draft_excerpt',
  'other',
]

export type MaterialKind = 'character' | 'gimmick' | 'plot' | 'draft' | 'other'
export type MaterialKindWithMixed = MaterialKind | 'mixed'

export function materialKindPromptKind(kind: MaterialKind): MaterialKindPromptKind {
  return `${MATERIAL_KIND_PROMPT_PREFIX}${kind}` as MaterialKindPromptKind
}

export const MATERIAL_KIND_KEYS: MaterialKind[] = [
  'character',
  'gimmick',
  'plot',
  'draft',
  'other',
]

export const MATERIAL_STAGE_LABELS: Record<MaterialStageId, string> = {
  gimmick: '梗',
  character: '人设',
  pacing: '剧情设计',
  intro: '导语设计',
  plot_refine: '剧情细化',
  draft_excerpt: '优秀正文片段',
  other: '其他素材',
}

export const MATERIAL_KIND_LABELS: Record<MaterialKindWithMixed, string> = {
  character: '人设素材库',
  gimmick: '梗素材库',
  plot: '剧情素材库',
  draft: '正文素材库',
  other: '其他素材库',
  mixed: '综合素材库',
}

export const MATERIAL_KIND_STAGE_IDS: Record<MaterialKindWithMixed, MaterialStageId[]> = {
  character: ['character'],
  gimmick: ['gimmick'],
  plot: ['pacing', 'intro', 'plot_refine'],
  draft: ['draft_excerpt'],
  other: ['other'],
  mixed: ['gimmick', 'character', 'pacing', 'intro', 'plot_refine', 'draft_excerpt', 'other'],
}

export const MATERIAL_STAGE_KIND: Record<MaterialStageId, MaterialKind> = {
  character: 'character',
  gimmick: 'gimmick',
  pacing: 'plot',
  intro: 'plot',
  plot_refine: 'plot',
  draft_excerpt: 'draft',
  other: 'other',
}

export function materialKindFromStageId(stageId: MaterialStageId | string): MaterialKind | null {
  return (MATERIAL_STAGE_KIND as Record<string, MaterialKind>)[stageId] ?? null
}

export function normalizeMaterialKindAccess(raw: unknown): MaterialKind[] {
  const values = Array.isArray(raw) ? raw : raw ? [raw] : []
  const out: MaterialKind[] = []
  for (const item of values) {
    const id = String(item ?? '').trim()
    const kind = normalizeMaterialKind(id, 'mixed')
    const resolved = kind === 'mixed' ? materialKindFromStageId(id) : kind
    if (!resolved || out.includes(resolved)) continue
    out.push(resolved)
  }
  return out
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
  material_kind: MaterialKindWithMixed
  parent_genre?: string  // 世情/追妻（short/script 时有效）
  sub_genre?: string     // legacy: 旧版子分类
  output_dir?: string
}

/** 素材库标签：短篇/长篇/剧本素材 · 分类 · 类型（如「短篇素材 · 世情 · 人设素材库」） */
export function materialMetaLabel(
  material: Pick<MaterialSummary, 'material_type' | 'material_kind' | 'parent_genre'>,
): string {
  return [
    materialTypeLabel(material.material_type),
    material.parent_genre?.trim(),
    MATERIAL_KIND_LABELS[material.material_kind],
  ]
    .filter(Boolean)
    .join(' · ')
}

export interface Material extends MaterialSummary {
  overview?: string
  stages?: Partial<Record<MaterialStageId, string>>
  stage_items?: Partial<Record<MaterialStageId, MaterialStageEntry[]>>
  created_at?: string
  updated_at?: string
}

export interface MaterialStageEntry {
  id: string
  title: string
  body: string
  created_at?: string
  updated_at?: string
}

export function normalizeMaterialStages(
  raw?: Partial<Record<MaterialStageId, string>> | null,
): Record<MaterialStageId, string> {
  const out: Record<MaterialStageId, string> = {
    gimmick: '',
    character: '',
    pacing: '',
    intro: '',
    plot_refine: '',
    draft_excerpt: '',
    other: '',
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
export type SkillKind = 'general' | 'plot' | 'style' | 'other'

export const SKILL_KIND_KEYS: SkillKind[] = [
  'general',
  'plot',
  'style',
  'other',
]

export const SKILL_KIND_LABELS: Record<SkillKind, string> = {
  general: '通用技能库',
  plot: '剧情设计技能库',
  style: '文风写作技能库',
  other: '其他技能库',
}

export const SKILL_KIND_STAGE_IDS: Record<SkillKind, SkillStageId[]> = {
  general: [...SKILL_STAGE_KEYS],
  plot: ['character_design', 'plot_design', 'outline'],
  style: ['draft', 'expert_section_writer'],
  other: [...SKILL_STAGE_KEYS],
}

export function skillKindPromptKind(kind: SkillKind): SkillKindPromptKind {
  return `${SKILL_KIND_PROMPT_PREFIX}${kind}` as SkillKindPromptKind
}
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
  skill_kind: SkillKind
  is_builtin?: boolean
  stage_counts?: Partial<Record<SkillStageId, number>>
  stage_skill_count?: number
  output_dir?: string
}

export interface Skill extends SkillSummary {
  overview?: string
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
  source_common_skill_id?: string
  source_skill_id?: string
  source_skill_entry_id?: string
}

export interface SkillManagerSkill {
  id: string
  name: string
  description: string
  body: string
}

export interface SkillImportSourceEntry {
  id: string
  title: string
}

export interface SkillImportSource {
  id: string
  title: string
  skill_type: SkillType
  skill_kind: SkillKind
  is_builtin: boolean
  stages: Partial<Record<SkillStageId, SkillImportSourceEntry[]>>
}

export interface SkillImportSelection {
  source_skill_id: string
  stage_id: SkillStageId
  entry_id: string
}

export interface ImportSkillEntriesResult {
  skill: Skill
  added_count: number
  skipped_count: number
}

export interface MaterialLibraryGroup {
  id: string
  title: string
  members: Partial<Record<MaterialKind, string>>
  created_at: string
  updated_at: string
}

export interface SkillLibraryGroup {
  id: string
  title: string
  members: Partial<Record<SkillKind, string>>
  created_at: string
  updated_at: string
}

export function materialLibraryGroupLinks(
  group: MaterialLibraryGroup,
  materials: MaterialSummary[],
): Record<MaterialKind, string[]> {
  const byId = new Map(materials.map((material) => [material.id, material]))
  const out = emptyLinkedMaterialIdsByKind()
  for (const kind of MATERIAL_KIND_KEYS) {
    const id = group.members[kind]
    const material = id ? byId.get(id) : undefined
    if (
      material && materialMatchesKind(material, kind)
    ) {
      out[kind] = [material.id]
    }
  }
  return out
}

export function skillLibraryGroupLinks(
  group: SkillLibraryGroup,
  skills: SkillSummary[],
): Record<SkillKind, string[]> {
  const byId = new Map(skills.map((skill) => [skill.id, skill]))
  const out = emptyLinkedSkillIdsByKind()
  for (const kind of SKILL_KIND_KEYS) {
    const id = group.members[kind]
    const skill = id ? byId.get(id) : undefined
    if (
      skill && skillMatchesKind(skill, kind)
    ) {
      out[kind] = [skill.id]
    }
  }
  return out
}

function newLocalLibraryGroupId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
}

export function normalizeMaterialLibraryGroupMembers(
  raw: unknown,
): Partial<Record<MaterialKind, string>> {
  const out: Partial<Record<MaterialKind, string>> = {}
  if (!raw || typeof raw !== 'object') return out
  const record = raw as Record<string, unknown>
  const seen = new Set<string>()
  for (const kind of MATERIAL_KIND_KEYS) {
    const value = record[kind]
    if (typeof value !== 'string') continue
    const id = value.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out[kind] = id
  }
  return out
}

export function normalizeSkillLibraryGroupMembers(
  raw: unknown,
): Partial<Record<SkillKind, string>> {
  const out: Partial<Record<SkillKind, string>> = {}
  if (!raw || typeof raw !== 'object') return out
  const record = raw as Record<string, unknown>
  const seen = new Set<string>()
  for (const kind of SKILL_KIND_KEYS) {
    const value = record[kind]
    if (typeof value !== 'string') continue
    const id = value.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out[kind] = id
  }
  return out
}

export function normalizeMaterialLibraryGroup(raw: unknown): MaterialLibraryGroup | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  if (!id || !title) return null
  return {
    id,
    title,
    members: normalizeMaterialLibraryGroupMembers(record.members),
    created_at: typeof record.created_at === 'string' ? record.created_at : '',
    updated_at: typeof record.updated_at === 'string' ? record.updated_at : '',
  }
}

export function normalizeSkillLibraryGroup(raw: unknown): SkillLibraryGroup | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  if (!id || !title) return null
  return {
    id,
    title,
    members: normalizeSkillLibraryGroupMembers(record.members),
    created_at: typeof record.created_at === 'string' ? record.created_at : '',
    updated_at: typeof record.updated_at === 'string' ? record.updated_at : '',
  }
}

export function normalizeMaterialLibraryGroups(raw: unknown): MaterialLibraryGroup[] {
  if (!Array.isArray(raw)) return []
  const out: MaterialLibraryGroup[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const group = normalizeMaterialLibraryGroup(item)
    if (!group || seen.has(group.id)) continue
    seen.add(group.id)
    out.push(group)
  }
  return out
}

export function normalizeSkillLibraryGroups(raw: unknown): SkillLibraryGroup[] {
  if (!Array.isArray(raw)) return []
  const out: SkillLibraryGroup[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const group = normalizeSkillLibraryGroup(item)
    if (!group || seen.has(group.id)) continue
    seen.add(group.id)
    out.push(group)
  }
  return out
}

export function libraryGroupMemberIds(
  members: Partial<Record<string, string>> | null | undefined,
): string[] {
  if (!members) return []
  return Object.values(members).filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
}

export function occupiedLibraryIdsFromGroups(
  groups: Array<{ members: Partial<Record<string, string>> }>,
  excludeGroupId?: string | null,
): Set<string> {
  const occupied = new Set<string>()
  for (const group of groups) {
    if (excludeGroupId && 'id' in group && (group as { id?: string }).id === excludeGroupId) {
      continue
    }
    for (const id of libraryGroupMemberIds(group.members)) {
      occupied.add(id)
    }
  }
  return occupied
}

export function countLibraryGroupMembers(
  members: Partial<Record<string, string>> | null | undefined,
): number {
  return libraryGroupMemberIds(members).length
}

export function createLocalMaterialLibraryGroup(
  title: string,
  members: Partial<Record<MaterialKind, string>>,
): MaterialLibraryGroup {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  return {
    id: newLocalLibraryGroupId(),
    title: title.trim(),
    members: normalizeMaterialLibraryGroupMembers(members),
    created_at: now,
    updated_at: now,
  }
}

export function createLocalSkillLibraryGroup(
  title: string,
  members: Partial<Record<SkillKind, string>>,
): SkillLibraryGroup {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  return {
    id: newLocalLibraryGroupId(),
    title: title.trim(),
    members: normalizeSkillLibraryGroupMembers(members),
    created_at: now,
    updated_at: now,
  }
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
      source_common_skill_id:
        typeof item.source_common_skill_id === 'string'
          ? item.source_common_skill_id
          : undefined,
      source_skill_id:
        typeof item.source_skill_id === 'string' ? item.source_skill_id : undefined,
      source_skill_entry_id:
        typeof item.source_skill_entry_id === 'string'
          ? item.source_skill_entry_id
          : undefined,
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

export function normalizeMaterialKind(
  raw: unknown,
  defaultKind: MaterialKindWithMixed = 'mixed',
): MaterialKindWithMixed {
  if (
    raw === 'character' ||
    raw === 'gimmick' ||
    raw === 'plot' ||
    raw === 'draft' ||
    raw === 'other' ||
    raw === 'mixed'
  ) {
    return raw
  }
  return defaultKind
}

export function emptyLinkedMaterialIdsByKind(): Record<MaterialKind, string[]> {
  return MATERIAL_KIND_KEYS.reduce(
    (out, kind) => {
      out[kind] = []
      return out
    },
    {} as Record<MaterialKind, string[]>,
  )
}

export function normalizeLinkedMaterialIdsByKind(
  raw: unknown,
  legacyMaterialId?: unknown,
): Partial<Record<MaterialKind, string[]>> {
  const out = emptyLinkedMaterialIdsByKind()
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    for (const kind of MATERIAL_KIND_KEYS) {
      const value = obj[kind]
      const values = Array.isArray(value) ? value : value ? [value] : []
      const seen = new Set<string>()
      for (const item of values) {
        const id = String(item ?? '').trim()
        if (!id || seen.has(id)) continue
        seen.add(id)
        out[kind].push(id)
      }
    }
    return out
  }
  const legacyId = String(legacyMaterialId ?? '').trim()
  if (legacyId) {
    for (const kind of MATERIAL_KIND_KEYS) out[kind] = [legacyId]
  }
  return out
}

function newLocalMaterialStageEntryId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
}

const MATERIAL_STAGE_ENTRY_LABELS: Record<MaterialStageId, string> = {
  gimmick: '梗',
  character: '人设',
  pacing: '剧情',
  intro: '导语',
  plot_refine: '剧情细化',
  draft_excerpt: '正文',
  other: '其他素材',
}

function materialEntryFallbackTitle(stageId: MaterialStageId, body: string, index: number): string {
  const firstLine = body
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^#+\s*/, '').trim())
    .find(Boolean)
  if (firstLine) return firstLine.slice(0, 40)
  const suffix = index > 0 ? ` ${index + 1}` : ''
  return `未命名${MATERIAL_STAGE_ENTRY_LABELS[stageId]}${suffix}`
}

function normalizeMaterialStageEntry(
  stageId: MaterialStageId,
  raw: unknown,
  index: number,
): MaterialStageEntry[] {
  if (typeof raw === 'string') {
    return raw.trim()
      ? [{
          id: newLocalMaterialStageEntryId(),
          title: materialEntryFallbackTitle(stageId, raw, index),
          body: raw,
        }]
      : []
  }
  if (!raw || typeof raw !== 'object') return []
  const item = raw as Partial<MaterialStageEntry>
  const body = typeof item.body === 'string' ? item.body : ''
  const title = typeof item.title === 'string' ? item.title.trim() : ''
  if (!body.trim() && !title && !item.id) return []
  return [{
    id: typeof item.id === 'string' && item.id ? item.id : newLocalMaterialStageEntryId(),
    title: title || materialEntryFallbackTitle(stageId, body, index),
    body,
    created_at: typeof item.created_at === 'string' ? item.created_at : undefined,
    updated_at: typeof item.updated_at === 'string' ? item.updated_at : undefined,
  }]
}

export function normalizeMaterialStageItems(
  raw?: Partial<Record<MaterialStageId, unknown>> | null,
  fallbackStages?: Partial<Record<MaterialStageId, string>> | null,
): Record<MaterialStageId, MaterialStageEntry[]> {
  const out = {} as Record<MaterialStageId, MaterialStageEntry[]>
  for (const stageId of MATERIAL_STAGE_KEYS) {
    const value = raw?.[stageId]
    let entries: MaterialStageEntry[] = []
    if (Array.isArray(value)) {
      entries = value.flatMap((item, index) =>
        normalizeMaterialStageEntry(stageId, item, index),
      )
    } else if (value != null) {
      entries = normalizeMaterialStageEntry(stageId, value, 0)
    }
    const fallback = fallbackStages?.[stageId]
    if (entries.length === 0 && raw == null && typeof fallback === 'string' && fallback.trim()) {
      entries = normalizeMaterialStageEntry(stageId, fallback, 0)
    }
    out[stageId] = entries
  }
  return out
}

export function materialStageItemsToStages(
  items: Partial<Record<MaterialStageId, MaterialStageEntry[]>>,
): Record<MaterialStageId, string> {
  const out = normalizeMaterialStages({})
  for (const stageId of MATERIAL_STAGE_KEYS) {
    out[stageId] = (items[stageId] ?? [])
      .map((entry) => {
        const title = entry.title?.trim()
        const body = entry.body ?? ''
        if (!title && !body.trim()) return ''
        return title ? `# ${title}\n\n${body}`.trim() : body.trim()
      })
      .filter(Boolean)
      .join('\n\n---\n\n')
  }
  return out
}

export function firstLinkedMaterialId(
  linkedMaterialIdsByKind?: Partial<Record<MaterialKind, string[]>>,
): string {
  if (!linkedMaterialIdsByKind) return ''
  for (const kind of MATERIAL_KIND_KEYS) {
    const id = linkedMaterialIdsByKind[kind]?.[0]
    if (id) return id
  }
  return ''
}

export function materialMatchesKind(
  material: Pick<MaterialSummary, 'material_kind'> | null | undefined,
  kind: MaterialKind,
): boolean {
  if (!material) return false
  return material.material_kind === 'mixed' || material.material_kind === kind
}

export function normalizeSkillType(raw: unknown): SkillType {
  if (raw === 'short' || raw === 'long' || raw === 'script') return raw
  return 'short'
}

export function normalizeSkillKind(raw: unknown): SkillKind {
  if (raw === 'general' || raw === 'plot' || raw === 'style' || raw === 'other') {
    return raw
  }
  return 'general'
}

export function emptyLinkedSkillIdsByKind(): Record<SkillKind, string[]> {
  return SKILL_KIND_KEYS.reduce(
    (out, kind) => {
      out[kind] = []
      return out
    },
    {} as Record<SkillKind, string[]>,
  )
}

export function normalizeLinkedSkillIdsByKind(
  raw: unknown,
  legacySkillId?: unknown,
): Partial<Record<SkillKind, string[]>> {
  const out = emptyLinkedSkillIdsByKind()
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    for (const kind of SKILL_KIND_KEYS) {
      const value = obj[kind]
      const values = Array.isArray(value) ? value : value ? [value] : []
      const seen = new Set<string>()
      for (const item of values) {
        const id = String(item ?? '').trim()
        if (!id || seen.has(id)) continue
        seen.add(id)
        out[kind].push(id)
      }
    }
    return out
  }
  const legacyId = String(legacySkillId ?? '').trim()
  if (legacyId) out.general = [legacyId]
  return out
}

export function firstLinkedSkillId(
  linkedSkillIdsByKind?: Partial<Record<SkillKind, string[]>>,
): string {
  if (!linkedSkillIdsByKind) return ''
  for (const kind of SKILL_KIND_KEYS) {
    const id = linkedSkillIdsByKind[kind]?.[0]
    if (id) return id
  }
  return ''
}

export function skillMatchesKind(
  skill: Pick<SkillSummary, 'skill_kind'> | null | undefined,
  kind: SkillKind,
): boolean {
  return Boolean(skill) && skill!.skill_kind === kind
}

function normalizeBooleanFlag(raw: unknown, defaultValue = false): boolean {
  if (raw == null) return defaultValue
  if (raw === true) return true
  if (typeof raw === 'number') return raw !== 0
  if (typeof raw === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase())
  }
  return defaultValue
}

export function normalizeBookSummary(raw: Partial<BookSummary> & { id: string }): BookSummary {
  const book_type = normalizeBookType(raw.book_type)
  const linked_material_ids_by_kind = normalizeLinkedMaterialIdsByKind(
    raw.linked_material_ids_by_kind,
    raw.linked_material_id,
  )
  const linked_skill_ids_by_kind = normalizeLinkedSkillIdsByKind(
    raw.linked_skill_ids_by_kind,
    raw.linked_skill_id,
  )
  return {
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title : '未命名',
    book_type,
    categories: Array.isArray(raw.categories) ? [...raw.categories] : [],
    status: normalizeBookStatus(raw.status),
    output_dir: typeof raw.output_dir === 'string' ? raw.output_dir : undefined,
    linked_material_id:
      firstLinkedMaterialId(linked_material_ids_by_kind) ||
      (typeof raw.linked_material_id === 'string' ? raw.linked_material_id : undefined),
    linked_material_ids_by_kind,
    linked_skill_id:
      firstLinkedSkillId(linked_skill_ids_by_kind) ||
      (typeof raw.linked_skill_id === 'string' ? raw.linked_skill_id : undefined),
    linked_skill_ids_by_kind,
  }
}

export function normalizeBook(raw: Partial<Book> & { id: string }): Book {
  const summary = normalizeBookSummary(raw)
  return {
    ...summary,
    content: typeof raw.content === 'string' ? raw.content : '',
    stages: raw.stages,
    long_workspace:
      summary.book_type === 'long'
        ? normalizeLongWorkspace(raw.long_workspace, raw.stages)
        : undefined,
    expert_draft: raw.expert_draft,
    memories: normalizeMemoryEntries(raw.memories),
    memory_auto_capture_enabled: normalizeBooleanFlag(
      raw.memory_auto_capture_enabled,
      true,
    ),
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
    material_kind: normalizeMaterialKind(raw.material_kind),
    parent_genre: typeof raw.parent_genre === 'string' ? raw.parent_genre : '',
    sub_genre: typeof raw.sub_genre === 'string' ? raw.sub_genre : '',
    output_dir: typeof raw.output_dir === 'string' ? raw.output_dir : undefined,
  }
}

export function normalizeMaterial(raw: Partial<Material> & { id: string }): Material {
  const summary = normalizeMaterialSummary(raw)
  const fallbackStages = normalizeMaterialStages(raw.stages)
  const rawStageItems = raw.stage_items as Partial<Record<MaterialStageId, unknown>> | undefined
  const stage_items = normalizeMaterialStageItems(
    rawStageItems ?? null,
    rawStageItems == null ? fallbackStages : null,
  )
  return {
    ...summary,
    overview: typeof raw.overview === 'string' ? raw.overview : '',
    stages: materialStageItemsToStages(stage_items),
    stage_items,
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
    skill_kind: normalizeSkillKind(raw.skill_kind),
    is_builtin: raw.is_builtin === true,
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
    overview: typeof raw.overview === 'string' ? raw.overview : '',
    stages,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : undefined,
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : undefined,
  }
}
