import type { AgentTool } from '@mariozechner/pi-agent-core'

import type { StageId } from '../../bridge'
import { QINGGAN_STAGE_LABELS, type QingganStageId } from './stages'
import {
  buildWriteWorkspaceEditorTool,
  causalityCheatsheetTool,
  chapterStubTool,
  lineNoiseScanTool,
  manuscriptMetricsTool,
  outlineScanTool,
  type ApplyToPayload,
  reviewRubricTool,
  sceneBeatHintTool,
} from '../shared/piToolkit'

export type QingganWorkspaceStageAgentContext = {
  bookTitle: string
  stageId: QingganStageId
  stageBody: string
  allStages: Partial<Record<StageId, string>>
  applyToStageEditor?: (payload: ApplyToPayload) => void
}

/** 工作台系统提示词由后端磁盘模板提供；此处仅附加 Pi 工具。 */
export function buildQingganWorkspaceAdditionalTools(
  ctx: QingganWorkspaceStageAgentContext,
): AgentTool[] {
  const plotEditorTool =
    ctx.applyToStageEditor != null
      ? buildWriteWorkspaceEditorTool({
          stageId: ctx.stageId,
          stageLabel: QINGGAN_STAGE_LABELS[ctx.stageId],
          applyToStageEditor: ctx.applyToStageEditor,
        })
      : null
  switch (ctx.stageId) {
    case 'qinggan_character':
    case 'qinggan_intro':
      return [...(plotEditorTool ? [plotEditorTool] : [])]
    case 'qinggan_plot_refine':
      return [
        sceneBeatHintTool,
        causalityCheatsheetTool,
        ...(plotEditorTool ? [plotEditorTool] : []),
      ]
    case 'qinggan_outline':
      return [outlineScanTool, chapterStubTool]
    case 'qinggan_outline_review':
      return [outlineScanTool, chapterStubTool, reviewRubricTool]
    case 'qinggan_draft':
      return [manuscriptMetricsTool]
    case 'qinggan_draft_review':
      return [reviewRubricTool, lineNoiseScanTool, manuscriptMetricsTool]
    default:
      return []
  }
}
