import { useCallback } from 'react'
import type { MutableRefObject } from 'react'
import {
  type Book,
  defaultExpertDraft,
  type ExpertDraft,
  mergeStagePatchIntoAll,
  normalizeExpertDraft,
  resolveWorkspaceBookGenre,
  type StageId,
} from '../../bridge'
import type { WorkspaceAgentReadAccessConfig } from '../../workspaces/shared/readAccess'
import {
  runExpertDraftSectionWriter as runShortExpertDraftSectionWriter,
  type ExpertDraftSectionContentField,
  type GetExpertDraftSectionContent,
  type RunExpertDraftSectionWriterOptions,
} from '../../workspaces/short/expertDraft/sectionWriter'
import {
  EXPERT_SECTION_WRITER_AGENT_ID,
} from '../../workspaces/short/stageReadAccess'
import {
  runExpertDraftSectionWriter as runScriptExpertDraftSectionWriter,
} from '../../workspaces/script/expertDraft/sectionWriter'
import type { BookWorkspaceSessionState } from '../../stores/workspaceStore'
import {
  defaultExpertDraftStateTitle,
  expertDraftSectionTitleForIndex,
  nextExpertDraftSectionId,
} from './expertDraftUtils'
import { resolveReadAccessForBook } from './stageEditing'
import { syncExpertDraftSectionTextarea } from './liveStageBody'
import {
  EMPTY_STAGES,
} from './workspaceTypes'

type CommitWorkspaceSession = (
  bookId: string,
  updater: (current: BookWorkspaceSessionState) => BookWorkspaceSessionState,
  syncActive?: boolean,
) => BookWorkspaceSessionState | null

type UseExpertDraftRuntimeInput = {
  bookRef: MutableRefObject<Book | null>
  workspaceSessionsRef: MutableRefObject<Record<string, BookWorkspaceSessionState>>
  expertDraftRef: MutableRefObject<ExpertDraft>
  expertDraftActiveSectionEditorRef: MutableRefObject<{
    sectionId: string
    body: HTMLTextAreaElement | null
    state: HTMLTextAreaElement | null
  }>
  expertRunAbortRef: MutableRefObject<AbortController | null>
  expertRunPromiseRef: MutableRefObject<Promise<void> | null>
  expertRunAbortByBookRef: MutableRefObject<Record<string, AbortController | null>>
  expertRunPromiseByBookRef: MutableRefObject<Record<string, Promise<void> | null>>
  workspaceAgentReadAccess: WorkspaceAgentReadAccessConfig
  commitWorkspaceSession: CommitWorkspaceSession
  updateExpertDraftForBook: (
    bookId: string,
    updater: (current: ExpertDraft) => ExpertDraft,
  ) => void
  getCurrentWorkspaceStageBody?: (stageId: StageId) => string | undefined
  setActiveBookStage: (stageId: StageId) => void
  setError: (message: string | null) => void
  setMessage: (message: string | null) => void
}

export function useExpertDraftRuntime({
  bookRef,
  workspaceSessionsRef,
  expertDraftRef,
  expertDraftActiveSectionEditorRef,
  expertRunAbortRef,
  expertRunPromiseRef,
  expertRunAbortByBookRef,
  expertRunPromiseByBookRef,
  workspaceAgentReadAccess,
  commitWorkspaceSession,
  updateExpertDraftForBook,
  getCurrentWorkspaceStageBody,
  setActiveBookStage,
  setError,
  setMessage,
}: UseExpertDraftRuntimeInput) {
  const handleExpertDraftSectionTextareaRef = useCallback(
    (
      sectionId: string,
      field: 'body' | 'character_state',
      node: HTMLTextAreaElement | null,
    ) => {
      const slot = expertDraftActiveSectionEditorRef.current
      slot.sectionId = sectionId
      if (field === 'body') {
        slot.body = node
      } else {
        slot.state = node
      }
    },
    [expertDraftActiveSectionEditorRef],
  )

  const getRenderedExpertDraftSectionContent = useCallback<
    GetExpertDraftSectionContent
  >((sectionId, field) => {
    const slot = expertDraftActiveSectionEditorRef.current
    if (slot.sectionId !== sectionId) return undefined
    const node = field === 'body' ? slot.body : slot.state
    return node?.value
  }, [expertDraftActiveSectionEditorRef])

  const syncExpertDraftSectionField = useCallback(
    (
      sectionId: string,
      field: ExpertDraftSectionContentField,
      body: string,
    ) => {
      syncExpertDraftSectionTextarea(
        expertDraftActiveSectionEditorRef,
        sectionId,
        field,
        body,
      )
    },
    [expertDraftActiveSectionEditorRef],
  )

  const selectExpertDraftSectionForBook = useCallback(
    (bookId: string, sectionId: string) => {
      updateExpertDraftForBook(bookId, (draft) => {
        if (!draft.sections.some((section) => section.id === sectionId)) {
          return draft
        }
        return {
          ...draft,
          active_section_id: sectionId,
        }
      })
    },
    [updateExpertDraftForBook],
  )

  const createExpertDraftSectionForBook = useCallback(
    (bookId: string) => {
      updateExpertDraftForBook(bookId, (draft) => {
        if (draft.running) return draft
        const session = workspaceSessionsRef.current[bookId]
        const bookType = session?.book.book_type ?? 'short'
        const id = nextExpertDraftSectionId(draft.sections)
        const title = expertDraftSectionTitleForIndex(draft.sections.length, bookType)
        return {
          ...draft,
          active_section_id: id,
          sections: [
            ...draft.sections,
            { id, title, word_count_requirement: '', body: '' },
          ],
          character_states: [
            ...draft.character_states,
            {
              section_id: id,
              title: defaultExpertDraftStateTitle(title),
              body: '',
            },
          ],
        }
      })
    },
    [updateExpertDraftForBook, workspaceSessionsRef],
  )

  const handleExpertDraftSectionSelect = useCallback(
    (sectionId: string) => {
      const currentBookId = bookRef.current?.id
      if (!currentBookId) return
      setActiveBookStage('draft')
      selectExpertDraftSectionForBook(currentBookId, sectionId)
    },
    [bookRef, selectExpertDraftSectionForBook, setActiveBookStage],
  )

  const handleExpertDraftSectionCreate = useCallback(() => {
    const currentBookId = bookRef.current?.id
    if (!currentBookId) return
    setActiveBookStage('draft')
    createExpertDraftSectionForBook(currentBookId)
  }, [bookRef, createExpertDraftSectionForBook, setActiveBookStage])

  const startExpertWritingForBook = useCallback(
    (
      bookId: string,
      sectionIds: string[],
      options?: {
        userWritingPrompt?: string
        callbacks?: Pick<
          RunExpertDraftSectionWriterOptions,
          'onSectionAgentStart' | 'onRunFinish'
        >
      },
    ) => {
      const session = workspaceSessionsRef.current[bookId]
      if (
        !session ||
        expertRunPromiseByBookRef.current[bookId] ||
        session.expertDraft.running
      ) {
        return false
      }
      const available = new Set(session.expertDraft.sections.map((s) => s.id))
      const ids = sectionIds
        .map((sid) => sid.trim())
        .filter((sid) => sid && available.has(sid))
      if (ids.length === 0) return false

      const ac = new AbortController()
      expertRunAbortByBookRef.current[bookId] = ac
      if (bookRef.current?.id === bookId) {
        expertRunAbortRef.current = ac
      }
      updateExpertDraftForBook(bookId, (draft) => ({
        ...draft,
        running: true,
        active_section_id: ids[0] ?? '',
      }))

      const runExpertDraftSectionWriter =
        session.book.book_type === 'script'
          ? runScriptExpertDraftSectionWriter
          : runShortExpertDraftSectionWriter
      const run = runExpertDraftSectionWriter({
        bookId: session.book.id,
        bookTitle: session.book.title,
        bookGenre: resolveWorkspaceBookGenre(session.book),
        sectionIds: ids,
        getDraft: () =>
          workspaceSessionsRef.current[bookId]?.expertDraft ??
          normalizeExpertDraft(null, false, session.book.book_type),
        getWorkspaceStages: () =>
          workspaceSessionsRef.current[bookId]?.stages ?? EMPTY_STAGES,
        linkedMaterial: session.linkedMaterial,
        linkedSkill: session.linkedSkill,
        userWritingPrompt: options?.userWritingPrompt,
        readAccess: resolveReadAccessForBook(
          session.book,
          workspaceAgentReadAccess,
          EXPERT_SECTION_WRITER_AGENT_ID,
        ),
        getRenderedExpertDraftSectionContent,
        getCurrentWorkspaceStageBody: (stageId) => {
          const live = getCurrentWorkspaceStageBody?.(stageId)
          if (live !== undefined) return live
          return workspaceSessionsRef.current[bookId]?.stages[stageId]
        },
        syncExpertDraftSectionField,
        updateDraft: (updater) => updateExpertDraftForBook(bookId, updater),
        signal: ac.signal,
        onError: setError,
        onSectionAgentStart: options?.callbacks?.onSectionAgentStart,
        onRunFinish: options?.callbacks?.onRunFinish,
      })
        .catch((e: unknown) => {
          if (ac.signal.aborted) return
          setError(e instanceof Error ? e.message : '专家模式后台写作失败')
        })
        .finally(() => {
          if (expertRunPromiseByBookRef.current[bookId] === run) {
            expertRunPromiseByBookRef.current[bookId] = null
            expertRunAbortByBookRef.current[bookId] = null
            if (bookRef.current?.id === bookId) {
              expertRunPromiseRef.current = null
              expertRunAbortRef.current = null
            }
            updateExpertDraftForBook(bookId, (draft) => ({
              ...draft,
              running: false,
              active_section_id: '',
            }))
          }
        })

      expertRunPromiseByBookRef.current[bookId] = run
      if (bookRef.current?.id === bookId) {
        expertRunPromiseRef.current = run
      }
      void run
      return true
    },
    [
      bookRef,
      expertRunAbortByBookRef,
      expertRunAbortRef,
      expertRunPromiseByBookRef,
      expertRunPromiseRef,
      getRenderedExpertDraftSectionContent,
      getCurrentWorkspaceStageBody,
      syncExpertDraftSectionField,
      setError,
      updateExpertDraftForBook,
      workspaceAgentReadAccess,
      workspaceSessionsRef,
    ],
  )

  const stopExpertWriting = useCallback(() => {
    const currentBookId = bookRef.current?.id
    if (!currentBookId) return
    const controller = expertRunAbortByBookRef.current[currentBookId]
    if (!controller || controller.signal.aborted) return
    controller.abort()
    updateExpertDraftForBook(currentBookId, (draft) => ({
      ...draft,
      running: false,
      active_section_id: '',
    }))
  }, [bookRef, expertRunAbortByBookRef, updateExpertDraftForBook])

  const resetExpertDraft = useCallback(() => {
    if (expertDraftRef.current.running) return
    const ok = window.confirm('清空正文编写内容，并恢复为第一节的初始状态？')
    if (!ok) return
    const currentBookId = bookRef.current?.id
    if (!currentBookId) return
    const bookType = bookRef.current?.book_type ?? 'short'
    const next = normalizeExpertDraft(defaultExpertDraft(bookType), true, bookType)
    commitWorkspaceSession(
      currentBookId,
      (session) => {
        const updatedStages = { ...session.stages, draft: '' }
        return {
          ...session,
          stages: updatedStages,
          expertDraft: next,
          book: {
            ...session.book,
            stages: mergeStagePatchIntoAll(session.book.stages, updatedStages),
            content: '',
            expert_draft: next,
          },
        }
      },
      true,
    )
    setMessage('正文编写已清空')
    setError(null)
    window.setTimeout(() => setMessage(null), 2000)
  }, [bookRef, commitWorkspaceSession, expertDraftRef, setError, setMessage])

  return {
    createExpertDraftSectionForBook,
    getRenderedExpertDraftSectionContent,
    syncExpertDraftSectionField,
    handleExpertDraftSectionCreate,
    handleExpertDraftSectionSelect,
    handleExpertDraftSectionTextareaRef,
    resetExpertDraft,
    selectExpertDraftSectionForBook,
    startExpertWritingForBook,
    stopExpertWriting,
  }
}
