import type { AgentTool } from '@earendil-works/pi-agent-core'

import type {
  Material,
  StageId,
  MaterialPromptKind,
  MaterialStageId,
  SkillStageId,
  WorkspaceAgentReadAccessConfig,
} from '../bridge'
import { resolveWorkspaceAgentReadAccess } from '../workspaces/short/stageReadAccess'
import type { ShortStageId } from '../workspaces/short/stages'
import {
  buildShortWorkspaceAdditionalTools,
  type ShortWorkspaceStageAgentContext,
} from '../workspaces/short/stageAgents'
import {
  buildMaterialWorkspaceAdditionalTools,
  type MaterialWorkspaceStageAgentContext,
} from '../workspaces/material/materialStageAgents'
import {
  buildSkillWorkspaceAdditionalTools,
  type SkillWorkspaceStageAgentContext,
} from '../workspaces/skill/skillStageAgents'

export type ApplyToStageEditorPayload = {
  text: string
  /** replace：整段替换；append：前空则整块，否则前加 \n\n；append_token：流式 delta，仅拼接不加分段；streaming_end：流式结束标记 */
  mode: 'replace' | 'append' | 'append_token' | 'streaming_end'
}

export type WorkspaceStageAgentContext = {
  bookTitle: string
  workspaceType?: 'book' | 'material' | 'skill'
  promptKind?: MaterialPromptKind
  stageId: StageId | MaterialStageId | SkillStageId
  stageBody: string
  getCurrentStageBody?: (
    stageId?: StageId | MaterialStageId | SkillStageId,
  ) => string | undefined
  allStages: Partial<Record<StageId | MaterialStageId | SkillStageId, string>>
  linkedMaterial?: Material | null
  /** 全局创作空间智能体可读配置（短篇创作空间） */
  workspaceAgentReadAccess?: WorkspaceAgentReadAccessConfig | null
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
  if (ctx.workspaceType === 'material') {
    if (!ctx.promptKind) return []
    const materialCtx: MaterialWorkspaceStageAgentContext = {
      materialTitle: ctx.bookTitle,
      promptKind: ctx.promptKind,
      stageId: ctx.stageId as MaterialStageId,
      stageBody: ctx.stageBody,
      allStages: ctx.allStages as Partial<Record<MaterialStageId, string>>,
      applyToStageEditor: ctx.applyToStageEditor,
      isToolCallStreamed: ctx.isToolCallStreamed,
    }
    return buildMaterialWorkspaceAdditionalTools(materialCtx)
  }

  // 技能库模式
  if (ctx.workspaceType === 'skill') {
    const skillCtx: SkillWorkspaceStageAgentContext = {
      skillTitle: ctx.bookTitle,
      stageId: ctx.stageId as SkillStageId,
      stageBody: ctx.stageBody,
      applyToStageEditor: ctx.applyToStageEditor,
      isToolCallStreamed: ctx.isToolCallStreamed,
    }
    return buildSkillWorkspaceAdditionalTools(skillCtx)
  }

  // 书籍短篇工作台模式
  const shortStageId = ctx.stageId as ShortStageId
  const readAccess = resolveWorkspaceAgentReadAccess(
    ctx.workspaceAgentReadAccess,
    shortStageId,
  )
  const narrow: ShortWorkspaceStageAgentContext = {
    bookTitle: ctx.bookTitle,
    stageId: shortStageId,
    stageBody: ctx.stageBody,
    getCurrentStageBody: (stageId) => ctx.getCurrentStageBody?.(stageId),
    allStages: ctx.allStages as Partial<Record<ShortWorkspaceStageAgentContext['stageId'], string>>,
    linkedMaterial: ctx.linkedMaterial,
    workspaceAgentReadAccess: ctx.workspaceAgentReadAccess,
    allowedWorkspaceStages: readAccess?.workspace,
    allowedMaterialStages: readAccess?.material,
    applyToStageEditor: ctx.applyToStageEditor,
    onRequestSave: ctx.onRequestSave,
    isToolCallStreamed: ctx.isToolCallStreamed,
  }
  return buildShortWorkspaceAdditionalTools(narrow)
}
