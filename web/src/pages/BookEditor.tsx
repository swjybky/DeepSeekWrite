import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  type Book,
  type BookStatus,
  type BookSummary,
  type ExpertDraft,
  type ExpertDraftSection,
  type StageId,
  defaultExpertDraft,
  mergeStagePatchIntoAll,
  normalizeExpertDraft,
  normalizeStagesForWorkspaceBook,
  WORKSPACE_CONTENT_STAGES,
  resolveWorkspaceStagesForBook,
  resolveWorkspaceBookGenre,
  getBook,
  isWorkspaceShortBook,
  listBooks,
  saveBook,
  listMaterials,
  getMaterial,
  MATERIAL_STAGE_LABELS,
  type Material,
  type MaterialSummary,
  type Skill,
  type SkillSummary,
  generateBookCover,
  getBookCover,
  pickFolder,
  exportDocx,
  getWorkspaceAgentReadAccess,
  type WorkspaceAgentReadAccessConfig,
  listSkills,
  getSkill,
} from '../bridge'
import { WorkspaceAiChat } from '../components/WorkspaceAiChat'
import type { ApplyToStageEditorPayload } from '../pi/workspaceStageAgents'
import { ExpertDraftAiChat } from '../workspaces/short/expertDraft/ExpertDraftAiChat'
import { ExpertDraftEditor } from '../workspaces/short/expertDraft/ExpertDraftEditor'
import {
  runExpertDraftSectionWriter,
  type GetExpertDraftSectionContent,
  type RunExpertDraftSectionWriterOptions,
} from '../workspaces/short/expertDraft/sectionWriter'
import {
  EXPERT_DRAFT_COORDINATOR_AGENT_ID,
  EXPERT_SECTION_WRITER_AGENT_ID,
  getDefaultWorkspaceAgentReadAccess,
  resolveWorkspaceAgentReadAccess,
} from '../workspaces/short/stageReadAccess'
import {
  PLOT_CHILD_STAGES,
  PLOT_STAGE_ID,
  type PlotChildStageId,
} from '../workspaces/short/stages'
import { WorkspaceTreeNav } from '../components/WorkspaceTreeNav'
import './BookEditor.css'

/** 空 stages 对象，用于非激活阶段的稳定引用，避免不必要的重渲染 */
const EMPTY_STAGES: Record<StageId, string> = {} as Record<StageId, string>

type SaveCurrentBookOptions = {
  status?: BookStatus
  successMessage?: string | null
}

type BookPersistedSnapshot = {
  stages: Record<StageId, string>
  expertDraft: ExpertDraft
}

type BookWorkspaceSessionState = {
  book: Book
  stages: Record<StageId, string>
  expertDraft: ExpertDraft
  persistedSnapshot: BookPersistedSnapshot
  activeStage: StageId
  activePlotChildStage: PlotChildStageId | ''
  linkedMaterial: Material | null
  linkedSkill: Skill | null
  coverData: string | null
  aiChatEpochByStage: Partial<Record<StageId, number>>
  expertAiChatEpoch: number
  streamingStages: Partial<Record<StageId, boolean>>
}

const WORKSPACE_LEAVE_CONFIRM_MESSAGE =
  '当前有未保存的修改，确定离开创作空间吗？未保存的内容将丢失。'

function expertDraftPersistedFingerprint(draft: ExpertDraft): string {
  return JSON.stringify({
    sections: draft.sections.map((section) => ({
      id: section.id,
      title: section.title,
      word_count_requirement: section.word_count_requirement ?? '',
      body: section.body,
    })),
    character_states: draft.character_states.map((state) => ({
      section_id: state.section_id,
      title: state.title,
      body: state.body,
    })),
  })
}

function createBookPersistedSnapshot(
  book: Book,
  expertDraft?: ExpertDraft,
): BookPersistedSnapshot {
  return {
    stages: normalizeStagesForWorkspaceBook(book, book.stages),
    expertDraft: normalizeExpertDraft(expertDraft ?? book.expert_draft, true),
  }
}

function resolvePersistedSnapshot(
  session: BookWorkspaceSessionState,
): BookPersistedSnapshot {
  return (
    session.persistedSnapshot ??
    createBookPersistedSnapshot(session.book, session.expertDraft)
  )
}

function bookSessionHasUnsavedChanges(
  session: BookWorkspaceSessionState,
  tokenBuffers: Partial<Record<StageId, string>> | undefined,
): boolean {
  if (
    tokenBuffers &&
    Object.values(tokenBuffers).some((value) => (value ?? '').length > 0)
  ) {
    return true
  }
  const snapshot = resolvePersistedSnapshot(session)
  for (const stage of WORKSPACE_CONTENT_STAGES) {
    if ((session.stages[stage.id] ?? '') !== (snapshot.stages[stage.id] ?? '')) {
      return true
    }
  }
  return (
    expertDraftPersistedFingerprint(session.expertDraft) !==
    expertDraftPersistedFingerprint(snapshot.expertDraft)
  )
}

function hasAnyUnsavedWorkspaceChanges(
  sessions: Record<string, BookWorkspaceSessionState>,
  tokenBuffersByBook: Record<string, Partial<Record<StageId, string>>>,
): boolean {
  return Object.entries(sessions).some(([bookId, session]) =>
    bookSessionHasUnsavedChanges(
      session,
      tokenBuffersByBook[bookId],
    ),
  )
}

const AI_PANEL_WIDTH_KEY = 'write-claw:workspace-ai-width'
const AI_PANEL_MIN = 240
/** 超宽屏下的绝对上限，避免 AI 栏占满整屏 */
const AI_PANEL_HARD_MAX = 1000
/** Pi ChatPanel 会注入 artifacts；false 则从 Agent 工具列表移除（对话流式优先）。改为 true 可恢复侧栏工件面板能力。 */
const WORKSPACE_AI_INCLUDE_PI_ARTIFACTS = false
const WORKSPACE_SPLITTER_W = 6
/** 三栏份额：左 : 中 : 右（AI）= 18 : 36 : 36，可分配宽 = 视口宽 − 分割条 */
const WORKSPACE_COL_L = 18
const WORKSPACE_COL_R = 36
const WORKSPACE_COL_SUM = 18 + 36 + 36
/** 为中间编辑区保留的近似最小宽度（用于计算 AI 栏在当前窗口下最大能拉多宽） */
const EDITOR_MIN_FOR_LAYOUT = 160

function usableWidthLessSplitter(viewportWidth: number): number {
  return Math.max(0, viewportWidth - WORKSPACE_SPLITTER_W)
}

function approxRailWidthPx(viewportWidth: number): number {
  return Math.round(
    (usableWidthLessSplitter(viewportWidth) * WORKSPACE_COL_L) /
      WORKSPACE_COL_SUM,
  )
}

function defaultAiPanelWidthPx(viewportWidth: number): number {
  return Math.round(
    (usableWidthLessSplitter(viewportWidth) * WORKSPACE_COL_R) /
      WORKSPACE_COL_SUM,
  )
}

function maxAiWidthForViewport(viewportWidth: number): number {
  const rail = approxRailWidthPx(viewportWidth)
  const raw =
    viewportWidth - rail - WORKSPACE_SPLITTER_W - EDITOR_MIN_FOR_LAYOUT
  return Math.min(
    AI_PANEL_HARD_MAX,
    Math.max(AI_PANEL_MIN, Math.floor(raw)),
  )
}

function clampAiPanelWidth(width: number, viewportWidth: number): number {
  const cap = maxAiWidthForViewport(viewportWidth)
  return Math.min(cap, Math.max(AI_PANEL_MIN, width))
}

/** 总字符长度与不含 Unicode 空白类字符的字数（换行不计入后者） */
function stageTextCounts(text: string): { total: number; nonSpace: number } {
  return {
    total: text.length,
    nonSpace: text.replace(/\p{White_Space}/gu, '').length,
  }
}

function combineExpertDraftSections(draft: ExpertDraft): string {
  return draft.sections
    .map((section) => {
      const body = section.body.trim()
      if (!body) return ''
      const title = section.title.trim()
      return title ? `${title}\n${body}` : body
    })
    .filter(Boolean)
    .join('\n\n')
}

function chineseSectionNumber(n: number): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  if (n <= 10) return n === 10 ? '十' : digits[n]!
  if (n < 20) return `十${digits[n - 10]}`
  if (n < 100) {
    const tens = Math.floor(n / 10)
    const ones = n % 10
    return `${digits[tens]}十${ones ? digits[ones] : ''}`
  }
  return String(n)
}

function expertDraftSectionTitleForIndex(index: number): string {
  if (index <= 0) return '导语'
  return `第${chineseSectionNumber(index)}节`
}

function nextExpertDraftSectionId(sections: ExpertDraftSection[]): string {
  let n = sections.length
  const used = new Set(sections.map((s) => s.id))
  while (used.has(`section-${n}`)) n += 1
  return `section-${n}`
}

function defaultExpertDraftStateTitle(sectionTitle: string): string {
  return `${sectionTitle.trim() || '小节'}人物状态`
}

function expertDraftSectionTreeLabel(section: ExpertDraftSection): string {
  const title = section.title.trim()
  return title || '未命名小节'
}

function isPlotChildStageId(stageId: string): stageId is PlotChildStageId {
  return PLOT_CHILD_STAGES.some((stage) => stage.id === stageId)
}

function resolvePlotEditorStageId(
  activeStage: StageId,
  activePlotChildStage: PlotChildStageId | '',
): StageId {
  if (activeStage !== PLOT_STAGE_ID) return activeStage
  return activePlotChildStage || PLOT_STAGE_ID
}

/** 左侧树书籍列表保持进入工作台时的顺序，不因保存/切换导致按更新时间重排 */
function mergeWorkspaceBooksStable(
  orderRef: { current: string[] | null },
  incoming: BookSummary[],
): BookSummary[] {
  const byId = new Map(incoming.map((b) => [b.id, b]))
  let order = orderRef.current
  if (!order?.length) {
    order = incoming.map((b) => b.id)
  } else {
    for (const b of incoming) {
      if (!order.includes(b.id)) order.push(b.id)
    }
    order = order.filter((bookId) => byId.has(bookId))
  }
  orderRef.current = order
  return order
    .map((bookId) => byId.get(bookId))
    .filter((b): b is BookSummary => b != null)
}

function readStoredAiWidth(): number {
  const vw =
    typeof window !== 'undefined' ? window.innerWidth : 1280
  try {
    const raw = localStorage.getItem(AI_PANEL_WIDTH_KEY)
    const n = raw ? Number.parseInt(raw, 10) : NaN
    if (!Number.isFinite(n))
      return clampAiPanelWidth(defaultAiPanelWidthPx(vw), vw)
    return clampAiPanelWidth(n, vw)
  } catch {
    return clampAiPanelWidth(defaultAiPanelWidthPx(vw), vw)
  }
}

function createBookWorkspaceSession(input: {
  book: Book
  linkedMaterial: Material | null
  linkedSkill: Skill | null
  coverData: string | null
  activeStage: StageId
  activePlotChildStage?: PlotChildStageId | ''
  resetExpertRuntime: boolean
  previous?: BookWorkspaceSessionState
}): BookWorkspaceSessionState {
  const stages = normalizeStagesForWorkspaceBook(input.book, input.book.stages)
  const expertDraft = normalizeExpertDraft(
    input.book.expert_draft,
    input.resetExpertRuntime,
  )
  const persistedSnapshot =
    input.previous?.persistedSnapshot ??
    createBookPersistedSnapshot(input.book, expertDraft)
  return {
    book: input.book,
    stages,
    expertDraft,
    persistedSnapshot,
    activeStage: input.activeStage,
    activePlotChildStage:
      input.activeStage === PLOT_STAGE_ID
        ? input.activePlotChildStage ?? input.previous?.activePlotChildStage ?? ''
        : '',
    linkedMaterial: input.linkedMaterial,
    linkedSkill: input.linkedSkill,
    coverData: input.coverData,
    aiChatEpochByStage: input.previous?.aiChatEpochByStage ?? {},
    expertAiChatEpoch: input.previous?.expertAiChatEpoch ?? 0,
    streamingStages: input.previous?.streamingStages ?? {},
  }
}


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
  const [aiPanelWidth, setAiPanelWidth] = useState(readStoredAiWidth)
  /** 当前阶段 AI 侧栏「对话轮次」：递增后重建 Pi 会话并清空该阶段对话历史 */
  const [linkedMaterial, setLinkedMaterial] = useState<Material | null>(null)
  const [linkedSkill, setLinkedSkill] = useState<Skill | null>(null)
  const [workspaceAgentReadAccess, setWorkspaceAgentReadAccess] =
    useState<WorkspaceAgentReadAccessConfig>(
      () => getDefaultWorkspaceAgentReadAccess(),
  )
  const [materialSelectorOpen, setMaterialSelectorOpen] = useState(false)
  const [materialSummaries, setMaterialSummaries] = useState<MaterialSummary[]>([])
  const [materialSelectorLoading, setMaterialSelectorLoading] = useState(false)
  const [materialSelectorSaving, setMaterialSelectorSaving] = useState(false)
  const [skillSelectorOpen, setSkillSelectorOpen] = useState(false)
  const [skillSummaries, setSkillSummaries] = useState<SkillSummary[]>([])
  const [skillSelectorLoading, setSkillSelectorLoading] = useState(false)
  const [skillSelectorSaving, setSkillSelectorSaving] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [aiChatEpochByStage, setAiChatEpochByStage] = useState<
    Partial<Record<StageId, number>>
  >({})
  const [expertAiChatEpoch, setExpertAiChatEpoch] = useState(0)
  /** 封面相关状态 */
  const [coverData, setCoverData] = useState<string | null>(null)
  const [coverGenerating, setCoverGenerating] = useState(false)
  const [coverDialogOpen, setCoverDialogOpen] = useState(false)
  const [coverPromptDraft, setCoverPromptDraft] = useState('')
  const [coverViewerOpen, setCoverViewerOpen] = useState(false)
  const [workspaceSessions, setWorkspaceSessions] = useState<
    Record<string, BookWorkspaceSessionState>
  >({})
  const [loadedBookIds, setLoadedBookIds] = useState<string[]>([])
  const splitDragRef = useRef<{ startX: number; startWidth: number } | null>(
    null,
  )
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
    setLoadedBookIds((prev) => {
      if (prev.includes(bookId)) return prev
      return [...prev, bookId]
    })
  }, [])

  const syncActiveSessionState = useCallback((session: BookWorkspaceSessionState) => {
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
  }, [])

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
      setWorkspaceSessions(nextSessions)
      if (syncActive && bookRef.current?.id === bookId) {
        syncActiveSessionState(nextSession)
      }
      return nextSession
    },
    [syncActiveSessionState],
  )

  const storeWorkspaceSession = useCallback(
    (session: BookWorkspaceSessionState, makeActive: boolean) => {
      const nextSessions = {
        ...workspaceSessionsRef.current,
        [session.book.id]: session,
      }
      workspaceSessionsRef.current = nextSessions
      setWorkspaceSessions(nextSessions)
      rememberLoadedBookId(session.book.id)
      tokenBuffersByBookRef.current[session.book.id] =
        tokenBuffersByBookRef.current[session.book.id] ?? {}
      tokenBufferRafByBookRef.current[session.book.id] =
        tokenBufferRafByBookRef.current[session.book.id] ?? {}
      if (makeActive) {
        syncActiveSessionState(session)
      }
    },
    [rememberLoadedBookId, syncActiveSessionState],
  )

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
    }
    return cleanupWorkspaceRuntime
  }, [])

  const updateExpertDraftForBook = useCallback(
    (bookId: string, updater: (current: ExpertDraft) => ExpertDraft) => {
      commitWorkspaceSession(bookId, (session) => {
        const nextExpertDraft = normalizeExpertDraft(updater(session.expertDraft))
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

  useEffect(() => {
    try {
      localStorage.setItem(AI_PANEL_WIDTH_KEY, String(aiPanelWidth))
    } catch {
      /* ignore */
    }
  }, [aiPanelWidth])

  useEffect(() => {
    const onResize = () => {
      setAiPanelWidth((w) => clampAiPanelWidth(w, window.innerWidth))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

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
            getWorkspaceAgentReadAccess(),
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

      const [b, readAccessConfig, bookSummaries] = await Promise.all([
        getBook(id),
        getWorkspaceAgentReadAccess(),
        listBooks(),
      ])
      if (!b) {
        setBook(null)
        setError('未找到该书籍')
        return
      }
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
    if (!book || !isWorkspaceShortBook(book)) return
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
        const id = nextExpertDraftSectionId(draft.sections)
        const title = expertDraftSectionTitleForIndex(draft.sections.length)
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

      const run = runExpertDraftSectionWriter({
        bookId: session.book.id,
        bookTitle: session.book.title,
        bookGenre: resolveWorkspaceBookGenre(session.book),
        sectionIds: ids,
        getDraft: () =>
          workspaceSessionsRef.current[bookId]?.expertDraft ??
          normalizeExpertDraft(null),
        getWorkspaceStages: () =>
          workspaceSessionsRef.current[bookId]?.stages ?? EMPTY_STAGES,
        linkedMaterial: session.linkedMaterial,
        linkedSkill: session.linkedSkill,
        userWritingPrompt: options?.userWritingPrompt,
        readAccess: resolveWorkspaceAgentReadAccess(
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
    const ok = window.confirm('清空正文编写内容，并恢复为导语和第一节的初始状态？')
    if (!ok) return
    const currentBookId = bookRef.current?.id
    if (!currentBookId) return
    const next = normalizeExpertDraft(defaultExpertDraft(), true)
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
      if (!id || !book || !isWorkspaceShortBook(book)) return
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

  const useWorkspace = book ? isWorkspaceShortBook(book) : false

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
              {book.book_type === 'short' ? '短篇' : '长篇'}
              {book.book_type === 'short' && book.categories.length > 0
                ? ` · ${book.categories.join('、')}`
                : ''}
            </span>
          </div>
          <span className="editor-header-spacer" aria-hidden />
        </header>
        <div className="editor-pending-main">
          <p className="editor-pending-title">该类型工作台开发中</p>
          <p className="muted editor-pending-desc">
            当前所有短篇书籍可使用完整写作台与 AI 协作；长篇工作台仍在扩展中。
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
  const workspaceTreeBaseStages = railStages.map((s) => ({
    id: s.id,
    label: s.label,
    ...(s.id === PLOT_STAGE_ID
      ? {
          children: PLOT_CHILD_STAGES.map((child) => ({
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
    .filter((item) => item.book_type === 'short' && item.status !== 'completed')
    .map((item) => ({
      id: item.id,
      title: item.title,
      meta: item.categories.length > 0 ? item.categories.join('、') : '未分类',
      stages: item.id === book.id ? workspaceTreeStages : workspaceTreeBaseStages,
    }))
  const renderedWorkspaceSessions = loadedBookIds
    .map((bookId) => workspaceSessions[bookId])
    .filter((session): session is BookWorkspaceSessionState => Boolean(session))
    .filter((session) => isWorkspaceShortBook(session.book))
  const stageBody = activeStageBody
  const expertDraftActive = activeStage === 'draft'
  const activeExpertDraftSectionId = expertDraft.active_section_id || ''
  const activePlotChildLabel =
    activeStage === PLOT_STAGE_ID && activePlotChildStage
      ? PLOT_CHILD_STAGES.find((stage) => stage.id === activePlotChildStage)?.label
      : ''

  const openMaterialSelector = async () => {
    setMaterialSelectorOpen(true)
    setMaterialSelectorLoading(true)
    setError(null)
    try {
      setMaterialSummaries(await listMaterials())
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法加载素材库列表')
    } finally {
      setMaterialSelectorLoading(false)
    }
  }

  const saveLinkedMaterial = async (materialId: string | null) => {
    if (!book) return
    setMaterialSelectorSaving(true)
    setError(null)
    try {
      const next = await saveBook(book.id, { linked_material_id: materialId ?? '' })
      if (!next) {
        setError('关联素材库失败：书籍不存在')
        return
      }
      const material = next.linked_material_id
        ? await getMaterial(next.linked_material_id)
        : null
      const currentSession = workspaceSessionsRef.current[next.id]
      if (currentSession) {
        storeWorkspaceSession(
          {
            ...currentSession,
            book: next,
            linkedMaterial: material,
          },
          bookRef.current?.id === next.id,
        )
      } else {
        setBook(next)
        setLinkedMaterial(material)
      }
      syncWorkspaceBookSummary(next)
      setMaterialSelectorOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '关联素材库失败')
    } finally {
      setMaterialSelectorSaving(false)
    }
  }

  const openSkillSelector = async () => {
    setSkillSelectorOpen(true)
    setSkillSelectorLoading(true)
    setError(null)
    try {
      setSkillSummaries(await listSkills())
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法加载技能库列表')
    } finally {
      setSkillSelectorLoading(false)
    }
  }

  const saveLinkedSkill = async (skillId: string | null) => {
    if (!book) return
    setSkillSelectorSaving(true)
    setError(null)
    try {
      const next = await saveBook(book.id, { linked_skill_id: skillId ?? '' })
      if (!next) {
        setError('绑定技能库失败：书籍不存在')
        return
      }
      const skill = next.linked_skill_id ? await getSkill(next.linked_skill_id) : null
      const currentSession = workspaceSessionsRef.current[next.id]
      if (currentSession) {
        storeWorkspaceSession(
          {
            ...currentSession,
            book: next,
            linkedSkill: skill,
          },
          bookRef.current?.id === next.id,
        )
      } else {
        setBook(next)
        setLinkedSkill(skill)
      }
      syncWorkspaceBookSummary(next)
      setSkillSelectorOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '绑定技能库失败')
    } finally {
      setSkillSelectorSaving(false)
    }
  }

  const { total: stageCharTotal, nonSpace: stageCharNonSpace } =
    stageTextCounts(stageBody)

  return (
    <div className="editor-page editor-page--workspace">
      <header className="editor-header editor-header--agent">
        <button type="button" className="back-link" onClick={handleBackToShelf}>
          ← 返回
        </button>
        <div className="editor-header-meta muted">
          <span className="editor-header-meta-inner">
            <span className="editor-header-meta-text">
              {book?.title || '未命名'}
              {' · '}
              {book?.book_type === 'short' ? '短篇' : '长篇'}
              {book?.book_type === 'short' && (book.categories?.length ?? 0) > 0
                ? ` · ${(book.categories ?? []).join('、')}`
                : ''}
              {book?.status === 'completed' ? ' · 已完成' : ''}
            </span>
            {error || message ? (
              <span
                className={
                  error
                    ? 'editor-header-flash editor-header-flash--error'
                    : 'editor-header-flash editor-header-flash--ok'
                }
                aria-live="polite"
              >
                {error ?? message}
              </span>
            ) : null}
          </span>
        </div>
        <div className="editor-header-actions">
          {coverData ? (
            <button
              type="button"
              className="btn-cover-view"
              title="查看封面"
              onClick={() => setCoverViewerOpen(true)}
            >
              <img
                src={`data:image/png;base64,${coverData}`}
                alt="封面"
                className="btn-cover-thumb"
                onError={() => {
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
                }}
              />
            </button>
          ) : null}
          <button
            type="button"
            className="btn-cover-generate"
            onClick={() => {
              const defaultPrompt = `基于下面的书内容介绍，给我生成一个具有吸引力的书封面，封面不要有小字，给出合适配图，加上书名\n书名：${book?.title ?? ''}`
              setCoverPromptDraft(defaultPrompt)
              setCoverDialogOpen(true)
            }}
            disabled={coverGenerating}
          >
            {coverGenerating ? '生成中…' : '生成封面'}
          </button>
          <span
            className="editor-header-material-name"
            title={linkedMaterial ? `已关联：${linkedMaterial.title}` : '未关联素材库'}
          >
            {linkedMaterial ? linkedMaterial.title : '未关联素材'}
          </span>
          <button
            type="button"
            className={
              linkedMaterial
                ? 'editor-header-material-select editor-header-material-select--active'
                : 'editor-header-material-select'
            }
            aria-label="选择关联素材库"
            title={linkedMaterial ? `已关联：${linkedMaterial.title}` : '选择关联素材库'}
            onClick={() => void openMaterialSelector()}
          >
            素材库选择
          </button>
          <span
            className="editor-header-material-name"
            title={linkedSkill ? `已绑定：${linkedSkill.title}` : '未绑定技能库'}
          >
            {linkedSkill ? linkedSkill.title : '未绑定技能'}
          </span>
          <button
            type="button"
            className={
              linkedSkill
                ? 'editor-header-material-select editor-header-material-select--active'
                : 'editor-header-material-select'
            }
            aria-label="选择绑定技能库"
            title={linkedSkill ? `已绑定：${linkedSkill.title}` : '选择绑定技能库'}
            onClick={() => void openSkillSelector()}
          >
            技能库选择
          </button>
          <button
            type="button"
            className="btn-save"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? '保存中…' : '保存'}
          </button>
          <button
            type="button"
            className={
              book.status === 'completed'
                ? 'btn-book-status btn-book-status--completed'
                : 'btn-book-status'
            }
            onClick={() => void handleToggleBookStatus()}
            disabled={saving}
          >
            {book.status === 'completed' ? '修改' : '完成'}
          </button>
        </div>
      </header>

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
        <aside className="workspace-rail workspace-rail--tree">
          {book.status === 'completed' ? (
            <WorkspaceTreeNav
              rootLabel={book.title}
              stages={workspaceTreeStages}
              defaultExpanded
              activeStageId={activeStage}
              activeStageChildId={
                activeStage === PLOT_STAGE_ID
                  ? activePlotChildStage || undefined
                  : activeStage === 'draft'
                    ? activeExpertDraftSectionId
                    : undefined
              }
              onStageSelect={(stageId) => setActiveBookStage(stageId as StageId)}
              onStageChildSelect={(stageId, childId) => {
                if (stageId === PLOT_STAGE_ID && isPlotChildStageId(childId)) {
                  selectPlotChildForBook(book.id, childId)
                }
                if (stageId === 'draft') handleExpertDraftSectionSelect(childId)
              }}
              onStageChildCreate={(stageId) => {
                if (stageId === 'draft') handleExpertDraftSectionCreate()
              }}
              editingTitle={editingTitle}
              titleDraft={titleDraft}
              onTitleDraftChange={setTitleDraft}
              onTitleEditStart={() => {
                setTitleDraft(book.title)
                setEditingTitle(true)
              }}
              onTitleEditEnd={() => {
                const trimmed = titleDraft.trim()
                if (trimmed && trimmed !== book.title) {
                  void (async () => {
                    try {
                      const next = await saveBook(book.id, { title: trimmed })
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
              }}
              onTitleEditCancel={() => {
                setEditingTitle(false)
                setTitleDraft('')
              }}
            />
          ) : (
            <WorkspaceTreeNav
              books={workspaceTreeBooks}
              defaultExpanded={false}
              activeBookId={book.id}
              activeStageId={activeStage}
              activeStageChildId={
                activeStage === PLOT_STAGE_ID
                  ? activePlotChildStage || undefined
                  : activeStage === 'draft'
                    ? activeExpertDraftSectionId
                    : undefined
              }
              onStageSelect={(stageId) =>
                void handleTreeBookStageSelect(book.id, stageId as StageId)
              }
              onBookSelect={(bookId) => handleTreeBookSelect(bookId)}
              onBookStageSelect={(bookId, stageId) =>
                void handleTreeBookStageSelect(bookId, stageId as StageId)
              }
              onBookStageChildSelect={(bookId, stageId, childId) =>
                void handleTreeBookStageChildSelect(
                  bookId,
                  stageId as StageId,
                  childId,
                )
              }
              onBookStageChildCreate={(bookId, stageId) =>
                handleTreeBookStageChildCreate(bookId, stageId as StageId)
              }
              editingTitle={editingTitle}
              titleDraft={titleDraft}
              onTitleDraftChange={setTitleDraft}
              onTitleEditStart={() => {
                setTitleDraft(book?.title ?? '')
                setEditingTitle(true)
              }}
              onTitleEditEnd={() => {
                const trimmed = titleDraft.trim()
                if (trimmed && trimmed !== book?.title && book) {
                  void (async () => {
                    try {
                      const next = await saveBook(book.id, { title: trimmed })
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
              }}
              onTitleEditCancel={() => {
                setEditingTitle(false)
                setTitleDraft('')
              }}
            />
          )}
        </aside>

        <aside className="workspace-ai workspace-ai--center" aria-label="AI 对话">
          <div className="workspace-ai-header workspace-ai-header-row">
            <span className="workspace-ai-header-title">智能体</span>
            {book ? (
              <div className="workspace-ai-header-actions">
                <button
                  type="button"
                  className="workspace-ai-new-chat"
                  aria-label={
                    expertDraftActive
                      ? activeExpertDraftSectionId
                        ? '清空当前小节分节写手对话并开始新会话'
                        : '清空专家总控智能体对话并开始新会话'
                      : '清空当前阶段 AI 对话并开始新会话'
                  }
                  title={
                    expertDraftActive
                      ? activeExpertDraftSectionId
                        ? '仅清空当前小节的分节写手会话，其它小节各自保留独立历史'
                        : '仅清空专家总控智能体上下文，不影响后台分节写作任务'
                      : '仅影响当前左侧阶段对应的助手会话，其他阶段各有一份独立历史'
                  }
                  disabled={expertDraftActive && expertDraft.running}
                  onClick={() => {
                    if (expertDraftActive) {
                      bumpActiveExpertChatEpoch()
                      return
                    }
                    bumpActiveStageChatEpoch(activeStage)
                  }}
                >
                  新建对话
                </button>
              </div>
            ) : null}
          </div>
          <div className="workspace-ai-hint muted">
            {railStages.find((s) => s.id === activeStage)?.label}
            {activePlotChildLabel ? ` · ${activePlotChildLabel}` : ''}
            {expertDraftActive
              ? activeExpertDraftSectionId
                ? ' · 分节写手'
                : ' · 专家总控'
              : ''}
            {' · '}
            {book?.categories.join('、') || '未分类'}
            {linkedMaterial ? ` · 素材：${linkedMaterial.title}` : ''}
            {linkedSkill ? ` · 技能：${linkedSkill.title}` : ''}
          </div>
          {book ? (
            <div className="workspace-ai-chat-stack">
              {renderedWorkspaceSessions.flatMap((session) => {
                const sessionBookGenre = resolveWorkspaceBookGenre(session.book)
                const sessionStages = resolveWorkspaceStagesForBook(session.book)
                const sessionExpertActive =
                  session.activeStage === 'draft'
                const isVisibleBook = session.book.id === book.id
                const stageLayers = sessionStages
                  .filter((s) => s.id !== 'draft')
                  .map((s) => {
                    const epoch = session.aiChatEpochByStage[s.id] ?? 0
                    const activeContentStageForLayer =
                      s.id === PLOT_STAGE_ID
                        ? session.activePlotChildStage || PLOT_STAGE_ID
                        : s.id
                    const layerKey =
                      epoch > 0
                        ? `${session.book.id}-shared-${s.id}-${epoch}`
                        : `${session.book.id}-shared-${s.id}`
                    const isActive =
                      isVisibleBook &&
                      session.activeStage === s.id &&
                      !sessionExpertActive
                    return (
                      <div
                        key={layerKey}
                        className={
                          isActive
                            ? 'workspace-ai-chat-layer workspace-ai-chat-layer--active'
                            : 'workspace-ai-chat-layer'
                        }
                        aria-hidden={!isActive}
                      >
                        <WorkspaceAiChat
                          sessionBookId={session.book.id}
                          sessionEpoch={epoch}
                          bookTitle={session.book.title}
                          bookGenre={sessionBookGenre}
                          stageId={s.id}
                          activeStageContentId={activeContentStageForLayer}
                          stageBody={
                            session.stages[activeContentStageForLayer] ?? ''
                          }
                          getCurrentStageBody={(stageId) => {
                            const sid = (stageId ?? s.id) as StageId
                            if (isVisibleBook) {
                              const rendered = getRenderedWorkspaceStageBody(sid)
                              if (rendered !== undefined) return rendered
                            }
                            if (isVisibleBook && sid === activeStageRef.current) {
                              return getRenderedWorkspaceStageBody(sid)
                            }
                            return workspaceSessionsRef.current[session.book.id]?.stages[sid]
                          }}
                          allStages={session.stages}
                          linkedMaterial={session.linkedMaterial}
                          linkedSkill={session.linkedSkill}
                          workspaceAgentReadAccess={workspaceAgentReadAccess}
                          includePiArtifacts={WORKSPACE_AI_INCLUDE_PI_ARTIFACTS}
                          applyToStageEditor={(payload) =>
                            applyToStageEditorForBook(session.book.id, s.id, payload)
                          }
                          onRequestSave={async () => {
                            await saveBookSession(session.book.id)
                          }}
                          isPaused={!isActive}
                        />
                      </div>
                    )
                  })

                const expertLayerActive = isVisibleBook && sessionExpertActive
                const expertLayer = (
                  <div
                    key={`${session.book.id}-expert-draft-layer`}
                    className={
                      expertLayerActive
                        ? 'workspace-ai-chat-layer workspace-ai-chat-layer--active'
                        : 'workspace-ai-chat-layer'
                    }
                    aria-hidden={!expertLayerActive}
                  >
                    <ExpertDraftAiChat
                      key={`${session.book.id}-shared-expert-draft-${session.expertAiChatEpoch}`}
                      bookId={session.book.id}
                      bookTitle={session.book.title}
                      bookGenre={sessionBookGenre}
                      sessionEpoch={session.expertAiChatEpoch}
                      stages={session.stages}
                      linkedMaterial={session.linkedMaterial}
                      linkedSkill={session.linkedSkill}
                      readAccess={resolveWorkspaceAgentReadAccess(
                        workspaceAgentReadAccess,
                        EXPERT_DRAFT_COORDINATOR_AGENT_ID,
                      )}
                      writerReadAccess={resolveWorkspaceAgentReadAccess(
                        workspaceAgentReadAccess,
                        EXPERT_SECTION_WRITER_AGENT_ID,
                      )}
                      expertDraft={session.expertDraft}
                      updateDraft={(updater) =>
                        updateExpertDraftForBook(session.book.id, updater)
                      }
                      startWriting={(sectionIds, options) =>
                        startExpertWritingForBook(
                          session.book.id,
                          sectionIds,
                          options,
                        )
                      }
                      getRenderedExpertDraftSectionContent={
                        isVisibleBook
                          ? getRenderedExpertDraftSectionContent
                          : undefined
                      }
                    />
                  </div>
                )
                return [...stageLayers, expertLayer]
              })}
            </div>
          ) : null}
        </aside>

        <div
          className="workspace-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整对话区宽度"
          tabIndex={0}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.preventDefault()
            splitDragRef.current = {
              startX: e.clientX,
              startWidth: aiPanelWidth,
            }
            ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            const drag = splitDragRef.current
            if (!drag) return
            const delta = e.clientX - drag.startX
            const next = drag.startWidth + delta
            setAiPanelWidth(clampAiPanelWidth(next, window.innerWidth))
          }}
          onPointerUp={(e) => {
            splitDragRef.current = null
            try {
              ;(e.currentTarget as HTMLDivElement).releasePointerCapture(
                e.pointerId,
              )
            } catch {
              /* ignore */
            }
          }}
          onPointerCancel={(e) => {
            splitDragRef.current = null
            try {
              ;(e.currentTarget as HTMLDivElement).releasePointerCapture(
                e.pointerId,
              )
            } catch {
              /* ignore */
            }
          }}
          onKeyDown={(e) => {
            const step = 16
            if (e.key === 'ArrowLeft') {
              e.preventDefault()
              setAiPanelWidth((w) =>
                clampAiPanelWidth(w - step, window.innerWidth),
              )
            } else if (e.key === 'ArrowRight') {
              e.preventDefault()
              setAiPanelWidth((w) =>
                clampAiPanelWidth(w + step, window.innerWidth),
              )
            }
          }}
        />

        <div className="workspace-editor-pane workspace-editor-pane--primary">
          {expertDraftActive ? (
            <ExpertDraftEditor
              draft={expertDraft}
              stageBody={stageBody}
              stageBodyReadOnly={Boolean(streamingStages.draft)}
              onStageBodyChange={handleStageBodyChange}
              updateDraft={updateExpertDraft}
              onSectionTextareaRef={handleExpertDraftSectionTextareaRef}
              stopWriting={stopExpertWriting}
              resetDraft={resetExpertDraft}
              mergeSectionsToDraft={mergeExpertDraftToStage}
              exportDraft={handleExportExpertDraftDocx}
            />
          ) : activeStage === PLOT_STAGE_ID ? (
            <div
              className={
                activePlotChildStage
                  ? 'workspace-plot-editor workspace-plot-editor--single'
                  : 'workspace-plot-editor'
              }
            >
              {(activePlotChildStage
                ? PLOT_CHILD_STAGES.filter(
                    (stage) => stage.id === activePlotChildStage,
                  )
                : PLOT_CHILD_STAGES
              ).map((plotStage) => {
                const body = stages[plotStage.id] ?? ''
                const counts = stageTextCounts(body)
                return (
                  <section
                    key={plotStage.id}
                    className="workspace-plot-editor-section"
                  >
                    <div className="workspace-stage-heading">
                      <label
                        className="workspace-stage-label"
                        htmlFor={`stage-body-${plotStage.id}`}
                      >
                        {plotStage.label}
                      </label>
                      <span
                        className="workspace-char-count muted"
                        aria-live="polite"
                        title={`不含空白字数 ${counts.nonSpace.toLocaleString('zh-CN')}；总字符（含空格与换行）${counts.total.toLocaleString('zh-CN')}`}
                      >
                        {counts.nonSpace.toLocaleString('zh-CN')} 字
                        <span className="workspace-char-count-sep" aria-hidden>
                          {' · '}
                        </span>
                        <span className="workspace-char-count-detail">
                          {counts.total.toLocaleString('zh-CN')} 字符
                        </span>
                      </span>
                    </div>
                    <textarea
                      id={`stage-body-${plotStage.id}`}
                      ref={(node) => {
                        textareaRefsRef.current[plotStage.id] = node
                        if (plotStage.id === activeContentStage) {
                          textareaRef.current = node
                        }
                      }}
                      className="editor-body workspace-textarea"
                      value={body}
                      onChange={(e) =>
                        handleStageBodyChange(e.target.value, plotStage.id)
                      }
                      placeholder="在此编辑当前剧情内容..."
                      spellCheck={false}
                      readOnly={Boolean(streamingStages[plotStage.id])}
                    />
                  </section>
                )
              })}
            </div>
          ) : (
            <>
              <div className="workspace-stage-heading">
                <label className="workspace-stage-label" htmlFor="stage-body">
                  {railStages.find((s) => s.id === activeStage)?.label}
                </label>
                <span
                  className="workspace-char-count muted"
                  aria-live="polite"
                  title={`不含空白字数 ${stageCharNonSpace.toLocaleString('zh-CN')}；总字符（含空格与换行）${stageCharTotal.toLocaleString('zh-CN')}`}
                >
                  {stageCharNonSpace.toLocaleString('zh-CN')} 字
                  <span className="workspace-char-count-sep" aria-hidden>
                    {' · '}
                  </span>
                  <span className="workspace-char-count-detail">
                    {stageCharTotal.toLocaleString('zh-CN')} 字符
                  </span>
                </span>
              </div>
              <textarea
                id="stage-body"
                ref={(node) => {
                  textareaRef.current = node
                  textareaRefsRef.current[activeContentStage] = node
                }}
                className="editor-body workspace-textarea"
                value={stageBody}
                onChange={(e) => handleStageBodyChange(e.target.value)}
                placeholder="在此编辑当前阶段内容..."
                spellCheck={false}
                readOnly={Boolean(streamingStages[activeContentStage])}
              />
            </>
          )}
        </div>

        {materialSelectorOpen ? (
          <div
            className="workspace-material-selector-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wc-material-selector-title"
          >
            <div className="workspace-material-selector-panel">
              <div className="workspace-material-selector-head">
                <h2 id="wc-material-selector-title" className="workspace-material-selector-title">
                  选择关联素材库
                </h2>
                <button
                  type="button"
                  className="workspace-material-selector-close"
                  aria-label="关闭"
                  disabled={materialSelectorSaving}
                  onClick={() => setMaterialSelectorOpen(false)}
                >
                  ×
                </button>
              </div>
              <div className="workspace-material-current">
                当前关联：
                <strong>{linkedMaterial ? linkedMaterial.title : '未关联'}</strong>
                {linkedMaterial?.output_dir ? (
                  <span title={linkedMaterial.output_dir}>
                    {` · ${linkedMaterial.output_dir.length > 42
                      ? `${linkedMaterial.output_dir.slice(0, 22)}…${linkedMaterial.output_dir.slice(-16)}`
                      : linkedMaterial.output_dir}`}
                  </span>
                ) : null}
              </div>
              <div className="workspace-material-stage-note">
                可供 AI 读取的阶段：{Object.values(MATERIAL_STAGE_LABELS).join('、')}
              </div>
              <div className="workspace-material-list">
                {materialSelectorLoading ? (
                  <p className="muted workspace-material-empty">加载中…</p>
                ) : materialSummaries.length === 0 ? (
                  <p className="muted workspace-material-empty">暂无素材库</p>
                ) : (
                  materialSummaries.map((material) => {
                    const selected = material.id === book.linked_material_id
                    const genre = [
                      material.material_type === 'short' ? '短篇素材' : '长篇素材',
                      material.parent_genre,
                      material.sub_genre,
                    ].filter(Boolean).join(' · ')
                    return (
                      <button
                        key={material.id}
                        type="button"
                        className={
                          selected
                            ? 'workspace-material-item workspace-material-item--selected'
                            : 'workspace-material-item'
                        }
                        disabled={materialSelectorSaving}
                        onClick={() => void saveLinkedMaterial(material.id)}
                      >
                        <span className="workspace-material-item-main">
                          <span className="workspace-material-item-title">{material.title}</span>
                          <span className="workspace-material-item-meta">{genre || '素材'}</span>
                        </span>
                        <span className="workspace-material-item-state">
                          {selected ? '已关联' : '关联'}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
              <div className="workspace-material-selector-foot">
                <button
                  type="button"
                  className="btn-material-clear"
                  disabled={materialSelectorSaving || !book.linked_material_id}
                  onClick={() => void saveLinkedMaterial(null)}
                >
                  取消关联
                </button>
                <button
                  type="button"
                  className="btn-material-close"
                  disabled={materialSelectorSaving}
                  onClick={() => setMaterialSelectorOpen(false)}
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {skillSelectorOpen ? (
          <div
            className="workspace-material-selector-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wc-skill-selector-title"
          >
            <div className="workspace-material-selector-panel">
              <div className="workspace-material-selector-head">
                <h2 id="wc-skill-selector-title" className="workspace-material-selector-title">
                  选择绑定技能库
                </h2>
                <button
                  type="button"
                  className="workspace-material-selector-close"
                  aria-label="关闭"
                  disabled={skillSelectorSaving}
                  onClick={() => setSkillSelectorOpen(false)}
                >
                  ×
                </button>
              </div>
              <div className="workspace-material-current">
                当前绑定：
                <strong>{linkedSkill ? linkedSkill.title : '未绑定'}</strong>
                {linkedSkill?.output_dir ? (
                  <span title={linkedSkill.output_dir}>
                    {` · ${linkedSkill.output_dir.length > 42
                      ? `${linkedSkill.output_dir.slice(0, 22)}…${linkedSkill.output_dir.slice(-16)}`
                      : linkedSkill.output_dir}`}
                  </span>
                ) : null}
              </div>
              <div className="workspace-material-stage-note">
                AI 会按当前阶段展示可加载技能，并通过 load_skill 读取完整技能内容。
              </div>
              <div className="workspace-material-list">
                {skillSelectorLoading ? (
                  <p className="muted workspace-material-empty">加载中…</p>
                ) : skillSummaries.length === 0 ? (
                  <p className="muted workspace-material-empty">暂无技能库</p>
                ) : (
                  skillSummaries.map((skill) => {
                    const selected = skill.id === book.linked_skill_id
                    const count = skill.stage_skill_count ?? 0
                    return (
                      <button
                        key={skill.id}
                        type="button"
                        className={
                          selected
                            ? 'workspace-material-item workspace-material-item--selected'
                            : 'workspace-material-item'
                        }
                        disabled={skillSelectorSaving}
                        onClick={() => void saveLinkedSkill(skill.id)}
                      >
                        <span className="workspace-material-item-main">
                          <span className="workspace-material-item-title">{skill.title}</span>
                          <span className="workspace-material-item-meta">
                            {count > 0 ? `${count} 条阶段技能` : '暂无阶段技能'}
                          </span>
                        </span>
                        <span className="workspace-material-item-state">
                          {selected ? '已绑定' : '绑定'}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
              <div className="workspace-material-selector-foot">
                <button
                  type="button"
                  className="btn-material-clear"
                  disabled={skillSelectorSaving || !book.linked_skill_id}
                  onClick={() => void saveLinkedSkill(null)}
                >
                  取消绑定
                </button>
                <button
                  type="button"
                  className="btn-material-close"
                  disabled={skillSelectorSaving}
                  onClick={() => setSkillSelectorOpen(false)}
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* 封面生成弹窗 */}
        {coverDialogOpen ? (
          <div
            className="workspace-cover-dialog-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wc-cover-dialog-title"
          >
            <div className="workspace-cover-dialog-panel">
              <div className="workspace-cover-dialog-head">
                <h2 id="wc-cover-dialog-title" className="workspace-cover-dialog-title">
                  生成封面
                </h2>
                <button
                  type="button"
                  className="workspace-cover-dialog-close"
                  aria-label="关闭"
                  disabled={coverGenerating}
                  onClick={() => setCoverDialogOpen(false)}
                >
                  ×
                </button>
              </div>
              <div className="workspace-cover-dialog-body">
                <label className="workspace-cover-dialog-label" htmlFor="cover-prompt">
                  提示词（可修改）
                </label>
                <textarea
                  id="cover-prompt"
                  className="workspace-cover-dialog-area"
                  value={coverPromptDraft}
                  spellCheck={false}
                  disabled={coverGenerating}
                  onChange={(e) => setCoverPromptDraft(e.target.value)}
                />
              </div>
              <div className="workspace-cover-dialog-foot">
                <button
                  type="button"
                  className="btn-cover-dialog-cancel"
                  disabled={coverGenerating}
                  onClick={() => setCoverDialogOpen(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn-cover-dialog-confirm"
                  disabled={coverGenerating || !coverPromptDraft.trim()}
                  onClick={() => {
                    if (!book || !coverPromptDraft.trim()) return
                    setCoverGenerating(true)
                    setCoverDialogOpen(false)
                    generateBookCover(book.id, coverPromptDraft.trim())
                      .then(async (res) => {
                        if (res.success) {
                          const refreshed = await getBookCover(book.id)
                          const currentSession = workspaceSessionsRef.current[book.id]
                          if (currentSession) {
                            storeWorkspaceSession(
                              {
                                ...currentSession,
                                coverData: refreshed.cover_data,
                              },
                              bookRef.current?.id === book.id,
                            )
                          } else {
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
                  }}
                >
                  {coverGenerating ? '生成中…' : '确认生成'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* 封面查看弹窗 */}
        {coverViewerOpen && coverData ? (
          <div
            className="workspace-cover-viewer-backdrop"
            role="dialog"
            aria-modal="true"
            onClick={() => setCoverViewerOpen(false)}
          >
            <div className="workspace-cover-viewer-panel">
              <button
                type="button"
                className="workspace-cover-viewer-close"
                aria-label="关闭"
                onClick={() => setCoverViewerOpen(false)}
              >
                ×
              </button>
              <img
                src={`data:image/png;base64,${coverData}`}
                alt="书籍封面"
                className="workspace-cover-viewer-img"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
