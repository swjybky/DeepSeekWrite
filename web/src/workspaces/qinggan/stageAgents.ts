import type { AgentTool } from '@mariozechner/pi-agent-core'

import type { StageId } from '../../bridge'
import {
  QINGGAN_PEEK_EMPTY,
  QINGGAN_STAGE_LABELS,
  buildQingganCharacterStagePrompt,
  buildQingganDraftPrompt,
  buildQingganDraftReviewPrompt,
  buildQingganIntroStagePrompt,
  buildQingganOutlinePrompt,
  buildQingganOutlineReviewPrompt,
  buildQingganPlotRefinePrompt,
} from './stagePrompts'
import { QINGGAN_WORKSPACE_STAGES, type QingganStageId } from './stages'
import {
  buildWriteWorkspaceEditorTool,
  causalityCheatsheetTool,
  chapterStubTool,
  excerptFn as excerpt,
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

function peekOtherQinggan(
  ctx: QingganWorkspaceStageAgentContext,
  exclude: QingganStageId,
): string {
  const lines: string[] = []
  for (const { id: sid } of QINGGAN_WORKSPACE_STAGES) {
    if (sid === exclude) continue
    const t = (ctx.allStages[sid] ?? '').trim()
    if (!t) continue
    const label = QINGGAN_STAGE_LABELS[sid]
    lines.push(`【${label}】\n${excerpt(t, 2000)}`)
  }
  return lines.length ? lines.join('\n\n') : QINGGAN_PEEK_EMPTY
}

function refinePrompt(ctx: QingganWorkspaceStageAgentContext): string {
  return buildQingganPlotRefinePrompt({
    bookTitle: ctx.bookTitle,
    otherStagesBlock: peekOtherQinggan(ctx, 'qinggan_plot_refine'),
    stageBodyExcerpt: excerpt(ctx.stageBody),
  })
}

function outlinePrompt(ctx: QingganWorkspaceStageAgentContext): string {
  return buildQingganOutlinePrompt({
    bookTitle: ctx.bookTitle,
    otherStagesBlock: peekOtherQinggan(ctx, 'qinggan_outline'),
    stageBodyExcerpt: excerpt(ctx.stageBody),
  })
}

function outlineReviewPrompt(ctx: QingganWorkspaceStageAgentContext): string {
  return buildQingganOutlineReviewPrompt({
    bookTitle: ctx.bookTitle,
    otherStagesBlock: peekOtherQinggan(ctx, 'qinggan_outline_review'),
    stageBodyExcerpt: excerpt(ctx.stageBody),
  })
}

function draftPrompt(ctx: QingganWorkspaceStageAgentContext): string {
  return buildQingganDraftPrompt({
    bookTitle: ctx.bookTitle,
    otherStagesBlock: peekOtherQinggan(ctx, 'qinggan_draft'),
    stageBodyExcerpt: excerpt(ctx.stageBody),
  })
}

function draftReviewPrompt(ctx: QingganWorkspaceStageAgentContext): string {
  return buildQingganDraftReviewPrompt({
    bookTitle: ctx.bookTitle,
    otherStagesBlock: peekOtherQinggan(ctx, 'qinggan_draft_review'),
    stageBodyExcerpt: excerpt(ctx.stageBody),
  })
}

export function getQingganWorkspaceStageAgentDefinition(
  ctx: QingganWorkspaceStageAgentContext,
): { systemPrompt: string; additionalTools: AgentTool[] } {
  return {
    systemPrompt: buildQingganWorkspaceSystemPrompt(ctx),
    additionalTools: buildQingganWorkspaceAdditionalTools(ctx),
  }
}

function buildQingganWorkspaceSystemPrompt(
  ctx: QingganWorkspaceStageAgentContext,
): string {
  let base: string
  switch (ctx.stageId) {
    case 'qinggan_character':
      base = buildQingganCharacterStagePrompt()
      break
    case 'qinggan_intro':
      base = buildQingganIntroStagePrompt()
      break
    case 'qinggan_plot_refine':
      base = refinePrompt(ctx)
      break
    case 'qinggan_outline':
      base = outlinePrompt(ctx)
      break
    case 'qinggan_outline_review':
      base = outlineReviewPrompt(ctx)
      break
    case 'qinggan_draft':
      base = draftPrompt(ctx)
      break
    case 'qinggan_draft_review':
      base = draftReviewPrompt(ctx)
      break
    default:
      base = buildQingganCharacterStagePrompt()
  }
  if (
    ctx.applyToStageEditor &&
    (ctx.stageId === 'qinggan_character' ||
      ctx.stageId === 'qinggan_intro' ||
      ctx.stageId === 'qinggan_plot_refine')
  ) {
    return `${base}\n\n【编辑器】需要落稿时请调用工具 write_workspace_editor（replace / append）；replace 前避免误删用户已有长文。`
  }
  return base
}

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
