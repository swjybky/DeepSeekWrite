import type { AgentTool } from '@mariozechner/pi-agent-core'

import type { StageId, WorkspaceShortKind } from '../bridge'
import {
  getQingganWorkspaceStageAgentDefinition,
  type QingganWorkspaceStageAgentContext,
} from '../workspaces/qinggan/stageAgents'
import {
  getShiqingWorkspaceStageAgentDefinition,
  type ShiqingWorkspaceStageAgentContext,
} from '../workspaces/shiqing/stageAgents'

export type ApplyToStageEditorPayload = {
  text: string
  mode: 'replace' | 'append'
}

export type WorkspaceStageAgentContext = {
  bookTitle: string
  workspaceShortKind: WorkspaceShortKind
  stageId: StageId
  stageBody: string
  allStages: Partial<Record<StageId, string>>
  applyToStageEditor?: (payload: ApplyToStageEditorPayload) => void
}

export function getWorkspaceStageAgentDefinition(
  ctx: WorkspaceStageAgentContext,
): { systemPrompt: string; additionalTools: AgentTool[] } {
  if (ctx.workspaceShortKind === 'qinggan') {
    const narrow: QingganWorkspaceStageAgentContext = {
      bookTitle: ctx.bookTitle,
      stageId: ctx.stageId as QingganWorkspaceStageAgentContext['stageId'],
      stageBody: ctx.stageBody,
      allStages: ctx.allStages,
      applyToStageEditor: ctx.applyToStageEditor,
    }
    return getQingganWorkspaceStageAgentDefinition(narrow)
  }
  const narrow: ShiqingWorkspaceStageAgentContext = {
    bookTitle: ctx.bookTitle,
    stageId: ctx.stageId as ShiqingWorkspaceStageAgentContext['stageId'],
    stageBody: ctx.stageBody,
    allStages: ctx.allStages,
    applyToStageEditor: ctx.applyToStageEditor,
  }
  return getShiqingWorkspaceStageAgentDefinition(narrow)
}
