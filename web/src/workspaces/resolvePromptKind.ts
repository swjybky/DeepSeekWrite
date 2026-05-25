/**
 * 提示词目录映射
 * 根据书籍分类确定使用哪个提示词目录。
 * 阶段定义统一，仅提示词内容区分类型风格。
 */

export type PromptKind = 'shiqing' | 'qinggan' | 'kehuan' | 'xuanyi'

type BookWorkspaceSlice = {
  book_type: 'short' | 'long'
  categories: string[]
}

/**
 * 根据书籍分类解析应使用的提示词目录
 * 多分类并存时按创建表单顺序优先。
 */
export function resolvePromptKind(
  book: BookWorkspaceSlice,
): PromptKind | null {
  if (book.book_type !== 'short') return null

  if (book.categories.includes('世情')) return 'shiqing'

  if (
    book.categories.includes('追妻') ||
    book.categories.includes('现实情感') ||
    book.categories.includes('情感')
  ) {
    return 'qinggan'
  }

  if (book.categories.includes('科幻')) return 'kehuan'
  if (book.categories.includes('悬疑')) return 'xuanyi'

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
 * 判断是否为追妻短篇（用于提示词选择）
 */
export function isQingganShortBook(book: BookWorkspaceSlice): boolean {
  return resolvePromptKind(book) === 'qinggan'
}

/**
 * 判断是否为科幻短篇（用于提示词选择）
 */
export function isKehuanShortBook(book: BookWorkspaceSlice): boolean {
  return resolvePromptKind(book) === 'kehuan'
}

/**
 * 判断是否为悬疑短篇（用于提示词选择）
 */
export function isXuanyiShortBook(book: BookWorkspaceSlice): boolean {
  return resolvePromptKind(book) === 'xuanyi'
}
