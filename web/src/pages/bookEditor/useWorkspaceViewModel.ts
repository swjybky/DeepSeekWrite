import { useMemo } from 'react'
import {
  type Book,
  type BookSummary,
  type ExpertDraft,
  type StageId,
  isWorkspaceBook,
  resolveWorkspaceStagesForBook,
} from '../../bridge'
import type { BookWorkspaceSessionState } from '../../stores/workspaceStore'
import {
  ExpertDraftEditor as ShortExpertDraftEditor,
} from '../../workspaces/short/expertDraft/ExpertDraftEditor'
import {
  ExpertDraftEditor as ScriptExpertDraftEditor,
} from '../../workspaces/script/expertDraft/ExpertDraftEditor'
import { PLOT_STAGE_ID } from '../../workspaces/short/stages'
import { expertDraftSectionTreeLabel } from './expertDraftUtils'
import {
  plotChildStagesForBook,
  resolvePlotEditorStageId,
} from './stageEditing'
import type { PlotChildStageId } from './workspaceTypes'

type UseWorkspaceViewModelInput = {
  book: Book | null
  workspaceBooks: BookSummary[]
  workspaceSessions: Record<string, BookWorkspaceSessionState>
  loadedBookIds: string[]
  expertDraft: ExpertDraft
  activeStage: StageId
  activePlotChildStage: PlotChildStageId | ''
  stages: Record<StageId, string>
}

export function useWorkspaceViewModel({
  book,
  workspaceBooks,
  workspaceSessions,
  loadedBookIds,
  expertDraft,
  activeStage,
  activePlotChildStage,
  stages,
}: UseWorkspaceViewModelInput) {
  return useMemo(() => {
    const activeContentStage = resolvePlotEditorStageId(
      activeStage,
      activePlotChildStage,
    )
    const stageBody = stages[activeContentStage] ?? ''
    const activeExpertDraftSectionId = expertDraft.active_section_id || ''

    if (!book) {
      return {
        ActiveExpertDraftEditor: ShortExpertDraftEditor,
        activeContentStage,
        activeExpertDraftSectionId,
        activePlotChildLabel: '',
        activePlotChildStages: [],
        expertDraftActive: activeStage === 'draft',
        railStages: [],
        renderedWorkspaceSessions: [],
        stageBody,
        workspaceTreeBooks: [],
        workspaceTreeStages: [],
      }
    }

    const railStages = resolveWorkspaceStagesForBook(book)
    const activePlotChildStages = plotChildStagesForBook(book)
    const workspaceTreeBaseStages = railStages.map((s) => ({
      id: s.id,
      label: s.label,
      ...(s.id === PLOT_STAGE_ID
        ? {
            children: activePlotChildStages.map((child) => ({
              id: child.id,
              label: child.label,
            })),
          }
        : {}),
    }))
    const activeTreeDraft = workspaceSessions[book.id]?.expertDraft ?? expertDraft
    const workspaceTreeStages = workspaceTreeBaseStages.map((stage) => {
      if (stage.id !== 'draft') return stage
      return {
        ...stage,
        children: activeTreeDraft.sections.map((section) => ({
          id: section.id,
          label: expertDraftSectionTreeLabel(section),
        })),
        createChildLabel: '创建章节',
        createChildDisabled: activeTreeDraft.running,
      }
    })
    const workspaceTreeBooks = workspaceBooks
      .filter(
        (item) =>
          item.book_type === book.book_type &&
          isWorkspaceBook(item) &&
          item.status !== 'completed',
      )
      .map((item) => ({
        id: item.id,
        title: item.title,
        meta: item.categories.length > 0 ? item.categories.join('、') : '未分类',
        stages: item.id === book.id ? workspaceTreeStages : workspaceTreeBaseStages,
      }))
    const renderedWorkspaceSessions = loadedBookIds
      .map((bookId) => workspaceSessions[bookId])
      .filter((session): session is BookWorkspaceSessionState => Boolean(session))
      .filter(
        (session) =>
          isWorkspaceBook(session.book) &&
          session.book.book_type === book.book_type,
      )
    const activePlotChildLabel =
      activeStage === PLOT_STAGE_ID && activePlotChildStage
        ? activePlotChildStages.find((stage) => stage.id === activePlotChildStage)?.label
        : ''

    return {
      ActiveExpertDraftEditor:
        book.book_type === 'script'
          ? ScriptExpertDraftEditor
          : ShortExpertDraftEditor,
      activeContentStage,
      activeExpertDraftSectionId,
      activePlotChildLabel,
      activePlotChildStages,
      expertDraftActive: activeStage === 'draft',
      railStages,
      renderedWorkspaceSessions,
      stageBody,
      workspaceTreeBooks,
      workspaceTreeStages,
    }
  }, [
    activePlotChildStage,
    activeStage,
    book,
    expertDraft,
    loadedBookIds,
    stages,
    workspaceBooks,
    workspaceSessions,
  ])
}
