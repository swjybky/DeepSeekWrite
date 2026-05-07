/** 与工作台实现目录名一致：shiqing / qinggan */
export type WorkspaceShortKind = 'shiqing' | 'qinggan'

type BookWorkspaceSlice = {
  book_type: 'short' | 'long'
  categories: string[]
}

export function resolveWorkspaceShortKind(
  book: BookWorkspaceSlice,
): WorkspaceShortKind | null {
  if (book.book_type !== 'short') return null
  if (book.categories.includes('世情')) return 'shiqing'
  if (
    book.categories.includes('现实情感') ||
    book.categories.includes('情感')
  ) {
    return 'qinggan'
  }
  return null
}

export function isWorkspaceShortBook(book: BookWorkspaceSlice): boolean {
  return resolveWorkspaceShortKind(book) != null
}

/** @deprecated 请用 resolveWorkspaceShortKind === 'shiqing' */
export function isShiqingShortBook(book: BookWorkspaceSlice): boolean {
  return resolveWorkspaceShortKind(book) === 'shiqing'
}

export function isQingganShortBook(book: BookWorkspaceSlice): boolean {
  return resolveWorkspaceShortKind(book) === 'qinggan'
}
