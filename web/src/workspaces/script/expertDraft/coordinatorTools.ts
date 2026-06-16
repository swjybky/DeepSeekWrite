import type { AgentTool } from '@earendil-works/pi-agent-core'

import type { Material, MaterialStageId, Skill, StageId } from '../../../bridge'
import {
  buildExpertDraftCoordinatorCoreTools,
  type ExpertDraftCoordinatorCoreToolContext,
} from '../../shared/expertDraftCoordinatorTools'
import type { GetExpertDraftSectionContent } from '../../shared/expertDraftSectionTools'
import {
  buildReadLinkedMaterialContentTool,
  buildReadWorkspaceContentTool,
  buildSearchWorkspaceTextTool,
} from '../stageAgents'
import { buildLoadSkillTool } from '../loadSkill'
import type { WorkspaceAgentReadAccessEntry } from '../stageReadAccess'
import type { ScriptStageId } from '../stages'

export type ExpertDraftCoordinatorToolContext = ExpertDraftCoordinatorCoreToolContext & {
  allStages: Partial<Record<StageId, string>>
  linkedMaterial?: Material | null
  linkedSkill?: Skill | null
  readAccess: WorkspaceAgentReadAccessEntry
  getRenderedExpertDraftSectionContent?: GetExpertDraftSectionContent
  /** 优先读取编辑框/会话最新内容，与 edit_expert_draft_section 同源 */
  getCurrentWorkspaceStageBody?: (stageId: StageId) => string | undefined
}

export function buildExpertDraftCoordinatorTools(
  ctx: ExpertDraftCoordinatorToolContext,
): AgentTool[] {
  const readTools: AgentTool[] = []
  const readLiveStageBody = (stageId: ScriptStageId): string => {
    const live = ctx.getCurrentWorkspaceStageBody?.(stageId)
    if (live !== undefined) return live
    if (stageId === 'draft') return ctx.getExpertDraftStageBody()
    return ctx.allStages[stageId] ?? ''
  }
  const toolCtx = {
    bookTitle: ctx.bookTitle,
    stageId: 'draft' as const,
    stageBody: '',
    allStages: ctx.allStages,
    linkedMaterial: ctx.linkedMaterial ?? null,
    getCurrentStageBody: readLiveStageBody,
  }
  if (ctx.readAccess.workspace.length > 0) {
    readTools.push(
      buildReadWorkspaceContentTool(
        toolCtx,
        ctx.readAccess.workspace as readonly ScriptStageId[],
      ),
    )
  }
  readTools.push(
    buildSearchWorkspaceTextTool(
      toolCtx,
      ctx.readAccess.workspace as readonly ScriptStageId[],
    ),
  )
  if (ctx.readAccess.material.length > 0) {
    readTools.push(
      buildReadLinkedMaterialContentTool(
        toolCtx,
        ctx.readAccess.material as readonly MaterialStageId[],
      ),
    )
  }
  readTools.push(
    buildLoadSkillTool({
      linkedSkill: ctx.linkedSkill,
      currentStageId: 'expert_draft_coordinator',
    }),
  )

  return [
    ...readTools,
    ...buildExpertDraftCoordinatorCoreTools({
      bookTitle: ctx.bookTitle,
      getDraft: ctx.getDraft,
      updateDraft: ctx.updateDraft,
      getExpertDraftStageBody: ctx.getExpertDraftStageBody,
      applyExpertDraftStageBody: ctx.applyExpertDraftStageBody,
      startWriting: ctx.startWriting,
      skipIntroByDefault: false,
      firstSectionFallbackTitle: '第一节',
    }),
  ]
}
