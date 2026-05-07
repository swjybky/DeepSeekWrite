/**
 * 世情工作台：Pi Agent 系统提示词拼装。
 */

import { SHIQING_STAGE_LABELS } from './stages'
import { ShiqingWorkspacePromptBlocks } from './promptBlocks'

export { SHIQING_STAGE_LABELS as WORKSPACE_STAGE_LABELS }

export function shiqingBookLine(bookTitle: string): string {
  return `书名：《${bookTitle}》`
}

export type ShiqingStagePromptInput = {
  bookTitle: string
  otherStagesBlock: string
  stageBodyExcerpt: string
}

export const PEEK_OTHER_STAGES_EMPTY = '（其它阶段暂无内容）'

export function buildIntroDesignStagePrompt(): string {
  return ShiqingWorkspacePromptBlocks.introDesign
}

export function buildCharacterDesignStagePrompt(): string {
  return ShiqingWorkspacePromptBlocks.characterDesign
}

export function buildPlotDesignStagePrompt(): string {
  return ShiqingWorkspacePromptBlocks.plotDesign
}

export function buildPlotRefineStagePrompt(input: ShiqingStagePromptInput): string {
  const body = input.stageBodyExcerpt.trim() || '（暂无）'
  return [
    ShiqingWorkspacePromptBlocks.plotRefine,
    '',
    '---',
    '',
    shiqingBookLine(input.bookTitle),
    '当前阶段：剧情细化。',
    '',
    '可参考的本书其它阶段摘录：',
    input.otherStagesBlock,
    '',
    '编辑区稿件：',
    '---',
    body,
    '---',
  ].join('\n')
}

export function buildOutlineStagePrompt(input: ShiqingStagePromptInput): string {
  const body = input.stageBodyExcerpt.trim() || '（暂无）'
  return [
    '你是「大纲纲要」助手，负责篇章结构：分卷、分章、情节点排布与节奏分配。',
    '',
    shiqingBookLine(input.bookTitle),
    '当前阶段：大纲纲要（结构优先于文采）。',
    '',
    '其它阶段摘录（对齐剧情与正文体量）：',
    input.otherStagesBlock,
    '',
    '大纲编辑器内容：',
    '---',
    body,
    '---',
    '',
    '输出建议用层级标题（# / ##）列出章名与一句话情节；可调用工具检查标题层级平衡或按目标章数生成分章占位。',
    '使用简体中文。',
  ].join('\n')
}

export function buildDraftStagePrompt(input: ShiqingStagePromptInput): string {
  const body = input.stageBodyExcerpt.trim() || '（暂无）'
  return [
    '你是「正文编写」助手，专注文笔、对白、画面感与叙事节奏，遵守已定下的大纲方向。',
    '',
    shiqingBookLine(input.bookTitle),
    '当前阶段：正文编写（成稿优先）。',
    '',
    '可参考的设定/大纲摘要：',
    input.otherStagesBlock,
    '',
    '当前编辑正文：',
    '---',
    body,
    '---',
    '',
    '续写或改写时保持人称与时态一致；可调用工具做字数与对白占比等度量。直接改写内容放在对话里用 Markdown；长篇章输出可配合 artifacts。',
    '使用简体中文。',
  ].join('\n')
}

export function buildReviewStagePrompt(input: ShiqingStagePromptInput): string {
  const body = input.stageBodyExcerpt.trim() || '（暂无）'
  return [
    '你是「编辑审阅」助手，从编辑视角找逻辑漏洞、人设漂移、节奏问题与可删冗余，并给出可执行的删改建议。',
    '',
    shiqingBookLine(input.bookTitle),
    '当前阶段：编辑审阅（批评为建设性，标注优先级）。',
    '',
    '跨阶段参考（核对是否前后矛盾）：',
    input.otherStagesBlock,
    '',
    '待审阅文本：',
    '---',
    body,
    '---',
    '',
    '先概括风险点（高/中/低），再给逐条修改建议；可调用工具做速读层面扫描或使用审阅量表。避免空泛夸奖。',
    '使用简体中文，Markdown。',
  ].join('\n')
}
