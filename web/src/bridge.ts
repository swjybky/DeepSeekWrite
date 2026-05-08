export type BookType = 'short' | 'long'

import { QINGGAN_WORKSPACE_STAGES } from './workspaces/qinggan/stages'
import type { QingganStageId } from './workspaces/qinggan/stages'
import { SHIQING_WORKSPACE_STAGES } from './workspaces/shiqing/stages'
import type { ShiqingStageId } from './workspaces/shiqing/stages'
import {
  isQingganShortBook,
  isShiqingShortBook,
  isWorkspaceShortBook,
  resolveWorkspaceShortKind,
  type WorkspaceShortKind,
} from './workspaces/resolveWorkspace'

export type { QingganStageId, ShiqingStageId, WorkspaceShortKind }
export {
  isQingganShortBook,
  isShiqingShortBook,
  isWorkspaceShortBook,
  resolveWorkspaceShortKind,
}

export type StageId = ShiqingStageId | QingganStageId

/** 世情工作台左栏；历史引用名保持不变 */
export const WORKSPACE_STAGES = SHIQING_WORKSPACE_STAGES

/** 短篇可选分类（可扩展） */
export const SHORT_GENRE_OPTIONS = ['世情', '现实情感'] as const

/** 依据书籍分类解析当前应使用的左侧阶段列表（世情 vs 情感） */
export function resolveWorkspaceStagesForBook(
  book: Pick<Book, 'book_type' | 'categories'>,
): typeof SHIQING_WORKSPACE_STAGES | typeof QINGGAN_WORKSPACE_STAGES {
  if (resolveWorkspaceShortKind(book) === 'qinggan') {
    return QINGGAN_WORKSPACE_STAGES
  }
  return SHIQING_WORKSPACE_STAGES
}

/** 两端存储中的「全字段」工作台 stages（与世情键 + 情感键并集对齐 Python STAGE_KEYS） */
export function normalizeAllBookStages(
  raw?: Partial<Record<StageId, string>> | null,
): Record<StageId, string> {
  const r = raw ?? {}
  const o = {} as Record<StageId, string>
  for (const s of SHIQING_WORKSPACE_STAGES) {
    o[s.id] = r[s.id] ?? ''
  }
  for (const s of QINGGAN_WORKSPACE_STAGES) {
    o[s.id] = r[s.id] ?? ''
  }
  return o
}

/** 仅当前工作台在用的阶段子集（用于编辑区 state） */
export function normalizeStagesForWorkspaceBook(
  book: Pick<Book, 'book_type' | 'categories'>,
  raw?: Partial<Record<StageId, string>> | null,
): Record<StageId, string> {
  const full = normalizeAllBookStages(raw)
  const rows = resolveWorkspaceStagesForBook(book)
  const out = {} as Record<StageId, string>
  for (const s of rows) {
    out[s.id] = full[s.id] ?? ''
  }
  return out
}

/** 把部分阶段更新合并进完整存储，未出现的键保持原样 */
export function mergeStagePatchIntoAll(
  previous: Partial<Record<StageId, string>> | undefined,
  patch: Partial<Record<StageId, string>>,
): Record<StageId, string> {
  const next = normalizeAllBookStages(previous)
  for (const [k, v] of Object.entries(patch)) {
    if (k in next) {
      next[k as StageId] = String(v ?? '')
    }
  }
  return next
}

function primaryDraftStageId(
  book: Pick<Book, 'book_type' | 'categories'>,
): StageId {
  return resolveWorkspaceShortKind(book) === 'qinggan' ? 'qinggan_draft' : 'draft'
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
}

export interface Book extends BookSummary {
  content: string
  stages?: Partial<Record<StageId, string>>
  created_at?: string
  updated_at?: string
}

/** 与 app/.env 对应，由桌面壳 get_ai_defaults 注入 */
export interface AiModelDefaults {
  provider: string
  model_id: string
  api_key: string
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
        ): Promise<Book | null>
        delete_book(book_id: string): Promise<boolean>
        /** 上次选定的工作文件夹（持久化在应用 .data/preferences.json） */
        get_workspace_root(): Promise<string | null>
        set_workspace_root(path: string | null): Promise<void>
        /** app/.env 中的默认模型与 Key；未配置完整时返回 null */
        get_ai_defaults(): Promise<AiModelDefaults | null>
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
 * 桌面壳下偶发首帧早于 `api` 注入：先让出 1～2 帧再取桥接；若 `get_workspace_root` 抛错则短重试（避免误显示「未选择」）。
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
    .map(({ id, title, book_type, categories, output_dir }) => ({
      id,
      title,
      book_type,
      categories,
      output_dir,
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
  options: { content?: string | null; stages?: Record<string, string> | null },
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
    return api.save_book(book_id, opts.content ?? null, opts.stages ?? null)
  }
  return mockSaveBook(book_id, opts)
}

export async function deleteBook(book_id: string): Promise<boolean> {
  const api = await getBridgeApi()
  if (api?.delete_book) return api.delete_book(book_id)
  return mockDeleteBook(book_id)
}
