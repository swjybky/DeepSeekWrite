import { useCallback, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import {
  generateBookCover,
  getBookCover,
  type Book,
} from '../../bridge'
import type { BookWorkspaceSessionState } from '../../stores/workspaceStore'

type UseBookCoverRuntimeInput = {
  bookRef: MutableRefObject<Book | null>
  workspaceSessionsRef: MutableRefObject<Record<string, BookWorkspaceSessionState>>
  setCoverData: Dispatch<SetStateAction<string | null>>
  setError: Dispatch<SetStateAction<string | null>>
  setMessage: Dispatch<SetStateAction<string | null>>
  storeWorkspaceSession: (
    session: BookWorkspaceSessionState,
    makeActive: boolean,
  ) => void
}

export function useBookCoverRuntime({
  bookRef,
  workspaceSessionsRef,
  setCoverData,
  setError,
  setMessage,
  storeWorkspaceSession,
}: UseBookCoverRuntimeInput) {
  const [coverGenerating, setCoverGenerating] = useState(false)
  const [coverDialogOpen, setCoverDialogOpen] = useState(false)
  const [coverPromptDraft, setCoverPromptDraft] = useState('')
  const [coverViewerOpen, setCoverViewerOpen] = useState(false)

  const openCoverGenerateDialog = useCallback(() => {
    const currentBook = bookRef.current
    const defaultPrompt = `基于下面的书内容介绍，给我生成一个具有吸引力的书封面，封面不要有小字，给出合适配图，加上书名\n书名：${currentBook?.title ?? ''}`
    setCoverPromptDraft(defaultPrompt)
    setCoverDialogOpen(true)
  }, [bookRef])

  const clearCoverDataForActiveBook = useCallback(() => {
    const currentBookId = bookRef.current?.id
    if (!currentBookId) {
      setCoverData(null)
      return
    }
    const currentSession = workspaceSessionsRef.current[currentBookId]
    if (currentSession) {
      storeWorkspaceSession(
        { ...currentSession, coverData: null },
        true,
      )
    } else {
      setCoverData(null)
    }
  }, [bookRef, setCoverData, storeWorkspaceSession, workspaceSessionsRef])

  const confirmCoverGeneration = useCallback(() => {
    const currentBook = bookRef.current
    const prompt = coverPromptDraft.trim()
    if (!currentBook || !prompt) return
    setCoverGenerating(true)
    setCoverDialogOpen(false)
    generateBookCover(currentBook.id, prompt)
      .then(async (res) => {
        if (res.success) {
          const refreshed = await getBookCover(currentBook.id)
          const currentSession = workspaceSessionsRef.current[currentBook.id]
          if (currentSession) {
            storeWorkspaceSession(
              {
                ...currentSession,
                coverData: refreshed.cover_data,
              },
              bookRef.current?.id === currentBook.id,
            )
          } else if (bookRef.current?.id === currentBook.id) {
            setCoverData(refreshed.cover_data)
          }
          setMessage('封面生成成功')
          window.setTimeout(() => setMessage(null), 2000)
        } else {
          setError(res.error || '封面生成失败')
        }
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : '封面生成失败')
      })
      .finally(() => {
        setCoverGenerating(false)
      })
  }, [
    bookRef,
    coverPromptDraft,
    setCoverData,
    setError,
    setMessage,
    storeWorkspaceSession,
    workspaceSessionsRef,
  ])

  return {
    coverGenerating,
    coverDialogOpen,
    setCoverDialogOpen,
    coverPromptDraft,
    setCoverPromptDraft,
    coverViewerOpen,
    setCoverViewerOpen,
    openCoverGenerateDialog,
    clearCoverDataForActiveBook,
    confirmCoverGeneration,
  }
}
