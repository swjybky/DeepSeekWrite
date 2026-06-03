import type { StageId, MaterialStageId, MaterialPromptKind } from '../bridge'
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

export type PromptRenderKind = 'workspace' | MaterialPromptKind

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
  promptKind: PromptRenderKind,
  excludeStageId: StageId | MaterialStageId | null,
  allStages: Partial<Record<StageId | MaterialStageId, string>>,
): string {
  const rows = isMaterialPromptKind(promptKind)
    ? MATERIAL_ORDER[promptKind]
    : SHORT_WORKSPACE_STAGES
  if (!rows) return PEEK_EMPTY
  const parts: string[] = []
  const stages = allStages ?? {}
  for (const row of rows) {
    const sid = row.id as StageId | MaterialStageId
    if (excludeStageId !== null && sid === excludeStageId) continue
    const raw = (stages[sid] ?? '').trim()
    if (!raw.length) continue
    parts.push(`【${row.label}】\n${excerptText(raw, PEER_CAP)}`)
  }
  return parts.length ? parts.join('\n\n') : PEEK_EMPTY
}

export function peekAllowedWorkspaceStagesExcerpt(
  allStages: Partial<Record<StageId, string>>,
  allowedStageIds: readonly StageId[],
): string {
  const allowed = new Set(allowedStageIds)
  const filtered: Partial<Record<StageId, string>> = {}
  for (const stage of SHORT_WORKSPACE_STAGES) {
    if (allowed.has(stage.id)) filtered[stage.id] = allStages[stage.id] ?? ''
  }
  return peekOtherStagesExcerpt('workspace', null, filtered)
}

const WORKSPACE_TAG =
  /\{\{(BOOK_TITLE|BOOK_LINE|BOOK_GENRE|STYLE|STAGE_BODY|OTHER_STAGES_EXCERPT)\}\}/g
const MATERIAL_TAG =
  /\{\{(BOOK_TITLE|BOOK_LINE|STAGE_BODY|OTHER_STAGES_EXCERPT)\}\}/g

export type PromptSubstitutePayload = {
  bookTitle: string
  bookGenre?: string
  stageBody: string
  otherStagesComputed: string
  promptKind: PromptRenderKind
}

export type PromptRenderPayload = {
  bookTitle: string
  bookGenre?: string
  stageBody: string
  otherStagesExcerpt?: string | null
  promptKind: PromptRenderKind
  stageId: StageId | MaterialStageId
  allStages: Partial<Record<StageId | MaterialStageId, string>>
}

export function substitutePromptPlaceholders(
  templateRaw: string,
  input: PromptSubstitutePayload,
): string {
  const bt = input.bookTitle.trim()
  const genre = input.bookGenre?.trim() || '未分类'
  const rep: Record<string, string> = {
    BOOK_TITLE: bt,
    BOOK_LINE: `书名：《${bt}》`,
    BOOK_GENRE: genre,
    STYLE: genre,
    STAGE_BODY: excerptText(input.stageBody),
    OTHER_STAGES_EXCERPT: input.otherStagesComputed,
  }
  const tag = input.promptKind === 'workspace' ? WORKSPACE_TAG : MATERIAL_TAG
  return templateRaw.replace(tag, (_, k: keyof typeof rep) => rep[k] ?? '')
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
    bookGenre: payload.bookGenre,
    stageBody: payload.stageBody,
    otherStagesComputed: other,
    promptKind: payload.promptKind,
  })
}
