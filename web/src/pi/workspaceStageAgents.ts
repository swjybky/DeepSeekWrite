import type { AgentTool } from '@mariozechner/pi-agent-core'

import type { Material, StageId, PromptKind } from '../bridge'
import {
  buildShortWorkspaceAdditionalTools,
  type ShortWorkspaceStageAgentContext,
} from '../workspaces/short/stageAgents'

export type ApplyToStageEditorPayload = {
  text: string
  /** replace：整段替换；append：前空则整块，否则前加 \n\n；append_token：流式 delta，仅拼接不加分段；streaming_end：流式结束标记 */
  mode: 'replace' | 'append' | 'append_token' | 'streaming_end'
}

export type WorkspaceStageAgentContext = {
  bookTitle: string
  promptKind: PromptKind
  stageId: StageId
  stageBody: string
  allStages: Partial<Record<StageId, string>>
  linkedMaterial?: Material | null
  applyToStageEditor?: (payload: ApplyToStageEditorPayload) => void
}

/** Pi 工作台工具集；systemPrompt 须由后端 `getWorkspaceSystemPrompt` 单独装配。
 * 统一使用 short/stageAgents 中的工具配置，世情和情感共用同一套工具集，
 * 仅提示词内容区分风格差异。
 */
export function getWorkspaceStageAdditionalTools(
  ctx: WorkspaceStageAgentContext,
): AgentTool[] {
  // 统一使用新的短篇工作台工具配置
  const narrow: ShortWorkspaceStageAgentContext = {
    bookTitle: ctx.bookTitle,
    stageId: ctx.stageId as ShortWorkspaceStageAgentContext['stageId'],
    stageBody: ctx.stageBody,
    allStages: ctx.allStages,
    linkedMaterial: ctx.linkedMaterial,
    applyToStageEditor: ctx.applyToStageEditor,
  }
  return buildShortWorkspaceAdditionalTools(narrow)
}
