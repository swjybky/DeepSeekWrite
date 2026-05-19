export type BookType = 'short' | 'long'

// 统一短篇阶段定义
import {
  SHORT_WORKSPACE_STAGES,
  type ShortStageId,
  normalizeShortStages,
  migrateLegacyStages,
} from './workspaces/short/stages'

// 提示词目录映射
import {
  type PromptKind,
  isQingganShortBook,
  isShiqingShortBook,
  isWorkspaceShortBook,
  resolvePromptKind,
} from './workspaces/resolvePromptKind'

import { getEmbeddedPromptTemplate } from './prompt/embeddedDefaults'
import { renderPromptFromTemplateRaw } from './prompt/renderTemplate'

export type { ShortStageId, PromptKind }
export {
  isQingganShortBook,
  isShiqingShortBook,
  isWorkspaceShortBook,
  resolvePromptKind,
}

// 统一阶段ID类型
export type StageId = ShortStageId

// 导出统一阶段定义
export const WORKSPACE_STAGES = SHORT_WORKSPACE_STAGES

/** 短篇可选分类（可扩展） */
export const SHORT_GENRE_OPTIONS = ['世情', '现实情感'] as const

/** 获取统一阶段列表（所有短篇书籍使用同一套阶段） */
export function resolveWorkspaceStagesForBook(
  _book?: Pick<Book, 'book_type' | 'categories'>,
): typeof SHORT_WORKSPACE_STAGES {
  // 不再区分世情和情感，统一返回 SHORT_WORKSPACE_STAGES
  void _book
  return SHORT_WORKSPACE_STAGES
}

/** 两端存储中的「全字段」工作台 stages（统一阶段键） */
export function normalizeAllBookStages(
  raw?: Partial<Record<StageId, string>> | null,
): Record<StageId, string> {
  return normalizeShortStages(raw)
}

/** 仅当前工作台在用的阶段子集（用于编辑区 state） */
export function normalizeStagesForWorkspaceBook(
  _book?: Pick<Book, 'book_type' | 'categories'>,
  raw?: Partial<Record<StageId, string>> | null,
): Record<StageId, string> {
  // _book 参数保留用于向后兼容，已不再需要
  void _book
  // 迁移旧数据
  const migrated = migrateLegacyStages(raw)
  // 归一化到统一阶段
  return normalizeShortStages(migrated)
}

/** 把部分阶段更新合并进完整存储，未出现的键保持原样 */
export function mergeStagePatchIntoAll(
  previous: Partial<Record<StageId, string>> | undefined,
  patch: Partial<Record<StageId, string>>,
): Record<StageId, string> {
  const next = normalizeAllBookStages(previous)
  // 对patch也进行迁移
  const migratedPatch = migrateLegacyStages(patch)
  for (const [k, v] of Object.entries(migratedPatch)) {
    if (k in next) {
      next[k as StageId] = String(v ?? '')
    }
  }
  return next
}

function primaryDraftStageId(
  _book?: Pick<Book, 'book_type' | 'categories'>,
): StageId {
  // 统一使用 "draft"
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
  /** 本机落地目录，空表示未指定 */
  output_dir?: string
  /** 写书工作台关联的素材库 id，空表示未关联 */
  linked_material_id?: string
}

export interface Book extends BookSummary {
  content: string
  stages?: Partial<Record<StageId, string>>
  created_at?: string
  updated_at?: string
}

// ==================== 素材类型定义 ====================

export type MaterialType = 'long' | 'short'

export type MaterialStageId = 'character' | 'gimmick' | 'pacing'

export const MATERIAL_STAGE_LABELS: Record<MaterialStageId, string> = {
  character: '人设素材',
  gimmick: '梗素材',
  pacing: '节奏素材',
}

export const SHORT_MATERIAL_GENRES: Record<string, string[]> = {
  '世情': ['家庭', '职场', '婚恋', '邻里', '亲子', '继承', '养老'],
  '情感': ['甜宠', '虐恋', '重生', '穿越', '暗恋', '破镜重圆', '先婚后爱'],
}

export interface MaterialSummary {
  id: string
  title: string
  material_type: MaterialType
  parent_genre?: string  // 世情/情感（仅short时有效）
  sub_genre?: string     // 子分类
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
    gimmick: '',
    pacing: '',
  }
  if (!raw) return out
  for (const k of Object.keys(out) as MaterialStageId[]) {
    if (k in raw) out[k] = String(raw[k] ?? '')
  }
  return out
}

/** 与 app/.env 对应，由桌面壳 get_ai_defaults 注入 */
export interface AiModelDefaults {
  provider: string
  model_id: string
  api_key: string
  /**
   * 可选快速模型 ID（对应 app/.env 的 model_name_flash）；
   * 鉴权始终与 `model_id` 相同，共用同一条 `api_key`（无单独 flash 密钥字段）。
   * 未配置时前端旁路回退为与 `model_id` 相同。
   */
  model_id_flash?: string
}

declare global {
  interface Window {
    /** API 在 pywebviewready 之后才可用 */
    pywebview?: {
      api?: {
        list_books(): Promise<BookSummary[]>
        pick_folder(): Promise<string | null>
        create_book(
          title: string,
          book_type: string,
          categories: string[],
          workspace_root?: string | null,
        ): Promise<Book>
        get_book(book_id: string): Promise<Book | null>
        save_book(
          book_id: string,
          content?: string | null,
          stages?: Record<string, string> | null,
          linked_material_id?: string | null,
        ): Promise<Book | null>
        delete_book(book_id: string): Promise<boolean>
        /** 上次选定的工作文件夹（持久化在应用 .data/preferences.json） */
        get_workspace_root(): Promise<string | null>
        set_workspace_root(path: string | null): Promise<void>
        /** app/.env 中的默认模型与 Key；未配置完整时返回 null */
        get_ai_defaults(): Promise<AiModelDefaults | null>

        /** 渲染工作台系统提示词（磁盘默认 + `.data/prompt_overrides`，占位符服务端替换）。 */
        get_workspace_system_prompt(
          prompt_kind: string,
          stage_id: string,
          context_json: string,
        ): Promise<string>
        /** 读取当前生效的模板原文（便于侧栏编辑器）。 */
        read_workspace_prompt_template(
          prompt_kind: string,
          stage_id: string,
        ): Promise<string>
        save_workspace_prompt_override(
          prompt_kind: string,
          stage_id: string,
          body: string,
        ): Promise<void>
        reset_workspace_prompt_override(
          prompt_kind: string,
          stage_id: string,
        ): Promise<boolean>

        // ==================== 素材库 API ====================
        list_materials(): Promise<MaterialSummary[]>
        get_material(material_id: string): Promise<Material | null>
        create_material(
          title: string,
          material_type: string,
          parent_genre?: string | null,
          sub_genre?: string | null,
          workspace_root?: string | null,
        ): Promise<Material>
        save_material(
          material_id: string,
          stages?: Record<string, string> | null,
        ): Promise<Material | null>
        delete_material(material_id: string): Promise<boolean>
        get_material_genres(): Promise<Record<string, string[]>>
      }
    }
  }
}

const MOCK_STORAGE_KEY = 'write_claw_dev_books'

/** 书架「工作文件夹」持久化键（浏览器 / pywebview 同源存储） */
export const WORKSPACE_ROOT_STORAGE_KEY = 'write_claw_workspace_root'

/** 与 main.tsx boot 一致：桌面壳加载的打包页（含本机 HTTP + `?pywebview=1`） */
export function isPywebviewDesktopBundle(): boolean {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return window.location.protocol === 'file:' || params.get('pywebview') === '1'
}

export function getStoredWorkspaceRoot(): string | null {
  try {
    const v = localStorage.getItem(WORKSPACE_ROOT_STORAGE_KEY)
    return v?.trim() ? v.trim() : null
  } catch {
    return null
  }
}

export function setStoredWorkspaceRoot(path: string | null): void {
  try {
    if (path?.trim()) localStorage.setItem(WORKSPACE_ROOT_STORAGE_KEY, path.trim())
    else localStorage.removeItem(WORKSPACE_ROOT_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * 启动时解析工作文件夹：桌面端以 Python 持久化为准；若无则从 localStorage 读取并写回磁盘。
 * 纯浏览器开发仅使用 localStorage。
 *
 * 桌面壳里偶发首帧早于 `api` 注入：先让出 1～2 帧再取桥接；若 `get_workspace_root` 抛错则短重试（避免误显示「未选择」）。
 * 不在「无 api」时循环调用 getBridgeApi，以免重复触发长时间解析。
 */
export async function loadPersistedWorkspaceRoot(): Promise<string | null> {
  const fromLs = getStoredWorkspaceRoot()
  const desktop = isPywebviewDesktopBundle()
  if (desktop) {
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
  }

  const api = await getBridgeApi()
  if (!api?.get_workspace_root || !api?.set_workspace_root) {
    return fromLs
  }

  const attempts = desktop ? 8 : 1
  const delayMs = 100

  for (let i = 0; i < attempts; i++) {
    try {
      const fromDisk = await api.get_workspace_root()
      if (typeof fromDisk === 'string' && fromDisk.trim()) {
        const t = fromDisk.trim()
        setStoredWorkspaceRoot(t)
        return t
      }
      if (fromLs) {
        await api.set_workspace_root(fromLs)
        return fromLs
      }
      return null
    } catch {
      if (desktop && i < attempts - 1) {
        await new Promise<void>((r) => setTimeout(r, delayMs))
        continue
      }
      return fromLs
    }
  }
  return fromLs
}

/** 选择或更改工作文件夹后调用，同步 localStorage 与桌面端 preferences.json */
export async function persistWorkspaceRoot(path: string | null): Promise<void> {
  setStoredWorkspaceRoot(path)
  const api = await getBridgeApi()
  if (api?.set_workspace_root) {
    await api.set_workspace_root(path)
  }
}

function loadMock(): Map<string, Book> {
  try {
    const raw = localStorage.getItem(MOCK_STORAGE_KEY)
    if (!raw) return new Map()
    const arr = JSON.parse(raw) as Book[]
    return new Map(arr.map((b) => [b.id, b]))
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

async function mockListBooks(): Promise<BookSummary[]> {
  const map = loadMock()
  return [...map.values()]
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
    .map(({ id, title, book_type, categories, output_dir, linked_material_id }) => ({
      id,
      title,
      book_type,
      categories,
      output_dir,
      linked_material_id,
    }))
}

async function mockCreateBook(
  title: string,
  book_type: string,
  categories: string[],
  workspace_root?: string | null,
): Promise<Book> {
  const map = loadMock()
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const bt: BookType = book_type === 'short' ? 'short' : 'long'
  const ws = (workspace_root ?? '').trim()
  const safeName = (title.trim() || '未命名').replace(/[<>:"/\\|?*\n\r\t]/g, '_').trim() || '未命名'
  const output_dir =
    ws.length > 0
      ? `${ws.replace(/[/\\]+$/, '')}${typeof window !== 'undefined' && window.navigator.userAgent.includes('Win') ? '\\' : '/'}${safeName}`
      : undefined
  const book: Book = {
    id: randomId(),
    title: title.trim() || '未命名',
    book_type: bt,
    categories: bt === 'short' ? [...categories] : [],
    content: '',
    output_dir,
    linked_material_id: '',
    stages: normalizeAllBookStages({}),
    created_at: now,
    updated_at: now,
  }
  map.set(book.id, book)
  saveMock(map)
  return book
}

async function mockGetBook(book_id: string): Promise<Book | null> {
  return loadMock().get(book_id) ?? null
}

async function mockSaveBook(
  book_id: string,
  options: {
    content?: string | null
    stages?: Record<string, string> | null
    linked_material_id?: string | null
  },
): Promise<Book | null> {
  const map = loadMock()
  const b = map.get(book_id)
  if (!b) return null
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  let next: Book = { ...b, updated_at: now }
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
  map.set(book_id, next)
  saveMock(map)
  return next
}

async function mockDeleteBook(book_id: string): Promise<boolean> {
  const map = loadMock()
  const ok = map.delete(book_id)
  if (ok) saveMock(map)
  return ok
}

// ==================== 素材 Mock 数据 ====================

const MOCK_MATERIALS_KEY = 'write_claw_dev_materials'

function loadMockMaterials(): Map<string, Material> {
  try {
    const raw = localStorage.getItem(MOCK_MATERIALS_KEY)
    if (!raw) return new Map()
    const arr = JSON.parse(raw) as Material[]
    return new Map(arr.map((m) => [m.id, m]))
  } catch {
    return new Map()
  }
}

function saveMockMaterials(map: Map<string, Material>) {
  localStorage.setItem(MOCK_MATERIALS_KEY, JSON.stringify([...map.values()]))
}

async function mockListMaterials(): Promise<MaterialSummary[]> {
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

async function mockGetMaterial(material_id: string): Promise<Material | null> {
  return loadMockMaterials().get(material_id) ?? null
}

async function mockCreateMaterial(
  title: string,
  material_type: string,
  parent_genre?: string | null,
  sub_genre?: string | null,
): Promise<Material> {
  const map = loadMockMaterials()
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const mt: MaterialType = material_type === 'long' ? 'long' : 'short'
  const material: Material = {
    id: randomId(),
    title: title.trim() || '未命名素材',
    material_type: mt,
    parent_genre: mt === 'short' ? (parent_genre || '') : '',
    sub_genre: mt === 'short' ? (sub_genre || '') : '',
    stages: normalizeMaterialStages({}),
    created_at: now,
    updated_at: now,
  }
  map.set(material.id, material)
  saveMockMaterials(map)
  return material
}

async function mockSaveMaterial(
  material_id: string,
  stages?: Record<string, string> | null,
): Promise<Material | null> {
  const map = loadMockMaterials()
  const m = map.get(material_id)
  if (!m) return null
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  let next: Material = { ...m, updated_at: now }
  if (stages != null) {
    const normalized = normalizeMaterialStages(stages as Partial<Record<MaterialStageId, string>>)
    next = { ...next, stages: normalized }
  }
  map.set(material_id, next)
  saveMockMaterials(map)
  return next
}

async function mockDeleteMaterial(material_id: string): Promise<boolean> {
  const map = loadMockMaterials()
  const ok = map.delete(material_id)
  if (ok) saveMockMaterials(map)
  return ok
}

async function mockGetMaterialGenres(): Promise<Record<string, string[]>> {
  return { ...SHORT_MATERIAL_GENRES }
}

type BridgeApi = NonNullable<typeof window.pywebview>['api']

/** 已成功拿到的 Python API，避免重复等待 */
let memoApi: BridgeApi | null = null
/** 已确认是纯浏览器（无 pywebview），避免每次列表都轮询 */
let memoBrowserOnly = false

const PYWEBVIEW_READY = 'pywebviewready'

/** 等待 pywebviewready / 首轮超时；桌面生产包给足冷启动时间 */
const BRIDGE_WAIT_MS = import.meta.env.DEV ? 2_000 : 15_000

/** pywebview 对象已出现但 api 仍晚几帧注入时，继续轮询 */
const API_ATTACH_POLL_MS = import.meta.env.DEV ? 3_000 : 15_000
const API_ATTACH_POLL_STEP_MS = 50

/** 单次桥接解析（并发调用共享同一 Promise，避免抢先返回 mock） */
let bridgeWaitSingleton: Promise<BridgeApi | undefined> | null = null

function readBridgeApi(): BridgeApi | undefined {
  return window.pywebview?.api
}

async function resolveBridgeApiOnce(): Promise<BridgeApi | undefined> {
  const read = readBridgeApi

  if (read()) {
    memoApi = read()!
    return memoApi
  }

  if (typeof window.pywebview === 'undefined') {
    for (let i = 0; i < 60; i++) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
      if (typeof window.pywebview !== 'undefined') break
    }
  }

  if (read()) {
    memoApi = read()!
    return memoApi
  }

  await new Promise<void>((resolve) => {
    const done = () => resolve()
    window.addEventListener(PYWEBVIEW_READY, () => queueMicrotask(done), { once: true })
    queueMicrotask(() => read() && done())
    setTimeout(() => read() && done(), 0)
    setTimeout(done, BRIDGE_WAIT_MS)
  })

  const pollUntil = Date.now() + API_ATTACH_POLL_MS
  while (Date.now() < pollUntil) {
    const api = read()
    if (api) {
      memoApi = api
      return api
    }
    await new Promise<void>((r) => setTimeout(r, API_ATTACH_POLL_STEP_MS))
  }

  const api = read()
  if (api) {
    memoApi = api
    return api
  }

  if (typeof window.pywebview === 'undefined') {
    memoBrowserOnly = true
  }
  return undefined
}

/**
 * 获取 pywebview 注入的 Python API。
 * 桌面壳里注入时机不定：此处单例等待 + 就绪后轮询，避免 listBooks / 工作目录等并发调用抢先误走 mock。
 */
export async function getBridgeApi(): Promise<BridgeApi | undefined> {
  if (memoApi) return memoApi
  if (memoBrowserOnly) return undefined

  if (!bridgeWaitSingleton) {
    bridgeWaitSingleton = resolveBridgeApiOnce()
  }

  try {
    const resolved = await bridgeWaitSingleton
    if (memoApi) return memoApi
    if (memoBrowserOnly) return undefined
    return resolved
  } finally {
    bridgeWaitSingleton = null
  }
}

export async function pickFolder(): Promise<string | null> {
  const api = await getBridgeApi()
  if (api?.pick_folder) return api.pick_folder()
  // 浏览器开发：用 prompt 模拟路径，取消返回 null
  const v = window.prompt('开发模式：请输入模拟文件夹路径（留空取消）', '')
  if (v == null || v.trim() === '') return null
  return v.trim()
}

export async function listBooks(): Promise<BookSummary[]> {
  const api = await getBridgeApi()
  if (api) return api.list_books()
  return mockListBooks()
}

export async function createBook(
  title: string,
  book_type: BookType,
  categories: string[],
  workspace_root?: string | null,
): Promise<Book> {
  const api = await getBridgeApi()
  if (api) return api.create_book(title, book_type, categories, workspace_root ?? null)
  return mockCreateBook(title, book_type, categories, workspace_root)
}

export async function getBook(book_id: string): Promise<Book | null> {
  const api = await getBridgeApi()
  if (api) return api.get_book(book_id)
  return mockGetBook(book_id)
}

export type SaveBookOptions = {
  content?: string | null
  stages?: Record<string, string> | null
  linked_material_id?: string | null
}

export async function saveBook(
  book_id: string,
  contentOrOptions?: string | SaveBookOptions,
): Promise<Book | null> {
  const api = await getBridgeApi()
  if (typeof contentOrOptions === 'string') {
    if (api) return api.save_book(book_id, contentOrOptions, null)
    return mockSaveBook(book_id, { content: contentOrOptions })
  }
  const opts = contentOrOptions ?? {}
  if (api) {
    return api.save_book(
      book_id,
      opts.content ?? null,
      opts.stages ?? null,
      opts.linked_material_id ?? undefined,
    )
  }
  return mockSaveBook(book_id, opts)
}

export async function deleteBook(book_id: string): Promise<boolean> {
  const api = await getBridgeApi()
  if (api?.delete_book) return api.delete_book(book_id)
  return mockDeleteBook(book_id)
}

// ==================== 素材 Bridge 函数 ====================

export async function listMaterials(): Promise<MaterialSummary[]> {
  const api = await getBridgeApi()
  if (api?.list_materials) return api.list_materials()
  return mockListMaterials()
}

export async function getMaterial(material_id: string): Promise<Material | null> {
  const api = await getBridgeApi()
  if (api?.get_material) return api.get_material(material_id)
  return mockGetMaterial(material_id)
}

export async function createMaterial(
  title: string,
  material_type: MaterialType,
  parent_genre?: string | null,
  sub_genre?: string | null,
  workspace_root?: string | null,
): Promise<Material> {
  const api = await getBridgeApi()
  if (api?.create_material) {
    return api.create_material(title, material_type, parent_genre ?? null, sub_genre ?? null, workspace_root ?? null)
  }
  return mockCreateMaterial(title, material_type, parent_genre, sub_genre)
}

export type SaveMaterialOptions = {
  stages?: Record<string, string> | null
}

export async function saveMaterial(
  material_id: string,
  options?: SaveMaterialOptions,
): Promise<Material | null> {
  const api = await getBridgeApi()
  const opts = options ?? {}
  if (api?.save_material) {
    return api.save_material(material_id, opts.stages ?? null)
  }
  return mockSaveMaterial(material_id, opts.stages)
}

export async function deleteMaterial(material_id: string): Promise<boolean> {
  const api = await getBridgeApi()
  if (api?.delete_material) return api.delete_material(material_id)
  return mockDeleteMaterial(material_id)
}

export async function getMaterialGenres(): Promise<Record<string, string[]>> {
  const api = await getBridgeApi()
  if (api?.get_material_genres) return api.get_material_genres()
  return mockGetMaterialGenres()
}

const PROMPT_TEMPLATE_LS_PREFIX = 'write_claw_prompt_template_override:'

function localPromptLsKey(promptKind: string, stage: string): string {
  return PROMPT_TEMPLATE_LS_PREFIX + `${promptKind}:${stage}`
}

/** 磁盘 / 嵌入式默认 + （浏览器）localStorage 覆盖；用于编辑器与离线渲染。 */
export async function readWorkspacePromptTemplate(
  promptKind: PromptKind,
  stageId: StageId,
): Promise<string> {
  const api = await getBridgeApi()
  if (api?.read_workspace_prompt_template) {
    const t = await api.read_workspace_prompt_template(
      promptKind,
      stageId,
    )
    return t.endsWith('\n') ? t.slice(0, -1) : t
  }
  try {
    const ls = localStorage.getItem(localPromptLsKey(promptKind, stageId))
    if (ls != null && ls.trim() !== '')
      return ls.endsWith('\n') ? ls.slice(0, -1) : ls
  } catch {
    /* ignore */
  }
  return getEmbeddedPromptTemplate(promptKind, stageId)
}

export async function saveWorkspacePromptOverride(
  promptKind: PromptKind,
  stageId: StageId,
  body: string,
): Promise<void> {
  const api = await getBridgeApi()
  if (api?.save_workspace_prompt_override) {
    await api.save_workspace_prompt_override(promptKind, stageId, body)
    return
  }
  try {
    localStorage.setItem(localPromptLsKey(promptKind, stageId), body)
  } catch {
    console.warn('[涌泉] 无法保存提示词覆盖：无桌面桥接且无可用 localStorage')
  }
}

export async function resetWorkspacePromptOverride(
  promptKind: PromptKind,
  stageId: StageId,
): Promise<boolean> {
  const api = await getBridgeApi()
  if (api?.reset_workspace_prompt_override) {
    return api.reset_workspace_prompt_override(promptKind, stageId)
  }
  try {
    const k = localPromptLsKey(promptKind, stageId)
    const had = localStorage.getItem(k) != null
    localStorage.removeItem(k)
    return had
  } catch {
    return false
  }
}

export async function getWorkspaceSystemPrompt(
  promptKind: PromptKind,
  stageId: StageId,
  input: {
    bookTitle: string
    stageBody: string
    allStages: Partial<Record<StageId, string>>
  },
): Promise<string> {
  const stagesObj: Record<string, string> = {}
  for (const [k, v] of Object.entries(input.allStages ?? {})) {
    stagesObj[k] = String(v ?? '')
  }

  const api = await getBridgeApi()
  if (api?.get_workspace_system_prompt) {
    return api.get_workspace_system_prompt(
      promptKind,
      stageId,
      JSON.stringify({
        book_title: input.bookTitle,
        stage_body: input.stageBody,
        all_stages: stagesObj,
      }),
    )
  }

  const raw = await readWorkspacePromptTemplate(promptKind, stageId)
  return renderPromptFromTemplateRaw(raw, {
    bookTitle: input.bookTitle,
    stageBody: input.stageBody,
    allStages: input.allStages,
    promptKind,
    stageId,
  })
}
