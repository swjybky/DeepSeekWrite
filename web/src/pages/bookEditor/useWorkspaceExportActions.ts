import { useCallback } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import {
  type Book,
  type ExpertDraft,
  type StageId,
  exportDocx,
  pickFolder,
} from '../../bridge'
import { combineExpertDraftSections } from './expertDraftUtils'

type UseWorkspaceExportActionsInput = {
  book: Book | null
  coverData: string | null
  stagesRef: MutableRefObject<Record<StageId, string>>
  expertDraftRef: MutableRefObject<ExpertDraft>
  setMessage: Dispatch<SetStateAction<string | null>>
  setError: Dispatch<SetStateAction<string | null>>
}

export function useWorkspaceExportActions({
  book,
  coverData,
  stagesRef,
  expertDraftRef,
  setMessage,
  setError,
}: UseWorkspaceExportActionsInput) {
  const exportStageDocx = useCallback(async (stageId: StageId, body: string) => {
    if (!book) return
    const folder = await pickFolder()
    if (!folder) return
    setMessage(null)
    setError(null)
    try {
      const res = await exportDocx(
        book.id,
        stageId,
        folder,
        body,
        coverData,
      )
      if (res.success) {
        setMessage('导出成功')
        window.setTimeout(() => setMessage(null), 2000)
      } else {
        setError(res.error || '导出失败')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出失败')
    }
  }, [book, coverData, setError, setMessage])

  const handleExportExpertDraftDocx = useCallback(async () => {
    const currentStageBody = stagesRef.current.draft ?? ''
    const combinedBody = combineExpertDraftSections(expertDraftRef.current)
    const body = currentStageBody.trim() ? currentStageBody : combinedBody
    if (!body) {
      setMessage(null)
      setError('正文编写没有可导出的正文')
      return
    }
    await exportStageDocx('draft', body)
  }, [exportStageDocx, expertDraftRef, setError, setMessage, stagesRef])

  return {
    handleExportExpertDraftDocx,
  }
}
