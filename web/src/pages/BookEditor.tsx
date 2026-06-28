import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  type Book,
  bookTypeLabel,
  type BookStatus,
  type BookSummary,
  type ExpertDraft,
  type MemoryEntry,
  type StageId,
  getBookMemories,
  getUserMemories,
  normalizeExpertDraft,
  normalizeStagesForWorkspaceBook,
  isWorkspaceBook,
  mergeStagePatchIntoAll,
  mergeUniqueMemories,
  saveBookMemories,
  saveUserMemories,
  type Material,
  type Skill,
  type WorkspaceAgentReadAccessConfig,
} from '../bridge'
import {
  getDefaultWorkspaceAgentReadAccess,
} from '../workspaces/short/stageReadAccess'
import { PLOT_STAGE_ID } from '../workspaces/short/stages'
import {
  MaterialSelectorDialog,
  SkillSelectorDialog,
} from './bookEditor/LibrarySelectorDialogs'
import { WorkspaceBookHeader } from './bookEditor/WorkspaceBookHeader'
import {
  useWorkspaceStore,
  type BookPersistedSnapshot,
  type BookWorkspaceSessionState,
} from '../stores/workspaceStore'
import {
  bookSessionHasUnsavedChanges,
  createBookPersistedSnapshot,
  workspaceSessionContentFingerprint,
} from './bookEditor/workspaceSession'
import {
  EMPTY_STAGES,
  type PlotChildStageId,
} from './bookEditor/workspaceTypes'
import { useAiPanelWidth } from './bookEditor/useAiPanelWidth'
import { useLibrarySelectors } from './bookEditor/useLibrarySelectors'
import { useBookCoverRuntime } from './bookEditor/useBookCoverRuntime'
import { useWorkspaceChatEpochs } from './bookEditor/useWorkspaceChatEpochs'
import { useWorkspaceExportActions } from './bookEditor/useWorkspaceExportActions'
import { useExpertDraftRuntime } from './bookEditor/useExpertDraftRuntime'
import { resolveLiveWorkspaceStageBody } from './bookEditor/liveStageBody'
import { useWorkspaceKeyboardShortcuts } from './bookEditor/useWorkspaceKeyboardShortcuts'
import { useWorkspacePersistence } from './bookEditor/useWorkspacePersistence'
import { useWorkspaceStageRuntime } from './bookEditor/useWorkspaceStageRuntime'
import { useWorkspaceStreaming } from './bookEditor/useWorkspaceStreaming'
import { useWorkspaceTitleEditing } from './bookEditor/useWorkspaceTitleEditing'
import { useWorkspaceTreeNavigation } from './bookEditor/useWorkspaceTreeNavigation'
import { useWorkspaceViewModel } from './bookEditor/useWorkspaceViewModel'
import { WorkspaceAiPanel } from './bookEditor/WorkspaceAiPanel'
import { WorkspaceCoverDialogs } from './bookEditor/WorkspaceCoverDialogs'
import { WorkspaceEditorPane } from './bookEditor/WorkspaceEditorPane'
import { WorkspaceRailPanel } from './bookEditor/WorkspaceRailPanel'
import { WorkspaceSplitter } from './bookEditor/WorkspaceSplitter'
import {
  combineExpertDraftSections,
  mapExpertDraftToDraftStage,
} from './bookEditor/expertDraftUtils'
import { useKeyedAutoSave } from '../hooks/useKeyedAutoSave'
import { useTextHistory } from '../hooks/useTextHistory'
import { useAppDialog } from '../components/useAppDialog'
import { MemoryManagerDialog } from '../components/MemoryManagerDialog'
import './BookEditor.css'

export function BookEditor() {
  const { id } = useParams<{ id: string }>()
  const { confirm, dialog } = useAppDialog()
  const [book, setBook] = useState<Book | null>(null)
  const [workspaceBooks, setWorkspaceBooks] = useState<BookSummary[]>([])
  const [stages, setStages] = useState<Record<StageId, string>>(() =>
    normalizeStagesForWorkspaceBook({ book_type: 'short', categories: ['世情'] }, {}),
  )
  const [expertDraft, setExpertDraftState] = useState<ExpertDraft>(() =>
    normalizeExpertDraft(null),
  )
  const [activeStage, setActiveStage] = useState<StageId>(PLOT_STAGE_ID)
  const [activePlotChildStage, setActivePlotChildStage] = useState<
    PlotChildStageId | ''
  >('')
  const [loading, setLoading] = useState(true)
  const [bookTransitioning, setBookTransitioning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aiPanelWidth, setAiPanelWidth] = useAiPanelWidth()
  /** 当前阶段 AI 侧栏「对话轮次」：递增后重建 Pi 会话并清空该阶段对话历史 */
  const [linkedMaterial, setLinkedMaterial] = useState<Material | null>(null)
  const [linkedSkill, setLinkedSkill] = useState<Skill | null>(null)
  const [workspaceAgentReadAccess, setWorkspaceAgentReadAccess] =
    useState<WorkspaceAgentReadAccessConfig>(
      () => getDefaultWorkspaceAgentReadAccess(),
  )
  const [aiChatEpochByStage, setAiChatEpochByStage] = useState<
    Partial<Record<StageId, number>>
  >({})
  const [expertAiChatEpoch, setExpertAiChatEpoch] = useState(0)
  const [coverData, setCoverData] = useState<string | null>(null)
  const [bookMemoryOpen, setBookMemoryOpen] = useState(false)
  const [bookMemories, setBookMemories] = useState<MemoryEntry[]>([])
  const [workspaceUserMemories, setWorkspaceUserMemories] = useState<MemoryEntry[]>([])
  const [bookMemorySaving, setBookMemorySaving] = useState(false)
  const [bookMemoryError, setBookMemoryError] = useState<string | null>(null)
  const [bookMemoryUnread, setBookMemoryUnread] = useState(false)
  const workspaceSessions = useWorkspaceStore((state) => state.sessions)
  const loadedBookIds = useWorkspaceStore((state) => state.loadedBookIds)
  const replaceWorkspaceSessions = useWorkspaceStore((state) => state.replaceSessions)
  const markWorkspaceBookLoaded = useWorkspaceStore((state) => state.markBookLoaded)
  const setActiveWorkspaceBookId = useWorkspaceStore((state) => state.setActiveBookId)
  const resetWorkspaceRuntime = useWorkspaceStore((state) => state.resetWorkspaceRuntime)
  /** 防止连按保存或 Ctrl+S 与按钮并发触发两次提交 */
  const saveInFlightRef = useRef(false)
  const activeStageRef = useRef<StageId>(activeStage)
  const activePlotChildStageRef = useRef<PlotChildStageId | ''>(
    activePlotChildStage,
  )
  const bookRef = useRef<Book | null>(book)
  /** 当前激活阶段的 textarea ref，用于自动滚动 */
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const textareaRefsRef = useRef<Partial<Record<StageId, HTMLTextAreaElement | null>>>({})
  /** 流式 token 缓冲区；按阶段隔离，避免切换阶段后写入串台 */
  const tokenBuffersRef = useRef<Partial<Record<StageId, string>>>({})
  const tokenBufferRafRefs = useRef<Partial<Record<StageId, number>>>({})
  const tokenBuffersByBookRef = useRef<
    Record<string, Partial<Record<StageId, string>>>
  >({})
  const tokenBufferRafByBookRef = useRef<
    Record<string, Partial<Record<StageId, number>>>
  >({})
  /** 最新 stages 的 ref，用于流式写入时读取当前值 */
  const stagesRef = useRef<Record<StageId, string>>(EMPTY_STAGES)
  const workspaceSessionsRef = useRef<Record<string, BookWorkspaceSessionState>>({})
  const pendingInitialStageRef = useRef<{
    bookId: string
    stageId: StageId
    childId?: PlotChildStageId
  } | null>(null)
  const hasLoadedOnceRef = useRef(false)
  const workspaceBookOrderRef = useRef<string[] | null>(null)
  /** 最新专家模式正文结构，用于后台小节智能体读取和写入 */
  const expertDraftRef = useRef<ExpertDraft>(normalizeExpertDraft(null))
  const expertDraftActiveSectionEditorRef = useRef<{
    sectionId: string
    body: HTMLTextAreaElement | null
    state: HTMLTextAreaElement | null
  }>({
    sectionId: '',
    body: null,
    state: null,
  })
  const expertRunAbortRef = useRef<AbortController | null>(null)
  const expertRunPromiseRef = useRef<Promise<void> | null>(null)
  const expertRunAbortByBookRef = useRef<Record<string, AbortController | null>>({})
  const expertRunPromiseByBookRef = useRef<Record<string, Promise<void> | null>>({})
  const saveInFlightByBookRef = useRef<Record<string, boolean>>({})
  /** 正在流式输出的阶段禁用用户输入（设为只读） */
  const [streamingStages, setStreamingStages] = useState<Partial<Record<StageId, boolean>>>({})
  const streamingStagesRef = useRef<Partial<Record<StageId, boolean>>>({})
  const textHistory = useTextHistory()
  const observedWorkspaceFingerprintsRef = useRef<Record<string, string>>({})

  const rememberLoadedBookId = useCallback((bookId: string) => {
    markWorkspaceBookLoaded(bookId)
  }, [markWorkspaceBookLoaded])

  const syncActiveSessionState = useCallback((session: BookWorkspaceSessionState) => {
    setActiveWorkspaceBookId(session.book.id)
    bookRef.current = session.book
    setBook(session.book)
    stagesRef.current = session.stages
    setStages(session.stages)
    expertDraftRef.current = session.expertDraft
    setExpertDraftState(session.expertDraft)
    activeStageRef.current = session.activeStage
    setActiveStage(session.activeStage)
    activePlotChildStageRef.current = session.activePlotChildStage
    setActivePlotChildStage(session.activePlotChildStage)
    setLinkedMaterial(session.linkedMaterial)
    setLinkedSkill(session.linkedSkill)
    setCoverData(session.coverData)
    setAiChatEpochByStage(session.aiChatEpochByStage)
    setExpertAiChatEpoch(session.expertAiChatEpoch)
    streamingStagesRef.current = session.streamingStages
    setStreamingStages(session.streamingStages)
    tokenBuffersByBookRef.current[session.book.id] =
      tokenBuffersByBookRef.current[session.book.id] ?? {}
    tokenBufferRafByBookRef.current[session.book.id] =
      tokenBufferRafByBookRef.current[session.book.id] ?? {}
    tokenBuffersRef.current = tokenBuffersByBookRef.current[session.book.id]
    tokenBufferRafRefs.current = tokenBufferRafByBookRef.current[session.book.id]
    expertRunAbortRef.current = expertRunAbortByBookRef.current[session.book.id] ?? null
    expertRunPromiseRef.current = expertRunPromiseByBookRef.current[session.book.id] ?? null
  }, [setActiveWorkspaceBookId])

  const commitWorkspaceSession = useCallback(
    (
      bookId: string,
      updater: (
        current: BookWorkspaceSessionState,
      ) => BookWorkspaceSessionState,
      syncActive = true,
    ): BookWorkspaceSessionState | null => {
      const current = workspaceSessionsRef.current[bookId]
      if (!current) return null
      const nextSession = updater(current)
      const nextSessions = {
        ...workspaceSessionsRef.current,
        [bookId]: nextSession,
      }
      workspaceSessionsRef.current = nextSessions
      replaceWorkspaceSessions(nextSessions)
      if (syncActive && bookRef.current?.id === bookId) {
        syncActiveSessionState(nextSession)
      }
      return nextSession
    },
    [replaceWorkspaceSessions, syncActiveSessionState],
  )

  const storeWorkspaceSession = useCallback(
    (session: BookWorkspaceSessionState, makeActive: boolean) => {
      const nextSessions = {
        ...workspaceSessionsRef.current,
        [session.book.id]: session,
      }
      workspaceSessionsRef.current = nextSessions
      replaceWorkspaceSessions(nextSessions)
      rememberLoadedBookId(session.book.id)
      tokenBuffersByBookRef.current[session.book.id] =
        tokenBuffersByBookRef.current[session.book.id] ?? {}
      tokenBufferRafByBookRef.current[session.book.id] =
        tokenBufferRafByBookRef.current[session.book.id] ?? {}
      if (makeActive) {
        syncActiveSessionState(session)
      }
    },
    [rememberLoadedBookId, replaceWorkspaceSessions, syncActiveSessionState],
  )

  const updateBookMemoriesInState = useCallback(
    (bookId: string, memories: MemoryEntry[]) => {
      setBookMemories(memories)
      setBook((current) =>
        current?.id === bookId ? { ...current, memories } : current,
      )
      commitWorkspaceSession(
        bookId,
        (session) => ({
          ...session,
          book: {
            ...session.book,
            memories,
          },
        }),
        true,
      )
    },
    [commitWorkspaceSession],
  )

  const loadCurrentMemories = useCallback(
    async (targetBook: Book) => {
      if (!isWorkspaceBook(targetBook)) return
      setBookMemoryError(null)
      try {
        const [nextBookMemories, nextUserMemories] = await Promise.all([
          getBookMemories(targetBook.id),
          getUserMemories(targetBook.book_type),
        ])
        updateBookMemoriesInState(targetBook.id, nextBookMemories)
        setWorkspaceUserMemories(nextUserMemories)
      } catch (err) {
        setBookMemoryError(err instanceof Error ? err.message : '读取记忆失败')
      }
    },
    [updateBookMemoriesInState],
  )

  useEffect(() => {
    const currentBook = bookRef.current
    if (!currentBook || !isWorkspaceBook(currentBook)) {
      setBookMemories([])
      setWorkspaceUserMemories([])
      return
    }
    setBookMemories(currentBook.memories ?? [])
    void loadCurrentMemories(currentBook)
  }, [book?.id, book?.book_type, bookRef, loadCurrentMemories])

  const openBookMemoryManager = useCallback(() => {
    if (bookRef.current) {
      setBookMemories(bookRef.current.memories ?? bookMemories)
    }
    setBookMemoryUnread(false)
    setBookMemoryOpen(true)
  }, [bookMemories, bookRef])

  const handleSaveBookMemories = useCallback(
    async (next: MemoryEntry[]) => {
      const currentBook = bookRef.current
      if (!currentBook) return
      setBookMemorySaving(true)
      setBookMemoryError(null)
      try {
        const saved = await saveBookMemories(currentBook.id, next)
        updateBookMemoriesInState(currentBook.id, saved)
        setBookMemoryOpen(false)
        setBookMemoryUnread(false)
      } catch (err) {
        setBookMemoryError(err instanceof Error ? err.message : '保存记忆失败')
      } finally {
        setBookMemorySaving(false)
      }
    },
    [bookRef, updateBookMemoriesInState],
  )

  const handleSyncBookMemoryToUser = useCallback(
    async (memory: MemoryEntry) => {
      const currentBook = bookRef.current
      if (!currentBook || !isWorkspaceBook(currentBook)) return
      setBookMemoryError(null)
      try {
        const nextUserMemories = mergeUniqueMemories(workspaceUserMemories, [memory])
        const saved = await saveUserMemories(currentBook.book_type, nextUserMemories)
        setWorkspaceUserMemories(saved)
        setMessage('已同步到用户记忆')
      } catch (err) {
        setBookMemoryError(err instanceof Error ? err.message : '同步记忆失败')
      }
    },
    [bookRef, workspaceUserMemories],
  )

  const handleBookMemoriesCaptured = useCallback(
    async (bookId: string, memories: MemoryEntry[]) => {
      const saved = await saveBookMemories(bookId, memories)
      updateBookMemoriesInState(bookId, saved)
      if (!bookMemoryOpen) setBookMemoryUnread(true)
      setMessage('已更新书籍记忆')
    },
    [bookMemoryOpen, updateBookMemoriesInState],
  )

  const {
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
  } = useBookCoverRuntime({
    bookRef,
    workspaceSessionsRef,
    setCoverData,
    setError,
    setMessage,
    storeWorkspaceSession,
  })

  useEffect(() => {
    activeStageRef.current = activeStage
  }, [activeStage])

  useEffect(() => {
    activePlotChildStageRef.current = activePlotChildStage
  }, [activePlotChildStage])

  useEffect(() => {
    bookRef.current = book
  }, [book])

  useEffect(() => {
    workspaceSessionsRef.current = workspaceSessions
  }, [workspaceSessions])

  // 保持 stagesRef 始终指向最新值
  useEffect(() => {
    stagesRef.current = stages
  }, [stages])

  useEffect(() => {
    expertDraftRef.current = expertDraft
  }, [expertDraft])

  // 清理 RAF
  useEffect(() => {
    const cleanupWorkspaceRuntime = () => {
      Object.values(tokenBufferRafByBookRef.current).forEach((stageRefs) => {
        Object.values(stageRefs).forEach((rafId) => {
          if (rafId !== undefined) cancelAnimationFrame(rafId)
        })
      })
      Object.values(expertRunAbortByBookRef.current).forEach((controller) => {
        controller?.abort()
      })
      resetWorkspaceRuntime()
    }
    return cleanupWorkspaceRuntime
  }, [resetWorkspaceRuntime])

  const updateExpertDraftForBook = useCallback(
    (bookId: string, updater: (current: ExpertDraft) => ExpertDraft) => {
      commitWorkspaceSession(bookId, (session) => {
        const nextExpertDraft = normalizeExpertDraft(
          updater(session.expertDraft),
          false,
          session.book.book_type,
        )
        const previousDraftBody = combineExpertDraftSections(session.expertDraft)
        const nextDraftBody = combineExpertDraftSections(nextExpertDraft)
        const nextStages =
          previousDraftBody === nextDraftBody
            ? session.stages
            : mapExpertDraftToDraftStage(session.stages, nextExpertDraft)
        for (const section of nextExpertDraft.sections) {
          const previous = session.expertDraft.sections.find(
            (candidate) => candidate.id === section.id,
          )
          if (previous?.body !== section.body) {
            textHistory.observe(
              `workspace:${bookId}:expert:${section.id}:body`,
              section.body,
            )
          }
        }
        for (const state of nextExpertDraft.character_states) {
          const previous = session.expertDraft.character_states.find(
            (candidate) => candidate.section_id === state.section_id,
          )
          if (previous?.body !== state.body) {
            textHistory.observe(
              `workspace:${bookId}:expert:${state.section_id}:character-state`,
              state.body,
            )
          }
        }
        if ((session.stages.draft ?? '') !== (nextStages.draft ?? '')) {
          textHistory.observe(
            `workspace:${bookId}:stage:draft`,
            nextStages.draft ?? '',
          )
        }
        return {
          ...session,
          stages: nextStages,
          expertDraft: nextExpertDraft,
          book: {
            ...session.book,
            stages: mergeStagePatchIntoAll(session.book.stages, nextStages),
            content: nextStages.draft ?? session.book.content,
            expert_draft: nextExpertDraft,
          },
        }
      })
    },
    [commitWorkspaceSession, textHistory],
  )

  const updateExpertDraft = useCallback(
    (updater: (current: ExpertDraft) => ExpertDraft) => {
      const currentBookId = bookRef.current?.id
      if (!currentBookId) return
      updateExpertDraftForBook(currentBookId, updater)
    },
    [updateExpertDraftForBook],
  )

  const recordWorkspaceTextChange = useCallback(
    (
      bookId: string,
      stageId: StageId,
      previous: string,
      next: string,
      kind: 'atomic' | 'stream',
    ) => {
      textHistory.record(
        `workspace:${bookId}:stage:${stageId}`,
        previous,
        next,
        kind,
      )
    },
    [textHistory],
  )

  const {
    applyToStageEditorForBook,
    cancelTokenFlush,
    flushAllTokenBuffersForBook,
    updateStage,
  } = useWorkspaceStreaming({
    bookRef,
    workspaceSessionsRef,
    activeStageRef,
    activePlotChildStageRef,
    textareaRefsRef,
    tokenBuffersRef,
    tokenBufferRafRefsRef: tokenBufferRafRefs,
    tokenBuffersByBookRef,
    tokenBufferRafByBookRef,
    streamingStagesRef,
    commitWorkspaceSession,
    recordTextChange: recordWorkspaceTextChange,
    endTextHistoryGroup: (bookId, stageId) =>
      textHistory.endGroup(`workspace:${bookId}:stage:${stageId}`),
  })

  const {
    handleBackToShelf,
    refreshWorkspaceBooks,
    saveBookSession,
    saveCurrentBook,
    syncWorkspaceBookSummary,
    waitForSaveIdle,
  } = useWorkspacePersistence({
    id,
    book,
    bookRef,
    workspaceSessionsRef,
    workspaceBookOrderRef,
    pendingInitialStageRef,
    hasLoadedOnceRef,
    saveInFlightRef,
    saveInFlightByBookRef,
    tokenBuffersByBookRef,
    setBook,
    setWorkspaceBooks,
    setWorkspaceAgentReadAccess,
    setLoading,
    setBookTransitioning,
    setSaving,
    setMessage,
    setError,
    commitWorkspaceSession,
    storeWorkspaceSession,
    syncActiveSessionState,
    flushAllTokenBuffersForBook,
  })

  const workspaceAutoSave = useKeyedAutoSave<BookPersistedSnapshot>({
    getSnapshot: (bookId) => {
      const session = workspaceSessionsRef.current[bookId]
      if (!session) return null
      return createBookPersistedSnapshot(
        {
          ...session.book,
          stages: session.stages,
          expert_draft: session.expertDraft,
        },
        session.expertDraft,
      )
    },
    saveSnapshot: async (bookId, snapshot) => {
      const next = await saveBookSession(bookId, {}, snapshot)
      if (!next) throw new Error('保存创作空间失败')
    },
  })
  const {
    flush: flushWorkspaceBook,
    flushAll: flushAllWorkspaceBooks,
    markSaved: markWorkspaceBookSaved,
    schedule: scheduleWorkspaceBookSave,
    statusFor: workspaceBookSaveStatus,
  } = workspaceAutoSave

  useEffect(() => {
    for (const [bookId, session] of Object.entries(workspaceSessions)) {
      const fingerprint = workspaceSessionContentFingerprint(session)
      const previous = observedWorkspaceFingerprintsRef.current[bookId]
      observedWorkspaceFingerprintsRef.current[bookId] = fingerprint
      const dirty = bookSessionHasUnsavedChanges(
        session,
        tokenBuffersByBookRef.current[bookId],
      )
      if (previous === undefined) {
        for (const section of session.expertDraft.sections) {
          textHistory.observe(
            `workspace:${bookId}:expert:${section.id}:body`,
            section.body,
          )
        }
        for (const state of session.expertDraft.character_states) {
          textHistory.observe(
            `workspace:${bookId}:expert:${state.section_id}:character-state`,
            state.body,
          )
        }
        if (dirty) scheduleWorkspaceBookSave(bookId)
        else markWorkspaceBookSaved(bookId)
      } else if (previous !== fingerprint && dirty) {
        scheduleWorkspaceBookSave(bookId)
      }
    }
  }, [
    markWorkspaceBookSaved,
    scheduleWorkspaceBookSave,
    textHistory,
    workspaceSessions,
  ])

  const flushActiveWorkspaceBook = useCallback(async () => {
    const currentBookId = bookRef.current?.id
    if (!currentBookId) return true
    flushAllTokenBuffersForBook(currentBookId)
    return flushWorkspaceBook(currentBookId)
  }, [flushAllTokenBuffersForBook, flushWorkspaceBook])

  const {
    editingTitle,
    titleDraft,
    setTitleDraft,
    handleTitleEditStart,
    handleTitleEditEnd,
    handleTitleEditCancel,
  } = useWorkspaceTitleEditing({
    bookRef,
    workspaceSessionsRef,
    setBook,
    setError,
    setMessage,
    storeWorkspaceSession,
    syncWorkspaceBookSummary,
  })

  const titleHistoryKey = `workspace:${book?.id ?? id ?? 'unknown'}:title`
  const handleHistoryTitleEditStart = useCallback(() => {
    textHistory.clear(titleHistoryKey, bookRef.current?.title ?? '')
    handleTitleEditStart()
  }, [handleTitleEditStart, textHistory, titleHistoryKey])
  const handleHistoryTitleDraftChange = useCallback(
    (value: string) => {
      textHistory.change(
        titleHistoryKey,
        titleDraft,
        value,
        setTitleDraft,
      )
    },
    [setTitleDraft, textHistory, titleDraft, titleHistoryKey],
  )

  const {
    materialSelectorOpen,
    setMaterialSelectorOpen,
    materialSummaries,
    materialSelectorLoading,
    materialSelectorSaving,
    openMaterialSelector,
    saveLinkedMaterial,
    skillSelectorOpen,
    setSkillSelectorOpen,
    skillSummaries,
    skillSelectorLoading,
    skillSelectorSaving,
    openSkillSelector,
    saveLinkedSkill,
  } = useLibrarySelectors({
    book,
    bookRef,
    workspaceSessionsRef,
    setBook,
    setLinkedMaterial,
    setLinkedSkill,
    setError,
    storeWorkspaceSession,
    syncWorkspaceBookSummary,
  })

  const { handleExportExpertDraftDocx } = useWorkspaceExportActions({
    book,
    coverData,
    stagesRef,
    expertDraftRef,
    setMessage,
    setError,
  })

  const getRenderedWorkspaceStageBody = useCallback(
    (stageId: StageId): string | undefined => {
      return textareaRefsRef.current[stageId]?.value
    },
    [],
  )

  const getCurrentWorkspaceStageBody = useCallback(
    (stageId: StageId): string | undefined => {
      const bookId = bookRef.current?.id
      if (!bookId) return undefined
      return resolveLiveWorkspaceStageBody({
        sessionBookId: bookId,
        activeBookId: bookId,
        stageId,
        fallbackStages: workspaceSessionsRef.current[bookId]?.stages ?? {},
        workspaceSessionsRef,
        getRenderedWorkspaceStageBody,
      })
    },
    [bookRef, workspaceSessionsRef, getRenderedWorkspaceStageBody],
  )

  const {
    handleStageBodyChange,
    selectPlotChildForBook,
    setActiveBookStage,
  } = useWorkspaceStageRuntime({
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
    textareaRefsRef,
  })

  const confirmResetExpertDraft = useCallback(
    () =>
      confirm({
        title: '清空正文编写',
        message: '清空正文编写内容，并恢复为第一节的初始状态？',
        confirmText: '清空',
        variant: 'danger',
      }),
    [confirm],
  )

  const {
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
  } = useExpertDraftRuntime({
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
    confirmResetExpertDraft,
  })

  const {
    bumpActiveExpertChatEpoch,
    bumpActiveStageChatEpoch,
  } = useWorkspaceChatEpochs({
    bookRef,
    workspaceSessionsRef,
    aiChatEpochByStage,
    expertAiChatEpoch,
    setAiChatEpochByStage,
    setExpertAiChatEpoch,
    commitWorkspaceSession,
  })

  const {
    handleTreeBookSelect,
    handleTreeBookStageChildCreate,
    handleTreeBookStageChildSelect,
    handleTreeBookStageSelect,
  } = useWorkspaceTreeNavigation({
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
  })

  const handleToggleBookStatus = useCallback(async () => {
    if (!book) return
    const nextStatus: BookStatus =
      book.status === 'completed' ? 'editing' : 'completed'
    const next = await saveCurrentBook({
      status: nextStatus,
      successMessage: nextStatus === 'completed' ? '已标记完成' : '已恢复编辑',
    })
    if (!next) return
    try {
      await refreshWorkspaceBooks()
    } catch (e) {
      setError(e instanceof Error ? e.message : '刷新书籍列表失败')
    }
  }, [book, refreshWorkspaceBooks, saveCurrentBook])

  const handleToggleBookMemoryAutoCapture = useCallback(
    async (enabled: boolean) => {
      if (!book) return
      setBookMemoryError(null)
      const next = await saveCurrentBook({
        memory_auto_capture_enabled: enabled,
        successMessage: enabled ? '已开启主动录入记忆' : '已关闭主动录入记忆',
      })
      if (!next) setBookMemoryError('保存记忆开关失败')
    },
    [book, saveCurrentBook],
  )

  useWorkspaceKeyboardShortcuts({
    id,
    book,
    handleSave: flushActiveWorkspaceBook,
  })

  const handleAutoSaveBack = useCallback(async () => {
    await flushAllWorkspaceBooks()
    handleBackToShelf()
  }, [flushAllWorkspaceBooks, handleBackToShelf])

  const applyToStageEditorWithAutoSave = useCallback(
    (bookId: string, stageId: StageId, payload: Parameters<typeof applyToStageEditorForBook>[2]) => {
      applyToStageEditorForBook(bookId, stageId, payload)
      if (payload.mode === 'streaming_end') void flushWorkspaceBook(bookId)
    },
    [applyToStageEditorForBook, flushWorkspaceBook],
  )

  const {
    ActiveExpertDraftEditor,
    activeContentStage,
    activeExpertDraftSectionId,
    activePlotChildLabel,
    activePlotChildStages,
    expertDraftActive,
    railStages,
    renderedWorkspaceSessions,
    stageBody,
    workspaceTreeBooks,
    workspaceTreeStages,
  } = useWorkspaceViewModel({
    book,
    workspaceBooks,
    workspaceSessions,
    loadedBookIds,
    expertDraft,
    activeStage,
    activePlotChildStage,
    stages,
  })

  if (!id) {
    return (
      <div className="editor-wrap">
        <p className="editor-error">无效链接</p>
        <Link to="/">返回书架</Link>
      </div>
    )
  }

  if (loading && !book) {
    return (
      <div className="editor-wrap">
        <p className="muted">加载中…</p>
      </div>
    )
  }

  if (error && !book) {
    return (
      <div className="editor-wrap">
        <p className="editor-error">{error}</p>
        <Link to="/">返回书架</Link>
      </div>
    )
  }

  const useWorkspace = book ? isWorkspaceBook(book) : false

  if (book && !useWorkspace) {
    return (
      <div className="editor-page editor-page--pending">
        <header className="editor-header">
          <Link className="back-link" to="/">
            ← 书架
          </Link>
          <div className="editor-title-block">
            <h1 className="editor-title">{book.title}</h1>
            <span className="editor-sub">
              {bookTypeLabel(book.book_type)}
              {isWorkspaceBook(book) && book.categories.length > 0
                ? ` · ${book.categories.join('、')}`
                : ''}
            </span>
          </div>
          <span className="editor-header-spacer" aria-hidden />
        </header>
        <div className="editor-pending-main">
          <p className="editor-pending-title">该类型工作台开发中</p>
          <p className="muted editor-pending-desc">
            当前短篇与剧本可使用完整写作台与 AI 协作；长篇工作台仍在扩展中。
          </p>
          <Link className="btn-pending-home" to="/">
            返回书架
          </Link>
        </div>
      </div>
    )
  }

  if (!book) {
    return (
      <div className="editor-wrap">
        <p className="muted">暂无书籍数据</p>
        <Link to="/">返回书架</Link>
      </div>
    )
  }

  return (
    <div className="editor-page editor-page--workspace">
      <WorkspaceBookHeader
        book={book}
        coverData={coverData}
        coverGenerating={coverGenerating}
        linkedMaterial={linkedMaterial}
        linkedSkill={linkedSkill}
        saving={saving}
        autoSaveStatus={workspaceBookSaveStatus(book.id)}
        error={error}
        message={message}
        onBack={() => void handleAutoSaveBack()}
        onViewCover={() => setCoverViewerOpen(true)}
        onGenerateCover={openCoverGenerateDialog}
        onCoverError={clearCoverDataForActiveBook}
        onOpenMaterialSelector={() => void openMaterialSelector()}
        onOpenSkillSelector={() => void openSkillSelector()}
        onOpenMemoryManager={openBookMemoryManager}
        onToggleStatus={() => void handleToggleBookStatus()}
        memoryUnread={bookMemoryUnread}
      />
      {dialog}
      {bookMemoryOpen ? (
        <MemoryManagerDialog
          title="书籍记忆"
          memories={bookMemories}
          saving={bookMemorySaving}
          error={bookMemoryError}
          titleActions={
            <label
              className="memory-auto-capture-toggle"
              title="开启后，模型会自动地帮你总结记忆。"
            >
              <input
                type="checkbox"
                checked={Boolean(book.memory_auto_capture_enabled)}
                disabled={saving || bookMemorySaving}
                aria-label="主动录入书籍记忆"
                onChange={(event) =>
                  void handleToggleBookMemoryAutoCapture(event.target.checked)
                }
              />
              <span className="memory-auto-capture-switch" aria-hidden />
              <span>主动录入</span>
            </label>
          }
          onClose={() => {
            if (!bookMemorySaving) setBookMemoryOpen(false)
          }}
          onSave={handleSaveBookMemories}
          onSyncMemory={handleSyncBookMemoryToUser}
        />
      ) : null}

      <div
        className={
          bookTransitioning
            ? 'workspace-grid workspace-grid--transitioning'
            : 'workspace-grid'
        }
        style={
          {
            '--workspace-ai-width': `${aiPanelWidth}px`,
          } as CSSProperties
        }
      >
        {bookTransitioning ? (
          <div className="workspace-grid-transition" aria-live="polite">
            正在切换书籍…
          </div>
        ) : null}
        <WorkspaceRailPanel
          book={book}
          workspaceTreeStages={workspaceTreeStages}
          workspaceTreeBooks={workspaceTreeBooks}
          activeStage={activeStage}
          activePlotChildStage={activePlotChildStage}
          activeExpertDraftSectionId={activeExpertDraftSectionId}
          editingTitle={editingTitle}
          titleDraft={titleDraft}
          onTitleDraftChange={handleHistoryTitleDraftChange}
          onTitleEditStart={handleHistoryTitleEditStart}
          onTitleEditEnd={handleTitleEditEnd}
          onTitleEditCancel={handleTitleEditCancel}
          onTitleInputKeyDown={(event) =>
            textHistory.handleKeyDown(
              event,
              titleHistoryKey,
              titleDraft,
              setTitleDraft,
            )
          }
          onActiveStageSelect={(stageId) => {
            void flushActiveWorkspaceBook()
            setActiveBookStage(stageId)
          }}
          onPlotChildSelect={(childId) => {
            void flushActiveWorkspaceBook()
            selectPlotChildForBook(book.id, childId)
          }}
          onExpertDraftSectionSelect={(sectionId) => {
            void flushActiveWorkspaceBook()
            handleExpertDraftSectionSelect(sectionId)
          }}
          onExpertDraftSectionCreate={handleExpertDraftSectionCreate}
          onTreeBookSelect={handleTreeBookSelect}
          onTreeBookStageSelect={(bookId, stageId) =>
            void handleTreeBookStageSelect(bookId, stageId)
          }
          onTreeBookStageChildSelect={(bookId, stageId, childId) =>
            void handleTreeBookStageChildSelect(bookId, stageId, childId)
          }
          onTreeBookStageChildCreate={handleTreeBookStageChildCreate}
        />

        <WorkspaceAiPanel
          book={book}
          railStages={railStages}
          activeStage={activeStage}
          activePlotChildLabel={activePlotChildLabel ?? ''}
          expertDraftActive={expertDraftActive}
          activeExpertDraftSectionId={activeExpertDraftSectionId}
          expertDraft={expertDraft}
          renderedWorkspaceSessions={renderedWorkspaceSessions}
          userMemories={workspaceUserMemories}
          workspaceAgentReadAccess={workspaceAgentReadAccess}
          linkedMaterialTitle={linkedMaterial?.title}
          linkedSkillTitle={linkedSkill?.title}
          workspaceSessionsRef={workspaceSessionsRef}
          getRenderedWorkspaceStageBody={getRenderedWorkspaceStageBody}
          applyToStageEditorForBook={applyToStageEditorWithAutoSave}
          selectPlotChildForBook={selectPlotChildForBook}
          saveBookSession={saveBookSession}
          updateExpertDraftForBook={updateExpertDraftForBook}
          startExpertWritingForBook={startExpertWritingForBook}
          getRenderedExpertDraftSectionContent={
            getRenderedExpertDraftSectionContent
          }
          syncExpertDraftSectionField={syncExpertDraftSectionField}
          onBookMemoriesCaptured={handleBookMemoriesCaptured}
          onExpertDraftStageBodyChange={(body) =>
            handleStageBodyChange(body, 'draft')
          }
          bumpActiveExpertChatEpoch={bumpActiveExpertChatEpoch}
          bumpActiveStageChatEpoch={bumpActiveStageChatEpoch}
        />

        <WorkspaceSplitter
          aiPanelWidth={aiPanelWidth}
          setAiPanelWidth={setAiPanelWidth}
        />

        <WorkspaceEditorPane
          expertDraftActive={expertDraftActive}
          ActiveExpertDraftEditor={ActiveExpertDraftEditor}
          expertDraft={expertDraft}
          stageBody={stageBody}
          streamingStages={streamingStages}
          onStageBodyChange={handleStageBodyChange}
          updateExpertDraft={updateExpertDraft}
          onSectionTextareaRef={handleExpertDraftSectionTextareaRef}
          stopExpertWriting={stopExpertWriting}
          resetExpertDraft={resetExpertDraft}
          exportExpertDraft={handleExportExpertDraftDocx}
          activeStage={activeStage}
          activeContentStage={activeContentStage}
          activePlotChildStage={activePlotChildStage}
          activePlotChildStages={activePlotChildStages}
          stages={stages}
          railStages={railStages}
          textareaRef={textareaRef}
          textareaRefsRef={textareaRefsRef}
          bookId={book.id}
          textHistory={textHistory}
          onTextBlur={() => void flushActiveWorkspaceBook()}
        />

        {materialSelectorOpen ? (
          <MaterialSelectorDialog
            book={book}
            linkedMaterial={linkedMaterial}
            summaries={materialSummaries}
            loading={materialSelectorLoading}
            saving={materialSelectorSaving}
            onClose={() => setMaterialSelectorOpen(false)}
            onSelect={(materialId) => void saveLinkedMaterial(materialId)}
            onClear={() => void saveLinkedMaterial(null)}
          />
        ) : null}

        {skillSelectorOpen ? (
          <SkillSelectorDialog
            book={book}
            linkedSkill={linkedSkill}
            summaries={skillSummaries}
            loading={skillSelectorLoading}
            saving={skillSelectorSaving}
            onClose={() => setSkillSelectorOpen(false)}
            onSelect={(skillId) => void saveLinkedSkill(skillId)}
            onClear={() => void saveLinkedSkill(null)}
          />
        ) : null}

        <WorkspaceCoverDialogs
          coverData={coverData}
          coverDialogOpen={coverDialogOpen}
          coverGenerating={coverGenerating}
          coverPromptDraft={coverPromptDraft}
          coverViewerOpen={coverViewerOpen}
          setCoverDialogOpen={setCoverDialogOpen}
          setCoverPromptDraft={setCoverPromptDraft}
          setCoverViewerOpen={setCoverViewerOpen}
          confirmCoverGeneration={confirmCoverGeneration}
          textHistory={textHistory}
          historyKey={`workspace:${book.id}:cover-prompt`}
        />
      </div>
    </div>
  )
}
