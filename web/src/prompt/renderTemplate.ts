import type { StageId, PromptKind, MaterialStageId, MaterialPromptKind } from '../bridge'
import { SHORT_WORKSPACE_STAGES } from '../workspaces/short/stages'

const PEEK_EMPTY = '（其它阶段暂无内容）'
const BODY_CAP = 12000
const PEER_CAP = 2000

/** 与 piToolkit excerptFn(body,12000) 一致 */
export function excerptText(body: string, maxLen = BODY_CAP): string {
  void maxLen
  const t = body.trim()
  if (!t.length) return '（暂无）'
  return t
}

/**
 * 统一使用 SHORT_WORKSPACE_STAGES 作为阶段顺序
 * 世情和情感共用同一套阶段定义
 */
const BOOK_ORDER: Record<string, readonly { id: string; label: string }[]> = {
  shiqing: SHORT_WORKSPACE_STAGES,
  qinggan: SHORT_WORKSPACE_STAGES,
  kehuan: SHORT_WORKSPACE_STAGES,
  xuanyi: SHORT_WORKSPACE_STAGES,
}

const MATERIAL_ORDER: Record<string, readonly { id: string; label: string }[]> = {
  material_long: [
    { id: 'character', label: '人设素材' },
    { id: 'intro', label: '导语素材' },
    { id: 'gimmick', label: '梗素材' },
    { id: 'plot_refine', label: '剧情细化素材' },
    { id: 'pacing', label: '节奏素材' },
    { id: 'draft_excerpt', label: '正文片段' },
  ],
  material_short_shiqing: [
    { id: 'character', label: '人设素材' },
    { id: 'intro', label: '导语素材' },
    { id: 'gimmick', label: '梗素材' },
    { id: 'plot_refine', label: '剧情细化素材' },
    { id: 'pacing', label: '节奏素材' },
    { id: 'draft_excerpt', label: '正文片段' },
  ],
  material_short_qinggan: [
    { id: 'character', label: '人设素材' },
    { id: 'intro', label: '导语素材' },
    { id: 'gimmick', label: '梗素材' },
    { id: 'plot_refine', label: '剧情细化素材' },
    { id: 'pacing', label: '节奏素材' },
    { id: 'draft_excerpt', label: '正文片段' },
  ],
  material_short_kehuan: [
    { id: 'character', label: '人设素材' },
    { id: 'intro', label: '导语素材' },
    { id: 'gimmick', label: '梗素材' },
    { id: 'plot_refine', label: '剧情细化素材' },
    { id: 'pacing', label: '节奏素材' },
    { id: 'draft_excerpt', label: '正文片段' },
  ],
  material_short_xuanyi: [
    { id: 'character', label: '人设素材' },
    { id: 'intro', label: '导语素材' },
    { id: 'gimmick', label: '梗素材' },
    { id: 'plot_refine', label: '剧情细化素材' },
    { id: 'pacing', label: '节奏素材' },
    { id: 'draft_excerpt', label: '正文片段' },
  ],
}

function isMaterialPromptKind(kind: string): kind is MaterialPromptKind {
  return kind.startsWith('material_')
}

export function peekOtherStagesExcerpt(
  promptKind: PromptKind | MaterialPromptKind,
  excludeStageId: StageId | MaterialStageId,
  allStages: Partial<Record<StageId | MaterialStageId, string>>,
): string {
  const rows = isMaterialPromptKind(promptKind)
    ? MATERIAL_ORDER[promptKind]
    : BOOK_ORDER[promptKind]
  if (!rows) return PEEK_EMPTY
  const parts: string[] = []
  const stages = allStages ?? {}
  for (const row of rows) {
    const sid = row.id as StageId | MaterialStageId
    if (sid === excludeStageId) continue
    const raw = (stages[sid] ?? '').trim()
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
  promptKind: PromptKind | MaterialPromptKind
  stageId: StageId | MaterialStageId
  allStages: Partial<Record<StageId | MaterialStageId, string>>
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
      payload.allStages ?? {},
    )
  return substitutePromptPlaceholders(templateRaw, {
    bookTitle: payload.bookTitle,
    stageBody: payload.stageBody,
    otherStagesComputed: other,
  })
}
