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
import { getBridgeApi } from './runtime'
import {
  mockCreateBook,
  mockDeleteBook,
  mockGetBook,
  mockListBooks,
  mockSaveBook,
} from './mockStore'

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
  if (api) {
    const list = await api.list_books() as BookSummary[]
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
  const api = await getBridgeApi()
  if (api) {
    return normalizeBook(
      await api.create_book(
        title,
        book_type,
        categories,
        workspace_root ?? null,
        linked_skill_id ?? null,
        linked_material_id ?? null,
      ),
    )
  }
  return mockCreateBook(title, book_type, categories, workspace_root, linked_skill_id, linked_material_id)
}

export async function getBook(book_id: string): Promise<Book | null> {
  const api = await getBridgeApi()
  if (api) {
    const raw = await api.get_book(book_id)
    return raw ? normalizeBook(raw) : null
  }
  return mockGetBook(book_id)
}


export async function saveBook(
  book_id: string,
  contentOrOptions?: string | SaveBookOptions,
): Promise<Book | null> {
  const api = await getBridgeApi()
  if (typeof contentOrOptions === 'string') {
    if (api) {
      const raw = await api.save_book(book_id, contentOrOptions, null)
      return raw ? normalizeBook(raw) : null
    }
    return mockSaveBook(book_id, { content: contentOrOptions })
  }
  const opts = contentOrOptions ?? {}
  if (api) {
    const raw = await api.save_book(
      book_id,
      opts.content ?? null,
      opts.stages ?? null,
      opts.linked_material_id ?? undefined,
      opts.expert_draft ?? undefined,
      opts.title ?? undefined,
      opts.status ?? undefined,
      opts.linked_skill_id ?? undefined,
    )
    return raw ? normalizeBook(raw) : null
  }
  return mockSaveBook(book_id, opts)
}

export async function deleteBook(book_id: string): Promise<boolean> {
  const api = await getBridgeApi()
  if (api?.delete_book) return api.delete_book(book_id)
  return mockDeleteBook(book_id)
}
