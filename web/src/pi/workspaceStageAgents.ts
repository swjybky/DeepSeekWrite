import type { AgentTool } from '@earendil-works/pi-agent-core'

import type {
  Material,
  BookType,
  MaterialType,
  StageId,
  MaterialPromptKind,
  MaterialStageId,
  Skill,
  SkillType,
  SkillStageId,
  WorkspaceAgentReadAccessConfig,
} from '../bridge'
import {
  resolveWorkspaceAgentIdForStage,
  resolveWorkspaceAgentReadAccess,
} from '../workspaces/short/stageReadAccess'
import type { ShortStageId } from '../workspaces/short/stages'
import {
  buildShortWorkspaceAdditionalTools,
  type ShortWorkspaceStageAgentContext,
} from '../workspaces/short/stageAgents'
import {
  resolveWorkspaceAgentIdForStage as resolveScriptWorkspaceAgentIdForStage,
  resolveWorkspaceAgentReadAccess as resolveScriptWorkspaceAgentReadAccess,
} from '../workspaces/script/stageReadAccess'
import type { ScriptStageId } from '../workspaces/script/stages'
import {
  buildScriptWorkspaceAdditionalTools,
  type ScriptWorkspaceStageAgentContext,
} from '../workspaces/script/stageAgents'
import {
  buildMaterialWorkspaceAdditionalTools as buildShortMaterialWorkspaceAdditionalTools,
  type MaterialWorkspaceStageAgentContext as ShortMaterialWorkspaceStageAgentContext,
} from '../workspaces/material/short/materialStageAgents'
import {
  buildMaterialWorkspaceAdditionalTools as buildLongMaterialWorkspaceAdditionalTools,
  type MaterialWorkspaceStageAgentContext as LongMaterialWorkspaceStageAgentContext,
} from '../workspaces/material/long/materialStageAgents'
import {
  buildMaterialWorkspaceAdditionalTools as buildScriptMaterialWorkspaceAdditionalTools,
  type MaterialWorkspaceStageAgentContext as ScriptMaterialWorkspaceStageAgentContext,
} from '../workspaces/material/script/materialStageAgents'
import {
  buildSkillWorkspaceAdditionalTools as buildShortSkillWorkspaceAdditionalTools,
  type SkillWorkspaceStageAgentContext as ShortSkillWorkspaceStageAgentContext,
} from '../workspaces/skill/short/skillStageAgents'
import {
  buildSkillWorkspaceAdditionalTools as buildLongSkillWorkspaceAdditionalTools,
  type SkillWorkspaceStageAgentContext as LongSkillWorkspaceStageAgentContext,
} from '../workspaces/skill/long/skillStageAgents'
import {
  buildSkillWorkspaceAdditionalTools as buildScriptSkillWorkspaceAdditionalTools,
  type SkillWorkspaceStageAgentContext as ScriptSkillWorkspaceStageAgentContext,
} from '../workspaces/skill/script/skillStageAgents'

export type ApplyToStageEditorPayload = {
  text: string
  targetStageId?: StageId | MaterialStageId | SkillStageId
  /** replace：整段替换；append：前空则整块，否则前加 \n\n；append_token：流式 delta，仅拼接不加分段；streaming_end：流式结束标记 */
  mode: 'replace' | 'append' | 'append_token' | 'streaming_end'
}

export type WorkspaceStageAgentContext = {
  bookTitle: string
  bookType?: BookType
  materialTypeKey?: MaterialType
  skillType?: SkillType
  workspaceType?: 'book' | 'material' | 'skill'
  promptKind?: MaterialPromptKind
  stageId: StageId | MaterialStageId | SkillStageId
  activeStageContentId?: StageId | MaterialStageId | SkillStageId
  stageBody: string
  getCurrentStageBody?: (
    stageId?: StageId | MaterialStageId | SkillStageId,
  ) => string | undefined
  allStages: Partial<Record<StageId | MaterialStageId | SkillStageId, string>>
  linkedMaterial?: Material | null
  linkedSkill?: Skill | null
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
    const materialCtx:
      | ShortMaterialWorkspaceStageAgentContext
      | LongMaterialWorkspaceStageAgentContext
      | ScriptMaterialWorkspaceStageAgentContext = {
      materialTitle: ctx.bookTitle,
      promptKind: ctx.promptKind,
      stageId: ctx.stageId as MaterialStageId,
      stageBody: ctx.stageBody,
      allStages: ctx.allStages as Partial<Record<MaterialStageId, string>>,
      applyToStageEditor: ctx.applyToStageEditor,
      isToolCallStreamed: ctx.isToolCallStreamed,
    }
    if (ctx.materialTypeKey === 'script') {
      return buildScriptMaterialWorkspaceAdditionalTools(materialCtx)
    }
    if (ctx.materialTypeKey === 'long') {
      return buildLongMaterialWorkspaceAdditionalTools(materialCtx)
    }
    return buildShortMaterialWorkspaceAdditionalTools(materialCtx)
  }

  // 技能库模式
  if (ctx.workspaceType === 'skill') {
    const skillCtx:
      | ShortSkillWorkspaceStageAgentContext
      | LongSkillWorkspaceStageAgentContext
      | ScriptSkillWorkspaceStageAgentContext = {
      skillTitle: ctx.bookTitle,
      stageId: ctx.stageId as SkillStageId,
      stageBody: ctx.stageBody,
      applyToStageEditor: ctx.applyToStageEditor,
      isToolCallStreamed: ctx.isToolCallStreamed,
    }
    if (ctx.skillType === 'script') {
      return buildScriptSkillWorkspaceAdditionalTools(skillCtx)
    }
    if (ctx.skillType === 'long') {
      return buildLongSkillWorkspaceAdditionalTools(skillCtx)
    }
    return buildShortSkillWorkspaceAdditionalTools(skillCtx)
  }

  if (ctx.bookType === 'script') {
    const scriptStageId = ctx.stageId as ScriptStageId
    const readAccessAgentId = resolveScriptWorkspaceAgentIdForStage(scriptStageId)
    const readAccess = resolveScriptWorkspaceAgentReadAccess(
      ctx.workspaceAgentReadAccess,
      readAccessAgentId,
    )
    const scriptCtx: ScriptWorkspaceStageAgentContext = {
      bookTitle: ctx.bookTitle,
      stageId: scriptStageId,
      defaultWriteStageId: ctx.activeStageContentId as ScriptStageId | undefined,
      stageBody: ctx.stageBody,
      getCurrentStageBody: (stageId) => ctx.getCurrentStageBody?.(stageId),
      allStages: ctx.allStages as Partial<Record<ScriptStageId, string>>,
      linkedMaterial: ctx.linkedMaterial,
      linkedSkill: ctx.linkedSkill,
      workspaceAgentReadAccess: ctx.workspaceAgentReadAccess,
      allowedWorkspaceStages: readAccess?.workspace as readonly ScriptStageId[] | undefined,
      allowedMaterialStages: readAccess?.material as readonly MaterialStageId[] | undefined,
      applyToStageEditor: ctx.applyToStageEditor,
      onRequestSave: ctx.onRequestSave,
      isToolCallStreamed: ctx.isToolCallStreamed,
    }
    return buildScriptWorkspaceAdditionalTools(scriptCtx)
  }

  // 书籍短篇工作台模式
  const shortStageId = ctx.stageId as ShortStageId
  const readAccessAgentId = resolveWorkspaceAgentIdForStage(shortStageId)
  const readAccess = resolveWorkspaceAgentReadAccess(
    ctx.workspaceAgentReadAccess,
    readAccessAgentId,
  )
  const narrow: ShortWorkspaceStageAgentContext = {
    bookTitle: ctx.bookTitle,
    stageId: shortStageId,
    defaultWriteStageId: ctx.activeStageContentId as ShortStageId | undefined,
    stageBody: ctx.stageBody,
    getCurrentStageBody: (stageId) => ctx.getCurrentStageBody?.(stageId),
    allStages: ctx.allStages as Partial<Record<ShortWorkspaceStageAgentContext['stageId'], string>>,
    linkedMaterial: ctx.linkedMaterial,
    linkedSkill: ctx.linkedSkill,
    workspaceAgentReadAccess: ctx.workspaceAgentReadAccess,
    allowedWorkspaceStages: readAccess?.workspace as readonly ShortStageId[] | undefined,
    allowedMaterialStages: readAccess?.material as readonly MaterialStageId[] | undefined,
    applyToStageEditor: ctx.applyToStageEditor,
    onRequestSave: ctx.onRequestSave,
    isToolCallStreamed: ctx.isToolCallStreamed,
  }
  return buildShortWorkspaceAdditionalTools(narrow)
}
