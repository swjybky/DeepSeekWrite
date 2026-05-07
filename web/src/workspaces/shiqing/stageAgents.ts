import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from 'typebox'

import type { StageId } from '../../bridge'
import {
  PEEK_OTHER_STAGES_EMPTY,
  WORKSPACE_STAGE_LABELS,
  buildCharacterDesignStagePrompt,
  buildDraftStagePrompt,
  buildIntroDesignStagePrompt,
  buildOutlineStagePrompt,
  buildPlotDesignStagePrompt,
  buildPlotRefineStagePrompt,
  buildReviewStagePrompt,
} from '../shiqing/stagePrompts'
import { SHIQING_WORKSPACE_STAGES, type ShiqingStageId } from '../shiqing/stages'
import {
  buildWriteWorkspaceEditorTool,
  causalityCheatsheetTool,
  chapterStubTool,
  defineTool,
  excerptFn as excerpt,
  lineNoiseScanTool,
  manuscriptMetricsTool,
  narrativeTemplateTool,
  outlineScanTool,
  type ApplyToPayload,
  reviewRubricTool,
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

function buildPlotDesignPrompt(): string {
  return buildPlotDesignStagePrompt()
}

function buildPlotRefinePrompt(ctx: ShiqingWorkspaceStageAgentContext): string {
  return buildPlotRefineStagePrompt({
    bookTitle: ctx.bookTitle,
    otherStagesBlock: peekOtherStages(ctx, 'plot_refine'),
    stageBodyExcerpt: excerpt(ctx.stageBody),
  })
}

function buildOutlinePrompt(ctx: ShiqingWorkspaceStageAgentContext): string {
  return buildOutlineStagePrompt({
    bookTitle: ctx.bookTitle,
    otherStagesBlock: peekOtherStages(ctx, 'outline'),
    stageBodyExcerpt: excerpt(ctx.stageBody),
  })
}

function buildDraftPrompt(ctx: ShiqingWorkspaceStageAgentContext): string {
  return buildDraftStagePrompt({
    bookTitle: ctx.bookTitle,
    otherStagesBlock: peekOtherStages(ctx, 'draft'),
    stageBodyExcerpt: excerpt(ctx.stageBody),
  })
}

function buildReviewPrompt(ctx: ShiqingWorkspaceStageAgentContext): string {
  return buildReviewStagePrompt({
    bookTitle: ctx.bookTitle,
    otherStagesBlock: peekOtherStages(ctx, 'review'),
    stageBodyExcerpt: excerpt(ctx.stageBody),
  })
}

function peekOtherStages(
  ctx: ShiqingWorkspaceStageAgentContext,
  exclude: ShiqingStageId,
): string {
  const lines: string[] = []
  for (const { id: sid } of SHIQING_WORKSPACE_STAGES) {
    if (sid === exclude) continue
    const t = (ctx.allStages[sid] ?? '').trim()
    if (!t) continue
    const label = WORKSPACE_STAGE_LABELS[sid]
    lines.push(`【${label}】\n${excerpt(t, 2000)}`)
  }
  return lines.length ? lines.join('\n\n') : PEEK_OTHER_STAGES_EMPTY
}

export function getShiqingWorkspaceStageAgentDefinition(
  ctx: ShiqingWorkspaceStageAgentContext,
): { systemPrompt: string; additionalTools: AgentTool[] } {
  return {
    systemPrompt: buildShiqingWorkspaceSystemPrompt(ctx),
    additionalTools: buildShiqingWorkspaceAdditionalTools(ctx),
  }
}

function buildShiqingWorkspaceSystemPrompt(
  ctx: ShiqingWorkspaceStageAgentContext,
): string {
  let base: string
  switch (ctx.stageId) {
    case 'intro_design':
      base = buildIntroDesignStagePrompt()
      break
    case 'character_design':
      base = buildCharacterDesignStagePrompt()
      break
    case 'plot_design':
      base = buildPlotDesignPrompt()
      break
    case 'plot_refine':
      base = buildPlotRefinePrompt(ctx)
      break
    case 'outline':
      base = buildOutlinePrompt(ctx)
      break
    case 'draft':
      base = buildDraftPrompt(ctx)
      break
    case 'review':
      base = buildReviewPrompt(ctx)
      break
    default:
      base = buildPlotDesignPrompt()
  }
  return base
}

/** 在世情工作台：读取本书已保存的世情阶段正文（仅世情阶段键）。 */
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
        ],
        {
          description:
            '世情工作台阶段键名，例如 intro_design、character_design…；单次只读取该阶段',
        },
      ),
    }),
    execute: async (_toolCallId, params) => {
      const sid = params.stage_id
      const label = WORKSPACE_STAGE_LABELS[sid]
      const raw = (ctx.allStages[sid] ?? '').trim()
      const header = `书名：《${ctx.bookTitle}》\n【${label}】（${sid}）`
      if (!raw) {
        return textBlock(`${header}\n\n该阶段暂无已保存正文，请先保存书籍。`)
      }
      return textBlock(`${header}\n\n${excerpt(raw)}`)
    },
  })
}

export function buildShiqingWorkspaceAdditionalTools(
  ctx: ShiqingWorkspaceStageAgentContext,
): AgentTool[] {
  const readShiqingSaved = buildReadShiqingWorkspaceContentTool(ctx)
  const label = WORKSPACE_STAGE_LABELS[ctx.stageId]
  const plotEditorTool =
    ctx.applyToStageEditor != null
      ? buildWriteWorkspaceEditorTool({
          stageId: ctx.stageId,
          stageLabel: label,
          applyToStageEditor: ctx.applyToStageEditor,
        })
      : null
  switch (ctx.stageId) {
    case 'intro_design':
    case 'character_design':
    case 'plot_design':
      return [...(plotEditorTool ? [plotEditorTool] : []), readShiqingSaved]
    case 'plot_refine':
      return [
        sceneBeatHintTool,
        causalityCheatsheetTool,
        ...(plotEditorTool ? [plotEditorTool] : []),
        readShiqingSaved,
      ]
    case 'outline':
      return [outlineScanTool, chapterStubTool, readShiqingSaved]
    case 'draft':
      return [manuscriptMetricsTool, readShiqingSaved]
    case 'review':
      return [reviewRubricTool, lineNoiseScanTool, readShiqingSaved]
    default:
      return [narrativeTemplateTool, seedFrameTool, readShiqingSaved]
  }
}
