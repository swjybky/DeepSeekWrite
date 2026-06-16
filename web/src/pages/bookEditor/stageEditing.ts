import type {
  Book,
  BookSummary,
  StageId,
  WorkspaceAgentId,
  WorkspaceAgentReadAccessConfig,
} from '../../domain/workspace'
import {
  PLOT_CHILD_STAGES as SHORT_PLOT_CHILD_STAGES,
  PLOT_STAGE_ID,
} from '../../workspaces/short/stages'
import {
  PLOT_CHILD_STAGES as SCRIPT_PLOT_CHILD_STAGES,
} from '../../workspaces/script/stages'
import {
  resolveWorkspaceAgentReadAccess as resolveShortWorkspaceAgentReadAccess,
} from '../../workspaces/short/stageReadAccess'
import {
  resolveWorkspaceAgentReadAccess as resolveScriptWorkspaceAgentReadAccess,
} from '../../workspaces/script/stageReadAccess'
import type {
  PlotChildStageDefinition,
  PlotChildStageId,
} from './workspaceTypes'

export function workspaceBookType(
  book: Pick<Book, 'book_type'> | BookSummary | null | undefined,
): 'short' | 'script' {
  return book?.book_type === 'script' ? 'script' : 'short'
}

export function plotChildStagesForBook(
  book: Pick<Book, 'book_type'> | BookSummary | null | undefined,
): readonly PlotChildStageDefinition[] {
  return workspaceBookType(book) === 'script'
    ? SCRIPT_PLOT_CHILD_STAGES
    : SHORT_PLOT_CHILD_STAGES
}

export function defaultPlotChildStageForBook(
  book: Pick<Book, 'book_type'> | BookSummary | null | undefined,
): PlotChildStageId | '' {
  return plotChildStagesForBook(book)[0]?.id ?? ''
}

export function resolveReadAccessForBook(
  book: Pick<Book, 'book_type'> | BookSummary | null | undefined,
  config: WorkspaceAgentReadAccessConfig | null | undefined,
  agentId: WorkspaceAgentId,
) {
  return workspaceBookType(book) === 'script'
    ? resolveScriptWorkspaceAgentReadAccess(config, agentId)
    : resolveShortWorkspaceAgentReadAccess(config, agentId)
}

export function isPlotChildStageId(stageId: string): stageId is PlotChildStageId {
  return (
    SHORT_PLOT_CHILD_STAGES.some((stage) => stage.id === stageId) ||
    SCRIPT_PLOT_CHILD_STAGES.some((stage) => stage.id === stageId)
  )
}

export function resolvePlotEditorStageId(
  activeStage: StageId,
  activePlotChildStage: PlotChildStageId | '',
): StageId {
  if (activeStage !== PLOT_STAGE_ID) return activeStage
  return activePlotChildStage || PLOT_STAGE_ID
}

/** 总字符长度与不含 Unicode 空白类字符的字数（换行不计入后者） */
export function stageTextCounts(text: string): { total: number; nonSpace: number } {
  return {
    total: text.length,
    nonSpace: text.replace(/\p{White_Space}/gu, '').length,
  }
}
