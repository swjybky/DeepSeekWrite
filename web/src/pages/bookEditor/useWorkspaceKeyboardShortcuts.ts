import { useEffect } from 'react'
import {
  type Book,
  isWorkspaceBook,
} from '../../bridge'

type UseWorkspaceKeyboardShortcutsInput = {
  id: string | undefined
  book: Book | null
  handleSave: () => Promise<unknown> | void
}

export function useWorkspaceKeyboardShortcuts({
  id,
  book,
  handleSave,
}: UseWorkspaceKeyboardShortcutsInput) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return
      if (!id || !book || !isWorkspaceBook(book)) return
      e.preventDefault()
      void handleSave()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [id, book, handleSave])
}
