import { getBridgeApi } from './runtime'

export type ManuscriptExportFormat = 'docx' | 'txt' | 'epub'

function normalizeCoverMap(raw: Record<string, string | null | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [bookId, coverData] of Object.entries(raw)) {
    if (coverData) out[bookId] = coverData
  }
  return out
}

export async function getBookCover(book_id: string): Promise<{ cover_data: string | null }> {
  const api = await getBridgeApi()
  if (api?.get_book_cover) {
    return api.get_book_cover(book_id)
  }
  return { cover_data: null }
}

export async function getBookCovers(book_ids: string[]): Promise<Record<string, string>> {
  const ids = Array.from(new Set(book_ids.map((id) => id.trim()).filter(Boolean)))
  if (!ids.length) return {}

  const api = await getBridgeApi()
  if (api?.get_book_covers) {
    const result = await api.get_book_covers(ids)
    return normalizeCoverMap(result.covers)
  }

  if (api?.get_book_cover) {
    const entries = await Promise.all(
      ids.map(async (bookId) => {
        try {
          const result = await api.get_book_cover(bookId)
          return [bookId, result.cover_data] as const
        } catch {
          return [bookId, null] as const
        }
      }),
    )
    return normalizeCoverMap(Object.fromEntries(entries))
  }

  return {}
}

export async function generateBookCover(
  book_id: string,
  prompt: string,
): Promise<{ cover_path: string | null; success: boolean; error: string | null }> {
  const api = await getBridgeApi()
  if (api?.generate_book_cover) {
    return api.generate_book_cover(book_id, prompt)
  }
  // 浏览器开发模式：模拟成功
  console.warn('[DeepseekWrite] 浏览器开发模式：封面生成 API 不可用，返回模拟数据')
  return { cover_path: null, success: false, error: '浏览器开发模式暂不支持封面生成' }
}

export async function exportDocx(
  book_id: string,
  stage_id: string,
  folder_path: string,
  content: string,
  cover_data: string | null,
): Promise<{ success: boolean; error: string | null; path: string | null }> {
  return exportManuscript(book_id, stage_id, folder_path, content, cover_data, 'docx')
}

export async function exportManuscript(
  book_id: string,
  stage_id: string,
  folder_path: string,
  content: string,
  cover_data: string | null,
  format: ManuscriptExportFormat,
): Promise<{ success: boolean; error: string | null; path: string | null }> {
  const api = await getBridgeApi()
  if (api?.export_text) {
    return api.export_text(book_id, stage_id, folder_path, content, cover_data, format)
  }
  if (format === 'docx' && api?.export_docx) {
    return api.export_docx(book_id, stage_id, folder_path, content, cover_data)
  }
  // 浏览器开发模式：保留原有 TXT 兜底；EPUB 需要桌面后端生成。
  try {
    if (format === 'epub') {
      return { success: false, error: '浏览器开发模式暂不支持该格式导出', path: null }
    }
    const title = content.slice(0, 20).replace(/[\\/:*?"<>|\n\r\t]/g, '_') || '未命名'
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title}.txt`
    a.click()
    URL.revokeObjectURL(url)
    return { success: true, error: null, path: null }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : '导出失败', path: null }
  }
}
