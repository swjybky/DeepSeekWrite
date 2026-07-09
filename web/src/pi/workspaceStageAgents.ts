import type { AgentTool } from '@earendil-works/pi-agent-core'

import type {
  Material,
  MaterialKind,
  MaterialKindWithMixed,
  MaterialStageEntry,
  BookType,
  MaterialType,
  StageId,
  MaterialPromptKind,
  MaterialStageId,
  Skill,
  SkillKind,
  SkillStageEntry,
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
  resolveWorkspaceAgentIdForStage as resolveLongWorkspaceAgentIdForStage,
  resolveWorkspaceAgentReadAccess as resolveLongWorkspaceAgentReadAccess,
} from '../workspaces/long/stageReadAccess'
import type { LongStageId } from '../workspaces/long/stages'
import {
  buildLongWorkspaceAdditionalTools,
  type LongWorkspaceStageAgentContext,
} from '../workspaces/long/stageAgents'
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
  /** 内部流式回滚/迁移使用：保留首尾空白，不执行默认 trim。 */
  preserveWhitespace?: boolean
  /** replace：整段替换；append：前空则整块，否则前加 \n\n；append_token：流式 delta，仅拼接不加分段；streaming_end：流式结束标记 */
  mode: 'replace' | 'append' | 'append_token' | 'streaming_end'
}

export type WorkspaceStageAgentContext = {
  bookTitle: string
  bookType?: BookType
  materialTypeKey?: MaterialType
  materialKind?: MaterialKindWithMixed
  materialEntryKind?: MaterialKind
  materialOverview?: string
  currentEntryTitle?: string
  materialStageItems?: Partial<Record<MaterialStageId, MaterialStageEntry[]>>
  getMaterialStageItems?: () => Partial<Record<MaterialStageId, MaterialStageEntry[]>>
  getMaterialOverview?: () => string
  selectMaterialEntry?: (stageId: MaterialStageId, entryId: string) => void
  createMaterialEntry?: (input: {
    stageId: MaterialStageId
    title: string
    body: string
  }) => MaterialStageEntry | null
  editMaterialEntry?: (input: {
    stageId: MaterialStageId
    entryId: string
    title?: string
    body?: string
  }) => boolean
  writeMaterialOverview?: (text: string) => void
  skillType?: SkillType
  skillKind?: SkillKind
  skillOverview?: string
  skillStageItems?: Partial<Record<SkillStageId, SkillStageEntry[]>>
  getSkillStages?: () => Partial<Record<SkillStageId, SkillStageEntry[]>>
  getSkillOverview?: () => string
  selectSkillEntry?: (stageId: SkillStageId, entryId: string) => void
  createSkillEntry?: (input: {
    stageId: SkillStageId
    title: string
    body: string
  }) => SkillStageEntry | null
  editSkillEntry?: (input: {
    stageId: SkillStageId
    entryId: string
    title?: string
    body?: string
  }) => boolean
  writeSkillOverview?: (text: string) => void
  workspaceType?: 'book' | 'material' | 'skill'
  promptKind?: MaterialPromptKind
  stageId: StageId | MaterialStageId | SkillStageId
  activeStageContentId?: StageId | MaterialStageId | SkillStageId
  stageBody: string
  getCurrentStageBody?: (
    stageId?: StageId | MaterialStageId | SkillStageId,
  ) => string | undefined
  /** 剧情等父阶段：解析当前应写入的子槽位（运行时读取，避免快照过期） */
  getDefaultWriteStageId?: () => StageId
  allStages: Partial<Record<StageId | MaterialStageId | SkillStageId, string>>
  linkedMaterial?: Material | null
  linkedMaterialsByKind?: Partial<Record<MaterialKind, Material[]>>
  linkedSkill?: Skill | null
  linkedSkillsByKind?: Partial<Record<SkillKind, Skill[]>>
  /** 全局创作空间智能体可读配置（短篇创作空间） */
  workspaceAgentReadAccess?: WorkspaceAgentReadAccessConfig | null
  applyToStageEditor?: (payload: ApplyToStageEditorPayload) => void
  /** 剧情父阶段专用：切换左侧剧情子方向。 */
  selectPlotChildStage?: (stageId: StageId) => void
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
      materialKind: ctx.materialKind,
      promptKind: ctx.promptKind,
      stageId: ctx.stageId as MaterialStageId,
      stageBody: ctx.stageBody,
      allStages: ctx.allStages as Partial<Record<MaterialStageId, string>>,
      overview: ctx.materialOverview,
      currentEntryTitle: ctx.currentEntryTitle,
      stageItems: ctx.materialStageItems,
      getMaterialStageItems: ctx.getMaterialStageItems,
      getMaterialOverview: ctx.getMaterialOverview,
      selectMaterialEntry: ctx.selectMaterialEntry,
      createMaterialEntry: ctx.createMaterialEntry,
      editMaterialEntry: ctx.editMaterialEntry,
      writeMaterialOverview: ctx.writeMaterialOverview,
      applyToStageEditor: ctx.applyToStageEditor,
      onRequestSave: ctx.onRequestSave,
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
      skillKind: ctx.skillKind,
      overview: ctx.skillOverview,
      currentEntryTitle: ctx.currentEntryTitle,
      stageId: ctx.stageId as SkillStageId,
      stageBody: ctx.stageBody,
      stageItems: ctx.skillStageItems,
      getSkillStages: ctx.getSkillStages,
      getSkillOverview: ctx.getSkillOverview,
      selectSkillEntry: ctx.selectSkillEntry,
      createSkillEntry: ctx.createSkillEntry,
      editSkillEntry: ctx.editSkillEntry,
      writeSkillOverview: ctx.writeSkillOverview,
      applyToStageEditor: ctx.applyToStageEditor,
      onRequestSave: ctx.onRequestSave,
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
      getDefaultWriteStageId: ctx.getDefaultWriteStageId
        ? () => ctx.getDefaultWriteStageId!() as ScriptStageId
        : undefined,
      stageBody: ctx.stageBody,
      getCurrentStageBody: (stageId) => ctx.getCurrentStageBody?.(stageId),
      allStages: ctx.allStages as Partial<Record<ScriptStageId, string>>,
      linkedMaterial: ctx.linkedMaterial,
      linkedMaterialsByKind: ctx.linkedMaterialsByKind,
      linkedSkill: ctx.linkedSkill,
      linkedSkillsByKind: ctx.linkedSkillsByKind,
      workspaceAgentReadAccess: ctx.workspaceAgentReadAccess,
      allowedWorkspaceStages: readAccess?.workspace as readonly ScriptStageId[] | undefined,
      allowedMaterialStages: readAccess?.material as readonly MaterialKind[] | undefined,
      applyToStageEditor: ctx.applyToStageEditor,
      selectPlotChildStage: ctx.selectPlotChildStage
        ? (stageId) => ctx.selectPlotChildStage?.(stageId)
        : undefined,
      onRequestSave: ctx.onRequestSave,
      isToolCallStreamed: ctx.isToolCallStreamed,
    }
    return buildScriptWorkspaceAdditionalTools(scriptCtx)
  }

  if (ctx.bookType === 'long') {
    const longStageId = ctx.stageId as LongStageId
    const readAccessAgentId = resolveLongWorkspaceAgentIdForStage(longStageId)
    const readAccess = resolveLongWorkspaceAgentReadAccess(
      ctx.workspaceAgentReadAccess,
      readAccessAgentId,
    )
    const longCtx: LongWorkspaceStageAgentContext = {
      bookTitle: ctx.bookTitle,
      stageId: longStageId,
      stageBody: ctx.stageBody,
      getCurrentStageBody: (stageId) => ctx.getCurrentStageBody?.(stageId),
      allStages: ctx.allStages as Partial<Record<LongStageId, string>>,
      allowedWorkspaceStages: readAccess?.workspace as readonly LongStageId[] | undefined,
      applyToStageEditor: ctx.applyToStageEditor
        ? (payload) => ctx.applyToStageEditor?.(payload)
        : undefined,
      isToolCallStreamed: ctx.isToolCallStreamed,
    }
    return buildLongWorkspaceAdditionalTools(longCtx)
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
    getDefaultWriteStageId: ctx.getDefaultWriteStageId
      ? () => ctx.getDefaultWriteStageId!() as ShortStageId
      : undefined,
    stageBody: ctx.stageBody,
    getCurrentStageBody: (stageId) => ctx.getCurrentStageBody?.(stageId),
    allStages: ctx.allStages as Partial<Record<ShortWorkspaceStageAgentContext['stageId'], string>>,
    linkedMaterial: ctx.linkedMaterial,
    linkedMaterialsByKind: ctx.linkedMaterialsByKind,
    linkedSkill: ctx.linkedSkill,
    linkedSkillsByKind: ctx.linkedSkillsByKind,
    workspaceAgentReadAccess: ctx.workspaceAgentReadAccess,
    allowedWorkspaceStages: readAccess?.workspace as readonly ShortStageId[] | undefined,
    allowedMaterialStages: readAccess?.material as readonly MaterialKind[] | undefined,
    applyToStageEditor: ctx.applyToStageEditor,
    selectPlotChildStage: ctx.selectPlotChildStage
      ? (stageId) => ctx.selectPlotChildStage?.(stageId)
      : undefined,
    onRequestSave: ctx.onRequestSave,
    isToolCallStreamed: ctx.isToolCallStreamed,
  }
  return buildShortWorkspaceAdditionalTools(narrow)
}
