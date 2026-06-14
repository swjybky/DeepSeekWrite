import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  type Book,
  bookTypeLabel,
  type BookStatus,
  type BookSummary,
  type ExpertDraft,
  type StageId,
  defaultExpertDraft,
  mergeStagePatchIntoAll,
  normalizeExpertDraft,
  normalizeStagesForWorkspaceBook,
  resolveWorkspaceStagesForBook,
  resolveWorkspaceBookGenre,
  getBook,
  getMaterial,
  isWorkspaceBook,
  listBooks,
  saveBook,
  type Material,
  type Skill,
  getBookCover,
  pickFolder,
  exportDocx,
  getWorkspaceAgentReadAccess,
  type WorkspaceAgentReadAccessConfig,
  getSkill,
} from '../bridge'
import type { ApplyToStageEditorPayload } from '../pi/workspaceStageAgents'
import {
  ExpertDraftEditor as ShortExpertDraftEditor,
} from '../workspaces/short/expertDraft/ExpertDraftEditor'
import {
  runExpertDraftSectionWriter as runShortExpertDraftSectionWriter,
  type GetExpertDraftSectionContent,
  type RunExpertDraftSectionWriterOptions,
} from '../workspaces/short/expertDraft/sectionWriter'
import {
  EXPERT_SECTION_WRITER_AGENT_ID,
  getDefaultWorkspaceAgentReadAccess,
} from '../workspaces/short/stageReadAccess'
import {
  ExpertDraftEditor as ScriptExpertDraftEditor,
} from '../workspaces/script/expertDraft/ExpertDraftEditor'
import {
  runExpertDraftSectionWriter as runScriptExpertDraftSectionWriter,
} from '../workspaces/script/expertDraft/sectionWriter'
import { PLOT_STAGE_ID } from '../workspaces/short/stages'
import {
  MaterialSelectorDialog,
  SkillSelectorDialog,
} from './bookEditor/LibrarySelectorDialogs'
import { WorkspaceBookHeader } from './bookEditor/WorkspaceBookHeader'
import {
  useWorkspaceStore,
  type BookWorkspaceSessionState,
} from '../stores/workspaceStore'
import {
  combineExpertDraftSections,
  defaultExpertDraftStateTitle,
  expertDraftSectionTitleForIndex,
  expertDraftSectionTreeLabel,
  nextExpertDraftSectionId,
} from './bookEditor/expertDraftUtils'
import {
  isPlotChildStageId,
  plotChildStagesForBook,
  resolvePlotEditorStageId,
  resolveReadAccessForBook,
  workspaceBookType,
} from './bookEditor/stageEditing'
import {
  createBookPersistedSnapshot,
  createBookWorkspaceSession,
  hasAnyUnsavedWorkspaceChanges,
  mergeWorkspaceBooksStable,
} from './bookEditor/workspaceSession'
import {
  EMPTY_STAGES,
  WORKSPACE_LEAVE_CONFIRM_MESSAGE,
  type PlotChildStageId,
  type SaveCurrentBookOptions,
} from './bookEditor/workspaceTypes'
import { useAiPanelWidth } from './bookEditor/useAiPanelWidth'
import { useLibrarySelectors } from './bookEditor/useLibrarySelectors'
import { useBookCoverRuntime } from './bookEditor/useBookCoverRuntime'
import { useWorkspaceTitleEditing } from './bookEditor/useWorkspaceTitleEditing'
import { WorkspaceAiPanel } from './bookEditor/WorkspaceAiPanel'
import { WorkspaceCoverDialogs } from './bookEditor/WorkspaceCoverDialogs'
import { WorkspaceEditorPane } from './bookEditor/WorkspaceEditorPane'
import { WorkspaceRailPanel } from './bookEditor/WorkspaceRailPanel'
import { WorkspaceSplitter } from './bookEditor/WorkspaceSplitter'
import './BookEditor.css'

export function BookEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
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

  const setEditorStreamingForBook = useCallback(
    (bookId: string, stageId: StageId, next: boolean) => {
      const current =
        bookRef.current?.id === bookId
          ? streamingStagesRef.current
          : workspaceSessionsRef.current[bookId]?.streamingStages ?? {}
      if (Boolean(current[stageId]) === next) return
      const updated = { ...current }
      if (next) {
        updated[stageId] = true
      } else {
        delete updated[stageId]
      }
      commitWorkspaceSession(
        bookId,
        (session) => ({
          ...session,
          streamingStages: updated,
        }),
        true,
      )
    },
    [commitWorkspaceSession],
  )

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
        return {
          ...session,
          expertDraft: nextExpertDraft,
          book: {
            ...session.book,
            expert_draft: nextExpertDraft,
          },
        }
      })
    },
    [commitWorkspaceSession],
  )

  const updateExpertDraft = useCallback(
    (updater: (current: ExpertDraft) => ExpertDraft) => {
      const currentBookId = bookRef.current?.id
      if (!currentBookId) return
      updateExpertDraftForBook(currentBookId, updater)
    },
    [updateExpertDraftForBook],
  )

  const updateStageForBook = useCallback(
    (
      bookId: string,
      stageId: StageId,
      updater: (current: string) => string,
    ) => {
      commitWorkspaceSession(bookId, (session) => {
        const current = session.stages[stageId] ?? ''
        const next = updater(current)
        if (next === current) return session
        const updatedStages = { ...session.stages, [stageId]: next }
        return {
          ...session,
          stages: updatedStages,
          book: {
            ...session.book,
            stages: mergeStagePatchIntoAll(session.book.stages, updatedStages),
            content: updatedStages.draft ?? session.book.content,
          },
        }
      })
    },
    [commitWorkspaceSession],
  )

  // 细粒度的阶段更新函数（使用函数式更新避免不必要的重渲染）
  const updateStage = useCallback(
    (stageId: StageId, updater: (current: string) => string) => {
      const currentBookId = bookRef.current?.id
      if (!currentBookId) return
      updateStageForBook(currentBookId, stageId, updater)
    },
    [updateStageForBook],
  )

  const cancelTokenFlushForBook = useCallback((bookId: string, stageId: StageId) => {
    const stageRafs = { ...(tokenBufferRafByBookRef.current[bookId] ?? {}) }
    const rafId = stageRafs[stageId]
    if (rafId !== undefined) {
      cancelAnimationFrame(rafId)
      delete stageRafs[stageId]
    }
    tokenBufferRafByBookRef.current[bookId] = stageRafs
    if (bookRef.current?.id === bookId) {
      tokenBufferRafRefs.current = stageRafs
    }
  }, [])

  const cancelTokenFlush = useCallback(
    (stageId: StageId) => {
      const currentBookId = bookRef.current?.id
      if (!currentBookId) return
      cancelTokenFlushForBook(currentBookId, stageId)
    },
    [cancelTokenFlushForBook],
  )

  // 将某个阶段缓冲区的 token 刷新到 state（使用 RAF 节流）
  const flushTokenBufferForBook = useCallback(
    (bookId: string, stageId: StageId) => {
      const stageRafs = { ...(tokenBufferRafByBookRef.current[bookId] ?? {}) }
      delete stageRafs[stageId]
      tokenBufferRafByBookRef.current[bookId] = stageRafs

      const buffers = { ...(tokenBuffersByBookRef.current[bookId] ?? {}) }
      const buffer = buffers[stageId] ?? ''
      if (!buffer) return
      delete buffers[stageId]
      tokenBuffersByBookRef.current[bookId] = buffers

      if (bookRef.current?.id === bookId) {
        tokenBuffersRef.current = buffers
        tokenBufferRafRefs.current = stageRafs
      }
      updateStageForBook(bookId, stageId, (cur) => cur + buffer)
    },
    [updateStageForBook],
  )

  const flushAllTokenBuffersForBook = useCallback(
    (bookId: string) => {
      const rafIds = Object.values(tokenBufferRafByBookRef.current[bookId] ?? {})
      tokenBufferRafByBookRef.current[bookId] = {}
      rafIds.forEach((rafId) => {
        if (rafId !== undefined) cancelAnimationFrame(rafId)
      })

      const buffers = tokenBuffersByBookRef.current[bookId] ?? {}
      tokenBuffersByBookRef.current[bookId] = {}
      if (bookRef.current?.id === bookId) {
        tokenBuffersRef.current = {}
        tokenBufferRafRefs.current = {}
      }
      for (const [stageId, buffer] of Object.entries(buffers) as [
        StageId,
        string | undefined,
      ][]) {
        if (!buffer) continue
        updateStageForBook(bookId, stageId, (cur) => cur + buffer)
      }
    },
    [updateStageForBook],
  )

  // 自动滚动 textarea 到底部（如果用户正在底部）
  const autoScrollTextarea = useCallback((stageId: StageId) => {
    const active = activeStageRef.current
    const activePlotChild = activePlotChildStageRef.current
    const visible =
      active === stageId ||
      (active === PLOT_STAGE_ID &&
        isPlotChildStageId(stageId) &&
        (!activePlotChild || activePlotChild === stageId))
    if (!visible) return
    const textarea = textareaRefsRef.current[stageId] ?? null
    if (!textarea) return
    const wasAtBottom =
      textarea.scrollHeight - textarea.scrollTop <= textarea.clientHeight + 20
    if (wasAtBottom) {
      textarea.scrollTop = textarea.scrollHeight
    }
  }, [])

  const applyToStageEditorForBook = useCallback(
    (bookId: string, stage: StageId, payload: ApplyToStageEditorPayload) => {
      const requestedTarget = String(payload.targetStageId ?? '').trim()
      const targetStage =
        stage === PLOT_STAGE_ID
          ? isPlotChildStageId(requestedTarget)
            ? requestedTarget
            : workspaceSessionsRef.current[bookId]?.activePlotChildStage ||
              PLOT_STAGE_ID
          : stage
      tokenBuffersByBookRef.current[bookId] =
        tokenBuffersByBookRef.current[bookId] ?? {}
      tokenBufferRafByBookRef.current[bookId] =
        tokenBufferRafByBookRef.current[bookId] ?? {}
      if (payload.mode === 'replace') {
        // replace 模式立即执行，清空缓冲区
        cancelTokenFlushForBook(bookId, targetStage)
        tokenBuffersByBookRef.current[bookId] = {
          ...(tokenBuffersByBookRef.current[bookId] ?? {}),
          [targetStage]: undefined,
        }
        setEditorStreamingForBook(bookId, targetStage, false)
        updateStageForBook(bookId, targetStage, () => payload.text.trim())
        // DOM 更新后尝试自动滚动
        if (bookRef.current?.id === bookId) {
          requestAnimationFrame(() => autoScrollTextarea(targetStage))
        }
        return
      }

      if (payload.mode === 'append_token') {
        if (!payload.text) return
        setEditorStreamingForBook(bookId, targetStage, true)
        const buffers = { ...(tokenBuffersByBookRef.current[bookId] ?? {}) }
        buffers[targetStage] = (buffers[targetStage] ?? '') + payload.text
        tokenBuffersByBookRef.current[bookId] = buffers
        const rafs = { ...(tokenBufferRafByBookRef.current[bookId] ?? {}) }
        if (rafs[targetStage] === undefined) {
          rafs[targetStage] = requestAnimationFrame(() => {
            flushTokenBufferForBook(bookId, targetStage)
            if (bookRef.current?.id === bookId) {
              requestAnimationFrame(() => autoScrollTextarea(targetStage))
            }
          })
          tokenBufferRafByBookRef.current[bookId] = rafs
        }
        if (bookRef.current?.id === bookId) {
          tokenBuffersRef.current = buffers
          tokenBufferRafRefs.current = rafs
        }
        return
      }

      // 流式结束标记
      if (payload.mode === 'streaming_end') {
        cancelTokenFlushForBook(bookId, targetStage)
        flushTokenBufferForBook(bookId, targetStage)
        setEditorStreamingForBook(bookId, targetStage, false)
        return
      }

      // 其他模式（append）立即执行
      cancelTokenFlushForBook(bookId, targetStage)
      tokenBuffersByBookRef.current[bookId] = {
        ...(tokenBuffersByBookRef.current[bookId] ?? {}),
        [targetStage]: undefined,
      }
      setEditorStreamingForBook(bookId, targetStage, false)
      const trimmed = payload.text.trim()
      if (!trimmed) return
      updateStageForBook(bookId, targetStage, (cur) => {
        const sep = cur.length === 0 ? '' : cur.endsWith('\n') ? '\n' : '\n\n'
        return cur + sep + trimmed
      })
      if (bookRef.current?.id === bookId) {
        requestAnimationFrame(() => autoScrollTextarea(targetStage))
      }
    },
    [
      updateStageForBook,
      cancelTokenFlushForBook,
      flushTokenBufferForBook,
      autoScrollTextarea,
      setEditorStreamingForBook,
    ],
  )

  const refreshWorkspaceBooks = useCallback(async () => {
    const list = await listBooks()
    setWorkspaceBooks(mergeWorkspaceBooksStable(workspaceBookOrderRef, list))
    return list
  }, [])

  const syncWorkspaceBookSummary = useCallback((next: Book) => {
    const summary: BookSummary = {
      id: next.id,
      title: next.title,
      book_type: next.book_type,
      categories: next.categories,
      status: next.status,
      output_dir: next.output_dir,
      linked_material_id: next.linked_material_id,
      linked_skill_id: next.linked_skill_id,
    }
    setWorkspaceBooks((prev) => {
      const index = prev.findIndex((item) => item.id === summary.id)
      if (index < 0) {
        workspaceBookOrderRef.current = [
          ...(workspaceBookOrderRef.current ?? []),
          summary.id,
        ]
        return [...prev, summary]
      }
      return prev.map((item) => (item.id === summary.id ? summary : item))
    })
  }, [])

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

  const waitForSaveIdle = useCallback(async (timeoutMs = 8000): Promise<boolean> => {
    const start = Date.now()
    while (saveInFlightRef.current) {
      if (Date.now() - start >= timeoutMs) return false
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return true
  }, [])

  const load = useCallback(async () => {
    if (!id) return
    setError(null)
    const switching = hasLoadedOnceRef.current
    if (!switching) {
      setLoading(true)
    } else {
      setBookTransitioning(true)
    }
    try {
      const cached = workspaceSessionsRef.current[id]
      if (cached) {
        const pending = pendingInitialStageRef.current
        if (pending?.bookId === id) {
          pendingInitialStageRef.current = null
        }
        const rows = resolveWorkspaceStagesForBook(cached.book)
        let nextCached =
          pending?.bookId === id && rows.some((row) => row.id === pending.stageId)
            ? commitWorkspaceSession(
                id,
                (session) => ({
                  ...session,
                  activeStage: pending.stageId,
                  activePlotChildStage:
                    pending.stageId === PLOT_STAGE_ID
                      ? pending.childId ?? ''
                      : '',
                }),
                false,
              ) ?? cached
            : cached
        if (!nextCached.persistedSnapshot) {
          nextCached = {
            ...nextCached,
            persistedSnapshot: createBookPersistedSnapshot(
              {
                ...nextCached.book,
                stages: mergeStagePatchIntoAll(
                  nextCached.book.stages,
                  nextCached.stages,
                ),
                expert_draft: nextCached.expertDraft,
              },
              nextCached.expertDraft,
            ),
          }
        }
        syncActiveSessionState(nextCached)
        try {
          const [readAccessConfig, bookSummaries] = await Promise.all([
            getWorkspaceAgentReadAccess(workspaceBookType(cached.book)),
            listBooks(),
          ])
          setWorkspaceAgentReadAccess(readAccessConfig)
          setWorkspaceBooks(
            mergeWorkspaceBooksStable(workspaceBookOrderRef, bookSummaries),
          )
        } catch {
          /* 缓存可用时，列表刷新失败不阻塞切回旧书 */
        }
        return
      }

      const [b, bookSummaries] = await Promise.all([
        getBook(id),
        listBooks(),
      ])
      if (!b) {
        setBook(null)
        setError('未找到该书籍')
        return
      }
      const readAccessConfig = await getWorkspaceAgentReadAccess(workspaceBookType(b))
      setWorkspaceAgentReadAccess(readAccessConfig)
      setWorkspaceBooks(
        mergeWorkspaceBooksStable(workspaceBookOrderRef, bookSummaries),
      )
      const coverRes = await getBookCover(b.id)
      const nextCoverData = coverRes.cover_data
      let material: Material | null = null
      if (b.linked_material_id) {
        material = await getMaterial(b.linked_material_id)
      }
      let skill: Skill | null = null
      if (b.linked_skill_id) {
        skill = await getSkill(b.linked_skill_id)
      }
      const rows = resolveWorkspaceStagesForBook(b)
      const pending = pendingInitialStageRef.current
      const pendingStage =
        pending?.bookId === b.id &&
        rows.some((row) => row.id === pending.stageId)
          ? pending.stageId
          : null
      const pendingPlotChild =
        pendingStage === PLOT_STAGE_ID && pending?.childId
          ? pending.childId
          : ''
      if (pending?.bookId === b.id) {
        pendingInitialStageRef.current = null
      }
      const previous = workspaceSessionsRef.current[b.id]
      const session = createBookWorkspaceSession({
        book: b,
        linkedMaterial: material,
        linkedSkill: skill,
        coverData: nextCoverData,
        activeStage: pendingStage ?? previous?.activeStage ?? rows[0]!.id,
        activePlotChildStage: pendingPlotChild || previous?.activePlotChildStage || '',
        resetExpertRuntime: previous == null,
        previous,
      })
      storeWorkspaceSession(session, true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      hasLoadedOnceRef.current = true
      setLoading(false)
      setBookTransitioning(false)
    }
  }, [
    id,
    commitWorkspaceSession,
    storeWorkspaceSession,
    syncActiveSessionState,
  ])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 进入书本页 mount 拉取数据
    void load()
  }, [load])

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
  }, [book, coverData])

  const handleExportExpertDraftDocx = useCallback(async () => {
    const currentStageBody = stagesRef.current.draft ?? ''
    const body = currentStageBody.trim()
      ? currentStageBody
      : combineExpertDraftSections(expertDraftRef.current)
    if (!body) {
      setMessage(null)
      setError('正文编写没有可导出的正文')
      return
    }
    await exportStageDocx('draft', body)
  }, [exportStageDocx])

  const getRenderedWorkspaceStageBody = useCallback(
    (stageId: StageId): string | undefined => {
      return textareaRefsRef.current[stageId]?.value
    },
    [],
  )

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
    [],
  )

  const getRenderedExpertDraftSectionContent = useCallback<
    GetExpertDraftSectionContent
  >((sectionId, field) => {
    const slot = expertDraftActiveSectionEditorRef.current
    if (slot.sectionId !== sectionId) return undefined
    const node = field === 'body' ? slot.body : slot.state
    if (!node) return undefined
    return node.value
  }, [])

  const saveBookSession = useCallback(
    async (
      bookId: string,
      options: SaveCurrentBookOptions = {},
    ): Promise<Book | null> => {
      const session = workspaceSessionsRef.current[bookId]
      if (!session) return null
      const isActiveBook = bookRef.current?.id === bookId
      if (saveInFlightByBookRef.current[bookId]) {
        if (isActiveBook) setError('正在保存，请稍后再试')
        return null
      }
      saveInFlightByBookRef.current[bookId] = true
      if (isActiveBook) {
        saveInFlightRef.current = true
        setSaving(true)
        setMessage(null)
        setError(null)
      }
      try {
        flushAllTokenBuffersForBook(bookId)
        const beforeSave = workspaceSessionsRef.current[bookId] ?? session
        const merged = mergeStagePatchIntoAll(
          beforeSave.book.stages,
          beforeSave.stages,
        )
        const next = await saveBook(bookId, {
          stages: merged,
          expert_draft: beforeSave.expertDraft,
          status: options.status,
        })
        if (!next) {
          if (isActiveBook) setError('保存失败：书籍不存在')
          return null
        }
        const latest = workspaceSessionsRef.current[bookId] ?? beforeSave
        const nextSession: BookWorkspaceSessionState = {
          ...latest,
          book: {
            ...next,
            stages: mergeStagePatchIntoAll(next.stages, latest.stages),
            expert_draft: latest.expertDraft,
            content: latest.stages.draft ?? next.content,
          },
          stages: latest.stages,
          expertDraft: latest.expertDraft,
          persistedSnapshot: createBookPersistedSnapshot(
            {
              ...next,
              stages: mergeStagePatchIntoAll(next.stages, latest.stages),
              expert_draft: latest.expertDraft,
              content: latest.stages.draft ?? next.content,
            },
            latest.expertDraft,
          ),
        }
        storeWorkspaceSession(nextSession, isActiveBook)
        syncWorkspaceBookSummary(next)
        if (isActiveBook && options.successMessage) {
          setMessage(options.successMessage)
          window.setTimeout(() => setMessage(null), 2000)
        }
        return next
      } catch (e) {
        if (isActiveBook) setError(e instanceof Error ? e.message : '保存失败')
        return null
      } finally {
        saveInFlightByBookRef.current[bookId] = false
        if (isActiveBook) {
          saveInFlightRef.current = false
          setSaving(false)
        }
      }
    },
    [
      flushAllTokenBuffersForBook,
      storeWorkspaceSession,
      syncWorkspaceBookSummary,
    ],
  )

  const saveCurrentBook = useCallback(
    async (options: SaveCurrentBookOptions = {}): Promise<Book | null> => {
      const currentBookId = bookRef.current?.id
      if (!currentBookId) return null
      return saveBookSession(currentBookId, options)
    },
    [saveBookSession],
  )

  const handleSave = useCallback(async () => {
    await saveCurrentBook({ successMessage: '已保存' })
  }, [saveCurrentBook])

  const hasUnsavedWorkspaceChanges = useCallback(() => {
    return hasAnyUnsavedWorkspaceChanges(
      workspaceSessionsRef.current,
      tokenBuffersByBookRef.current,
    )
  }, [])

  const confirmLeaveWorkspace = useCallback(() => {
    if (!hasUnsavedWorkspaceChanges()) return true
    return window.confirm(WORKSPACE_LEAVE_CONFIRM_MESSAGE)
  }, [hasUnsavedWorkspaceChanges])

  const handleBackToShelf = useCallback(() => {
    if (!confirmLeaveWorkspace()) return
    navigate('/')
  }, [confirmLeaveWorkspace, navigate])

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedWorkspaceChanges()) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasUnsavedWorkspaceChanges])

  useEffect(() => {
    if (!book || !isWorkspaceBook(book)) return
    const onPopState = () => {
      if (!hasUnsavedWorkspaceChanges()) return
      const ok = window.confirm(WORKSPACE_LEAVE_CONFIRM_MESSAGE)
      if (!ok) {
        window.history.go(1)
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [book, hasUnsavedWorkspaceChanges])

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
    [commitWorkspaceSession],
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
    [commitWorkspaceSession],
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
    [updateExpertDraftForBook],
  )

  const handleExpertDraftSectionSelect = useCallback(
    (sectionId: string) => {
      const currentBookId = bookRef.current?.id
      if (!currentBookId) return
      setActiveBookStage('draft')
      selectExpertDraftSectionForBook(currentBookId, sectionId)
    },
    [selectExpertDraftSectionForBook, setActiveBookStage],
  )

  const handleExpertDraftSectionCreate = useCallback(() => {
    const currentBookId = bookRef.current?.id
    if (!currentBookId) return
    setActiveBookStage('draft')
    createExpertDraftSectionForBook(currentBookId)
  }, [createExpertDraftSectionForBook, setActiveBookStage])

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
    [aiChatEpochByStage, commitWorkspaceSession],
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
  }, [commitWorkspaceSession, expertAiChatEpoch])

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
    [book, navigate, saveCurrentBook, setActiveBookStage, waitForSaveIdle],
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
      handleTreeBookStageSelect,
      book,
      navigate,
      saveCurrentBook,
      selectExpertDraftSectionForBook,
      selectPlotChildForBook,
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
    [createExpertDraftSectionForBook, setActiveBookStage],
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
    [handleTreeBookStageSelect, workspaceBooks],
  )

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
    [getRenderedExpertDraftSectionContent, updateExpertDraftForBook, workspaceAgentReadAccess],
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
  }, [updateExpertDraftForBook])

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
  }, [commitWorkspaceSession])

  const mergeExpertDraftToStage = useCallback(() => {
    if (expertDraftRef.current.running) return
    const body = combineExpertDraftSections(expertDraftRef.current)
    if (!body) {
      setMessage(null)
      setError('正文小节没有可合并的正文')
      return
    }
    updateStage('draft', () => body)
    setActiveBookStage('draft')
    setError(null)
    setMessage('已合并小节正文')
    window.setTimeout(() => setMessage(null), 2000)
  }, [setActiveBookStage, updateStage])

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

  const handleStageBodyChange = (value: string, stageId?: StageId) => {
    const targetStage = stageId ?? resolvePlotEditorStageId(
      activeStageRef.current,
      activePlotChildStageRef.current,
    )
    const currentBookId = bookRef.current?.id
    cancelTokenFlush(targetStage)
    if (currentBookId) {
      const buffers = { ...(tokenBuffersByBookRef.current[currentBookId] ?? {}) }
      delete buffers[targetStage]
      tokenBuffersByBookRef.current[currentBookId] = buffers
      tokenBuffersRef.current = buffers
    }
    updateStage(targetStage, () => value)
  }

  const activeContentStage = resolvePlotEditorStageId(
    activeStage,
    activePlotChildStage,
  )
  const activeStageBody = stages[activeContentStage] ?? ''

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

  const railStages = resolveWorkspaceStagesForBook(book)
  const activePlotChildStages = plotChildStagesForBook(book)
  const workspaceTreeBaseStages = railStages.map((s) => ({
    id: s.id,
    label: s.label,
    ...(s.id === PLOT_STAGE_ID
      ? {
          children: activePlotChildStages.map((child) => ({
            id: child.id,
            label: child.label,
          })),
        }
      : {}),
  }))
  const activeTreeDraft = workspaceSessions[book.id]?.expertDraft ?? expertDraft
  const workspaceTreeStages = workspaceTreeBaseStages.map((stage) => {
    if (stage.id !== 'draft') return stage
    return {
      ...stage,
      children: activeTreeDraft.sections.map((section) => ({
        id: section.id,
        label: expertDraftSectionTreeLabel(section),
      })),
      createChildLabel: '创建章节',
      createChildDisabled: activeTreeDraft.running,
    }
  })
  const workspaceTreeBooks = workspaceBooks
    .filter((item) => item.book_type === book.book_type && isWorkspaceBook(item) && item.status !== 'completed')
    .map((item) => ({
      id: item.id,
      title: item.title,
      meta: item.categories.length > 0 ? item.categories.join('、') : '未分类',
      stages: item.id === book.id ? workspaceTreeStages : workspaceTreeBaseStages,
    }))
  const renderedWorkspaceSessions = loadedBookIds
    .map((bookId) => workspaceSessions[bookId])
    .filter((session): session is BookWorkspaceSessionState => Boolean(session))
    .filter((session) => isWorkspaceBook(session.book) && session.book.book_type === book.book_type)
  const stageBody = activeStageBody
  const expertDraftActive = activeStage === 'draft'
  const activeExpertDraftSectionId = expertDraft.active_section_id || ''
  const ActiveExpertDraftEditor =
    book.book_type === 'script'
      ? ScriptExpertDraftEditor
      : ShortExpertDraftEditor
  const activePlotChildLabel =
    activeStage === PLOT_STAGE_ID && activePlotChildStage
      ? activePlotChildStages.find((stage) => stage.id === activePlotChildStage)?.label
      : ''

  return (
    <div className="editor-page editor-page--workspace">
      <WorkspaceBookHeader
        book={book}
        coverData={coverData}
        coverGenerating={coverGenerating}
        linkedMaterial={linkedMaterial}
        linkedSkill={linkedSkill}
        saving={saving}
        error={error}
        message={message}
        onBack={handleBackToShelf}
        onViewCover={() => setCoverViewerOpen(true)}
        onGenerateCover={openCoverGenerateDialog}
        onCoverError={clearCoverDataForActiveBook}
        onOpenMaterialSelector={() => void openMaterialSelector()}
        onOpenSkillSelector={() => void openSkillSelector()}
        onSave={() => void handleSave()}
        onToggleStatus={() => void handleToggleBookStatus()}
      />

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
          onTitleDraftChange={setTitleDraft}
          onTitleEditStart={handleTitleEditStart}
          onTitleEditEnd={handleTitleEditEnd}
          onTitleEditCancel={handleTitleEditCancel}
          onActiveStageSelect={setActiveBookStage}
          onPlotChildSelect={(childId) => selectPlotChildForBook(book.id, childId)}
          onExpertDraftSectionSelect={handleExpertDraftSectionSelect}
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
          workspaceAgentReadAccess={workspaceAgentReadAccess}
          linkedMaterialTitle={linkedMaterial?.title}
          linkedSkillTitle={linkedSkill?.title}
          workspaceSessionsRef={workspaceSessionsRef}
          getRenderedWorkspaceStageBody={getRenderedWorkspaceStageBody}
          applyToStageEditorForBook={applyToStageEditorForBook}
          saveBookSession={saveBookSession}
          updateExpertDraftForBook={updateExpertDraftForBook}
          startExpertWritingForBook={startExpertWritingForBook}
          getRenderedExpertDraftSectionContent={
            getRenderedExpertDraftSectionContent
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
          mergeExpertDraftToStage={mergeExpertDraftToStage}
          exportExpertDraft={handleExportExpertDraftDocx}
          activeStage={activeStage}
          activeContentStage={activeContentStage}
          activePlotChildStage={activePlotChildStage}
          activePlotChildStages={activePlotChildStages}
          stages={stages}
          railStages={railStages}
          textareaRef={textareaRef}
          textareaRefsRef={textareaRefsRef}
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
        />
      </div>
    </div>
  )
}
