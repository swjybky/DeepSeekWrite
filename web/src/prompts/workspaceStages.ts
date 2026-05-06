/**
 * 工作区「按写作阶段」Pi Agent 的系统提示词（纯字符串正文拼装）。
 * 与 workspaceStageAgents 中的 excerpt / peekOtherStages 结果拼接。
 */

import { WorkspaceStagePromptBlocks } from './workspaceStagePromptBlocks'

export const WORKSPACE_STAGE_LABELS = {
  plot_design: '剧情设计',
  plot_refine: '剧情细化',
  outline: '大纲纲要',
  draft: '正文编写',
  review: '编辑审阅',
} as const

export function workspaceBookLine(bookTitle: string): string {
  return `书名：《${bookTitle}》`
}

/** 供各阶段 system prompt 组装：书名、其它阶段摘录块、当前编辑区摘录 */
export type WorkspaceStagePromptInput = {
  bookTitle: string
  otherStagesBlock: string
  stageBodyExcerpt: string
}

export const PEEK_OTHER_STAGES_EMPTY = '（其它阶段暂无内容）'

/** 剧情设计（静态正文，见 WorkspaceStagePromptBlocks.plotDesign） */
export function buildPlotDesignStagePrompt(): string {
  return WorkspaceStagePromptBlocks.plotDesign
}

/** 剧情细化 */
export function buildPlotRefineStagePrompt(input: WorkspaceStagePromptInput): string {
  const body = input.stageBodyExcerpt.trim() || '（暂无）'
  return [
    '你是「剧情细化」专项助手，把粗梗落为可执行的场次、因果链与情绪起伏。',
    '',
    workspaceBookLine(input.bookTitle),
    '当前阶段：剧情细化（场景级：目标—障碍—转折—余波）。',
    '',
    '可参考的本书其它阶段摘录：',
    input.otherStagesBlock,
    '',
    '编辑区稿件：',
    '---',
    body,
    '---',
    '',
    '多从「信息差、动机、时限、资源」追问每场戏的必要性；避免提前写大纲编号或章名，除非用户要求。',
    '使用简体中文，Markdown 输出。需要长期追踪的设定表可用工具生成骨架，大段润色可走 artifacts。',
  ].join('\n')
}

/** 大纲纲要 */
export function buildOutlineStagePrompt(input: WorkspaceStagePromptInput): string {
  const body = input.stageBodyExcerpt.trim() || '（暂无）'
  return [
    '你是「大纲纲要」助手，负责篇章结构：分卷、分章、情节点排布与节奏分配。',
    '',
    workspaceBookLine(input.bookTitle),
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

/** 正文编写 */
export function buildDraftStagePrompt(input: WorkspaceStagePromptInput): string {
  const body = input.stageBodyExcerpt.trim() || '（暂无）'
  return [
    '你是「正文编写」助手，专注文笔、对白、画面感与叙事节奏，遵守已定下的大纲方向。',
    '',
    workspaceBookLine(input.bookTitle),
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

/** 编辑审阅 */
export function buildReviewStagePrompt(input: WorkspaceStagePromptInput): string {
  const body = input.stageBodyExcerpt.trim() || '（暂无）'
  return [
    '你是「编辑审阅」助手，从编辑视角找逻辑漏洞、人设漂移、节奏问题与可删冗余，并给出可执行的删改建议。',
    '',
    workspaceBookLine(input.bookTitle),
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
