import { useCallback } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type {
  Book,
  StageId,
} from '../../bridge'
import type { BookWorkspaceSessionState } from '../../stores/workspaceStore'

type CommitWorkspaceSession = (
  bookId: string,
  updater: (current: BookWorkspaceSessionState) => BookWorkspaceSessionState,
  syncActive?: boolean,
) => BookWorkspaceSessionState | null

type UseWorkspaceChatEpochsInput = {
  bookRef: MutableRefObject<Book | null>
  workspaceSessionsRef: MutableRefObject<Record<string, BookWorkspaceSessionState>>
  aiChatEpochByStage: Partial<Record<StageId, number>>
  expertAiChatEpoch: number
  setAiChatEpochByStage: Dispatch<
    SetStateAction<Partial<Record<StageId, number>>>
  >
  setExpertAiChatEpoch: Dispatch<SetStateAction<number>>
  commitWorkspaceSession: CommitWorkspaceSession
}

export function useWorkspaceChatEpochs({
  bookRef,
  workspaceSessionsRef,
  aiChatEpochByStage,
  expertAiChatEpoch,
  setAiChatEpochByStage,
  setExpertAiChatEpoch,
  commitWorkspaceSession,
}: UseWorkspaceChatEpochsInput) {
  const bumpActiveStageChatEpoch = useCallback(
    (stageId: StageId) => {
      const currentBookId = bookRef.current?.id
      if (!currentBookId) return
      const currentSession = workspaceSessionsRef.current[currentBookId]
      const currentEpochs =
        currentSession?.aiChatEpochByStage ?? aiChatEpochByStage
      const nextEpochs = {
        ...currentEpochs,
        [stageId]: (currentEpochs[stageId] ?? 0) + 1,
      }
      setAiChatEpochByStage(nextEpochs)
      commitWorkspaceSession(
        currentBookId,
        (session) => ({ ...session, aiChatEpochByStage: nextEpochs }),
        false,
      )
    },
    [
      aiChatEpochByStage,
      bookRef,
      commitWorkspaceSession,
      setAiChatEpochByStage,
      workspaceSessionsRef,
    ],
  )

  const bumpActiveExpertChatEpoch = useCallback(() => {
    const currentBookId = bookRef.current?.id
    if (!currentBookId) return
    const currentSession = workspaceSessionsRef.current[currentBookId]
    const nextEpoch = (currentSession?.expertAiChatEpoch ?? expertAiChatEpoch) + 1
    setExpertAiChatEpoch(nextEpoch)
    commitWorkspaceSession(
      currentBookId,
      (session) => ({ ...session, expertAiChatEpoch: nextEpoch }),
      false,
    )
  }, [
    bookRef,
    commitWorkspaceSession,
    expertAiChatEpoch,
    setExpertAiChatEpoch,
    workspaceSessionsRef,
  ])

  return {
    bumpActiveExpertChatEpoch,
    bumpActiveStageChatEpoch,
  }
}
