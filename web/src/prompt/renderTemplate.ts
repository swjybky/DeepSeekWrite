import type {
  StageId,
  MaterialStageId,
  MaterialPromptKind,
  SkillStageId,
  SkillPromptKind,
} from '../bridge'
import { SHORT_WORKSPACE_CONTENT_STAGES } from '../workspaces/short/stages'

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

export type PromptRenderKind = 'workspace' | MaterialPromptKind | SkillPromptKind

const MATERIAL_ORDER: Record<string, readonly { id: string; label: string }[]> = {
  material_manager: [
    { id: 'gimmick', label: '梗' },
    { id: 'character', label: '人设' },
    { id: 'pacing', label: '剧情设计' },
    { id: 'intro', label: '导语设计' },
    { id: 'plot_refine', label: '剧情细化' },
    { id: 'draft_excerpt', label: '优秀正文片段' },
    { id: 'other', label: '其他素材' },
  ],
}

const SKILL_ORDER: Record<string, readonly { id: string; label: string }[]> = {
  skill_manager: [
    { id: 'character_design', label: '人物技能' },
    { id: 'plot_design', label: '剧情技能' },
    { id: 'outline', label: '大纲技能' },
    { id: 'draft', label: '正文专家编写技能' },
    { id: 'expert_section_writer', label: '分节写手技能' },
  ],
}

function isMaterialPromptKind(kind: string): kind is MaterialPromptKind {
  return kind === 'material_manager' || kind.startsWith('material_')
}

function isSkillPromptKind(kind: string): kind is SkillPromptKind {
  return kind === 'skill_manager'
}

function materialKindLabel(kind: string | undefined): string {
  switch ((kind ?? '').trim()) {
    case 'character':
      return '人设素材'
    case 'gimmick':
      return '梗素材'
    case 'plot':
      return '剧情素材'
    case 'draft':
      return '正文素材'
    default:
      return '其他素材'
  }
}

function rowsForPromptKind(kind: PromptRenderKind) {
  if (isMaterialPromptKind(kind)) return MATERIAL_ORDER[kind]
  if (isSkillPromptKind(kind)) return SKILL_ORDER[kind]
  return SHORT_WORKSPACE_CONTENT_STAGES
}

export function peekOtherStagesExcerpt(
  promptKind: PromptRenderKind,
  excludeStageId: StageId | MaterialStageId | SkillStageId | null,
  allStages: Partial<Record<StageId | MaterialStageId | SkillStageId, string>>,
): string {
  const rows = rowsForPromptKind(promptKind)
  if (!rows) return PEEK_EMPTY
  const parts: string[] = []
  const stages = allStages ?? {}
  for (const row of rows) {
    const sid = row.id as StageId | MaterialStageId | SkillStageId
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
  for (const stage of SHORT_WORKSPACE_CONTENT_STAGES) {
    if (allowed.has(stage.id)) filtered[stage.id] = allStages[stage.id] ?? ''
  }
  return peekOtherStagesExcerpt('workspace', null, filtered)
}

const WORKSPACE_TAG =
  /\{\{(BOOK_TITLE|BOOK_GENRE)\}\}/g
const MATERIAL_TAG =
  /\{\{(BOOK_TITLE|BOOK_LINE|MATERIAL_TITLE|MATERIAL_LINE|MATERIAL_TYPE|MATERIAL_GENRE|MATERIAL_KIND|MATERIAL_KIND_LABEL|MATERIAL_OVERVIEW|CURRENT_ENTRY_TITLE|STAGE_ID|STAGE_LABEL|STAGE_BODY|OTHER_STAGES_EXCERPT)\}\}/g
const SKILL_TAG =
  /\{\{(BOOK_TITLE|BOOK_LINE|SKILL_TITLE|SKILL_LINE|SKILL_TYPE|STAGE_ID|STAGE_LABEL|STAGE_BODY|OTHER_STAGES_EXCERPT)\}\}/g

export type PromptSubstitutePayload = {
  bookTitle: string
  bookGenre?: string
  materialType?: string
  materialGenre?: string
  materialKind?: string
  materialOverview?: string
  currentEntryTitle?: string
  skillType?: string
  stageId?: StageId | MaterialStageId | SkillStageId
  stageLabel?: string
  stageBody: string
  otherStagesComputed: string
  promptKind: PromptRenderKind
}

export type PromptRenderPayload = {
  bookTitle: string
  bookGenre?: string
  materialType?: string
  materialGenre?: string
  materialKind?: string
  materialOverview?: string
  currentEntryTitle?: string
  skillType?: string
  stageBody: string
  otherStagesExcerpt?: string | null
  promptKind: PromptRenderKind
  stageId: StageId | MaterialStageId | SkillStageId
  allStages: Partial<Record<StageId | MaterialStageId | SkillStageId, string>>
}

export function substitutePromptPlaceholders(
  templateRaw: string,
  input: PromptSubstitutePayload,
): string {
  const bt = input.bookTitle.trim()
  const genre = input.bookGenre?.trim() || '未分类'
  const materialLine = `素材：《${bt}》`
  const skillLine = `技能：《${bt}》`
  const bookLine =
    input.promptKind === 'workspace'
      ? `书名：《${bt}》`
      : isSkillPromptKind(input.promptKind)
        ? skillLine
        : materialLine
  const rep: Record<string, string> = {
    BOOK_TITLE: bt,
    BOOK_LINE: bookLine,
    BOOK_GENRE: genre,
    MATERIAL_TITLE: bt,
    MATERIAL_LINE: materialLine,
    MATERIAL_TYPE: input.materialType?.trim() || '未分类素材',
    MATERIAL_GENRE: input.materialGenre?.trim() || '未分类',
    MATERIAL_KIND: input.materialKind?.trim() || 'other',
    MATERIAL_KIND_LABEL: materialKindLabel(input.materialKind),
    MATERIAL_OVERVIEW: excerptText(input.materialOverview ?? ''),
    CURRENT_ENTRY_TITLE: input.currentEntryTitle?.trim() || '未选择条目',
    SKILL_TITLE: bt,
    SKILL_LINE: skillLine,
    SKILL_TYPE: input.skillType?.trim() || '短篇技能',
    STAGE_ID: input.stageId ? String(input.stageId) : '',
    STAGE_LABEL: input.stageLabel ?? '',
    STAGE_BODY: excerptText(input.stageBody),
    OTHER_STAGES_EXCERPT: input.otherStagesComputed,
  }
  const tag =
    input.promptKind === 'workspace'
      ? WORKSPACE_TAG
      : isSkillPromptKind(input.promptKind)
        ? SKILL_TAG
        : MATERIAL_TAG
  return templateRaw.replace(tag, (_, k: keyof typeof rep) => rep[k] ?? '')
}

export function renderPromptFromTemplateRaw(
  templateRaw: string,
  payload: PromptRenderPayload,
): string {
  const other =
    payload.promptKind === 'workspace'
      ? (payload.otherStagesExcerpt ?? '')
      : payload.otherStagesExcerpt ??
        peekOtherStagesExcerpt(
          payload.promptKind,
          payload.stageId,
          payload.allStages ?? {},
        )
  return substitutePromptPlaceholders(templateRaw, {
    bookTitle: payload.bookTitle,
    bookGenre: payload.bookGenre,
    materialType: payload.materialType,
    materialGenre: payload.materialGenre,
    materialKind: payload.materialKind,
    materialOverview: payload.materialOverview,
    currentEntryTitle: payload.currentEntryTitle,
    skillType: payload.skillType,
    stageId: payload.stageId,
    stageLabel: rowsForPromptKind(payload.promptKind)?.find(
      (row) => row.id === payload.stageId,
    )?.label,
    stageBody: payload.stageBody,
    otherStagesComputed: other,
    promptKind: payload.promptKind,
  })
}
