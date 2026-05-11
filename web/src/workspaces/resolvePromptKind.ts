/**
 * 提示词目录映射
 * 根据书籍分类确定使用哪个提示词目录（shiqing 或 qinggan）
 * 阶段定义统一，仅提示词内容区分世情和情感风格
 */

export type PromptKind = 'shiqing' | 'qinggan'

type BookWorkspaceSlice = {
  book_type: 'short' | 'long'
  categories: string[]
}

/**
 * 根据书籍分类解析应使用的提示词目录
 * 世情优先于情感（当两者同时存在时）
 */
export function resolvePromptKind(
  book: BookWorkspaceSlice,
): PromptKind | null {
  if (book.book_type !== 'short') return null

  // 世情优先判断
  if (book.categories.includes('世情')) return 'shiqing'

  // 情感判断
  if (
    book.categories.includes('现实情感') ||
    book.categories.includes('情感')
  ) {
    return 'qinggan'
  }

  return null
}

/**
 * 判断是否为工作台支持的短篇书籍
 */
export function isWorkspaceShortBook(book: BookWorkspaceSlice): boolean {
  return resolvePromptKind(book) != null
}

/**
 * 判断是否为世情短篇（用于提示词选择）
 */
export function isShiqingShortBook(book: BookWorkspaceSlice): boolean {
  return resolvePromptKind(book) === 'shiqing'
}

/**
 * 判断是否为情感短篇（用于提示词选择）
 */
export function isQingganShortBook(book: BookWorkspaceSlice): boolean {
  return resolvePromptKind(book) === 'qinggan'
}
