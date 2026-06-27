import {
  normalizeBook,
  normalizeBookSummary,
} from './libraryDomain'
import type {
  Book,
  BookSummary,
  BookType,
} from '../domain/workspaceCore'
import type { SaveBookOptions } from './apiTypes'
import { deleteAiChatSessionsForOwner } from './aiChatHistoryClient'
import { getBridgeApi, resetBridgeApiCache } from './runtime'
import type { BridgeApi } from './runtime'
import {
  mockCreateBook,
  mockDeleteBook,
  mockGetBook,
  mockListBooks,
  mockSaveBook,
} from './mockStore'

/** pywebview.api 的非空根类型（BridgeApi 含 undefined，keyof 会塌缩为 never）。 */
type BridgeApiRoot = NonNullable<BridgeApi>

/**
 * 调用 pywebview api 方法；若 api 不完整（方法缺失，即抛 `xxx is not a function` 的根因），
 * 重置桥接缓存后重试一次，仍不可用则返回 undefined，让调用方回退到浏览器 mock。
 * 桌面壳偶发注入竞态下，第一次拿到不完整 api 后缓存会被锁死，此处自愈重试可恢复。
 */
async function callApiMethod<T>(
  methodName: keyof BridgeApiRoot,
  invoke: (api: BridgeApiRoot) => Promise<T>,
): Promise<T | undefined> {
  const api = await getBridgeApi()
  if (api && typeof (api as Record<string, unknown>)[methodName] === 'function') {
    return await invoke(api)
  }
  if (api) {
    resetBridgeApiCache()
    const retryApi = await getBridgeApi()
    if (
      retryApi &&
      typeof (retryApi as Record<string, unknown>)[methodName] === 'function'
    ) {
      return await invoke(retryApi)
    }
  }
  return undefined
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
  const list = await callApiMethod(
    'list_books',
    (api) => api.list_books() as Promise<BookSummary[]>,
  )
  if (list) {
    return list.map((item) => normalizeBookSummary(item))
  }
  return mockListBooks()
}

export async function createBook(
  title: string,
  book_type: BookType,
  categories: string[],
  workspace_root?: string | null,
  linked_skill_id?: string | null,
  linked_material_id?: string | null,
): Promise<Book> {
  const raw = await callApiMethod('create_book', (api) =>
    api.create_book(
      title,
      book_type,
      categories,
      workspace_root ?? null,
      linked_skill_id ?? null,
      linked_material_id ?? null,
    ),
  )
  if (raw) {
    return normalizeBook(raw)
  }
  return mockCreateBook(title, book_type, categories, workspace_root, linked_skill_id, linked_material_id)
}

export async function getBook(book_id: string): Promise<Book | null> {
  // 桌面端 get_book 合法返回 null 表示书籍不存在；callApiMethod 返回 undefined 表示 api 缺失，需回退 mock。
  const raw = await callApiMethod('get_book', (api) => api.get_book(book_id))
  if (raw === undefined) {
    return mockGetBook(book_id)
  }
  return raw ? normalizeBook(raw) : null
}


export async function saveBook(
  book_id: string,
  contentOrOptions?: string | SaveBookOptions,
): Promise<Book | null> {
  if (typeof contentOrOptions === 'string') {
    const raw = await callApiMethod('save_book', (api) =>
      api.save_book(book_id, contentOrOptions, null),
    )
    if (raw === undefined) {
      return mockSaveBook(book_id, { content: contentOrOptions })
    }
    return raw ? normalizeBook(raw) : null
  }
  const opts = contentOrOptions ?? {}
  const raw = await callApiMethod('save_book', (api) =>
    api.save_book(
      book_id,
      opts.content ?? null,
      opts.stages ?? null,
      opts.linked_material_id ?? undefined,
      opts.expert_draft ?? undefined,
      opts.title ?? undefined,
      opts.status ?? undefined,
      opts.linked_skill_id ?? undefined,
    ),
  )
  if (raw === undefined) {
    return mockSaveBook(book_id, opts)
  }
  return raw ? normalizeBook(raw) : null
}

export async function deleteBook(book_id: string): Promise<boolean> {
  const api = await getBridgeApi()
  const ok = api?.delete_book
    ? await api.delete_book(book_id)
    : await mockDeleteBook(book_id)
  if (ok && !api?.delete_book) {
    await deleteAiChatSessionsForOwner('book', book_id)
  }
  return ok
}
