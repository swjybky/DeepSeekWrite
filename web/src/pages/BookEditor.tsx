import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  readWorkspacePromptTemplate,
  resetWorkspacePromptOverride,
  saveWorkspacePromptOverride,
  type Book,
  type StageId,
  mergeStagePatchIntoAll,
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
} from '../bridge'
import { WorkspaceAiChat } from '../components/WorkspaceAiChat'
import type { ApplyToStageEditorPayload } from '../pi/workspaceStageAgents'
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
  const [activeStage, setActiveStage] = useState<StageId>('intro_design')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aiPanelWidth, setAiPanelWidth] = useState(readStoredAiWidth)
  /** 当前阶段 AI 侧栏「对话轮次」：递增后重建 Pi 会话并清空该阶段对话历史 */
  const [promptEditorOpen, setPromptEditorOpen] = useState(false)
  const [promptDraft, setPromptDraft] = useState('')
  const [promptEditorLoading, setPromptEditorLoading] = useState(false)
  const [promptEditorSaving, setPromptEditorSaving] = useState(false)
  /** 专家模式开关（仅世情文类型） */
  const [expertMode, setExpertMode] = useState(false)
  const [linkedMaterial, setLinkedMaterial] = useState<Material | null>(null)
  const [materialSelectorOpen, setMaterialSelectorOpen] = useState(false)
  const [materialSummaries, setMaterialSummaries] = useState<MaterialSummary[]>([])
  const [materialSelectorLoading, setMaterialSelectorLoading] = useState(false)
  const [materialSelectorSaving, setMaterialSelectorSaving] = useState(false)
  /** 传给当前阶段 WorkspaceAiChat，保存模板后递增以重拉后端 systemPrompt */
  const [promptReloadNonce, setPromptReloadNonce] = useState(0)
  const [aiChatEpochByStage, setAiChatEpochByStage] = useState<
    Partial<Record<StageId, number>>
  >({})
  const splitDragRef = useRef<{ startX: number; startWidth: number } | null>(
    null,
  )
  /** 防止连按保存或 Ctrl+S 与按钮并发触发两次提交 */
  const saveInFlightRef = useRef(false)
  const activeStageRef = useRef<StageId>(activeStage)
  /** 当前激活阶段的 textarea ref，用于自动滚动 */
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  /** 流式 token 缓冲区 */
  const tokenBufferRef = useRef<string>('')
  const tokenBufferRafRef = useRef<number | null>(null)
  /** 最新 stages 的 ref，用于流式写入时读取当前值 */
  const stagesRef = useRef<Record<StageId, string>>(EMPTY_STAGES)
  /** 正在流式输出时禁用用户输入（设为只读） */
  const [isStreaming, setIsStreaming] = useState(false)

  useEffect(() => {
    activeStageRef.current = activeStage
  }, [activeStage])

  // 保持 stagesRef 始终指向最新值
  useEffect(() => {
    stagesRef.current = stages
  }, [stages])

  // 清理 RAF
  useEffect(() => {
    return () => {
      if (tokenBufferRafRef.current) {
        cancelAnimationFrame(tokenBufferRafRef.current)
      }
    }
  }, [])

  // 细粒度的阶段更新函数（使用函数式更新避免不必要的重渲染）
  const updateStage = useCallback(
    (stageId: StageId, updater: (current: string) => string) => {
      setStages((prev) => {
        const current = prev[stageId] ?? ''
        const next = updater(current)
        if (next === current) return prev
        return { ...prev, [stageId]: next }
      })
    },
    [],
  )

  // 将缓冲区的 token 刷新到 state（使用 RAF 节流）
  const flushTokenBuffer = useCallback(() => {
    tokenBufferRafRef.current = null
    const buffer = tokenBufferRef.current
    if (!buffer) return
    tokenBufferRef.current = ''

    const stage = activeStageRef.current
    updateStage(stage, (cur) => cur + buffer)
  }, [updateStage])

  // 调度缓冲区刷新
  const scheduleFlush = useCallback(() => {
    if (tokenBufferRafRef.current) return
    tokenBufferRafRef.current = requestAnimationFrame(flushTokenBuffer)
  }, [flushTokenBuffer])

  // 自动滚动 textarea 到底部（如果用户正在底部）
  const autoScrollTextarea = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const wasAtBottom =
      textarea.scrollHeight - textarea.scrollTop <= textarea.clientHeight + 20
    if (wasAtBottom) {
      textarea.scrollTop = textarea.scrollHeight
    }
  }, [])

  const applyToStageEditor = useCallback(
    (payload: ApplyToStageEditorPayload) => {
      const stage = activeStageRef.current

      if (payload.mode === 'replace') {
        // replace 模式立即执行，清空缓冲区
        if (tokenBufferRafRef.current) {
          cancelAnimationFrame(tokenBufferRafRef.current)
          tokenBufferRafRef.current = null
        }
        tokenBufferRef.current = ''
        setIsStreaming(false)
        updateStage(stage, () => payload.text.trim())
        // DOM 更新后尝试自动滚动
        requestAnimationFrame(autoScrollTextarea)
        return
      }

      if (payload.mode === 'append_token') {
        if (!payload.text) return
        setIsStreaming(true)
        // 累积到缓冲区并立即刷新到 state（不再通过 RAF 延迟，避免重复）
        tokenBufferRef.current += payload.text
        // 立即刷新缓冲区，只追加新内容
        const buffer = tokenBufferRef.current
        tokenBufferRef.current = ''
        if (tokenBufferRafRef.current) {
          cancelAnimationFrame(tokenBufferRafRef.current)
          tokenBufferRafRef.current = null
        }
        // 使用函数式更新确保追加到最新值
        updateStage(stage, (cur) => cur + buffer)
        // DOM 更新后尝试自动滚动
        requestAnimationFrame(autoScrollTextarea)
        return
      }

      // 流式结束标记
      if (payload.mode === 'streaming_end') {
        if (tokenBufferRafRef.current) {
          cancelAnimationFrame(tokenBufferRafRef.current)
          tokenBufferRafRef.current = null
        }
        tokenBufferRef.current = ''
        setIsStreaming(false)
        return
      }

      // 其他模式（append）立即执行
      if (tokenBufferRafRef.current) {
        cancelAnimationFrame(tokenBufferRafRef.current)
        tokenBufferRafRef.current = null
      }
      tokenBufferRef.current = ''
      setIsStreaming(false)
      const trimmed = payload.text.trim()
      if (!trimmed) return
      updateStage(stage, (cur) => {
        const sep = cur.length === 0 ? '' : cur.endsWith('\n') ? '\n' : '\n\n'
        return cur + sep + trimmed
      })
      requestAnimationFrame(autoScrollTextarea)
    },
    [updateStage, scheduleFlush, autoScrollTextarea],
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
      if (b.linked_material_id) {
        const material = await getMaterial(b.linked_material_id)
        setLinkedMaterial(material)
      } else {
        setLinkedMaterial(null)
      }
      const rows = resolveWorkspaceStagesForBook(b)
      const normalized = normalizeStagesForWorkspaceBook(b, b.stages)
      setStages(normalized)
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

  const handleSave = useCallback(async () => {
    if (!id || !book || saveInFlightRef.current) return
    saveInFlightRef.current = true
    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      // 先刷新缓冲区确保数据完整
      if (tokenBufferRef.current && !tokenBufferRafRef.current) {
        flushTokenBuffer()
      }
      // 如果有正在进行的 RAF，等待它完成
      if (tokenBufferRafRef.current) {
        cancelAnimationFrame(tokenBufferRafRef.current)
        tokenBufferRafRef.current = null
        flushTokenBuffer()
      }
      const merged = mergeStagePatchIntoAll(book.stages, stages)
      const next = await saveBook(id, { stages: merged })
      if (!next) {
        setError('保存失败：书籍不存在')
        return
      }
      setBook(next)
      setStages(normalizeStagesForWorkspaceBook(next, next.stages))
      setMessage('已保存')
      window.setTimeout(() => setMessage(null), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      saveInFlightRef.current = false
      setSaving(false)
    }
  }, [id, book, stages, flushTokenBuffer])

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
    // 清理缓冲区，避免冲突
    if (tokenBufferRef.current) {
      tokenBufferRef.current = ''
    }
    updateStage(activeStage, () => value)
  }

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
            当前仅「短篇 · 世情」或「短篇 · 情感 / 现实情感」可使用完整写作台与 AI
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
  const promptKind: PromptKind = resolvePromptKind(book) ?? 'shiqing'
  const stageBody = stages[activeStage] ?? ''

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
      setPromptEditorOpen(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法加载提示词模板')
    } finally {
      setPromptEditorLoading(false)
    }
  }

  const savePromptTemplateEdit = async () => {
    setPromptEditorSaving(true)
    setError(null)
    try {
      await saveWorkspacePromptOverride(promptKind, activeStage, promptDraft)
      setPromptReloadNonce((n) => n + 1)
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
      await resetWorkspacePromptOverride(promptKind, activeStage)
      const t = await readWorkspacePromptTemplate(promptKind, activeStage)
      setPromptDraft(t)
      setPromptReloadNonce((n) => n + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : '重置提示词失败')
    } finally {
      setPromptEditorSaving(false)
    }
  }

  const { total: stageCharTotal, nonSpace: stageCharNonSpace } =
    stageTextCounts(stageBody)

  return (
    <div className="editor-page editor-page--workspace">
      <header className="editor-header">
        <Link className="back-link" to="/">
          ← 书架
        </Link>
        <div className="editor-title-block">
          <h1 className="editor-title">{book?.title ?? ''}</h1>
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
        <button
          type="button"
          className="btn-save"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? '保存中…' : '保存'}
        </button>
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
              <li key={s.id}>
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
              </li>
            ))}
          </ul>
        </nav>

        <div className="workspace-editor-pane">
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
            ref={textareaRef}
            className="editor-body workspace-textarea"
            value={stageBody}
            onChange={(e) => handleStageBodyChange(e.target.value)}
            placeholder="在此编辑当前阶段内容…"
            spellCheck={false}
            readOnly={isStreaming}
          />
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
                <button
                  type="button"
                  className={expertMode ? 'workspace-ai-expert-mode workspace-ai-expert-mode--active' : 'workspace-ai-expert-mode'}
                  aria-label={expertMode ? '退出专家模式' : '进入专家模式'}
                  title="切换专家模式"
                  onClick={() => setExpertMode((v) => !v)}
                >
                  专家模式
                </button>
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
              </div>
            ) : null}
          </div>
          <div className="workspace-ai-hint muted">
            上下文：本书 ·{' '}
            {railStages.find((s) => s.id === activeStage)?.label}
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
                const isActive = activeStage === s.id
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
                      // 非激活阶段使用 stable 空对象引用，避免 allStages 变化触发重渲染
                      allStages={isActive ? stages : EMPTY_STAGES}
                      linkedMaterial={isActive ? linkedMaterial : null}
                      includePiArtifacts={WORKSPACE_AI_INCLUDE_PI_ARTIFACTS}
                      promptRevision={isActive ? promptReloadNonce : 0}
                      applyToStageEditor={applyToStageEditor}
                      // 非激活阶段暂停实时更新，减少后台计算
                      isPaused={!isActive}
                    />
                  </div>
                )
              })}
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
                  短篇 · {book?.categories.join('、') || '未分类'} ·{' '}
                  {railStages.find((s) => s.id === activeStage)?.label}
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
                {'模板占位写法示例（各占一行）：'}
                <span className="workspace-prompt-editor-code">
                  {'{{BOOK_TITLE}} {{BOOK_LINE}} {{OTHER_STAGES_EXCERPT}} {{STAGE_BODY}}'}
                </span>
                {' 。保存后立即作用于当前工作台阶段。'}
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
      </div>
    </div>
  )
}
