import type { AgentTool } from '@mariozechner/pi-agent-core'

import type { StageId, WorkspaceShortKind } from '../bridge'
import {
  buildQingganWorkspaceAdditionalTools,
  type QingganWorkspaceStageAgentContext,
} from '../workspaces/qinggan/stageAgents'
import {
  buildShiqingWorkspaceAdditionalTools,
  type ShiqingWorkspaceStageAgentContext,
} from '../workspaces/shiqing/stageAgents'

export type ApplyToStageEditorPayload = {
  text: string
  /** replace：整段替换；append：前空则整块，否则前加 \\n\\n；append_token：流式 delta，仅拼接不加分段；streaming_end：流式结束标记 */
  mode: 'replace' | 'append' | 'append_token' | 'streaming_end'
}

export type WorkspaceStageAgentContext = {
  bookTitle: string
  workspaceShortKind: WorkspaceShortKind
  stageId: StageId
  stageBody: string
  allStages: Partial<Record<StageId, string>>
  applyToStageEditor?: (payload: ApplyToStageEditorPayload) => void
}

/** Pi 工作台工具集；systemPrompt 须由后端 `getWorkspaceSystemPrompt` 单独装配。 */
export function getWorkspaceStageAdditionalTools(
  ctx: WorkspaceStageAgentContext,
): AgentTool[] {
  if (ctx.workspaceShortKind === 'qinggan') {
    const narrow: QingganWorkspaceStageAgentContext = {
      bookTitle: ctx.bookTitle,
      stageId: ctx.stageId as QingganWorkspaceStageAgentContext['stageId'],
      stageBody: ctx.stageBody,
      allStages: ctx.allStages,
      applyToStageEditor: ctx.applyToStageEditor,
    }
    return buildQingganWorkspaceAdditionalTools(narrow)
  }
  const narrow: ShiqingWorkspaceStageAgentContext = {
    bookTitle: ctx.bookTitle,
    stageId: ctx.stageId as ShiqingWorkspaceStageAgentContext['stageId'],
    stageBody: ctx.stageBody,
    allStages: ctx.allStages,
    applyToStageEditor: ctx.applyToStageEditor,
  }
  return buildShiqingWorkspaceAdditionalTools(narrow)
}
