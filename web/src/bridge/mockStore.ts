import {
  defaultExpertDraft,
  isWorkspaceBook,
  mergeStagePatchIntoAll,
  normalizeExpertDraft,
  normalizeStagesForWorkspaceBook,
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
import {
  SCRIPT_MATERIAL_GENRES,
  SHORT_MATERIAL_GENRES,
  SKILL_STAGE_KEYS,
  normalizeBook,
  normalizeBookStatus,
  normalizeBookType,
  normalizeLinkedMaterialIdsByKind,
  normalizeLinkedSkillIdsByKind,
  firstLinkedMaterialId,
  firstLinkedSkillId,
  MATERIAL_KIND_KEYS,
  SKILL_KIND_KEYS,
  SKILL_KIND_STAGE_IDS,
  normalizeMaterial,
  normalizeMaterialKind,
  normalizeMaterialStageItems,
  normalizeMaterialStages,
  normalizeMaterialType,
  normalizeSkill,
  normalizeSkillKind,
  normalizeSkillStages,
  normalizeSkillType,
  materialStageItemsToStages,
  materialMatchesKind,
  normalizeMaterialLibraryGroupMembers,
  normalizeMaterialLibraryGroups,
  normalizeSkillLibraryGroupMembers,
  normalizeSkillLibraryGroups,
  occupiedLibraryIdsFromGroups,
  createLocalMaterialLibraryGroup,
  createLocalSkillLibraryGroup,
  type ImportSkillEntriesResult,
  type Material,
  type MaterialKind,
  type MaterialKindWithMixed,
  type MaterialLibraryGroup,
  type MaterialStageEntry,
  type MaterialStageId,
  type MaterialSummary,
  type Skill,
  type SkillKind,
  type SkillImportSelection,
  type SkillImportSource,
  type SkillLibraryGroup,
  type SkillStageId,
  type SkillSummary,
} from './libraryDomain'

const COMMON_SKILLS_MODULES = import.meta.glob(
  '../../../app/prompt_defaults/skill/common_skills.json',
  { eager: true, import: 'default' },
) as Record<string, { skills?: unknown[] }>

const OFFICIAL_GENERAL_SKILL_LIBRARY_ID = 'official-general-skill-library'
const MOCK_STORAGE_KEY = 'deepseekwrite_dev_books'

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

function normalizeMockLinkedSkillIdsByKind(
  raw: Partial<Record<SkillKind, string[]>> | null | undefined,
  legacySkillId: string | null | undefined,
  bookType: Book['book_type'],
): Partial<Record<SkillKind, string[]>> {
  const out = normalizeLinkedSkillIdsByKind(raw, legacySkillId)
  const skills = loadMockSkills()
  for (const kind of SKILL_KIND_KEYS) {
    out[kind] = (out[kind] ?? []).filter((id) => {
      const skill = skills.get(id)
      return Boolean(
        skill &&
          (skill.is_builtin || skill.skill_type === bookType) &&
          normalizeSkillKind(skill.skill_kind) === kind,
      )
    })
  }
  return out
}

export async function mockListBooks(): Promise<BookSummary[]> {
  const map = loadMock()
  return [...map.values()]
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
    .map(({ id, title, book_type, categories, status, output_dir, linked_material_id, linked_material_ids_by_kind, linked_skill_id, linked_skill_ids_by_kind }) => ({
      id,
      title,
      book_type,
      categories,
      status: normalizeBookStatus(status),
      output_dir,
      linked_material_id,
      linked_material_ids_by_kind,
      linked_skill_id,
      linked_skill_ids_by_kind,
    }))
}

export async function mockCreateBook(
  title: string,
  book_type: string,
  categories: string[],
  workspace_root?: string | null,
  linked_skill_id?: string | null,
  linked_material_id?: string | null,
  linked_material_ids_by_kind?: Partial<Record<MaterialKind, string[]>> | null,
  linked_skill_ids_by_kind?: Partial<Record<SkillKind, string[]>> | null,
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
  const linkedByKind = normalizeLinkedMaterialIdsByKind(
    linked_material_ids_by_kind,
    linked_material_id,
  )
  for (const kind of MATERIAL_KIND_KEYS) {
    linkedByKind[kind] = (linkedByKind[kind] ?? []).filter((id) =>
      loadMockMaterials().has(id),
    )
  }
  const linkedSkillsByKind = isWsBook
    ? normalizeMockLinkedSkillIdsByKind(
        linked_skill_ids_by_kind,
        linked_skill_id,
        bt,
      )
    : {}
  const book: Book = {
    id: randomId(),
    title: title.trim() || '未命名',
    book_type: bt,
    categories: bt === 'short' || bt === 'script' ? [...categories] : [],
    status: 'editing',
    content: '',
    output_dir,
    linked_material_id: isWsBook ? firstLinkedMaterialId(linkedByKind) : '',
    linked_material_ids_by_kind: isWsBook ? linkedByKind : {},
    linked_skill_id: isWsBook ? firstLinkedSkillId(linkedSkillsByKind) : '',
    linked_skill_ids_by_kind: linkedSkillsByKind,
    stages: normalizeStagesForWorkspaceBook({ book_type: bt }, {}),
    expert_draft: defaultExpertDraft(bt),
    memories: [],
    memory_auto_capture_enabled: true,
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
    stages: normalizeStagesForWorkspaceBook(book, book.stages),
    expert_draft: normalizeExpertDraft(book.expert_draft, false, book.book_type),
  }
}

export async function mockSaveBook(
  book_id: string,
  options: {
    content?: string | null
    stages?: Record<string, string> | null
    linked_material_id?: string | null
    linked_material_ids_by_kind?: Partial<Record<MaterialKind, string[]>> | null
    linked_skill_id?: string | null
    linked_skill_ids_by_kind?: Partial<Record<SkillKind, string[]>> | null
    expert_draft?: ExpertDraft | null
    title?: string | null
    status?: BookStatus | null
    memory_auto_capture_enabled?: boolean | null
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
    const merged = mergeStagePatchIntoAll(
      b.stages,
      options.stages as Partial<Record<StageId, string>>,
      next,
    )
    next = { ...next, stages: merged, content: merged[primaryDraftStageId(next)] ?? '' }
  } else if (options.content != null) {
    next = { ...next, content: options.content }
  }
  if (options.linked_material_id !== undefined) {
    const mid = options.linked_material_id?.trim() ?? ''
    const linkedByKind = normalizeLinkedMaterialIdsByKind(null, mid)
    for (const kind of MATERIAL_KIND_KEYS) {
      linkedByKind[kind] = (linkedByKind[kind] ?? []).filter((id) =>
        loadMockMaterials().has(id),
      )
    }
    next = {
      ...next,
      linked_material_id: firstLinkedMaterialId(linkedByKind),
      linked_material_ids_by_kind: linkedByKind,
    }
  }
  if (options.linked_material_ids_by_kind !== undefined) {
    const linkedByKind = normalizeLinkedMaterialIdsByKind(
      options.linked_material_ids_by_kind,
      null,
    )
    for (const kind of MATERIAL_KIND_KEYS) {
      linkedByKind[kind] = (linkedByKind[kind] ?? []).filter((id) =>
        loadMockMaterials().has(id),
      )
    }
    next = {
      ...next,
      linked_material_id: firstLinkedMaterialId(linkedByKind),
      linked_material_ids_by_kind: linkedByKind,
    }
  }
  if (options.linked_skill_id !== undefined) {
    const sid = options.linked_skill_id?.trim() ?? ''
    const linkedSkillsByKind = isWorkspaceBook(next)
      ? normalizeMockLinkedSkillIdsByKind(null, sid, next.book_type)
      : {}
    next = {
      ...next,
      linked_skill_id: firstLinkedSkillId(linkedSkillsByKind),
      linked_skill_ids_by_kind: linkedSkillsByKind,
    }
  }
  if (options.linked_skill_ids_by_kind !== undefined) {
    const linkedSkillsByKind = isWorkspaceBook(next)
      ? normalizeMockLinkedSkillIdsByKind(
          options.linked_skill_ids_by_kind,
          null,
          next.book_type,
        )
      : {}
    next = {
      ...next,
      linked_skill_id: firstLinkedSkillId(linkedSkillsByKind),
      linked_skill_ids_by_kind: linkedSkillsByKind,
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
  if (options.memory_auto_capture_enabled != null) {
    next = {
      ...next,
      memory_auto_capture_enabled: Boolean(options.memory_auto_capture_enabled),
    }
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

const MOCK_MATERIALS_KEY = 'deepseekwrite_dev_materials'

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
    .map(({ id, title, material_type, material_kind, parent_genre, sub_genre, output_dir }) => ({
      id,
      title,
      material_type,
      material_kind,
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
  material_kind?: MaterialKindWithMixed | null,
): Promise<Material> {
  void sub_genre
  const map = loadMockMaterials()
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const mt = normalizeMaterialType(material_type)
  const material: Material = {
    id: randomId(),
    title: title.trim() || '未命名素材',
    material_type: mt,
    material_kind: normalizeMaterialKind(material_kind, 'mixed'),
    parent_genre: mt === 'short' || mt === 'script' ? (parent_genre || '') : '',
    sub_genre: '',
    overview: '',
    stages: normalizeMaterialStages({}),
    stage_items: normalizeMaterialStageItems({}),
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
  stage_items?: Partial<Record<MaterialStageId, MaterialStageEntry[]>> | null,
  overview?: string | null,
): Promise<Material | null> {
  const map = loadMockMaterials()
  const m = map.get(material_id)
  if (!m) return null
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  let next: Material = { ...m, updated_at: now }
  if (title != null) {
    next = { ...next, title: title.trim() }
  }
  if (overview != null) {
    next = { ...next, overview }
  }
  if (stage_items != null) {
    const normalizedItems = normalizeMaterialStageItems(stage_items)
    next = {
      ...next,
      stage_items: normalizedItems,
      stages: materialStageItemsToStages(normalizedItems),
    }
  } else if (stages != null) {
    const normalized = normalizeMaterialStages(stages as Partial<Record<MaterialStageId, string>>)
    const normalizedItems = normalizeMaterialStageItems(null, normalized)
    next = {
      ...next,
      stages: normalized,
      stage_items: normalizedItems,
    }
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
      const linkedByKind = normalizeLinkedMaterialIdsByKind(
        book.linked_material_ids_by_kind,
        book.linked_material_id,
      )
      let removed = book.linked_material_id === material_id
      for (const kind of MATERIAL_KIND_KEYS) {
        const previous = linkedByKind[kind] ?? []
        linkedByKind[kind] = previous.filter((id) => id !== material_id)
        if (linkedByKind[kind].length !== previous.length) removed = true
      }
      if (removed) {
        books.set(bookId, {
          ...book,
          linked_material_id: firstLinkedMaterialId(linkedByKind),
          linked_material_ids_by_kind: linkedByKind,
        })
        changed = true
      }
    }
    if (changed) saveMock(books)
    removeMaterialIdFromMockGroups(material_id)
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

const MOCK_SKILLS_KEY = 'deepseekwrite_dev_skills'

export function loadMockSkills(): Map<string, Skill> {
  try {
    const raw = localStorage.getItem(MOCK_SKILLS_KEY)
    if (!raw) {
      const seeded = new Map<string, Skill>()
      ensureOfficialMockSkill(seeded)
      saveMockSkills(seeded)
      return seeded
    }
    const arr = JSON.parse(raw) as Array<Partial<Skill> & { id: string; stages?: unknown }>
    const map = new Map(arr.map((s) => [s.id, normalizeSkill(s)]))
    if (ensureOfficialMockSkill(map)) saveMockSkills(map)
    return map
  } catch {
    const seeded = new Map<string, Skill>()
    ensureOfficialMockSkill(seeded)
    return seeded
  }
}

function ensureOfficialMockSkill(map: Map<string, Skill>): boolean {
  const existing = map.get(OFFICIAL_GENERAL_SKILL_LIBRARY_ID)
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const createdAt = existing?.created_at || now
  const updatedAt = existing?.updated_at || createdAt
  const stages = normalizeSkillStages({})
  const rawSkills = Object.values(COMMON_SKILLS_MODULES)[0]?.skills
  for (const raw of Array.isArray(rawSkills) ? rawSkills : []) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as { id?: unknown; title?: unknown; body?: unknown; effective_stages?: unknown }
    const entryId = typeof item.id === 'string' && item.id ? item.id : randomId()
    const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : '未命名技能'
    const body = typeof item.body === 'string' ? item.body : ''
    for (const stageId of Array.isArray(item.effective_stages) ? item.effective_stages : []) {
      if (!SKILL_STAGE_KEYS.includes(stageId as SkillStageId)) continue
      stages[stageId as SkillStageId].push({
        id: entryId,
        title,
        body,
        created_at: createdAt,
        updated_at: updatedAt,
      })
    }
  }
  const expected = normalizeSkill({
    id: OFFICIAL_GENERAL_SKILL_LIBRARY_ID,
    title: '官方内置通用技能库',
    skill_type: 'short',
    skill_kind: 'general',
    is_builtin: true,
    overview: '官方提供的通用写作技能，仅供加载和使用。',
    stages,
    created_at: createdAt,
    updated_at: updatedAt,
  } as Parameters<typeof normalizeSkill>[0])
  if (existing && JSON.stringify(existing) === JSON.stringify(expected)) return false
  map.set(OFFICIAL_GENERAL_SKILL_LIBRARY_ID, expected)
  return true
}

function saveMockSkills(map: Map<string, Skill>) {
  localStorage.setItem(MOCK_SKILLS_KEY, JSON.stringify([...map.values()]))
}

export async function mockListSkills(): Promise<SkillSummary[]> {
  const map = loadMockSkills()
  return [...map.values()]
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
    .map(({ id, title, skill_type, skill_kind, is_builtin, stages, output_dir }) => ({
      id,
      title,
      skill_type,
      skill_kind,
      is_builtin,
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
  skill_kind: SkillKind = 'general',
): Promise<Skill> {
  const map = loadMockSkills()
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const kind = normalizeSkillKind(skill_kind)
  const stages = normalizeSkillStages({})
  const skill: Skill = {
    id: randomId(),
    title: title.trim() || '未命名技能',
    skill_type: normalizeSkillType(skill_type),
    skill_kind: kind,
    overview: '',
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
  if (s.is_builtin) throw new Error('官方内置通用技能库为只读，不能修改')
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  let next: Skill = { ...s, updated_at: now }
  if (options?.title != null) {
    next = { ...next, title: options.title.trim() || '未命名技能' }
  }
  if (options?.skill_type != null) {
    next = { ...next, skill_type: normalizeSkillType(options.skill_type) }
  }
  if (options?.skill_kind != null) {
    next = { ...next, skill_kind: normalizeSkillKind(options.skill_kind) }
  }
  if (options?.overview != null) {
    next = { ...next, overview: options.overview }
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

export async function mockListSkillImportSources(
  target_skill_id: string,
): Promise<SkillImportSource[]> {
  const map = loadMockSkills()
  const target = map.get(target_skill_id)
  if (!target) return []
  const allowed = new Set(SKILL_KIND_STAGE_IDS[normalizeSkillKind(target.skill_kind)])
  return [...map.values()]
    .filter((source) => source.id !== target.id)
    .map((source) => ({
      id: source.id,
      title: source.title,
      skill_type: source.skill_type,
      skill_kind: source.skill_kind,
      is_builtin: Boolean(source.is_builtin),
      stages: Object.fromEntries(
        SKILL_STAGE_KEYS.flatMap((stageId) => {
          const entries = source.stages[stageId] ?? []
          return allowed.has(stageId) && entries.length > 0
            ? [[stageId, entries.map(({ id, title }) => ({ id, title }))]]
            : []
        }),
      ) as Partial<Record<SkillStageId, { id: string; title: string }[]>>,
    }))
    .filter((source) => Object.keys(source.stages).length > 0)
    .sort((a, b) => Number(b.is_builtin) - Number(a.is_builtin) || a.title.localeCompare(b.title))
}

export async function mockImportSkillEntries(
  target_skill_id: string,
  selections: SkillImportSelection[],
): Promise<ImportSkillEntriesResult | null> {
  const map = loadMockSkills()
  const target = map.get(target_skill_id)
  if (!target) return null
  if (target.is_builtin) throw new Error('官方内置通用技能库为只读，不能写入技能')
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const allowed = new Set(SKILL_KIND_STAGE_IDS[normalizeSkillKind(target.skill_kind)])
  let added_count = 0
  let skipped_count = 0
  const seen = new Set<string>()
  for (const selection of selections) {
    const key = `${selection.source_skill_id}:${selection.stage_id}:${selection.entry_id}`
    if (seen.has(key) || !allowed.has(selection.stage_id)) {
      skipped_count += 1
      continue
    }
    seen.add(key)
    const source = map.get(selection.source_skill_id)
    const entry = source?.stages[selection.stage_id]?.find((item) => item.id === selection.entry_id)
    if (!source || source.id === target.id || !entry) {
      skipped_count += 1
      continue
    }
    const targetEntries = target.stages[selection.stage_id] ?? []
    const duplicate = targetEntries.some((item) =>
      item.source_skill_id === source.id && item.source_skill_entry_id === entry.id,
    ) || (
      source.id === OFFICIAL_GENERAL_SKILL_LIBRARY_ID
      && targetEntries.some((item) => item.source_common_skill_id === entry.id)
    )
    if (duplicate) {
      skipped_count += 1
      continue
    }
    targetEntries.push({
      id: randomId(),
      title: entry.title,
      body: entry.body,
      created_at: now,
      updated_at: now,
      source_skill_id: source.id,
      source_skill_entry_id: entry.id,
    })
    target.stages[selection.stage_id] = targetEntries
    added_count += 1
  }
  const next: Skill = {
    ...target,
    stages: normalizeSkillStages(target.stages),
    updated_at: added_count > 0 ? now : target.updated_at,
  }
  if (added_count > 0) {
    map.set(target_skill_id, next)
    saveMockSkills(map)
  }
  return {
    skill: next,
    added_count,
    skipped_count,
  }
}

export async function mockDeleteSkill(skill_id: string): Promise<boolean> {
  const map = loadMockSkills()
  if (map.get(skill_id)?.is_builtin) return false
  const ok = map.delete(skill_id)
  if (ok) {
    saveMockSkills(map)
    const books = loadMock()
    let changed = false
    for (const [bookId, book] of books) {
      const linkedByKind = normalizeLinkedSkillIdsByKind(
        book.linked_skill_ids_by_kind,
        book.linked_skill_id,
      )
      const nextByKind = { ...linkedByKind }
      for (const kind of SKILL_KIND_KEYS) {
        nextByKind[kind] = (nextByKind[kind] ?? []).filter((id) => id !== skill_id)
      }
      const nextLegacy = firstLinkedSkillId(nextByKind)
      if (
        book.linked_skill_id === skill_id ||
        nextLegacy !== book.linked_skill_id ||
        JSON.stringify(nextByKind) !== JSON.stringify(linkedByKind)
      ) {
        books.set(bookId, {
          ...book,
          linked_skill_id: nextLegacy,
          linked_skill_ids_by_kind: nextByKind,
        })
        changed = true
      }
    }
    if (changed) saveMock(books)
    removeSkillIdFromMockGroups(skill_id)
  }
  return ok
}

// ==================== 素材/技能库分组 Mock ====================

const MOCK_MATERIAL_GROUPS_KEY = 'deepseekwrite_dev_material_library_groups'
const MOCK_SKILL_GROUPS_KEY = 'deepseekwrite_dev_skill_library_groups'

function loadMockMaterialGroups(): MaterialLibraryGroup[] {
  try {
    const raw = localStorage.getItem(MOCK_MATERIAL_GROUPS_KEY)
    if (!raw) return []
    return normalizeMaterialLibraryGroups(JSON.parse(raw))
  } catch {
    return []
  }
}

function saveMockMaterialGroups(groups: MaterialLibraryGroup[]) {
  localStorage.setItem(MOCK_MATERIAL_GROUPS_KEY, JSON.stringify(groups))
}

function loadMockSkillGroups(): SkillLibraryGroup[] {
  try {
    const raw = localStorage.getItem(MOCK_SKILL_GROUPS_KEY)
    if (!raw) return []
    return normalizeSkillLibraryGroups(JSON.parse(raw))
  } catch {
    return []
  }
}

function saveMockSkillGroups(groups: SkillLibraryGroup[]) {
  localStorage.setItem(MOCK_SKILL_GROUPS_KEY, JSON.stringify(groups))
}

function removeMaterialIdFromMockGroups(materialId: string) {
  const groups = loadMockMaterialGroups()
  let changed = false
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const next = groups.map((group) => {
    const members = { ...group.members }
    let groupChanged = false
    for (const kind of MATERIAL_KIND_KEYS) {
      if (members[kind] === materialId) {
        delete members[kind]
        groupChanged = true
      }
    }
    if (!groupChanged) return group
    changed = true
    return { ...group, members, updated_at: now }
  })
  if (changed) saveMockMaterialGroups(next)
}

function removeSkillIdFromMockGroups(skillId: string) {
  const groups = loadMockSkillGroups()
  let changed = false
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const next = groups.map((group) => {
    const members = { ...group.members }
    let groupChanged = false
    for (const kind of SKILL_KIND_KEYS) {
      if (members[kind] === skillId) {
        delete members[kind]
        groupChanged = true
      }
    }
    if (!groupChanged) return group
    changed = true
    return { ...group, members, updated_at: now }
  })
  if (changed) saveMockSkillGroups(next)
}

export async function mockListMaterialLibraryGroups(): Promise<MaterialLibraryGroup[]> {
  return loadMockMaterialGroups().sort((a, b) =>
    (b.updated_at || '').localeCompare(a.updated_at || ''),
  )
}

export async function mockCreateMaterialLibraryGroup(
  title: string,
  members?: Partial<Record<MaterialKind, string>> | null,
): Promise<MaterialLibraryGroup> {
  const name = title.trim()
  if (!name) throw new Error('分组名称不能为空')
  const normalized = normalizeMaterialLibraryGroupMembers(members)
  if (Object.keys(normalized).length === 0) throw new Error('请至少选择一个素材库')
  const materials = loadMockMaterials()
  const groups = loadMockMaterialGroups()
  const occupied = occupiedLibraryIdsFromGroups(groups)
  for (const [kind, mid] of Object.entries(normalized) as Array<[MaterialKind, string]>) {
    const material = materials.get(mid)
    if (!material) throw new Error(`素材库不存在：${mid}`)
    if (!materialMatchesKind(material, kind)) {
      throw new Error(`素材库「${material.title}」不能放入${kind}部门`)
    }
    if (occupied.has(mid)) {
      throw new Error(`素材库「${material.title}」已在其他分组中`)
    }
  }
  const group = createLocalMaterialLibraryGroup(name, normalized)
  groups.push(group)
  saveMockMaterialGroups(groups)
  return group
}

export async function mockUpdateMaterialLibraryGroup(
  groupId: string,
  title?: string | null,
  members?: Partial<Record<MaterialKind, string>> | null,
): Promise<MaterialLibraryGroup | null> {
  const groups = loadMockMaterialGroups()
  const index = groups.findIndex((g) => g.id === groupId)
  if (index < 0) return null
  const current = { ...groups[index] }
  if (title != null) {
    const name = title.trim()
    if (!name) throw new Error('分组名称不能为空')
    current.title = name
  }
  if (members != null) {
    const normalized = normalizeMaterialLibraryGroupMembers(members)
    if (Object.keys(normalized).length === 0) throw new Error('请至少选择一个素材库')
    const materials = loadMockMaterials()
    const occupied = occupiedLibraryIdsFromGroups(groups, groupId)
    for (const [kind, mid] of Object.entries(normalized) as Array<[MaterialKind, string]>) {
      const material = materials.get(mid)
      if (!material) throw new Error(`素材库不存在：${mid}`)
      if (!materialMatchesKind(material, kind)) {
        throw new Error(`素材库「${material.title}」不能放入${kind}部门`)
      }
      if (occupied.has(mid)) {
        throw new Error(`素材库「${material.title}」已在其他分组中`)
      }
    }
    current.members = normalized
  }
  current.updated_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  groups[index] = current
  saveMockMaterialGroups(groups)
  return current
}

export async function mockDeleteMaterialLibraryGroup(groupId: string): Promise<boolean> {
  const groups = loadMockMaterialGroups()
  const next = groups.filter((g) => g.id !== groupId)
  if (next.length === groups.length) return false
  saveMockMaterialGroups(next)
  return true
}

export async function mockListSkillLibraryGroups(): Promise<SkillLibraryGroup[]> {
  return loadMockSkillGroups().sort((a, b) =>
    (b.updated_at || '').localeCompare(a.updated_at || ''),
  )
}

export async function mockCreateSkillLibraryGroup(
  title: string,
  members?: Partial<Record<SkillKind, string>> | null,
): Promise<SkillLibraryGroup> {
  const name = title.trim()
  if (!name) throw new Error('分组名称不能为空')
  const normalized = normalizeSkillLibraryGroupMembers(members)
  if (Object.keys(normalized).length === 0) throw new Error('请至少选择一个技能库')
  const skills = loadMockSkills()
  const groups = loadMockSkillGroups()
  const occupied = occupiedLibraryIdsFromGroups(groups)
  for (const [kind, sid] of Object.entries(normalized) as Array<[SkillKind, string]>) {
    const skill = skills.get(sid)
    if (!skill) throw new Error(`技能库不存在：${sid}`)
    if (skill.skill_kind !== kind) {
      throw new Error(`技能库「${skill.title}」不能放入${kind}分类`)
    }
    if (occupied.has(sid)) {
      throw new Error(`技能库「${skill.title}」已在其他分组中`)
    }
  }
  const group = createLocalSkillLibraryGroup(name, normalized)
  groups.push(group)
  saveMockSkillGroups(groups)
  return group
}

export async function mockUpdateSkillLibraryGroup(
  groupId: string,
  title?: string | null,
  members?: Partial<Record<SkillKind, string>> | null,
): Promise<SkillLibraryGroup | null> {
  const groups = loadMockSkillGroups()
  const index = groups.findIndex((g) => g.id === groupId)
  if (index < 0) return null
  const current = { ...groups[index] }
  if (title != null) {
    const name = title.trim()
    if (!name) throw new Error('分组名称不能为空')
    current.title = name
  }
  if (members != null) {
    const normalized = normalizeSkillLibraryGroupMembers(members)
    if (Object.keys(normalized).length === 0) throw new Error('请至少选择一个技能库')
    const skills = loadMockSkills()
    const occupied = occupiedLibraryIdsFromGroups(groups, groupId)
    for (const [kind, sid] of Object.entries(normalized) as Array<[SkillKind, string]>) {
      const skill = skills.get(sid)
      if (!skill) throw new Error(`技能库不存在：${sid}`)
      if (skill.skill_kind !== kind) {
        throw new Error(`技能库「${skill.title}」不能放入${kind}分类`)
      }
      if (occupied.has(sid)) {
        throw new Error(`技能库「${skill.title}」已在其他分组中`)
      }
    }
    current.members = normalized
  }
  current.updated_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  groups[index] = current
  saveMockSkillGroups(groups)
  return current
}

export async function mockDeleteSkillLibraryGroup(groupId: string): Promise<boolean> {
  const groups = loadMockSkillGroups()
  const next = groups.filter((g) => g.id !== groupId)
  if (next.length === groups.length) return false
  saveMockSkillGroups(next)
  return true
}
