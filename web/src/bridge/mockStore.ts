import {
  defaultExpertDraft,
  isWorkspaceBook,
  mergeStagePatchIntoAll,
  normalizeAllBookStages,
  normalizeExpertDraft,
  primaryDraftStageId,
} from '../domain/workspaceCore'
import type {
  Book,
  BookStatus,
  BookSummary,
  ExpertDraft,
  MemoryEntry,
  StageId,
} from '../domain/workspaceCore'
import type { SaveSkillOptions } from './apiTypes'
import { readCommonSkills } from './commonSkillsClient'
import {
  SCRIPT_MATERIAL_GENRES,
  SHORT_MATERIAL_GENRES,
  SKILL_STAGE_KEYS,
  normalizeBook,
  normalizeBookStatus,
  normalizeBookType,
  normalizeMaterial,
  normalizeMaterialStages,
  normalizeMaterialType,
  normalizeSkill,
  normalizeSkillStages,
  normalizeSkillType,
  type CommonSkill,
  type LoadCommonSkillsResult,
  type Material,
  type MaterialStageId,
  type MaterialSummary,
  type Skill,
  type SkillStageEntry,
  type SkillStageId,
  type SkillSummary,
} from './libraryDomain'

const DEFAULT_SKILL_TEMPLATE_MODULES = import.meta.glob(
  '../../../app/prompt_defaults/skill/default_skill_template.json',
  { eager: true, import: 'default' },
) as Record<string, { title?: string; stages?: Record<string, unknown> }>

const defaultSkillTemplate = Object.values(DEFAULT_SKILL_TEMPLATE_MODULES)[0] ?? null
const MOCK_STORAGE_KEY = 'write_claw_dev_books'

function loadMock(): Map<string, Book> {
  try {
    const raw = localStorage.getItem(MOCK_STORAGE_KEY)
    if (!raw) return new Map()
    const arr = JSON.parse(raw) as Array<Partial<Book> & { id: string }>
    return new Map(arr.map((b) => [b.id, normalizeBook(b)]))
  } catch {
    return new Map()
  }
}

function saveMock(map: Map<string, Book>) {
  localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify([...map.values()]))
}

function randomId() {
  return crypto.randomUUID()
}

export async function mockListBooks(): Promise<BookSummary[]> {
  const map = loadMock()
  return [...map.values()]
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
    .map(({ id, title, book_type, categories, status, output_dir, linked_material_id, linked_skill_id }) => ({
      id,
      title,
      book_type,
      categories,
      status: normalizeBookStatus(status),
      output_dir,
      linked_material_id,
      linked_skill_id,
    }))
}

export async function mockCreateBook(
  title: string,
  book_type: string,
  categories: string[],
  workspace_root?: string | null,
  linked_skill_id?: string | null,
  linked_material_id?: string | null,
): Promise<Book> {
  const map = loadMock()
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const bt = normalizeBookType(book_type)
  const ws = (workspace_root ?? '').trim()
  const safeName = (title.trim() || '未命名').replace(/[<>:"/\\|?*\n\r\t]/g, '_').trim() || '未命名'
  const output_dir =
    ws.length > 0
      ? `${ws.replace(/[/\\]+$/, '')}${typeof window !== 'undefined' && window.navigator.userAgent.includes('Win') ? '\\' : '/'}${safeName}`
      : undefined
  const isWsBook = isWorkspaceBook({ book_type: bt, categories: [] })
  const book: Book = {
    id: randomId(),
    title: title.trim() || '未命名',
    book_type: bt,
    categories: bt === 'short' || bt === 'script' ? [...categories] : [],
    status: 'editing',
    content: '',
    output_dir,
    linked_material_id:
      isWsBook && linked_material_id && loadMockMaterials().has(linked_material_id)
        ? linked_material_id
        : '',
    linked_skill_id:
      isWsBook && linked_skill_id && loadMockSkills().has(linked_skill_id)
        ? linked_skill_id
        : '',
    stages: normalizeAllBookStages({}),
    expert_draft: defaultExpertDraft(bt),
    memories: [],
    created_at: now,
    updated_at: now,
  }
  map.set(book.id, book)
  saveMock(map)
  return book
}

export async function mockGetBook(book_id: string): Promise<Book | null> {
  const book = loadMock().get(book_id) ?? null
  if (!book) return null
  return {
    ...book,
    status: normalizeBookStatus(book.status),
    expert_draft: normalizeExpertDraft(book.expert_draft, false, book.book_type),
  }
}

export async function mockSaveBook(
  book_id: string,
  options: {
    content?: string | null
    stages?: Record<string, string> | null
    linked_material_id?: string | null
    linked_skill_id?: string | null
    expert_draft?: ExpertDraft | null
    title?: string | null
    status?: BookStatus | null
  },
): Promise<Book | null> {
  const map = loadMock()
  const b = map.get(book_id)
  if (!b) return null
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  let next: Book = { ...b, updated_at: now }
  if (options.title != null) {
    next = { ...next, title: options.title.trim() }
  }
  if (options.stages != null) {
    const merged = mergeStagePatchIntoAll(b.stages, options.stages as Partial<Record<StageId, string>>)
    next = { ...next, stages: merged, content: merged[primaryDraftStageId(next)] ?? '' }
  } else if (options.content != null) {
    next = { ...next, content: options.content }
  }
  if (options.linked_material_id !== undefined) {
    const mid = options.linked_material_id?.trim() ?? ''
    next = { ...next, linked_material_id: mid && loadMockMaterials().has(mid) ? mid : '' }
  }
  if (options.linked_skill_id !== undefined) {
    const sid = options.linked_skill_id?.trim() ?? ''
    next = {
      ...next,
      linked_skill_id:
        isWorkspaceBook(next) && sid && loadMockSkills().has(sid) ? sid : '',
    }
  }
  if (options.expert_draft != null) {
    next = {
      ...next,
      expert_draft: normalizeExpertDraft(
        options.expert_draft,
        false,
        next.book_type,
      ),
    }
  }
  if (options.status != null) {
    next = { ...next, status: normalizeBookStatus(options.status) }
  }
  map.set(book_id, next)
  saveMock(map)
  return next
}

export async function mockDeleteBook(book_id: string): Promise<boolean> {
  const map = loadMock()
  const ok = map.delete(book_id)
  if (ok) saveMock(map)
  return ok
}

// ==================== 素材 Mock 数据 ====================

export async function mockGetBookMemories(book_id: string): Promise<MemoryEntry[]> {
  return loadMock().get(book_id)?.memories ?? []
}

export async function mockSetBookMemories(
  book_id: string,
  memories: MemoryEntry[],
): Promise<MemoryEntry[]> {
  const map = loadMock()
  const b = map.get(book_id)
  if (!b) return []
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  map.set(book_id, {
    ...b,
    memories,
    updated_at: now,
  })
  saveMock(map)
  return memories
}

const MOCK_MATERIALS_KEY = 'write_claw_dev_materials'

export function loadMockMaterials(): Map<string, Material> {
  try {
    const raw = localStorage.getItem(MOCK_MATERIALS_KEY)
    if (!raw) return new Map()
    const arr = JSON.parse(raw) as Array<Partial<Material> & { id: string }>
    return new Map(arr.map((m) => [m.id, normalizeMaterial(m)]))
  } catch {
    return new Map()
  }
}

function saveMockMaterials(map: Map<string, Material>) {
  localStorage.setItem(MOCK_MATERIALS_KEY, JSON.stringify([...map.values()]))
}

export async function mockListMaterials(): Promise<MaterialSummary[]> {
  const map = loadMockMaterials()
  return [...map.values()]
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
    .map(({ id, title, material_type, parent_genre, sub_genre, output_dir }) => ({
      id,
      title,
      material_type,
      parent_genre,
      sub_genre,
      output_dir,
    }))
}

export async function mockGetMaterial(material_id: string): Promise<Material | null> {
  return loadMockMaterials().get(material_id) ?? null
}

export async function mockCreateMaterial(
  title: string,
  material_type: string,
  parent_genre?: string | null,
  sub_genre?: string | null,
): Promise<Material> {
  void sub_genre
  const map = loadMockMaterials()
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const mt = normalizeMaterialType(material_type)
  const material: Material = {
    id: randomId(),
    title: title.trim() || '未命名素材',
    material_type: mt,
    parent_genre: mt === 'short' || mt === 'script' ? (parent_genre || '') : '',
    sub_genre: '',
    stages: normalizeMaterialStages({}),
    created_at: now,
    updated_at: now,
  }
  map.set(material.id, material)
  saveMockMaterials(map)
  return material
}

export async function mockSaveMaterial(
  material_id: string,
  stages?: Record<string, string> | null,
  title?: string,
): Promise<Material | null> {
  const map = loadMockMaterials()
  const m = map.get(material_id)
  if (!m) return null
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  let next: Material = { ...m, updated_at: now }
  if (title != null) {
    next = { ...next, title: title.trim() }
  }
  if (stages != null) {
    const normalized = normalizeMaterialStages(stages as Partial<Record<MaterialStageId, string>>)
    next = { ...next, stages: normalized }
  }
  map.set(material_id, next)
  saveMockMaterials(map)
  return next
}

export async function mockDeleteMaterial(material_id: string): Promise<boolean> {
  const map = loadMockMaterials()
  const ok = map.delete(material_id)
  if (ok) {
    saveMockMaterials(map)
    const books = loadMock()
    let changed = false
    for (const [bookId, book] of books) {
      if (book.linked_material_id === material_id) {
        books.set(bookId, { ...book, linked_material_id: '' })
        changed = true
      }
    }
    if (changed) saveMock(books)
  }
  return ok
}

export async function mockGetMaterialGenres(): Promise<Record<string, string[]>> {
  return {
    short: Object.keys(SHORT_MATERIAL_GENRES),
    script: Object.keys(SCRIPT_MATERIAL_GENRES),
  }
}

// ==================== 技能 Mock 数据 ====================

const MOCK_SKILLS_KEY = 'write_claw_dev_skills'

export function loadMockSkills(): Map<string, Skill> {
  try {
    const raw = localStorage.getItem(MOCK_SKILLS_KEY)
    if (!raw) {
      const seeded = seedDefaultMockSkill()
      if (seeded.size > 0) {
        saveMockSkills(seeded)
        return seeded
      }
      return new Map()
    }
    const arr = JSON.parse(raw) as Array<Partial<Skill> & { id: string; stages?: unknown }>
    return new Map(arr.map((s) => [s.id, normalizeSkill(s)]))
  } catch {
    return new Map()
  }
}

function seedDefaultMockSkill(): Map<string, Skill> {
  try {
    const tpl = defaultSkillTemplate
    if (!tpl?.stages) return new Map()
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
    const skill = normalizeSkill({
      id: randomId(),
      title: tpl.title || '参考技能',
      skill_type: 'short',
      stages: tpl.stages,
      created_at: now,
      updated_at: now,
    } as Parameters<typeof normalizeSkill>[0])
    return new Map([[skill.id, skill]])
  } catch {
    return new Map()
  }
}

function saveMockSkills(map: Map<string, Skill>) {
  localStorage.setItem(MOCK_SKILLS_KEY, JSON.stringify([...map.values()]))
}

function sameLoadedCommonSkill(entry: SkillStageEntry, commonSkill: CommonSkill): boolean {
  if (
    commonSkill.id &&
    entry.source_common_skill_id &&
    entry.source_common_skill_id === commonSkill.id
  ) {
    return true
  }
  return (
    entry.title.trim() === commonSkill.title.trim() &&
    entry.body.trim() === commonSkill.body.trim()
  )
}

async function appendMissingCommonSkills(
  stages: Skill['stages'],
  now: string,
): Promise<{ added_count: number; available_count: number }> {
  let added_count = 0
  let available_count = 0
  for (const commonSkill of await readCommonSkills()) {
    for (const stageId of commonSkill.effective_stages) {
      available_count += 1
      const entries = stages[stageId] ?? []
      if (entries.some((entry) => sameLoadedCommonSkill(entry, commonSkill))) {
        continue
      }
      entries.push({
        id: randomId(),
        title: commonSkill.title,
        body: commonSkill.body,
        created_at: now,
        updated_at: now,
        source_common_skill_id: commonSkill.id,
      })
      stages[stageId] = entries
      added_count += 1
    }
  }
  return { added_count, available_count }
}

export async function mockListSkills(): Promise<SkillSummary[]> {
  const map = loadMockSkills()
  return [...map.values()]
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
    .map(({ id, title, skill_type, stages, output_dir }) => ({
      id,
      title,
      skill_type,
      stage_counts: Object.fromEntries(
        SKILL_STAGE_KEYS.map((stageId) => [stageId, stages[stageId]?.length ?? 0]),
      ) as Partial<Record<SkillStageId, number>>,
      stage_skill_count: SKILL_STAGE_KEYS.reduce(
        (sum, stageId) => sum + (stages[stageId]?.length ?? 0),
        0,
      ),
      output_dir,
    }))
}

export async function mockGetSkill(skill_id: string): Promise<Skill | null> {
  return loadMockSkills().get(skill_id) ?? null
}

export async function mockCreateSkill(
  title: string,
  skill_type = 'short',
  load_common_skills = false,
): Promise<Skill> {
  const map = loadMockSkills()
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const stages = normalizeSkillStages({})
  if (load_common_skills) {
    await appendMissingCommonSkills(stages, now)
  }
  const skill: Skill = {
    id: randomId(),
    title: title.trim() || '未命名技能',
    skill_type: normalizeSkillType(skill_type),
    stages,
    stage_counts: {},
    stage_skill_count: 0,
    created_at: now,
    updated_at: now,
  }
  map.set(skill.id, skill)
  saveMockSkills(map)
  return skill
}

export async function mockSaveSkill(
  skill_id: string,
  options?: SaveSkillOptions,
): Promise<Skill | null> {
  const map = loadMockSkills()
  const s = map.get(skill_id)
  if (!s) return null
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  let next: Skill = { ...s, updated_at: now }
  if (options?.title != null) {
    next = { ...next, title: options.title.trim() || '未命名技能' }
  }
  if (options?.skill_type != null) {
    next = { ...next, skill_type: normalizeSkillType(options.skill_type) }
  }
  if (options?.stages != null) {
    const stages = normalizeSkillStages(
      options.stages as Partial<Record<SkillStageId, unknown>>,
    )
    next = {
      ...next,
      stages,
      stage_counts: Object.fromEntries(
        SKILL_STAGE_KEYS.map((stageId) => [stageId, stages[stageId]?.length ?? 0]),
      ) as Partial<Record<SkillStageId, number>>,
      stage_skill_count: SKILL_STAGE_KEYS.reduce(
        (sum, stageId) => sum + (stages[stageId]?.length ?? 0),
        0,
      ),
    }
  }
  map.set(skill_id, next)
  saveMockSkills(map)
  return next
}

export async function mockLoadCommonSkillsToSkill(
  skill_id: string,
): Promise<LoadCommonSkillsResult | null> {
  const map = loadMockSkills()
  const s = map.get(skill_id)
  if (!s) return null
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const stages = normalizeSkillStages(s.stages)
  const result = await appendMissingCommonSkills(stages, now)
  const next: Skill = {
    ...s,
    stages,
    updated_at: result.added_count > 0 ? now : s.updated_at,
  }
  if (result.added_count > 0) {
    map.set(skill_id, next)
    saveMockSkills(map)
  }
  return {
    skill: next,
    ...result,
    already_loaded: result.available_count > 0 && result.added_count === 0,
  }
}

export async function mockDeleteSkill(skill_id: string): Promise<boolean> {
  const map = loadMockSkills()
  const ok = map.delete(skill_id)
  if (ok) {
    saveMockSkills(map)
    const books = loadMock()
    let changed = false
    for (const [bookId, book] of books) {
      if (book.linked_skill_id === skill_id) {
        books.set(bookId, { ...book, linked_skill_id: '' })
        changed = true
      }
    }
    if (changed) saveMock(books)
  }
  return ok
}
