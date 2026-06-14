import type {
  BookType,
  ExpertDraft,
  ExpertDraftSection,
} from '../../domain/workspace'

export function combineExpertDraftSections(draft: ExpertDraft): string {
  return draft.sections
    .map((section) => {
      const body = section.body.trim()
      if (!body) return ''
      const title = section.title.trim()
      return title ? `${title}\n${body}` : body
    })
    .filter(Boolean)
    .join('\n\n')
}

function chineseSectionNumber(n: number): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  if (n <= 10) return n === 10 ? '十' : digits[n]!
  if (n < 20) return `十${digits[n - 10]}`
  if (n < 100) {
    const tens = Math.floor(n / 10)
    const ones = n % 10
    return `${digits[tens]}十${ones ? digits[ones] : ''}`
  }
  return String(n)
}

export function expertDraftSectionTitleForIndex(
  index: number,
  bookType: BookType = 'short',
): string {
  if (bookType !== 'script' && index <= 0) return '导语'
  return `第${chineseSectionNumber(bookType === 'script' ? index + 1 : index)}节`
}

export function nextExpertDraftSectionId(sections: ExpertDraftSection[]): string {
  let n = sections.length
  const used = new Set(sections.map((s) => s.id))
  while (used.has(`section-${n}`)) n += 1
  return `section-${n}`
}

export function defaultExpertDraftStateTitle(sectionTitle: string): string {
  return `${sectionTitle.trim() || '小节'}人物状态`
}

export function expertDraftSectionTreeLabel(section: ExpertDraftSection): string {
  const title = section.title.trim()
  return title || '未命名小节'
}
