import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from 'typebox'

import type { StageId } from '../../bridge'
import { SHIQING_STAGE_LABELS } from './stages'
import type { ShiqingStageId } from './stages'
import {
  causalityCheatsheetTool,
  chapterStubTool,
  defineTool,
  excerptFn as excerpt,
  manuscriptMetricsTool,
  narrativeTemplateTool,
  outlineScanTool,
  type ApplyToPayload,
  sceneBeatHintTool,
  seedFrameTool,
  textBlock,
} from '../shared/piToolkit'

export type ShiqingWorkspaceStageAgentContext = {
  bookTitle: string
  stageId: ShiqingStageId
  stageBody: string
  allStages: Partial<Record<StageId, string>>
  applyToStageEditor?: (payload: ApplyToPayload) => void
}

export function buildReadShiqingWorkspaceContentTool(
  ctx: ShiqingWorkspaceStageAgentContext,
): AgentTool {
  return defineTool({
    name: 'read_workspace_content',
    label: '读取世情工作区正文',
    description:
      '读取本书世情工作区某一阶段已保存（写入 stages）的正文，每次调用只返回一个 stage_id。不含编辑栏未写入 stages 的未保存草稿。',
    parameters: Type.Object({
      stage_id: Type.Union(
        [
          Type.Literal('intro_design'),
          Type.Literal('character_design'),
          Type.Literal('plot_design'),
          Type.Literal('plot_refine'),
          Type.Literal('outline'),
          Type.Literal('draft'),
          Type.Literal('review'),
          Type.Literal('format_conversion'),
        ],
        {
          description:
            '世情工作台阶段键名，例如 intro_design、character_design…；单次只读取该阶段',
        },
      ),
    }),
    execute: async (_toolCallId, params) => {
      const sid = params.stage_id
      const label = SHIQING_STAGE_LABELS[sid]
      const raw = (ctx.allStages[sid] ?? '').trim()
      const header = `书名：《${ctx.bookTitle}》\n【${label}】（${sid}）`
      if (!raw) {
        return textBlock(`${header}\n\n该阶段暂无已保存正文，请先保存书籍。`)
      }
      return textBlock(`${header}\n\n${excerpt(raw)}`)
    },
  })
}

/** 工作台系统提示词由后端磁盘模板提供；此处仅附加 Pi 工具。 */
export function buildShiqingWorkspaceAdditionalTools(
  ctx: ShiqingWorkspaceStageAgentContext,
): AgentTool[] {
  const readShiqingSaved = buildReadShiqingWorkspaceContentTool(ctx)
  switch (ctx.stageId) {
    case 'intro_design':
    case 'character_design':
    case 'plot_design':
      return [readShiqingSaved]
    case 'plot_refine':
      return [
        sceneBeatHintTool,
        causalityCheatsheetTool,
        readShiqingSaved,
      ]
    case 'outline':
      return [outlineScanTool, chapterStubTool, readShiqingSaved]
    case 'draft':
      return [manuscriptMetricsTool, readShiqingSaved]
    case 'review':
      return [readShiqingSaved]
    case 'format_conversion':
      return [readShiqingSaved]
    default:
      return [narrativeTemplateTool, seedFrameTool, readShiqingSaved]
  }
}
