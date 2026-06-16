import type {
  BookType,
  ExpertDraft,
  ExpertDraftSection,
  StageId,
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

function trimBlankBoundaryLines(lines: string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && !lines[start]!.trim()) start += 1
  while (end > start && !lines[end - 1]!.trim()) end -= 1
  return lines.slice(start, end)
}

function firstDraftBodySectionIndex(
  sections: ExpertDraftSection[],
  bookType: BookType,
): number {
  const bodyIndex = sections.findIndex((section) =>
    bookType === 'script' ? true : section.id !== 'intro',
  )
  return bodyIndex >= 0 ? bodyIndex : 0
}

export function syncExpertDraftFromDraftStage(
  draft: ExpertDraft,
  draftStageBody: string,
  bookType: BookType = 'short',
): ExpertDraft {
  if (draft.sections.length === 0) return draft

  const normalizedBody = draftStageBody.replace(/\r\n?/g, '\n')
  const lines = normalizedBody.split('\n')
  const markers: Array<{ sectionIndex: number; lineIndex: number }> = []
  let cursor = 0

  draft.sections.forEach((section, sectionIndex) => {
    const title = section.title.trim()
    if (!title) return
    for (let lineIndex = cursor; lineIndex < lines.length; lineIndex += 1) {
      if (lines[lineIndex]!.trim() !== title) continue
      markers.push({ sectionIndex, lineIndex })
      cursor = lineIndex + 1
      break
    }
  })

  if (markers.length === 0) {
    const targetIndex = firstDraftBodySectionIndex(draft.sections, bookType)
    return {
      ...draft,
      sections: draft.sections.map((section, index) => ({
        ...section,
        body: index === targetIndex ? normalizedBody : '',
      })),
    }
  }

  const bodiesBySectionId = new Map(
    draft.sections.map((section) => [section.id, '']),
  )

  markers.forEach((marker, markerIndex) => {
    const nextMarker = markers[markerIndex + 1]
    const bodyLines = trimBlankBoundaryLines(
      lines.slice(marker.lineIndex + 1, nextMarker?.lineIndex ?? lines.length),
    )
    bodiesBySectionId.set(
      draft.sections[marker.sectionIndex]!.id,
      bodyLines.join('\n'),
    )
  })

  const firstMarker = markers[0]!
  const preambleLines = trimBlankBoundaryLines(lines.slice(0, firstMarker.lineIndex))
  if (preambleLines.length > 0) {
    const preamble = preambleLines.join('\n')
    const targetIndex =
      firstMarker.sectionIndex > 0 ? firstMarker.sectionIndex - 1 : firstMarker.sectionIndex
    const targetSection = draft.sections[targetIndex]
    if (targetSection) {
      const current = bodiesBySectionId.get(targetSection.id) ?? ''
      bodiesBySectionId.set(
        targetSection.id,
        current ? `${preamble}\n\n${current}` : preamble,
      )
    }
  }

  return {
    ...draft,
    sections: draft.sections.map((section) => ({
      ...section,
      body: bodiesBySectionId.get(section.id) ?? '',
    })),
  }
}

export function mapExpertDraftToDraftStage(
  stages: Record<StageId, string>,
  draft: ExpertDraft,
): Record<StageId, string> {
  return {
    ...stages,
    draft: combineExpertDraftSections(draft),
  }
}

export function hydrateExpertDraftFromDraftStage(
  draft: ExpertDraft,
  draftStageBody: string,
  bookType: BookType = 'short',
): ExpertDraft {
  const legacyBody = draftStageBody.trim()
  if (!legacyBody || combineExpertDraftSections(draft).trim()) return draft

  const targetIndex = draft.sections.findIndex((section) =>
    bookType === 'script' ? true : section.id !== 'intro',
  )
  const safeIndex = targetIndex >= 0 ? targetIndex : 0
  if (!draft.sections[safeIndex]) return draft

  return syncExpertDraftFromDraftStage(draft, draftStageBody, bookType)
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
