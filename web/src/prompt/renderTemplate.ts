import type { StageId, PromptKind } from '../bridge'
import { SHORT_WORKSPACE_STAGES } from '../workspaces/short/stages'

const PEEK_EMPTY = '（其它阶段暂无内容）'
const BODY_CAP = 12000
const PEER_CAP = 2000

/** 与 piToolkit excerptFn(body,12000) 一致 */
export function excerptText(body: string, maxLen = BODY_CAP): string {
  const t = body.trim()
  if (!t.length) return '（暂无）'
  if (t.length <= maxLen) return t
  return `${t.slice(0, maxLen)}\n\n…（内容过长已截断）`
}

/**
 * 统一使用 SHORT_WORKSPACE_STAGES 作为阶段顺序
 * 世情和情感共用同一套阶段定义
 */
const ORDER: Record<string, readonly { id: string; label: string }[]> = {
  shiqing: SHORT_WORKSPACE_STAGES,
  qinggan: SHORT_WORKSPACE_STAGES,
}

export function peekOtherStagesExcerpt(
  _promptKind: PromptKind,
  excludeStageId: StageId,
  allStages: Partial<Record<StageId, string>>,
): string {
  const rows = ORDER['shiqing'] // 统一使用同一套阶段
  if (!rows) return PEEK_EMPTY
  const parts: string[] = []
  for (const row of rows) {
    const sid = row.id as StageId
    if (sid === excludeStageId) continue
    const raw = (allStages[sid] ?? '').trim()
    if (!raw.length) continue
    parts.push(`【${row.label}】\n${excerptText(raw, PEER_CAP)}`)
  }
  return parts.length ? parts.join('\n\n') : PEEK_EMPTY
}

const TAG = /\{\{(BOOK_TITLE|STAGE_BODY|OTHER_STAGES_EXCERPT|BOOK_LINE)\}\}/g

export type PromptSubstitutePayload = {
  bookTitle: string
  stageBody: string
  otherStagesComputed: string
}

export type PromptRenderPayload = {
  bookTitle: string
  stageBody: string
  otherStagesExcerpt?: string | null
  promptKind: PromptKind
  stageId: StageId
  allStages: Partial<Record<StageId, string>>
}

export function substitutePromptPlaceholders(
  templateRaw: string,
  input: PromptSubstitutePayload,
): string {
  const bt = input.bookTitle.trim()
  const rep: Record<string, string> = {
    BOOK_TITLE: bt,
    BOOK_LINE: `书名：《${bt}》`,
    STAGE_BODY: excerptText(input.stageBody),
    OTHER_STAGES_EXCERPT: input.otherStagesComputed,
  }
  return templateRaw.replace(TAG, (_, k: keyof typeof rep) => rep[k] ?? '')
}

export function renderPromptFromTemplateRaw(
  templateRaw: string,
  payload: PromptRenderPayload,
): string {
  const other =
    payload.otherStagesExcerpt ??
    peekOtherStagesExcerpt(
      payload.promptKind,
      payload.stageId,
      payload.allStages,
    )
  return substitutePromptPlaceholders(templateRaw, {
    bookTitle: payload.bookTitle,
    stageBody: payload.stageBody,
    otherStagesComputed: other,
  })
}
