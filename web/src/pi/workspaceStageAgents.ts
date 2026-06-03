import type { AgentTool } from '@mariozechner/pi-agent-core'

import type {
  Material,
  StageId,
  PromptKind,
  MaterialPromptKind,
  MaterialStageId,
  StageReadAccessConfig,
} from '../bridge'
import { resolveReadAccessForStage } from '../workspaces/short/stageReadAccess'
import type { ShortStageId } from '../workspaces/short/stages'
import {
  buildShortWorkspaceAdditionalTools,
  type ShortWorkspaceStageAgentContext,
} from '../workspaces/short/stageAgents'
import {
  buildMaterialWorkspaceAdditionalTools,
  type MaterialWorkspaceStageAgentContext,
} from '../workspaces/material/materialStageAgents'

export type ApplyToStageEditorPayload = {
  text: string
  /** replace：整段替换；append：前空则整块，否则前加 \n\n；append_token：流式 delta，仅拼接不加分段；streaming_end：流式结束标记 */
  mode: 'replace' | 'append' | 'append_token' | 'streaming_end'
}

export type WorkspaceStageAgentContext = {
  bookTitle: string
  promptKind: PromptKind | MaterialPromptKind
  stageId: StageId | MaterialStageId
  stageBody: string
  getCurrentStageBody?: () => string
  allStages: Partial<Record<StageId | MaterialStageId, string>>
  linkedMaterial?: Material | null
  /** 全局阶段可读配置（短篇创作空间） */
  stageReadAccess?: StageReadAccessConfig | null
  applyToStageEditor?: (payload: ApplyToStageEditorPayload) => void
  /** 查询某 toolCallId 是否已在流式生成阶段同步到编辑器 */
  isToolCallStreamed?: (toolCallId: string) => boolean
  /** 请求上层保存当前书籍/素材；用于复制工具写入后自动落盘 */
  onRequestSave?: () => void | Promise<void>
}

/** Pi 工作台工具集；systemPrompt 须由后端单独装配。 */
export function getWorkspaceStageAdditionalTools(
  ctx: WorkspaceStageAgentContext,
): AgentTool[] {
  // 素材库模式
  if (ctx.promptKind.startsWith('material_')) {
    const materialCtx: MaterialWorkspaceStageAgentContext = {
      materialTitle: ctx.bookTitle,
      promptKind: ctx.promptKind as MaterialPromptKind,
      stageId: ctx.stageId as MaterialStageId,
      stageBody: ctx.stageBody,
      allStages: ctx.allStages as Partial<Record<MaterialStageId, string>>,
      applyToStageEditor: ctx.applyToStageEditor,
      isToolCallStreamed: ctx.isToolCallStreamed,
    }
    return buildMaterialWorkspaceAdditionalTools(materialCtx)
  }

  // 书籍短篇工作台模式
  const shortStageId = ctx.stageId as ShortStageId
  const readAccess = resolveReadAccessForStage(ctx.stageReadAccess, shortStageId)
  const narrow: ShortWorkspaceStageAgentContext = {
    bookTitle: ctx.bookTitle,
    stageId: shortStageId,
    stageBody: ctx.stageBody,
    getCurrentStageBody: ctx.getCurrentStageBody,
    allStages: ctx.allStages as Partial<Record<ShortWorkspaceStageAgentContext['stageId'], string>>,
    linkedMaterial: ctx.linkedMaterial,
    stageReadAccess: ctx.stageReadAccess,
    allowedWorkspaceStages: readAccess?.workspace,
    allowedMaterialStages: readAccess?.material,
    applyToStageEditor: ctx.applyToStageEditor,
    onRequestSave: ctx.onRequestSave,
    isToolCallStreamed: ctx.isToolCallStreamed,
  }
  return buildShortWorkspaceAdditionalTools(narrow)
}
