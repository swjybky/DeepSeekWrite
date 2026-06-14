import { useCallback } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type {
  Book,
  StageId,
} from '../../bridge'
import type { BookWorkspaceSessionState } from '../../stores/workspaceStore'
import { PLOT_STAGE_ID } from '../../workspaces/short/stages'
import {
  isPlotChildStageId,
  resolvePlotEditorStageId,
} from './stageEditing'
import type { PlotChildStageId } from './workspaceTypes'

type CommitWorkspaceSession = (
  bookId: string,
  updater: (current: BookWorkspaceSessionState) => BookWorkspaceSessionState,
  syncActive?: boolean,
) => BookWorkspaceSessionState | null

type UseWorkspaceStageRuntimeInput = {
  bookRef: MutableRefObject<Book | null>
  activeStageRef: MutableRefObject<StageId>
  activePlotChildStageRef: MutableRefObject<PlotChildStageId | ''>
  tokenBuffersByBookRef: MutableRefObject<
    Record<string, Partial<Record<StageId, string>>>
  >
  tokenBuffersRef: MutableRefObject<Partial<Record<StageId, string>>>
  setActiveStage: Dispatch<SetStateAction<StageId>>
  setActivePlotChildStage: Dispatch<SetStateAction<PlotChildStageId | ''>>
  commitWorkspaceSession: CommitWorkspaceSession
  cancelTokenFlush: (stageId: StageId) => void
  updateStage: (stageId: StageId, updater: (current: string) => string) => void
}

export function useWorkspaceStageRuntime({
  bookRef,
  activeStageRef,
  activePlotChildStageRef,
  tokenBuffersByBookRef,
  tokenBuffersRef,
  setActiveStage,
  setActivePlotChildStage,
  commitWorkspaceSession,
  cancelTokenFlush,
  updateStage,
}: UseWorkspaceStageRuntimeInput) {
  const setActiveBookStage = useCallback(
    (stageId: StageId) => {
      const currentBookId = bookRef.current?.id
      const nextPlotChild = ''
      activeStageRef.current = stageId
      setActiveStage(stageId)
      activePlotChildStageRef.current = nextPlotChild
      setActivePlotChildStage(nextPlotChild)
      if (currentBookId) {
        commitWorkspaceSession(
          currentBookId,
          (session) => {
            if (stageId !== 'draft' || !session.expertDraft.active_section_id) {
              return {
                ...session,
                activeStage: stageId,
                activePlotChildStage: nextPlotChild,
              }
            }
            const nextExpertDraft = {
              ...session.expertDraft,
              active_section_id: '',
            }
            return {
              ...session,
              activeStage: stageId,
              activePlotChildStage: nextPlotChild,
              expertDraft: nextExpertDraft,
              book: {
                ...session.book,
                expert_draft: nextExpertDraft,
              },
            }
          },
          true,
        )
      }
    },
    [
      activePlotChildStageRef,
      activeStageRef,
      bookRef,
      commitWorkspaceSession,
      setActivePlotChildStage,
      setActiveStage,
    ],
  )

  const selectPlotChildForBook = useCallback(
    (bookId: string, childId: PlotChildStageId) => {
      if (!isPlotChildStageId(childId)) return
      if (bookRef.current?.id === bookId) {
        activeStageRef.current = PLOT_STAGE_ID
        activePlotChildStageRef.current = childId
        setActiveStage(PLOT_STAGE_ID)
        setActivePlotChildStage(childId)
      }
      commitWorkspaceSession(
        bookId,
        (session) => ({
          ...session,
          activeStage: PLOT_STAGE_ID,
          activePlotChildStage: childId,
        }),
        bookRef.current?.id === bookId,
      )
    },
    [
      activePlotChildStageRef,
      activeStageRef,
      bookRef,
      commitWorkspaceSession,
      setActivePlotChildStage,
      setActiveStage,
    ],
  )

  const handleStageBodyChange = useCallback(
    (value: string, stageId?: StageId) => {
      const targetStage = stageId ?? resolvePlotEditorStageId(
        activeStageRef.current,
        activePlotChildStageRef.current,
      )
      const currentBookId = bookRef.current?.id
      cancelTokenFlush(targetStage)
      if (currentBookId) {
        const buffers = {
          ...(tokenBuffersByBookRef.current[currentBookId] ?? {}),
        }
        delete buffers[targetStage]
        tokenBuffersByBookRef.current[currentBookId] = buffers
        tokenBuffersRef.current = buffers
      }
      updateStage(targetStage, () => value)
    },
    [
      activePlotChildStageRef,
      activeStageRef,
      bookRef,
      cancelTokenFlush,
      tokenBuffersByBookRef,
      tokenBuffersRef,
      updateStage,
    ],
  )

  return {
    handleStageBodyChange,
    selectPlotChildForBook,
    setActiveBookStage,
  }
}
