import {
  SHORT_WORKSPACE_CONTENT_STAGES,
  SHORT_WORKSPACE_STAGES,
  migrateLegacyStages,
  normalizeShortStages,
  type ShortStageId,
} from '../workspaces/short/stages'
import {
  SCRIPT_WORKSPACE_CONTENT_STAGES,
  SCRIPT_WORKSPACE_STAGES,
  migrateLegacyStages as migrateLegacyScriptStages,
  normalizeScriptStages,
  type ScriptStageId,
} from '../workspaces/script/stages'
import {
  LONG_WORKSPACE_CONTENT_STAGES,
  LONG_WORKSPACE_STAGES,
  normalizeLongStages,
  type LongStageId,
} from '../workspaces/long/stages'
import { isWorkspaceTypeEnabled } from '../workspaces/registry'

export type BookType = 'short' | 'long' | 'script'
export type BookStatus = 'editing' | 'completed'
export const MEMORY_TAGS = [
  'general',
  'character',
  'plot',
  'outline',
  'draft',
  'style',
] as const
export type MemoryTag = (typeof MEMORY_TAGS)[number]

export interface MemoryEntry {
  id: string
  tag: MemoryTag
  content: string
  created_at?: string
  updated_at?: string
}

function randomLocalId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
}

export function normalizeMemoryTag(raw: unknown): MemoryTag {
  return MEMORY_TAGS.includes(raw as MemoryTag) ? (raw as MemoryTag) : 'general'
}

export function normalizeMemoryEntries(raw: unknown): MemoryEntry[] {
  const source = Array.isArray(raw) ? raw : raw == null ? [] : [raw]
  const out: MemoryEntry[] = []
  const seenIds = new Set<string>()
  for (const item of source) {
    const entry =
      typeof item === 'string'
        ? { content: item }
        : item && typeof item === 'object'
          ? (item as Partial<MemoryEntry>)
          : null
    if (!entry) continue
    const content = String(entry.content ?? '').trim()
    if (!content) continue
    let id = String(entry.id ?? '').trim() || randomLocalId()
    if (seenIds.has(id)) id = randomLocalId()
    seenIds.add(id)
    out.push({
      id,
      tag: normalizeMemoryTag(entry.tag),
      content,
      created_at:
        typeof entry.created_at === 'string' ? entry.created_at : undefined,
      updated_at:
        typeof entry.updated_at === 'string' ? entry.updated_at : undefined,
    })
  }
  return out
}

export type { ShortStageId, ScriptStageId, LongStageId }

type BookWorkspaceSlice = {
  book_type: BookType
  categories: string[]
}

/** 短篇、剧本和长篇拥有各自隔离的创作空间。 */
export function isWorkspaceBook(book: BookWorkspaceSlice): boolean {
  return isWorkspaceTypeEnabled(book.book_type)
}

/** @deprecated 请用 isWorkspaceBook。 */
export function isWorkspaceShortBook(book: BookWorkspaceSlice): boolean {
  return isWorkspaceBook(book)
}

/** 提示词可见的分类上下文，不再影响智能体或模板选择。 */
export function resolveWorkspaceBookGenre(book: BookWorkspaceSlice): string {
  return book.categories.map((item) => item.trim()).filter(Boolean).join('、') || '未分类'
}

export function bookTypeLabel(bookType: BookType): string {
  if (bookType === 'script') return '剧本'
  if (bookType === 'short') return '短篇'
  return '长篇'
}

// 统一阶段ID类型
export type StageId = ShortStageId | ScriptStageId | LongStageId

// 导出统一阶段定义
export const WORKSPACE_STAGES = SHORT_WORKSPACE_STAGES
export const WORKSPACE_CONTENT_STAGES = SHORT_WORKSPACE_CONTENT_STAGES

export interface ExpertDraftSection {
  id: string
  title: string
  word_count_requirement?: string
  body: string
}

export interface ExpertDraftCharacterState {
  section_id: string
  title: string
  body: string
}

export interface ExpertDraft {
  sections: ExpertDraftSection[]
  character_states: ExpertDraftCharacterState[]
  running: boolean
  active_section_id?: string
}

export function defaultExpertDraft(bookType: BookType = 'short'): ExpertDraft {
  if (bookType === 'long') {
    return {
      sections: [],
      character_states: [],
      running: false,
      active_section_id: '',
    }
  }
  if (bookType === 'script') {
    return {
      sections: [
        { id: 'section-1', title: '第一节', word_count_requirement: '', body: '' },
      ],
      character_states: [
        { section_id: 'section-1', title: '第一节人物状态', body: '' },
      ],
      running: false,
      active_section_id: '',
    }
  }
  return {
    sections: [
      { id: 'intro', title: '导语', word_count_requirement: '', body: '' },
      { id: 'section-1', title: '第一节', word_count_requirement: '', body: '' },
    ],
    character_states: [
      { section_id: 'intro', title: '导语人物状态', body: '' },
      { section_id: 'section-1', title: '第一节人物状态', body: '' },
    ],
    running: false,
    active_section_id: '',
  }
}

function defaultExpertCharacterStateTitle(sectionTitle: string): string {
  return `${sectionTitle.trim() || '小节'}人物状态`
}

export function normalizeExpertDraft(
  raw?: Partial<ExpertDraft> | null,
  resetRuntime = false,
  bookType: BookType = 'short',
): ExpertDraft {
  if (bookType === 'long') return defaultExpertDraft('long')
  const base = defaultExpertDraft(bookType)
  if (!raw || typeof raw !== 'object') return base

  const sections: ExpertDraftSection[] = []
  const seenSectionIds = new Set<string>()
  const rawSections = raw.sections
  const hasSectionList = Array.isArray(rawSections)
  if (hasSectionList) {
    rawSections.forEach((item, index) => {
      if (!item || typeof item !== 'object') return
      const maybe = item as Partial<ExpertDraftSection>
      let id = String(maybe.id ?? '').trim()
      if (!id) {
        id =
          bookType === 'script'
            ? `section-${index + 1}`
            : index === 0
              ? 'intro'
              : `section-${index}`
      }
      if (seenSectionIds.has(id)) return
      seenSectionIds.add(id)
      const title =
        String(maybe.title ?? '').trim() ||
        (id === 'intro' ? '导语' : `第${sections.length + (bookType === 'script' ? 1 : 0)}节`)
      sections.push({
        id,
        title,
        word_count_requirement: String(maybe.word_count_requirement ?? '').trim(),
        body: String(maybe.body ?? ''),
      })
    })
  }

  const normalizedSections = hasSectionList ? sections : base.sections
  const titleById = new Map(normalizedSections.map((s) => [s.id, s.title]))
  const states: ExpertDraftCharacterState[] = []
  const seenStateIds = new Set<string>()

  if (Array.isArray(raw.character_states)) {
    raw.character_states.forEach((item) => {
      if (!item || typeof item !== 'object') return
      const maybe = item as Partial<ExpertDraftCharacterState> & { id?: string }
      const sectionId = String(maybe.section_id ?? maybe.id ?? '').trim()
      if (!sectionId || seenStateIds.has(sectionId) || !titleById.has(sectionId)) {
        return
      }
      seenStateIds.add(sectionId)
      const sectionTitle = titleById.get(sectionId) ?? '小节'
      states.push({
        section_id: sectionId,
        title:
          String(maybe.title ?? '').trim() ||
          defaultExpertCharacterStateTitle(sectionTitle),
        body: String(maybe.body ?? ''),
      })
    })
  }

  for (const section of normalizedSections) {
    if (seenStateIds.has(section.id)) continue
    states.push({
      section_id: section.id,
      title: defaultExpertCharacterStateTitle(section.title),
      body: '',
    })
  }

  const sectionIds = new Set(normalizedSections.map((s) => s.id))
  const active = String(raw.active_section_id ?? '').trim()

  return {
    sections: normalizedSections,
    character_states: states,
    running: resetRuntime ? false : Boolean(raw.running),
    active_section_id: active && sectionIds.has(active) ? active : '',
  }
}

/** 短篇可选分类（可扩展） */
export const SHORT_GENRE_OPTIONS = ['世情', '追妻', '科幻', '悬疑', '其他'] as const
/** 剧本分类暂时与短篇一致，但保持独立常量。 */
export const SCRIPT_GENRE_OPTIONS = ['世情', '追妻', '科幻', '悬疑', '其他'] as const

/** 获取统一阶段列表（所有短篇书籍使用同一套阶段） */
export function resolveWorkspaceStagesForBook(
  book?: Pick<Book, 'book_type'> | null,
): typeof SHORT_WORKSPACE_STAGES | typeof SCRIPT_WORKSPACE_STAGES | typeof LONG_WORKSPACE_STAGES {
  if (book?.book_type === 'long') return LONG_WORKSPACE_STAGES
  return book?.book_type === 'script' ? SCRIPT_WORKSPACE_STAGES : SHORT_WORKSPACE_STAGES
}

export function resolveWorkspaceContentStagesForBook(
  book?: Pick<Book, 'book_type'> | null,
):
  | typeof SHORT_WORKSPACE_CONTENT_STAGES
  | typeof SCRIPT_WORKSPACE_CONTENT_STAGES
  | typeof LONG_WORKSPACE_CONTENT_STAGES {
  if (book?.book_type === 'long') return LONG_WORKSPACE_CONTENT_STAGES
  return book?.book_type === 'script'
    ? SCRIPT_WORKSPACE_CONTENT_STAGES
    : SHORT_WORKSPACE_CONTENT_STAGES
}

/** 两端存储中的「全字段」工作台 stages（统一阶段键） */
export function normalizeAllBookStages(
  raw?: Partial<Record<StageId, string>> | null,
): Record<StageId, string> {
  return normalizeShortStages(raw) as Record<StageId, string>
}

/** 仅当前工作台在用的阶段子集（用于编辑区 state） */
export function normalizeStagesForWorkspaceBook(
  book?: Pick<Book, 'book_type'> | null,
  raw?: Partial<Record<StageId, string>> | null,
): Record<StageId, string> {
  if (book?.book_type === 'long') {
    return normalizeLongStages(
      raw as Partial<Record<LongStageId, string>>,
    ) as Record<StageId, string>
  }
  if (book?.book_type === 'script') {
    const migrated = migrateLegacyScriptStages(raw)
    return normalizeScriptStages(migrated) as Record<StageId, string>
  }
  const migrated = migrateLegacyStages(raw)
  return normalizeShortStages(migrated) as Record<StageId, string>
}

/** 把部分阶段更新合并进完整存储，未出现的键保持原样 */
export function mergeStagePatchIntoAll(
  previous: Partial<Record<StageId, string>> | undefined,
  patch: Partial<Record<StageId, string>>,
  book?: Pick<Book, 'book_type'> | null,
): Record<StageId, string> {
  const next = { ...(previous ?? {}) } as Record<string, string>
  for (const stage of resolveWorkspaceContentStagesForBook(book)) {
    if (!(stage.id in next)) next[stage.id] = ''
  }
  const migratedPatch =
    book?.book_type === 'script'
      ? migrateLegacyScriptStages(patch)
      : book?.book_type === 'long'
        ? patch
        : migrateLegacyStages(patch)
  for (const [k, v] of Object.entries(migratedPatch)) {
    next[k] = String(v ?? '')
  }
  return next as Record<StageId, string>
}

export function primaryDraftStageId(
  _book?: Pick<Book, 'book_type'> | null,
): StageId {
  void _book
  return 'draft'
}

/** @deprecated 请用 normalizeAllBookStages */
export function normalizeStages(
  raw?: Partial<Record<StageId, string>> | null,
): Record<StageId, string> {
  return normalizeAllBookStages(raw)
}

export interface BookSummary {
  id: string
  title: string
  book_type: BookType
  categories: string[]
  /** 书籍工作状态：编辑中 / 已完成 */
  status: BookStatus
  /** 本机落地目录，空表示未指定 */
  output_dir?: string
  /** 写书工作台关联的素材库 id，空表示未关联 */
  linked_material_id?: string
  /** 按素材部门关联的素材库 id 列表 */
  linked_material_ids_by_kind?: Partial<
    Record<'character' | 'gimmick' | 'plot' | 'draft', string[]>
  >
  /** 写书工作台绑定的技能库 id，空表示未绑定 */
  linked_skill_id?: string
}

export interface Book extends BookSummary {
  content: string
  stages?: Partial<Record<StageId, string>>
  expert_draft?: ExpertDraft
  memories: MemoryEntry[]
  memory_auto_capture_enabled: boolean
  created_at?: string
  updated_at?: string
}
