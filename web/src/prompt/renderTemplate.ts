import type {
  StageId,
  MaterialStageId,
  MaterialPromptKind,
  SkillStageId,
  SkillPromptKind,
} from '../bridge'
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

export type PromptRenderKind = 'workspace' | MaterialPromptKind | SkillPromptKind

const MATERIAL_ORDER: Record<string, readonly { id: string; label: string }[]> = {
  material_manager: [
    { id: 'character', label: '人设素材' },
    { id: 'intro', label: '导语素材' },
    { id: 'gimmick', label: '梗素材' },
    { id: 'plot_refine', label: '剧情细化素材' },
    { id: 'pacing', label: '剧情设计素材' },
    { id: 'draft_excerpt', label: '正文片段' },
  ],
}

const SKILL_ORDER: Record<string, readonly { id: string; label: string }[]> = {
  skill_manager: [
    { id: 'character_design', label: '人物设计技能' },
    { id: 'plot_design', label: '剧情设计技能' },
    { id: 'intro_design', label: '导语设计技能' },
    { id: 'plot_refine', label: '剧情细化技能' },
    { id: 'outline', label: '大纲纲要技能' },
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

function rowsForPromptKind(kind: PromptRenderKind) {
  if (isMaterialPromptKind(kind)) return MATERIAL_ORDER[kind]
  if (isSkillPromptKind(kind)) return SKILL_ORDER[kind]
  return SHORT_WORKSPACE_STAGES
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
  for (const stage of SHORT_WORKSPACE_STAGES) {
    if (allowed.has(stage.id)) filtered[stage.id] = allStages[stage.id] ?? ''
  }
  return peekOtherStagesExcerpt('workspace', null, filtered)
}

const WORKSPACE_TAG =
  /\{\{(BOOK_TITLE|BOOK_GENRE)\}\}/g
const MATERIAL_TAG =
  /\{\{(BOOK_TITLE|BOOK_LINE|MATERIAL_TITLE|MATERIAL_LINE|MATERIAL_TYPE|MATERIAL_GENRE|STAGE_ID|STAGE_LABEL|STAGE_BODY|OTHER_STAGES_EXCERPT)\}\}/g
const SKILL_TAG =
  /\{\{(BOOK_TITLE|BOOK_LINE|SKILL_TITLE|SKILL_LINE|STAGE_ID|STAGE_LABEL|STAGE_BODY|OTHER_STAGES_EXCERPT)\}\}/g

export type PromptSubstitutePayload = {
  bookTitle: string
  bookGenre?: string
  materialType?: string
  materialGenre?: string
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
    SKILL_TITLE: bt,
    SKILL_LINE: skillLine,
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
    stageId: payload.stageId,
    stageLabel: rowsForPromptKind(payload.promptKind)?.find(
      (row) => row.id === payload.stageId,
    )?.label,
    stageBody: payload.stageBody,
    otherStagesComputed: other,
    promptKind: payload.promptKind,
  })
}
