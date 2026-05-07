/**
 * 情感工作台：Pi Agent 系统提示词拼装（与世情工作台分文件维护）。
 */

import { QINGGAN_STAGE_LABELS } from './stages'
import { QingganWorkspacePromptBlocks } from './promptBlocks'

export { QINGGAN_STAGE_LABELS }

export function qingganBookLine(bookTitle: string): string {
  return `书名：《${bookTitle}》`
}

export function buildQingganCharacterStagePrompt(): string {
  return QingganWorkspacePromptBlocks.character
}

export function buildQingganIntroStagePrompt(): string {
  return QingganWorkspacePromptBlocks.intro
}

export const QINGGAN_PEEK_EMPTY = '（其它阶段暂无内容）'

export type QingganStagePromptInput = {
  bookTitle: string
  otherStagesBlock: string
  stageBodyExcerpt: string
}

/** 与其它阶段措辞区分：从人物/导语进入场次与因果 */
export function buildQingganPlotRefinePrompt(
  input: QingganStagePromptInput,
): string {
  const body = input.stageBodyExcerpt.trim() || '（暂无）'
  return [
    '你是「剧情细化」专项助手（情感现实向短篇），把意向与粗梗落为**场次链**：每场有目标—障碍—情感变化—余波。',
    '',
    qingganBookLine(input.bookTitle),
    '当前阶段：剧情细化。',
    '',
    '可参考的本书其它阶段摘录：',
    input.otherStagesBlock,
    '',
    '编辑区稿件：',
    '---',
    body,
    '---',
    '',
    '强调关系推进与选择节点，少用「爽点清单」口吻；需要章名占位时仅作结构提示。使用简体中文，Markdown。',
  ].join('\n')
}

export function buildQingganOutlinePrompt(
  input: QingganStagePromptInput,
): string {
  const body = input.stageBodyExcerpt.trim() || '（暂无）'
  return [
    '你是「大纲纲要」助手（情感短篇），负责分章结构、情节点与情绪曲线分配。',
    '',
    qingganBookLine(input.bookTitle),
    '当前阶段：大纲纲要。',
    '',
    '其它阶段摘录：',
    input.otherStagesBlock,
    '',
    '大纲编辑区：',
    '---',
    body,
    '---',
    '',
    '建议用 # / ## 分级；每章一句「这场戏在关系上改变了什么」。使用简体中文。',
  ].join('\n')
}

export function buildQingganOutlineReviewPrompt(
  input: QingganStagePromptInput,
): string {
  const body = input.stageBodyExcerpt.trim() || '（暂无）'
  return [
    QingganWorkspacePromptBlocks.outlineReview,
    '',
    qingganBookLine(input.bookTitle),
    '',
    '跨阶段参考：',
    input.otherStagesBlock,
    '',
    '待审阅大纲：',
    '---',
    body,
    '---',
  ].join('\n')
}

export function buildQingganDraftPrompt(input: QingganStagePromptInput): string {
  const body = input.stageBodyExcerpt.trim() || '（暂无）'
  return [
    '你是「正文编写」助手（情感短篇），专注生活细节、对话呼吸感与节奏，遵守大纲方向。',
    '',
    qingganBookLine(input.bookTitle),
    '当前阶段：正文编写。',
    '',
    '可参考摘录：',
    input.otherStagesBlock,
    '',
    '当前正文：',
    '---',
    body,
    '---',
    '',
    '续写保持人称与语气一致；避免忽然「爽文化」口号，除非本书定位如此。使用简体中文。',
  ].join('\n')
}

export function buildQingganDraftReviewPrompt(
  input: QingganStagePromptInput,
): string {
  const body = input.stageBodyExcerpt.trim() || '（暂无）'
  return [
    QingganWorkspacePromptBlocks.draftReview,
    '',
    qingganBookLine(input.bookTitle),
    '',
    '跨阶段参考：',
    input.otherStagesBlock,
    '',
    '待审正文：',
    '---',
    body,
    '---',
  ].join('\n')
}
