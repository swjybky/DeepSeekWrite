import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  readDeaiFlavorRemovalPromptTemplate,
  readExpertSectionWriterPromptTemplate,
  readWorkspacePromptTemplate,
  resetDeaiFlavorRemovalPromptOverride,
  resetExpertSectionWriterPromptOverride,
  resetWorkspacePromptOverride,
  saveDeaiFlavorRemovalPromptOverride,
  saveExpertSectionWriterPromptOverride,
  saveWorkspacePromptOverride,
  type Book,
  type ExpertDraft,
  type StageId,
  defaultExpertDraft,
  mergeStagePatchIntoAll,
  normalizeExpertDraft,
  normalizeStagesForWorkspaceBook,
  resolveWorkspaceStagesForBook,
  resolvePromptKind,
  type PromptKind,
  getBook,
  isWorkspaceShortBook,
  saveBook,
  listMaterials,
  getMaterial,
  MATERIAL_STAGE_LABELS,
  type Material,
  type MaterialSummary,
  generateBookCover,
  getBookCover,
  pickFolder,
  exportDocx,
  getStageReadAccess,
  saveStageReadAccess,
  type StageReadAccessConfig,
} from '../bridge'
import {
  DraftStageEditor,
  type DraftStageEditorMetrics,
} from '../components/DraftStageEditor'
import { StageReadAccessPicker } from '../components/StageReadAccessPicker'
import { WorkspaceAiChat } from '../components/WorkspaceAiChat'
import type { ApplyToStageEditorPayload } from '../pi/workspaceStageAgents'
import { ExpertDraftAiChat } from '../workspaces/short/expertDraft/ExpertDraftAiChat'
import { ExpertDraftEditor } from '../workspaces/short/expertDraft/ExpertDraftEditor'
import { promptKindStyleLabel } from '../workspaces/short/expertDraft/prompts'
import { runDeaiFlavorRemoval } from '../workspaces/short/deaiFlavorRemoval'
import {
  runExpertDraftSectionWriter,
  type RunExpertDraftSectionWriterOptions,
} from '../workspaces/short/expertDraft/sectionWriter'
import {
  getDefaultStageReadAccess,
  isConfigurableReadStage,
  resolveReadAccessForStage,
} from '../workspaces/short/stageReadAccess'
import './BookEditor.css'

/** 空 stages 对象，用于非激活阶段的稳定引用，避免不必要的重渲染 */
const EMPTY_STAGES: Record<StageId, string> = {} as Record<StageId, string>

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
type PromptEditorTarget =
  | 'workspace-stage'
  | 'expert-section-writer'
  | 'deai-flavor-removal'

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
  const [book, setBook] = useState<Book | null>(null)
  const [stages, setStages] = useState<Record<StageId, string>>(() =>
    normalizeStagesForWorkspaceBook({ book_type: 'short', categories: ['世情'] }, {}),
  )
  const [expertDraft, setExpertDraftState] = useState<ExpertDraft>(() =>
    normalizeExpertDraft(null),
  )
  const [activeStage, setActiveStage] = useState<StageId>('intro_design')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aiPanelWidth, setAiPanelWidth] = useState(readStoredAiWidth)
  /** 当前阶段 AI 侧栏「对话轮次」：递增后重建 Pi 会话并清空该阶段对话历史 */
  const [promptEditorOpen, setPromptEditorOpen] = useState(false)
  const [promptEditorTarget, setPromptEditorTarget] =
    useState<PromptEditorTarget>('workspace-stage')
  const [promptDraft, setPromptDraft] = useState('')
  const [promptEditorLoading, setPromptEditorLoading] = useState(false)
  const [promptEditorSaving, setPromptEditorSaving] = useState(false)
  /** 专家模式开关（仅世情文类型） */
  const [expertMode, setExpertMode] = useState(false)
  const [linkedMaterial, setLinkedMaterial] = useState<Material | null>(null)
  const [stageReadAccess, setStageReadAccess] = useState<StageReadAccessConfig>(
    () => getDefaultStageReadAccess(),
  )
  const [materialSelectorOpen, setMaterialSelectorOpen] = useState(false)
  const [materialSummaries, setMaterialSummaries] = useState<MaterialSummary[]>([])
  const [materialSelectorLoading, setMaterialSelectorLoading] = useState(false)
  const [materialSelectorSaving, setMaterialSelectorSaving] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  /** 传给当前阶段 WorkspaceAiChat，保存模板后递增以重拉后端 systemPrompt */
  const [promptReloadNonce, setPromptReloadNonce] = useState(0)
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
  /** 最新专家模式正文结构，用于后台小节智能体读取和写入 */
  const expertDraftRef = useRef<ExpertDraft>(normalizeExpertDraft(null))
  const expertRunAbortRef = useRef<AbortController | null>(null)
  const expertRunPromiseRef = useRef<Promise<void> | null>(null)
  const deaiAbortRef = useRef<AbortController | null>(null)
  const [deaiRunning, setDeaiRunning] = useState(false)
  /** 正在流式输出的阶段禁用用户输入（设为只读） */
  const [streamingStages, setStreamingStages] = useState<Partial<Record<StageId, boolean>>>({})
  const streamingStagesRef = useRef<Partial<Record<StageId, boolean>>>({})
  const currentPromptKind: PromptKind = book
    ? resolvePromptKind(book) ?? 'shiqing'
    : 'shiqing'

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
      deaiAbortRef.current?.abort()
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
      if (lineNumberGutterRef.current) {
        lineNumberGutterRef.current.scrollTop = textarea.scrollTop
      }
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

  useEffect(() => {
    let cancelled = false
    void getStageReadAccess().then((cfg) => {
      if (!cancelled) setStageReadAccess(cfg)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handleStageReadAccessChange = useCallback(
    async (next: StageReadAccessConfig) => {
      setStageReadAccess(next)
      try {
        const saved = await saveStageReadAccess(next)
        setStageReadAccess(saved)
        setPromptReloadNonce((n) => n + 1)
      } catch (e) {
        setError(e instanceof Error ? e.message : '保存阶段读取配置失败')
      }
    },
    [],
  )

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const b = await getBook(id)
      if (!b) {
        setBook(null)
        setError('未找到该书籍')
        return
      }
      setBook(b)
      const coverRes = await getBookCover(b.id)
      setCoverData(coverRes.cover_data)
      if (b.linked_material_id) {
        const material = await getMaterial(b.linked_material_id)
        setLinkedMaterial(material)
      } else {
        setLinkedMaterial(null)
      }
      const rows = resolveWorkspaceStagesForBook(b)
      const normalized = normalizeStagesForWorkspaceBook(b, b.stages)
      const normalizedExpertDraft = normalizeExpertDraft(b.expert_draft, true)
      stagesRef.current = normalized
      setStages(normalized)
      setDraftMetrics(stageTextCounts(normalized.draft ?? ''))
      expertDraftRef.current = normalizedExpertDraft
      setExpertDraftState(normalizedExpertDraft)
      setExpertMode(false)
      setExpertAiChatEpoch(0)
      setActiveStage(rows[0]!.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [id])

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

  const flushDraftCommit = useCallback(() => {
    const value = stagesRef.current.draft ?? ''
    handleDraftCommit(value)
  }, [handleDraftCommit])

  const handleSave = useCallback(async () => {
    if (!id || !book || saveInFlightRef.current) return
    saveInFlightRef.current = true
    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      flushAllTokenBuffers()
      flushDraftCommit()
      const merged = mergeStagePatchIntoAll(book.stages, stagesRef.current)
      const next = await saveBook(id, { stages: merged, expert_draft: expertDraft })
      if (!next) {
        setError('保存失败：书籍不存在')
        return
      }
      setBook(next)
      const normalizedStages = normalizeStagesForWorkspaceBook(next, next.stages)
      stagesRef.current = normalizedStages
      setStages(normalizedStages)
      const normalizedExpertDraft = normalizeExpertDraft(next.expert_draft)
      expertDraftRef.current = normalizedExpertDraft
      setExpertDraftState(normalizedExpertDraft)
      setMessage('已保存')
      window.setTimeout(() => setMessage(null), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      saveInFlightRef.current = false
      setSaving(false)
    }
  }, [id, book, expertDraft, flushAllTokenBuffers, flushDraftCommit])

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
        promptKind: currentPromptKind,
        sectionIds: ids,
        getDraft: () => expertDraftRef.current,
        getWorkspaceStages: () => stagesRef.current,
        linkedMaterial,
        draftReadAccess: resolveReadAccessForStage(stageReadAccess, 'draft') ?? {
          workspace: [],
          material: [],
        },
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
    [book, currentPromptKind, linkedMaterial, stageReadAccess, updateExpertDraft],
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

  const runDeaiOnText = useCallback(
    async (input: {
      text: string
      stageId?: StageId
      /** 为 true 时用阶段编辑区的流式缓冲（普通阶段）；专家模式小节为 false */
      useStageStreaming?: boolean
      applyToEditor: (payload: ApplyToStageEditorPayload) => void
    }) => {
      if (!book || deaiRunning) return
      if (!input.text.trim()) {
        setError('当前编辑框为空，无需去 AI 味。')
        return
      }
      deaiAbortRef.current?.abort()
      const ac = new AbortController()
      deaiAbortRef.current = ac
      setDeaiRunning(true)
      const streamStage = input.useStageStreaming !== false ? input.stageId : undefined
      if (streamStage) setEditorStreaming(streamStage, true)
      setError(null)
      try {
        const result = await runDeaiFlavorRemoval({
          bookId: book.id,
          bookTitle: book.title,
          promptKind: currentPromptKind,
          stageBody: input.text,
          stageId: input.stageId ?? 'draft',
          allStages: stagesRef.current,
          applyToEditor: input.applyToEditor,
          signal: ac.signal,
        })
        if (!result.ok) {
          setError(result.error)
          return
        }
        if (!result.streamed && result.text) {
          input.applyToEditor({ text: result.text, mode: 'replace' })
        }
        setMessage('已去除 AI 味')
        window.setTimeout(() => setMessage(null), 2000)
      } finally {
        input.applyToEditor({ text: '', mode: 'streaming_end' })
        if (streamStage) setEditorStreaming(streamStage, false)
        if (deaiAbortRef.current === ac) deaiAbortRef.current = null
        setDeaiRunning(false)
      }
    },
    [book, currentPromptKind, deaiRunning, setEditorStreaming],
  )

  const handleActiveStageDeai = useCallback(() => {
    void runDeaiOnText({
      text: stagesRef.current[activeStage] ?? '',
      stageId: activeStage,
      applyToEditor: (payload) => applyToStageEditor(activeStage, payload),
    })
  }, [activeStage, runDeaiOnText, applyToStageEditor])

  const handleExpertSectionDeai = useCallback(
    (sectionId: string, field: 'body' | 'state') => {
      const draft = expertDraftRef.current
      const section = draft.sections.find((s) => s.id === sectionId)
      if (!section) return
      const text =
        field === 'body'
          ? section.body
          : (
              draft.character_states.find((s) => s.section_id === sectionId)
                ?.body ?? ''
            )
      const streamAccRef = { current: text }
      const applyExpertField = (body: string) => {
        updateExpertDraft((current) => {
          if (field === 'body') {
            return {
              ...current,
              sections: current.sections.map((s) =>
                s.id === sectionId ? { ...s, body } : s,
              ),
            }
          }
          const exists = current.character_states.some(
            (s) => s.section_id === sectionId,
          )
          return {
            ...current,
            character_states: exists
              ? current.character_states.map((s) =>
                  s.section_id === sectionId ? { ...s, body } : s,
                )
              : [
                  ...current.character_states,
                  {
                    section_id: sectionId,
                    title: `${section.title}人物状态`,
                    body,
                  },
                ],
          }
        })
      }
      void runDeaiOnText({
        text,
        useStageStreaming: false,
        applyToEditor: (payload) => {
          if (payload.mode === 'replace') {
            if (payload.text === '') {
              streamAccRef.current = ''
              applyExpertField('')
              return
            }
            streamAccRef.current = payload.text
            applyExpertField(payload.text.trim())
            return
          }
          if (payload.mode === 'append_token') {
            if (!payload.text) return
            streamAccRef.current += payload.text
            applyExpertField(streamAccRef.current)
            return
          }
          if (payload.mode === 'streaming_end') return
          if (payload.mode === 'append') {
            const trimmed = payload.text.trim()
            if (!trimmed) return
            streamAccRef.current =
              streamAccRef.current.length === 0
                ? trimmed
                : `${streamAccRef.current}\n\n${trimmed}`
            applyExpertField(streamAccRef.current)
          }
        },
      })
    },
    [runDeaiOnText, updateExpertDraft],
  )

  const activeStageBody = stages[activeStage] ?? ''

  if (!id) {
    return (
      <div className="editor-wrap">
        <p className="editor-error">无效链接</p>
        <Link to="/">返回书架</Link>
      </div>
    )
  }

  if (loading) {
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
            当前仅「短篇 · 世情 / 追妻 / 科幻 / 悬疑」可使用完整写作台与 AI
            协作；其余组合仍在扩展中。
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
  const promptKind: PromptKind = currentPromptKind
  const stageBody = activeStageBody
  const expertDraftActive = expertMode && activeStage === 'draft'

  const openPromptEditor = async () => {
    const start = Date.now()
    const minDelay = 150
    setPromptEditorLoading(true)
    try {
      const t = await readWorkspacePromptTemplate(promptKind, activeStage)
      const elapsed = Date.now() - start
      if (elapsed < minDelay) {
        await new Promise((r) => setTimeout(r, minDelay - elapsed))
      }
      setPromptDraft(t)
      setPromptEditorTarget('workspace-stage')
      setPromptEditorOpen(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法加载提示词模板')
    } finally {
      setPromptEditorLoading(false)
    }
  }

  const openExpertPromptEditor = async () => {
    const start = Date.now()
    const minDelay = 150
    setPromptEditorLoading(true)
    try {
      const t = await readExpertSectionWriterPromptTemplate(promptKind)
      const elapsed = Date.now() - start
      if (elapsed < minDelay) {
        await new Promise((r) => setTimeout(r, minDelay - elapsed))
      }
      setPromptDraft(t)
      setPromptEditorTarget('expert-section-writer')
      setPromptEditorOpen(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法加载专家模式提示词模板')
    } finally {
      setPromptEditorLoading(false)
    }
  }

  const openDeaiPromptEditor = async () => {
    const start = Date.now()
    const minDelay = 150
    setPromptEditorLoading(true)
    try {
      const t = await readDeaiFlavorRemovalPromptTemplate(promptKind)
      const elapsed = Date.now() - start
      if (elapsed < minDelay) {
        await new Promise((r) => setTimeout(r, minDelay - elapsed))
      }
      setPromptDraft(t)
      setPromptEditorTarget('deai-flavor-removal')
      setPromptEditorOpen(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法加载去 AI 味提示词模板')
    } finally {
      setPromptEditorLoading(false)
    }
  }

  const savePromptTemplateEdit = async () => {
    setPromptEditorSaving(true)
    setError(null)
    try {
      if (promptEditorTarget === 'expert-section-writer') {
        await saveExpertSectionWriterPromptOverride(promptKind, promptDraft)
      } else if (promptEditorTarget === 'deai-flavor-removal') {
        await saveDeaiFlavorRemovalPromptOverride(promptKind, promptDraft)
      } else {
        await saveWorkspacePromptOverride(promptKind, activeStage, promptDraft)
        setPromptReloadNonce((n) => n + 1)
      }
      setPromptEditorOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存提示词失败')
    } finally {
      setPromptEditorSaving(false)
    }
  }

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

  const resetPromptTemplateToBuiltin = async () => {
    setPromptEditorSaving(true)
    try {
      const t =
        promptEditorTarget === 'expert-section-writer'
          ? await (async () => {
              await resetExpertSectionWriterPromptOverride(promptKind)
              return readExpertSectionWriterPromptTemplate(promptKind)
            })()
          : promptEditorTarget === 'deai-flavor-removal'
            ? await (async () => {
                await resetDeaiFlavorRemovalPromptOverride(promptKind)
                return readDeaiFlavorRemovalPromptTemplate(promptKind)
              })()
            : await (async () => {
                await resetWorkspacePromptOverride(promptKind, activeStage)
                setPromptReloadNonce((n) => n + 1)
                return readWorkspacePromptTemplate(promptKind, activeStage)
              })()
      setPromptDraft(t)
    } catch (e) {
      setError(e instanceof Error ? e.message : '重置提示词失败')
    } finally {
      setPromptEditorSaving(false)
    }
  }

  const { total: stageCharTotal, nonSpace: stageCharNonSpace } =
    activeStage === 'draft'
      ? draftMetrics
      : stageTextCounts(stageBody)
  const promptEditorIsExpert = promptEditorTarget === 'expert-section-writer'
  const promptEditorIsDeai = promptEditorTarget === 'deai-flavor-removal'
  const promptEditorTitle = promptEditorIsDeai
    ? `去 AI 味 · ${promptKindStyleLabel(promptKind)}`
    : promptEditorIsExpert
      ? `专家模式 · 后台小节编写智能体 · ${promptKindStyleLabel(promptKind)}`
      : `短篇 · ${book?.categories.join('、') || '未分类'} · ${
          railStages.find((s) => s.id === activeStage)?.label
        }`

  return (
    <div className="editor-page editor-page--workspace">
      <header className="editor-header">
        <Link className="back-link" to="/">
          ← 书架
        </Link>
        <div className="editor-title-block">
          {editingTitle ? (
            <input
              className="editor-title-input"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                const trimmed = titleDraft.trim()
                if (trimmed && trimmed !== book?.title && book) {
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
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur()
                } else if (e.key === 'Escape') {
                  setEditingTitle(false)
                  setTitleDraft('')
                }
              }}
              autoFocus
            />
          ) : (
            <h1
              className="editor-title editor-title--editable"
              onDoubleClick={() => {
                setTitleDraft(book?.title ?? '')
                setEditingTitle(true)
              }}
              title="双击编辑书名"
            >
              {book?.title ?? ''}
            </h1>
          )}
          <span className="editor-sub">
            {book?.book_type === 'short' ? '短篇' : '长篇'}
            {book?.book_type === 'short' && book.categories.length > 0
              ? ` · ${book.categories.join('、')}`
              : ''}
            {book?.output_dir ? (
              <span className="editor-path" title={book.output_dir}>
                {' '}
                · {book.output_dir.length > 36
                  ? `${book.output_dir.slice(0, 18)}…${book.output_dir.slice(-14)}`
                  : book.output_dir}
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
          <button
            type="button"
            className="btn-deai-prompt-edit"
            onClick={() => void openDeaiPromptEditor()}
            disabled={promptEditorLoading}
            title="编辑去 AI 味提示词模板"
          >
            {promptEditorLoading && promptEditorTarget === 'deai-flavor-removal'
              ? '加载…'
              : 'AI味去除提示词'}
          </button>
          <button
            type="button"
            className="btn-save"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </header>

      {error && <p className="editor-toast error">{error}</p>}
      {message && <p className="editor-toast ok">{message}</p>}

      <div
        className="workspace-grid"
        style={
          {
            '--workspace-ai-width': `${aiPanelWidth}px`,
          } as CSSProperties
        }
      >
        <nav className="workspace-rail" aria-label="写作阶段">
          <ul className="workspace-rail-list">
            {railStages.map((s) => (
              <li
                key={s.id}
                className={
                  isConfigurableReadStage(s.id)
                    ? 'workspace-rail-row'
                    : undefined
                }
              >
                <button
                  type="button"
                  className={
                    activeStage === s.id
                      ? 'rail-item rail-item--active'
                      : 'rail-item'
                  }
                  onClick={() => setActiveStage(s.id)}
                >
                  {s.label}
                </button>
                {isConfigurableReadStage(s.id) ? (
                  <StageReadAccessPicker
                    stageId={s.id}
                    config={stageReadAccess}
                    onChange={(next) => void handleStageReadAccessChange(next)}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </nav>

        <div className="workspace-editor-pane">
          {expertDraftActive ? (
            <ExpertDraftEditor
              draft={expertDraft}
              updateDraft={updateExpertDraft}
              stopWriting={stopExpertWriting}
              resetDraft={resetExpertDraft}
              writeToDraftStage={writeExpertDraftToStage}
              editPrompt={openExpertPromptEditor}
              promptEditorLoading={promptEditorLoading}
              onDeaiSectionBody={(sectionId) =>
                handleExpertSectionDeai(sectionId, 'body')
              }
              onDeaiCharacterState={(sectionId) =>
                handleExpertSectionDeai(sectionId, 'state')
              }
              deaiBusy={deaiRunning}
            />
          ) : (
            <>
              <div className="workspace-stage-heading">
                <label className="workspace-stage-label" htmlFor="stage-body">
                  {railStages.find((s) => s.id === activeStage)?.label}
                </label>
                <button
                  type="button"
                  className="btn-deai-flavor"
                  title="用 AI 去除当前编辑框内容的 AI 腔"
                  disabled={
                    deaiRunning ||
                    Boolean(streamingStages[activeStage]) ||
                    (activeStage === 'draft'
                      ? draftMetrics.nonSpace === 0
                      : !stageBody.trim())
                  }
                  onClick={() => void handleActiveStageDeai()}
                >
                  {deaiRunning ? '处理中…' : '去除AI味道'}
                </button>
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

        <div
          className="workspace-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整 AI 侧栏宽度"
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
            // 向右拖：中间编辑区变宽，AI 栏变窄（与常见分割条方向一致）
            const next = drag.startWidth - delta
            setAiPanelWidth(
              clampAiPanelWidth(next, window.innerWidth),
            )
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
                clampAiPanelWidth(w + step, window.innerWidth),
              )
            } else if (e.key === 'ArrowRight') {
              e.preventDefault()
              setAiPanelWidth((w) =>
                clampAiPanelWidth(w - step, window.innerWidth),
              )
            }
          }}
        />

        <aside className="workspace-ai" aria-label="AI 对话">
          <div className="workspace-ai-header workspace-ai-header-row">
            <span className="workspace-ai-header-title">AI 助手</span>
            {book ? (
              <div className="workspace-ai-header-actions">
                <span
                  className="workspace-ai-material-name"
                  title={linkedMaterial ? `已关联：${linkedMaterial.title}` : '未关联素材库'}
                >
                  {linkedMaterial ? linkedMaterial.title : '未关联素材'}
                </span>
                <button
                  type="button"
                  className={
                    linkedMaterial
                      ? 'workspace-ai-material-select workspace-ai-material-select--active'
                      : 'workspace-ai-material-select'
                  }
                  aria-label="选择关联素材库"
                  title={linkedMaterial ? `已关联：${linkedMaterial.title}` : '选择关联素材库'}
                  onClick={() => void openMaterialSelector()}
                >
                  素材库选择
                </button>
                {expertDraftActive ? (
                  <>
                    {activeStage === 'draft' ? (
                      <button
                        type="button"
                        className={expertMode ? 'workspace-ai-expert-mode workspace-ai-expert-mode--active' : 'workspace-ai-expert-mode'}
                        aria-label={expertMode ? '退出专家模式' : '进入专家模式'}
                        title="切换专家模式"
                        onClick={() => setExpertMode((v) => !v)}
                      >
                        专家模式
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="workspace-ai-new-chat"
                      aria-label="清空专家模式主智能体对话并开始新会话"
                      title="仅清空专家模式右侧主智能体上下文，不影响后台小节编写任务"
                      disabled={expertDraft.running}
                      onClick={() => setExpertAiChatEpoch((epoch) => epoch + 1)}
                    >
                      新建对话
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="workspace-ai-prompt-edit"
                      aria-label={`编辑提示词模板：${railStages.find((s) => s.id === activeStage)?.label}`}
                      title="编辑当前阶段工作台系统提示词模板（占位符在后端替换）"
                      disabled={promptEditorLoading}
                      onClick={() => void openPromptEditor()}
                    >
                      {promptEditorLoading ? '加载…' : '编辑提示词'}
                    </button>
                    {activeStage === 'draft' ? (
                      <button
                        type="button"
                        className={expertMode ? 'workspace-ai-expert-mode workspace-ai-expert-mode--active' : 'workspace-ai-expert-mode'}
                        aria-label={expertMode ? '退出专家模式' : '进入专家模式'}
                        title="切换专家模式"
                        onClick={() => setExpertMode((v) => !v)}
                      >
                        专家模式
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="workspace-ai-new-chat"
                      aria-label="清空当前阶段 AI 对话并开始新会话"
                      title="仅影响当前左侧阶段对应的助手会话，其他阶段各有一份独立历史"
                      onClick={() =>
                        setAiChatEpochByStage((prev) => ({
                          ...prev,
                          [activeStage]: (prev[activeStage] ?? 0) + 1,
                        }))
                      }
                    >
                      新建对话
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </div>
          <div className="workspace-ai-hint muted">
            上下文：本书 ·{' '}
            {railStages.find((s) => s.id === activeStage)?.label}
            {expertDraftActive ? ' · 专家模式' : ''}
            {' · '}
            类型：{book?.categories.join('、') || '未分类'}
            {linkedMaterial ? ` · 素材：${linkedMaterial.title}` : ' · 未关联素材'}
            {' · '}
            使用 Pi（pi-ai / pi-web-ui）连接真实模型；首次可在对话内配置 API Key 与模型。
          </div>
          {book ? (
            <div className="workspace-ai-chat-stack">
              {railStages.map((s) => {
                const epoch = aiChatEpochByStage[s.id] ?? 0
                const layerKey =
                  epoch > 0
                    ? `${book.id}-${promptKind}-${s.id}-${epoch}`
                    : `${book.id}-${promptKind}-${s.id}`
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
                    // 使用 CSS 隐藏非激活阶段，保留组件状态（对话记录）
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
                      promptKind={promptKind}
                      bookTitle={book.title}
                      stageId={s.id}
                      stageBody={stages[s.id] ?? ''}
                      getCurrentStageBody={() => stagesRef.current[s.id] ?? ''}
                      // 非激活阶段使用 stable 空对象引用，避免 allStages 变化触发重渲染
                      allStages={isActive ? stages : EMPTY_STAGES}
                      linkedMaterial={isActive ? linkedMaterial : null}
                      stageReadAccess={stageReadAccess}
                      includePiArtifacts={WORKSPACE_AI_INCLUDE_PI_ARTIFACTS}
                      promptRevision={isActive ? promptReloadNonce : 0}
                      applyToStageEditor={(payload) =>
                        applyToStageEditor(s.id, payload)
                      }
                      onRequestSave={handleSave}
                      // 非激活阶段暂停实时更新，减少后台计算
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
                  key={`${book.id}-${promptKind}-expert-draft-${expertAiChatEpoch}`}
                  bookId={book.id}
                  bookTitle={book.title}
                  promptKind={promptKind}
                  sessionEpoch={expertAiChatEpoch}
                  stages={stages}
                  expertDraft={expertDraft}
                  updateDraft={updateExpertDraft}
                  startWriting={startExpertWriting}
                />
              </div>
            </div>
          ) : null}
        </aside>

        {promptEditorOpen ? (
          <div
            className="workspace-prompt-editor-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wc-prompt-editor-title"
          >
            <div className="workspace-prompt-editor-panel">
              <div className="workspace-prompt-editor-head">
                <h2 id="wc-prompt-editor-title" className="workspace-prompt-editor-title">
                  {promptEditorTitle}
                </h2>
                <button
                  type="button"
                  className="workspace-prompt-editor-close"
                  aria-label="关闭"
                  disabled={promptEditorSaving}
                  onClick={() => setPromptEditorOpen(false)}
                >
                  ×
                </button>
              </div>
              <p className="workspace-prompt-editor-hint muted">
                {promptEditorIsDeai
                  ? '去 AI 味占位写法示例（各占一行）：'
                  : promptEditorIsExpert
                    ? '专家模式占位写法示例（各占一行）：'
                    : '模板占位写法示例（各占一行）：'}
                <span className="workspace-prompt-editor-code">
                  {promptEditorIsDeai
                    ? '{{BOOK_TITLE}} {{BOOK_LINE}} {{STAGE_BODY}}'
                    : promptEditorIsExpert
                      ? '{{BOOK_TITLE}} {{STYLE}}'
                      : '{{BOOK_TITLE}} {{BOOK_LINE}} {{OTHER_STAGES_EXCERPT}} {{STAGE_BODY}}'}
                </span>
                {promptEditorIsDeai
                  ? ' 。保存后作用于各阶段「去除AI味道」按钮。'
                  : promptEditorIsExpert
                    ? ' 。保存后作用于后台小节编写智能体。'
                    : ' 。保存后立即作用于当前工作台阶段。'}
              </p>
              <textarea
                className="workspace-prompt-editor-area"
                value={promptDraft}
                spellCheck={false}
                disabled={promptEditorSaving}
                onChange={(e) => setPromptDraft(e.target.value)}
              />
              <div className="workspace-prompt-editor-foot">
                <button
                  type="button"
                  className="btn-prompt-secondary"
                  disabled={promptEditorSaving}
                  onClick={() => void resetPromptTemplateToBuiltin()}
                >
                  恢复内置默认
                </button>
                <div className="workspace-prompt-editor-foot-gap" />
                <button
                  type="button"
                  className="btn-prompt-cancel"
                  disabled={promptEditorSaving}
                  onClick={() => setPromptEditorOpen(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn-prompt-save"
                  disabled={promptEditorSaving}
                  onClick={() => void savePromptTemplateEdit()}
                >
                  {promptEditorSaving ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

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
