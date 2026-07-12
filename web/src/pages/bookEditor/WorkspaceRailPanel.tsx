import { WorkspaceTreeNav } from '../../components/WorkspaceTreeNav'
import type { Book, StageId } from '../../domain/workspace'
import { LongWorkspaceTree } from '../../workspaces/long/LongWorkspaceTree'
import type { LongStageId } from '../../workspaces/long/stages'
import {
  normalizeLongWorkspace,
  type LongWorkspace,
} from '../../workspaces/long/longWorkspace'
import { PLOT_STAGE_ID } from '../../workspaces/short/stages'
import type { PlotChildStageId } from './workspaceTypes'
import { isPlotChildStageId } from './stageEditing'
import type { KeyboardEvent, ReactNode } from 'react'

type TreeStage = {
  id: StageId
  label: string
  children?: { id: string; label: string }[]
  createChildLabel?: string
  createChildDisabled?: boolean
  branchClickBehavior?: 'select' | 'toggle'
}

type TreeBook = {
  id: string
  title: string
  meta: string
  stages: TreeStage[]
}

type Props = {
  book: Book
  workspaceTreeStages: TreeStage[]
  workspaceTreeBooks: TreeBook[]
  stages: Record<StageId, string>
  longWorkspace: LongWorkspace | null
  activeStage: StageId
  activePlotChildStage: PlotChildStageId | ''
  activeExpertDraftSectionId: string
  editingTitle: boolean
  titleDraft: string
  onTitleDraftChange: (value: string) => void
  onTitleEditStart: () => void
  onTitleEditEnd: () => void
  onTitleEditCancel: () => void
  titleInputControls?: ReactNode
  onTitleInputKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
  onActiveStageSelect: (stageId: StageId) => void
  onPlotChildSelect: (childId: PlotChildStageId) => void
  onExpertDraftSectionSelect: (sectionId: string) => void
  onExpertDraftSectionCreate: () => void
  onTreeBookSelect: (bookId: string) => void
  onTreeBookStageSelect: (bookId: string, stageId: StageId) => void
  onTreeBookStageChildSelect: (
    bookId: string,
    stageId: StageId,
    childId: string,
  ) => void
  onTreeBookStageChildCreate: (bookId: string, stageId: StageId) => void
}

function activeStageChildId(
  activeStage: StageId,
  activePlotChildStage: PlotChildStageId | '',
  activeExpertDraftSectionId: string,
): string | undefined {
  if (activeStage === PLOT_STAGE_ID) return activePlotChildStage || undefined
  if (activeStage === 'draft') return activeExpertDraftSectionId
  return undefined
}

export function WorkspaceRailPanel({
  book,
  workspaceTreeStages,
  workspaceTreeBooks,
  stages,
  longWorkspace,
  activeStage,
  activePlotChildStage,
  activeExpertDraftSectionId,
  editingTitle,
  titleDraft,
  onTitleDraftChange,
  onTitleEditStart,
  onTitleEditEnd,
  onTitleEditCancel,
  titleInputControls,
  onTitleInputKeyDown,
  onActiveStageSelect,
  onPlotChildSelect,
  onExpertDraftSectionSelect,
  onExpertDraftSectionCreate,
  onTreeBookSelect,
  onTreeBookStageSelect,
  onTreeBookStageChildSelect,
  onTreeBookStageChildCreate,
}: Props) {
  const childId = activeStageChildId(
    activeStage,
    activePlotChildStage,
    activeExpertDraftSectionId,
  )

  if (book.book_type === 'long') {
    return (
      <aside className="workspace-rail workspace-rail--tree">
        <LongWorkspaceTree
          rootLabel={book.title}
          workspace={longWorkspace ?? normalizeLongWorkspace(book.long_workspace, stages)}
          activeStageId={activeStage as LongStageId}
          onStageSelect={(stageId) => onActiveStageSelect(stageId as StageId)}
          editingTitle={editingTitle}
          titleDraft={titleDraft}
          onTitleDraftChange={onTitleDraftChange}
          onTitleEditStart={onTitleEditStart}
          onTitleEditEnd={onTitleEditEnd}
          onTitleEditCancel={onTitleEditCancel}
          titleInputControls={titleInputControls}
          onTitleInputKeyDown={onTitleInputKeyDown}
        />
      </aside>
    )
  }

  return (
    <aside className="workspace-rail workspace-rail--tree">
      {book.status === 'completed' ? (
        <WorkspaceTreeNav
          rootLabel={book.title}
          stages={workspaceTreeStages}
          defaultExpanded
          activeStageId={activeStage}
          activeStageChildId={childId}
          onStageSelect={(stageId) => onActiveStageSelect(stageId as StageId)}
          onStageChildSelect={(stageId, childId) => {
            if (stageId === PLOT_STAGE_ID && isPlotChildStageId(childId)) {
              onPlotChildSelect(childId)
            }
            if (stageId === 'draft') onExpertDraftSectionSelect(childId)
          }}
          onStageChildCreate={(stageId) => {
            if (stageId === 'draft') onExpertDraftSectionCreate()
          }}
          editingTitle={editingTitle}
          titleDraft={titleDraft}
          onTitleDraftChange={onTitleDraftChange}
          onTitleEditStart={onTitleEditStart}
          onTitleEditEnd={onTitleEditEnd}
          onTitleEditCancel={onTitleEditCancel}
          titleInputControls={titleInputControls}
          onTitleInputKeyDown={onTitleInputKeyDown}
        />
      ) : (
        <WorkspaceTreeNav
          books={workspaceTreeBooks}
          defaultExpanded={false}
          activeBookId={book.id}
          activeStageId={activeStage}
          activeStageChildId={childId}
          onStageSelect={(stageId) =>
            onTreeBookStageSelect(book.id, stageId as StageId)
          }
          onBookSelect={onTreeBookSelect}
          onBookStageSelect={(bookId, stageId) =>
            onTreeBookStageSelect(bookId, stageId as StageId)
          }
          onBookStageChildSelect={(bookId, stageId, childId) =>
            onTreeBookStageChildSelect(
              bookId,
              stageId as StageId,
              childId,
            )
          }
          onBookStageChildCreate={(bookId, stageId) =>
            onTreeBookStageChildCreate(bookId, stageId as StageId)
          }
          editingTitle={editingTitle}
          titleDraft={titleDraft}
          onTitleDraftChange={onTitleDraftChange}
          onTitleEditStart={onTitleEditStart}
          onTitleEditEnd={onTitleEditEnd}
          onTitleEditCancel={onTitleEditCancel}
          titleInputControls={titleInputControls}
          onTitleInputKeyDown={onTitleInputKeyDown}
        />
      )}
    </aside>
  )
}
