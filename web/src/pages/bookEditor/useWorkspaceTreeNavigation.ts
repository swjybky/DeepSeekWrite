import { useCallback } from 'react'
import type { MutableRefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  resolveWorkspaceStagesForBook,
  type Book,
  type BookSummary,
  type StageId,
} from '../../bridge'
import type { BookWorkspaceSessionState } from '../../stores/workspaceStore'
import { PLOT_STAGE_ID } from '../../workspaces/short/stages'
import {
  isPlotChildStageId,
} from './stageEditing'
import type {
  PlotChildStageId,
  SaveCurrentBookOptions,
} from './workspaceTypes'

type UseWorkspaceTreeNavigationInput = {
  book: Book | null
  workspaceBooks: BookSummary[]
  bookRef: MutableRefObject<Book | null>
  workspaceSessionsRef: MutableRefObject<Record<string, BookWorkspaceSessionState>>
  pendingInitialStageRef: MutableRefObject<{
    bookId: string
    stageId: StageId
    childId?: PlotChildStageId
  } | null>
  activeStageRef: MutableRefObject<StageId>
  waitForSaveIdle: (timeoutMs?: number) => Promise<boolean>
  saveCurrentBook: (options?: SaveCurrentBookOptions) => Promise<Book | null>
  setActiveBookStage: (stageId: StageId) => void
  selectPlotChildForBook: (bookId: string, childId: PlotChildStageId) => void
  selectExpertDraftSectionForBook: (bookId: string, sectionId: string) => void
  createExpertDraftSectionForBook: (bookId: string) => void
  setError: (message: string | null) => void
}

export function useWorkspaceTreeNavigation({
  book,
  workspaceBooks,
  bookRef,
  workspaceSessionsRef,
  pendingInitialStageRef,
  activeStageRef,
  waitForSaveIdle,
  saveCurrentBook,
  setActiveBookStage,
  selectPlotChildForBook,
  selectExpertDraftSectionForBook,
  createExpertDraftSectionForBook,
  setError,
}: UseWorkspaceTreeNavigationInput) {
  const navigate = useNavigate()

  const handleTreeBookStageSelect = useCallback(
    async (targetBookId: string, targetStageId: StageId) => {
      if (!book) return
      if (
        targetBookId === book.id &&
        targetStageId === activeStageRef.current
      ) {
        if (targetStageId === PLOT_STAGE_ID) {
          setActiveBookStage(PLOT_STAGE_ID)
        }
        if (targetStageId === 'draft') {
          setActiveBookStage('draft')
        }
        return
      }
      if (targetBookId === book.id) {
        setActiveBookStage(targetStageId)
        return
      }
      pendingInitialStageRef.current = {
        bookId: targetBookId,
        stageId: targetStageId,
      }
      if (!(await waitForSaveIdle())) {
        pendingInitialStageRef.current = null
        setError('正在保存，请稍后再切换书籍')
        return
      }
      const saved = await saveCurrentBook({ successMessage: null })
      if (!saved) {
        pendingInitialStageRef.current = null
        return
      }
      navigate(`/book/${targetBookId}`)
    },
    [
      activeStageRef,
      book,
      navigate,
      pendingInitialStageRef,
      saveCurrentBook,
      setActiveBookStage,
      setError,
      waitForSaveIdle,
    ],
  )

  const handleTreeBookStageChildSelect = useCallback(
    async (targetBookId: string, targetStageId: StageId, childId: string) => {
      if (targetStageId === PLOT_STAGE_ID && isPlotChildStageId(childId)) {
        if (!book) return
        if (targetBookId === book.id) {
          selectPlotChildForBook(targetBookId, childId)
          return
        }
        pendingInitialStageRef.current = {
          bookId: targetBookId,
          stageId: PLOT_STAGE_ID,
          childId,
        }
        if (!(await waitForSaveIdle())) {
          pendingInitialStageRef.current = null
          setError('正在保存，请稍后再切换书籍')
          return
        }
        const saved = await saveCurrentBook({ successMessage: null })
        if (!saved) {
          pendingInitialStageRef.current = null
          return
        }
        navigate(`/book/${targetBookId}`)
        return
      }
      if (targetStageId !== 'draft') {
        await handleTreeBookStageSelect(targetBookId, targetStageId)
        return
      }
      await handleTreeBookStageSelect(targetBookId, 'draft')
      selectExpertDraftSectionForBook(targetBookId, childId)
    },
    [
      book,
      handleTreeBookStageSelect,
      navigate,
      pendingInitialStageRef,
      saveCurrentBook,
      selectExpertDraftSectionForBook,
      selectPlotChildForBook,
      setError,
      waitForSaveIdle,
    ],
  )

  const handleTreeBookStageChildCreate = useCallback(
    (targetBookId: string, targetStageId: StageId) => {
      if (targetStageId !== 'draft') return
      if (targetBookId === bookRef.current?.id) {
        setActiveBookStage('draft')
      }
      createExpertDraftSectionForBook(targetBookId)
    },
    [bookRef, createExpertDraftSectionForBook, setActiveBookStage],
  )

  const handleTreeBookSelect = useCallback(
    (targetBookId: string) => {
      const cached = workspaceSessionsRef.current[targetBookId]
      if (cached) {
        void handleTreeBookStageSelect(targetBookId, cached.activeStage)
        return
      }
      const summary = workspaceBooks.find((item) => item.id === targetBookId)
      const rows = resolveWorkspaceStagesForBook(summary)
      void handleTreeBookStageSelect(targetBookId, rows[0]!.id)
    },
    [handleTreeBookStageSelect, workspaceBooks, workspaceSessionsRef],
  )

  return {
    handleTreeBookSelect,
    handleTreeBookStageChildCreate,
    handleTreeBookStageChildSelect,
    handleTreeBookStageSelect,
  }
}
