import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  type Book,
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
import {
  DraftStageEditor,
  type DraftStageEditorMetrics,
} from '../components/DraftStageEditor'
import { WorkspaceAiChat } from '../components/WorkspaceAiChat'
import type { ApplyToStageEditorPayload } from '../pi/workspaceStageAgents'
import { ExpertDraftAiChat } from '../workspaces/short/expertDraft/ExpertDraftAiChat'
import { ExpertDraftEditor } from '../workspaces/short/expertDraft/ExpertDraftEditor'
import {
  runExpertDraftSectionWriter,
  type RunExpertDraftSectionWriterOptions,
} from '../workspaces/short/expertDraft/sectionWriter'
import {
  EXPERT_DRAFT_COORDINATOR_AGENT_ID,
  EXPERT_SECTION_WRITER_AGENT_ID,
  getDefaultWorkspaceAgentReadAccess,
  resolveWorkspaceAgentReadAccess,
} from '../workspaces/short/stageReadAccess'
import { WorkspaceTreeNav } from '../components/WorkspaceTreeNav'
import './BookEditor.css'

/** 空 stages 对象，用于非激活阶段的稳定引用，避免不必要的重渲染 */
const EMPTY_STAGES: Record<StageId, string> = {} as Record<StageId, string>

type SaveCurrentBookOptions = {
  status?: BookStatus
  successMessage?: string | null
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
function stageTextCounts(text: string): DraftStageEditorMetrics {
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
  const [activeStage, setActiveStage] = useState<StageId>('intro_design')
  const [loading, setLoading] = useState(true)
  const [bookTransitioning, setBookTransitioning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aiPanelWidth, setAiPanelWidth] = useState(readStoredAiWidth)
  /** 当前阶段 AI 侧栏「对话轮次」：递增后重建 Pi 会话并清空该阶段对话历史 */
  /** 专家模式开关 */
  const [expertMode, setExpertMode] = useState(false)
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
  const splitDragRef = useRef<{ startX: number; startWidth: number } | null>(
    null,
  )
  /** 防止连按保存或 Ctrl+S 与按钮并发触发两次提交 */
  const saveInFlightRef = useRef(false)
  const activeStageRef = useRef<StageId>(activeStage)
  /** 当前激活阶段的 textarea ref，用于自动滚动 */
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [draftMetrics, setDraftMetrics] = useState<DraftStageEditorMetrics>({
    total: 0,
    nonSpace: 0,
  })
  /** 流式 token 缓冲区；按阶段隔离，避免切换阶段后写入串台 */
  const tokenBuffersRef = useRef<Partial<Record<StageId, string>>>({})
  const tokenBufferRafRefs = useRef<Partial<Record<StageId, number>>>({})
  /** 最新 stages 的 ref，用于流式写入时读取当前值 */
  const stagesRef = useRef<Record<StageId, string>>(EMPTY_STAGES)
  const pendingInitialStageRef = useRef<{
    bookId: string
    stageId: StageId
  } | null>(null)
  const hasLoadedOnceRef = useRef(false)
  const workspaceBookOrderRef = useRef<string[] | null>(null)
  /** 最新专家模式正文结构，用于后台小节智能体读取和写入 */
  const expertDraftRef = useRef<ExpertDraft>(normalizeExpertDraft(null))
  const expertRunAbortRef = useRef<AbortController | null>(null)
  const expertRunPromiseRef = useRef<Promise<void> | null>(null)
  /** 正在流式输出的阶段禁用用户输入（设为只读） */
  const [streamingStages, setStreamingStages] = useState<Partial<Record<StageId, boolean>>>({})
  const streamingStagesRef = useRef<Partial<Record<StageId, boolean>>>({})
  const bookGenre = book ? resolveWorkspaceBookGenre(book) : '未分类'

  const setEditorStreaming = useCallback((stageId: StageId, next: boolean) => {
    if (Boolean(streamingStagesRef.current[stageId]) === next) return
    const updated = { ...streamingStagesRef.current }
    if (next) {
      updated[stageId] = true
    } else {
      delete updated[stageId]
    }
    streamingStagesRef.current = updated
    setStreamingStages(updated)
  }, [])

  useEffect(() => {
    activeStageRef.current = activeStage
  }, [activeStage])

  // 保持 stagesRef 始终指向最新值
  useEffect(() => {
    stagesRef.current = stages
  }, [stages])

  useEffect(() => {
    expertDraftRef.current = expertDraft
  }, [expertDraft])

  // 清理 RAF
  useEffect(() => {
    return () => {
      Object.values(tokenBufferRafRefs.current).forEach((rafId) => {
        if (rafId !== undefined) cancelAnimationFrame(rafId)
      })
      expertRunAbortRef.current?.abort()
    }
  }, [])

  const updateExpertDraft = useCallback(
    (updater: (current: ExpertDraft) => ExpertDraft) => {
      setExpertDraftState((prev) => {
        const next = normalizeExpertDraft(updater(prev))
        expertDraftRef.current = next
        return next
      })
    },
    [],
  )

  // 细粒度的阶段更新函数（使用函数式更新避免不必要的重渲染）
  const updateStage = useCallback(
    (stageId: StageId, updater: (current: string) => string) => {
      const currentStages = stagesRef.current
      const current = currentStages[stageId] ?? ''
      const next = updater(current)
      if (next === current) return
      const updated = { ...currentStages, [stageId]: next }
      stagesRef.current = updated
      setStages(updated)
    },
    [],
  )

  const cancelTokenFlush = useCallback((stageId: StageId) => {
    const rafId = tokenBufferRafRefs.current[stageId]
    if (rafId !== undefined) {
      cancelAnimationFrame(rafId)
      delete tokenBufferRafRefs.current[stageId]
    }
  }, [])

  // 将某个阶段缓冲区的 token 刷新到 state（使用 RAF 节流）
  const flushTokenBuffer = useCallback(
    (stageId: StageId) => {
      delete tokenBufferRafRefs.current[stageId]
      const buffer = tokenBuffersRef.current[stageId] ?? ''
      if (!buffer) return
      delete tokenBuffersRef.current[stageId]

      updateStage(stageId, (cur) => cur + buffer)
    },
    [updateStage],
  )

  const flushAllTokenBuffers = useCallback(() => {
    const rafIds = Object.values(tokenBufferRafRefs.current)
    tokenBufferRafRefs.current = {}
    rafIds.forEach((rafId) => {
      if (rafId !== undefined) cancelAnimationFrame(rafId)
    })

    const buffers = tokenBuffersRef.current
    tokenBuffersRef.current = {}
    for (const [stageId, buffer] of Object.entries(buffers) as [
      StageId,
      string | undefined,
    ][]) {
      if (!buffer) continue
      updateStage(stageId, (cur) => cur + buffer)
    }
  }, [updateStage])

  // 自动滚动 textarea 到底部（如果用户正在底部）
  const autoScrollTextarea = useCallback((stageId: StageId) => {
    if (activeStageRef.current !== stageId) return
    const textarea = textareaRef.current
    if (!textarea) return
    const wasAtBottom =
      textarea.scrollHeight - textarea.scrollTop <= textarea.clientHeight + 20
    if (wasAtBottom) {
      textarea.scrollTop = textarea.scrollHeight
    }
  }, [])

  const applyToStageEditor = useCallback(
    (stage: StageId, payload: ApplyToStageEditorPayload) => {
      if (payload.mode === 'replace') {
        // replace 模式立即执行，清空缓冲区
        cancelTokenFlush(stage)
        delete tokenBuffersRef.current[stage]
        setEditorStreaming(stage, false)
        updateStage(stage, () => payload.text.trim())
        // DOM 更新后尝试自动滚动
        requestAnimationFrame(() => autoScrollTextarea(stage))
        return
      }

      if (payload.mode === 'append_token') {
        if (!payload.text) return
        setEditorStreaming(stage, true)
        tokenBuffersRef.current[stage] =
          (tokenBuffersRef.current[stage] ?? '') + payload.text
        if (tokenBufferRafRefs.current[stage] === undefined) {
          tokenBufferRafRefs.current[stage] = requestAnimationFrame(() => {
            flushTokenBuffer(stage)
            requestAnimationFrame(() => autoScrollTextarea(stage))
          })
        }
        return
      }

      // 流式结束标记
      if (payload.mode === 'streaming_end') {
        cancelTokenFlush(stage)
        flushTokenBuffer(stage)
        setEditorStreaming(stage, false)
        return
      }

      // 其他模式（append）立即执行
      cancelTokenFlush(stage)
      delete tokenBuffersRef.current[stage]
      setEditorStreaming(stage, false)
      const trimmed = payload.text.trim()
      if (!trimmed) return
      updateStage(stage, (cur) => {
        const sep = cur.length === 0 ? '' : cur.endsWith('\n') ? '\n' : '\n\n'
        return cur + sep + trimmed
      })
      requestAnimationFrame(() => autoScrollTextarea(stage))
    },
    [
      updateStage,
      cancelTokenFlush,
      flushTokenBuffer,
      autoScrollTextarea,
      setEditorStreaming,
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

  const syncBookEditorState = useCallback(
    (next: Book, resetExpertRuntime = false) => {
      setBook(next)
      const normalizedStages = normalizeStagesForWorkspaceBook(next, next.stages)
      stagesRef.current = normalizedStages
      setStages(normalizedStages)
      setDraftMetrics(stageTextCounts(normalizedStages.draft ?? ''))
      const normalizedExpertDraft = normalizeExpertDraft(
        next.expert_draft,
        resetExpertRuntime,
      )
      expertDraftRef.current = normalizedExpertDraft
      setExpertDraftState(normalizedExpertDraft)
    },
    [],
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
      setCoverData(coverRes.cover_data)
      if (b.linked_material_id) {
        const material = await getMaterial(b.linked_material_id)
        setLinkedMaterial(material)
      } else {
        setLinkedMaterial(null)
      }
      if (b.linked_skill_id) {
        const skill = await getSkill(b.linked_skill_id)
        setLinkedSkill(skill)
      } else {
        setLinkedSkill(null)
      }
      const rows = resolveWorkspaceStagesForBook(b)
      syncBookEditorState(b, true)
      setExpertMode(false)
      setExpertAiChatEpoch(0)
      const pending = pendingInitialStageRef.current
      const pendingStage =
        pending?.bookId === b.id &&
        rows.some((row) => row.id === pending.stageId)
          ? pending.stageId
          : null
      if (pending?.bookId === b.id) {
        pendingInitialStageRef.current = null
      }
      setActiveStage(pendingStage ?? rows[0]!.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      hasLoadedOnceRef.current = true
      setLoading(false)
      setBookTransitioning(false)
    }
  }, [id, syncBookEditorState])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 进入书本页 mount 拉取数据
    void load()
  }, [load])

  const handleExportDocx = useCallback(async () => {
    if (!book) return
    const folder = await pickFolder()
    if (!folder) return
    setMessage(null)
    setError(null)
    try {
      const body = stagesRef.current[activeStageRef.current] ?? ''
      const res = await exportDocx(
        book.id,
        activeStageRef.current,
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

  const handleDraftLiveChange = useCallback(
    (value: string) => {
      cancelTokenFlush('draft')
      delete tokenBuffersRef.current.draft
      stagesRef.current = { ...stagesRef.current, draft: value }
    },
    [cancelTokenFlush],
  )

  const handleDraftCommit = useCallback((value: string) => {
    setStages((prev) => {
      if ((prev.draft ?? '') === value) return prev
      return { ...prev, draft: value }
    })
  }, [])

  const getRenderedWorkspaceStageBody = useCallback(
    (stageId: StageId): string | undefined => {
      if (stageId !== activeStageRef.current) return undefined
      return textareaRef.current?.value
    },
    [],
  )

  const flushDraftCommit = useCallback(() => {
    const value = stagesRef.current.draft ?? ''
    handleDraftCommit(value)
  }, [handleDraftCommit])

  const saveCurrentBook = useCallback(
    async (options: SaveCurrentBookOptions = {}): Promise<Book | null> => {
      if (!id || !book) return null
      if (saveInFlightRef.current) {
        setError('正在保存，请稍后再试')
        return null
      }
      saveInFlightRef.current = true
      setSaving(true)
      setMessage(null)
      setError(null)
      try {
        flushAllTokenBuffers()
        flushDraftCommit()
        const merged = mergeStagePatchIntoAll(book.stages, stagesRef.current)
        const next = await saveBook(id, {
          stages: merged,
          expert_draft: expertDraftRef.current,
          status: options.status,
        })
        if (!next) {
          setError('保存失败：书籍不存在')
          return null
        }
        syncBookEditorState(next)
        syncWorkspaceBookSummary(next)
        if (options.successMessage) {
          setMessage(options.successMessage)
          window.setTimeout(() => setMessage(null), 2000)
        }
        return next
      } catch (e) {
        setError(e instanceof Error ? e.message : '保存失败')
        return null
      } finally {
        saveInFlightRef.current = false
        setSaving(false)
      }
    },
    [
      id,
      book,
      flushAllTokenBuffers,
      flushDraftCommit,
      syncBookEditorState,
      syncWorkspaceBookSummary,
    ],
  )

  const handleSave = useCallback(async () => {
    await saveCurrentBook({ successMessage: '已保存' })
  }, [saveCurrentBook])

  const handleTreeBookStageSelect = useCallback(
    async (targetBookId: string, targetStageId: StageId) => {
      if (!book) return
      if (
        targetBookId === book.id &&
        targetStageId === activeStageRef.current
      ) {
        return
      }
      if (targetBookId === book.id) {
        setActiveStage(targetStageId)
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
    [book, navigate, saveCurrentBook, waitForSaveIdle],
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

  const startExpertWriting = useCallback(
    (
      sectionIds: string[],
      callbacks?: Pick<
        RunExpertDraftSectionWriterOptions,
        'onSectionAgentStart' | 'onRunFinish'
      >,
    ) => {
      if (!book || expertRunPromiseRef.current || expertDraftRef.current.running) {
        return false
      }
      const available = new Set(expertDraftRef.current.sections.map((s) => s.id))
      const ids = sectionIds
        .map((sid) => sid.trim())
        .filter((sid) => sid && available.has(sid))
      if (ids.length === 0) return false

      const ac = new AbortController()
      expertRunAbortRef.current = ac
      updateExpertDraft((draft) => ({
        ...draft,
        running: true,
        active_section_id: ids[0] ?? '',
      }))

      const run = runExpertDraftSectionWriter({
        bookId: book.id,
        bookTitle: book.title,
        bookGenre,
        sectionIds: ids,
        getDraft: () => expertDraftRef.current,
        getWorkspaceStages: () => stagesRef.current,
        linkedMaterial,
        linkedSkill,
        readAccess: resolveWorkspaceAgentReadAccess(
          workspaceAgentReadAccess,
          EXPERT_SECTION_WRITER_AGENT_ID,
        ),
        updateDraft: updateExpertDraft,
        signal: ac.signal,
        onError: setError,
        onSectionAgentStart: callbacks?.onSectionAgentStart,
        onRunFinish: callbacks?.onRunFinish,
      })
        .catch((e: unknown) => {
          if (ac.signal.aborted) return
          setError(e instanceof Error ? e.message : '专家模式后台写作失败')
        })
        .finally(() => {
          if (expertRunPromiseRef.current === run) {
            expertRunPromiseRef.current = null
            expertRunAbortRef.current = null
            updateExpertDraft((draft) => ({
              ...draft,
              running: false,
              active_section_id: '',
            }))
          }
        })

      expertRunPromiseRef.current = run
      void run
      return true
    },
    [
      book,
      bookGenre,
      linkedMaterial,
      linkedSkill,
      workspaceAgentReadAccess,
      updateExpertDraft,
    ],
  )

  const stopExpertWriting = useCallback(() => {
    const controller = expertRunAbortRef.current
    if (!controller || controller.signal.aborted) return
    controller.abort()
    updateExpertDraft((draft) => ({
      ...draft,
      running: false,
      active_section_id: '',
    }))
  }, [updateExpertDraft])

  const resetExpertDraft = useCallback(() => {
    if (expertDraftRef.current.running) return
    const ok = window.confirm('清空专家模式内容，并恢复为导语和第一节的初始状态？')
    if (!ok) return
    const next = normalizeExpertDraft(defaultExpertDraft(), true)
    expertDraftRef.current = next
    setExpertDraftState(next)
    setMessage('专家模式已清空')
    setError(null)
    window.setTimeout(() => setMessage(null), 2000)
  }, [])

  const writeExpertDraftToStage = useCallback(() => {
    if (expertDraftRef.current.running) return
    const body = combineExpertDraftSections(expertDraftRef.current)
    if (!body) {
      setMessage(null)
      setError('专家正文列表没有可写入的正文')
      return
    }
    updateStage('draft', () => body)
    setExpertMode(false)
    setActiveStage('draft')
    setError(null)
    setMessage('已写入普通模式正文')
    window.setTimeout(() => setMessage(null), 2000)
  }, [updateStage])

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

  const handleStageBodyChange = (value: string) => {
    cancelTokenFlush(activeStage)
    delete tokenBuffersRef.current[activeStage]
    updateStage(activeStage, () => value)
  }

  useEffect(() => {
    flushDraftCommit()
  }, [activeStage, flushDraftCommit])

  useEffect(() => {
    if (activeStage === 'draft') {
      setDraftMetrics(stageTextCounts(stagesRef.current.draft ?? ''))
    }
  }, [activeStage])

  const activeStageBody = stages[activeStage] ?? ''

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

  if (book.id !== id) {
    return (
      <div className="editor-page editor-page--workspace">
        <div className="editor-wrap">
          <p className="muted">正在打开书籍…</p>
        </div>
      </div>
    )
  }

  const railStages = resolveWorkspaceStagesForBook(book)
  const workspaceTreeStages = railStages.map((s) => ({ id: s.id, label: s.label }))
  const workspaceTreeBooks = workspaceBooks
    .filter((item) => item.book_type === 'short' && item.status !== 'completed')
    .map((item) => ({
      id: item.id,
      title: item.title,
      meta: item.categories.length > 0 ? item.categories.join('、') : '未分类',
      stages: workspaceTreeStages,
    }))
  const stageBody = activeStageBody
  const expertDraftActive = expertMode && activeStage === 'draft'

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
    if (!id || !book) return
    setMaterialSelectorSaving(true)
    setError(null)
    try {
      const next = await saveBook(id, { linked_material_id: materialId ?? '' })
      if (!next) {
        setError('关联素材库失败：书籍不存在')
        return
      }
      const material = next.linked_material_id
        ? await getMaterial(next.linked_material_id)
        : null
      setBook(next)
      setLinkedMaterial(material)
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
    if (!id || !book) return
    setSkillSelectorSaving(true)
    setError(null)
    try {
      const next = await saveBook(id, { linked_skill_id: skillId ?? '' })
      if (!next) {
        setError('绑定技能库失败：书籍不存在')
        return
      }
      const skill = next.linked_skill_id ? await getSkill(next.linked_skill_id) : null
      setBook(next)
      syncWorkspaceBookSummary(next)
      setLinkedSkill(skill)
      setSkillSelectorOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '绑定技能库失败')
    } finally {
      setSkillSelectorSaving(false)
    }
  }

  const { total: stageCharTotal, nonSpace: stageCharNonSpace } =
    activeStage === 'draft'
      ? draftMetrics
      : stageTextCounts(stageBody)

  return (
    <div className="editor-page editor-page--workspace">
      <header className="editor-header editor-header--agent">
        <Link className="back-link" to="/">
          ← 返回
        </Link>
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
                onError={() => setCoverData(null)}
              />
            </button>
          ) : null}
          <button
            type="button"
            className="btn-cover-generate"
            onClick={() => {
              const defaultPrompt = `基于下面的书内容介绍，给我生成一个具有吸引力的书封面，封面不要有小字，给出合适配图，加上书名\n书名：${book?.title ?? ''}\n剧情设计：${stages.plot_design ?? ''}`
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
              onStageSelect={(stageId) => setActiveStage(stageId as StageId)}
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
                        setBook(next)
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
              onStageSelect={(stageId) =>
                void handleTreeBookStageSelect(book.id, stageId as StageId)
              }
              onBookStageSelect={(bookId, stageId) =>
                void handleTreeBookStageSelect(bookId, stageId as StageId)
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
                        setBook(next)
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
                {activeStage === 'draft' ? (
                  <button
                    type="button"
                    className={
                      expertMode
                        ? 'workspace-ai-expert-mode workspace-ai-expert-mode--active'
                        : 'workspace-ai-expert-mode'
                    }
                    aria-label={expertMode ? '退出专家模式' : '进入专家模式'}
                    title="切换正文专家模式"
                    onClick={() => setExpertMode((v) => !v)}
                  >
                    专家模式
                  </button>
                ) : null}
                <button
                  type="button"
                  className="workspace-ai-new-chat"
                  aria-label={
                    expertDraftActive
                      ? '清空专家模式主智能体对话并开始新会话'
                      : '清空当前阶段 AI 对话并开始新会话'
                  }
                  title={
                    expertDraftActive
                      ? '仅清空专家模式右侧主智能体上下文，不影响后台小节编写任务'
                      : '仅影响当前左侧阶段对应的助手会话，其他阶段各有一份独立历史'
                  }
                  disabled={expertDraftActive && expertDraft.running}
                  onClick={() => {
                    if (expertDraftActive) {
                      setExpertAiChatEpoch((epoch) => epoch + 1)
                      return
                    }
                    setAiChatEpochByStage((prev) => ({
                      ...prev,
                      [activeStage]: (prev[activeStage] ?? 0) + 1,
                    }))
                  }}
                >
                  新建对话
                </button>
              </div>
            ) : null}
          </div>
          <div className="workspace-ai-hint muted">
            {railStages.find((s) => s.id === activeStage)?.label}
            {expertDraftActive ? ' · 专家模式' : ''}
            {' · '}
            {book?.categories.join('、') || '未分类'}
            {linkedMaterial ? ` · 素材：${linkedMaterial.title}` : ''}
            {linkedSkill ? ` · 技能：${linkedSkill.title}` : ''}
          </div>
          {book ? (
            <div className="workspace-ai-chat-stack">
              {railStages.map((s) => {
                const epoch = aiChatEpochByStage[s.id] ?? 0
                const layerKey =
                  epoch > 0
                    ? `${book.id}-shared-${s.id}-${epoch}`
                    : `${book.id}-shared-${s.id}`
                const isActive = activeStage === s.id && !expertDraftActive
                return (
                  <div
                    key={layerKey}
                    className={
                      isActive
                        ? 'workspace-ai-chat-layer workspace-ai-chat-layer--active'
                        : 'workspace-ai-chat-layer'
                    }
                    aria-hidden={!isActive}
                    style={
                      isActive
                        ? undefined
                        : {
                            position: 'absolute',
                            opacity: 0,
                            pointerEvents: 'none',
                            width: 0,
                            height: 0,
                            overflow: 'hidden',
                          }
                    }
                  >
                    <WorkspaceAiChat
                      sessionBookId={book.id}
                      sessionEpoch={epoch}
                      bookTitle={book.title}
                      bookGenre={bookGenre}
                      stageId={s.id}
                      stageBody={stages[s.id] ?? ''}
                      getCurrentStageBody={(stageId) =>
                        getRenderedWorkspaceStageBody((stageId ?? s.id) as StageId)
                      }
                      allStages={isActive ? stages : EMPTY_STAGES}
                      linkedMaterial={isActive ? linkedMaterial : null}
                      linkedSkill={isActive ? linkedSkill : null}
                      workspaceAgentReadAccess={workspaceAgentReadAccess}
                      includePiArtifacts={WORKSPACE_AI_INCLUDE_PI_ARTIFACTS}
                      applyToStageEditor={(payload) =>
                        applyToStageEditor(s.id, payload)
                      }
                      onRequestSave={handleSave}
                      isPaused={!isActive}
                    />
                  </div>
                )
              })}
              <div
                key={`${book.id}-expert-draft`}
                className={
                  expertDraftActive
                    ? 'workspace-ai-chat-layer workspace-ai-chat-layer--active'
                    : 'workspace-ai-chat-layer'
                }
                aria-hidden={!expertDraftActive}
                style={
                  expertDraftActive
                    ? undefined
                    : {
                        position: 'absolute',
                        opacity: 0,
                        pointerEvents: 'none',
                        width: 0,
                        height: 0,
                        overflow: 'hidden',
                      }
                }
              >
                <ExpertDraftAiChat
                  key={`${book.id}-shared-expert-draft-${expertAiChatEpoch}`}
                  bookId={book.id}
                  bookTitle={book.title}
                  bookGenre={bookGenre}
                  sessionEpoch={expertAiChatEpoch}
                  stages={stages}
                  linkedMaterial={linkedMaterial}
                  linkedSkill={linkedSkill}
                  readAccess={resolveWorkspaceAgentReadAccess(
                    workspaceAgentReadAccess,
                    EXPERT_DRAFT_COORDINATOR_AGENT_ID,
                  )}
                  expertDraft={expertDraft}
                  updateDraft={updateExpertDraft}
                  startWriting={startExpertWriting}
                />
              </div>
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
              updateDraft={updateExpertDraft}
              stopWriting={stopExpertWriting}
              resetDraft={resetExpertDraft}
              writeToDraftStage={writeExpertDraftToStage}
            />
          ) : (
            <>
              <div className="workspace-stage-heading">
                <label className="workspace-stage-label" htmlFor="stage-body">
                  {railStages.find((s) => s.id === activeStage)?.label}
                </label>
                {['draft', 'draft_review', 'format_conversion'].includes(activeStage) ? (
                  <button
                    type="button"
                    className="btn-export-docx"
                    title="导出正文为 docx"
                    onClick={() => void handleExportDocx()}
                  >
                    导出正文
                  </button>
                ) : null}
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
              {activeStage === 'draft' ? (
                <DraftStageEditor
                  value={stages.draft ?? ''}
                  onLiveChange={handleDraftLiveChange}
                  onCommit={handleDraftCommit}
                  onMetrics={setDraftMetrics}
                  readOnly={Boolean(streamingStages.draft)}
                  textareaRef={textareaRef}
                  resizeKey={aiPanelWidth}
                />
              ) : (
                <textarea
                  id="stage-body"
                  ref={textareaRef}
                  className="editor-body workspace-textarea"
                  value={stageBody}
                  onChange={(e) => handleStageBodyChange(e.target.value)}
                  placeholder="在此编辑当前阶段内容…"
                  spellCheck={false}
                  readOnly={Boolean(streamingStages[activeStage])}
                />
              )}
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
                          setCoverData(refreshed.cover_data)
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
