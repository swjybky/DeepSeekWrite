import { useCallback, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import {
  saveBook,
  type Book,
} from '../../bridge'
import type { BookWorkspaceSessionState } from '../../stores/workspaceStore'

type UseWorkspaceTitleEditingInput = {
  bookRef: MutableRefObject<Book | null>
  workspaceSessionsRef: MutableRefObject<Record<string, BookWorkspaceSessionState>>
  setBook: Dispatch<SetStateAction<Book | null>>
  setError: Dispatch<SetStateAction<string | null>>
  setMessage: Dispatch<SetStateAction<string | null>>
  storeWorkspaceSession: (
    session: BookWorkspaceSessionState,
    makeActive: boolean,
  ) => void
  syncWorkspaceBookSummary: (book: Book) => void
}

export function useWorkspaceTitleEditing({
  bookRef,
  workspaceSessionsRef,
  setBook,
  setError,
  setMessage,
  storeWorkspaceSession,
  syncWorkspaceBookSummary,
}: UseWorkspaceTitleEditingInput) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')

  const handleTitleEditStart = useCallback(() => {
    setTitleDraft(bookRef.current?.title ?? '')
    setEditingTitle(true)
  }, [bookRef])

  const handleTitleEditEnd = useCallback(() => {
    const currentBook = bookRef.current
    const trimmed = titleDraft.trim()
    if (currentBook && trimmed && trimmed !== currentBook.title) {
      void (async () => {
        try {
          const next = await saveBook(currentBook.id, { title: trimmed })
          if (next) {
            const currentSession = workspaceSessionsRef.current[next.id]
            if (currentSession) {
              storeWorkspaceSession(
                { ...currentSession, book: next },
                bookRef.current?.id === next.id,
              )
            } else {
              setBook(next)
            }
            syncWorkspaceBookSummary(next)
            setMessage('书名已修改')
            window.setTimeout(() => setMessage(null), 2000)
          } else {
            setError('保存书名失败')
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : '保存书名失败')
        }
      })()
    }
    setEditingTitle(false)
    setTitleDraft('')
  }, [
    bookRef,
    setBook,
    setError,
    setMessage,
    storeWorkspaceSession,
    syncWorkspaceBookSummary,
    titleDraft,
    workspaceSessionsRef,
  ])

  const handleTitleEditCancel = useCallback(() => {
    setEditingTitle(false)
    setTitleDraft('')
  }, [])

  return {
    editingTitle,
    titleDraft,
    setTitleDraft,
    handleTitleEditStart,
    handleTitleEditEnd,
    handleTitleEditCancel,
  }
}
