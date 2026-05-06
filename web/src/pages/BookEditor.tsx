import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  WORKSPACE_STAGES,
  type Book,
  type StageId,
  getBook,
  isShiqingShortBook,
  normalizeStages,
  saveBook,
} from '../bridge'
import { WorkspaceAiChat } from '../components/WorkspaceAiChat'
import type { ApplyToStageEditorPayload } from '../pi/workspaceStageAgents'
import './BookEditor.css'

const AI_PANEL_WIDTH_KEY = 'write-claw:workspace-ai-width'
const AI_PANEL_MIN = 240
/** 超宽屏下的绝对上限，避免 AI 栏占满整屏 */
const AI_PANEL_HARD_MAX = 1000
const AI_PANEL_DEFAULT = 280
/** Pi ChatPanel 会注入 artifacts；false 则从 Agent 工具列表移除（对话流式优先）。改为 true 可恢复侧栏工件面板能力。 */
const WORKSPACE_AI_INCLUDE_PI_ARTIFACTS = false
const WORKSPACE_SPLITTER_W = 6
/** 为中间编辑区保留的近似最小宽度（用于计算 AI 栏在当前窗口下最大能拉多宽） */
const EDITOR_MIN_FOR_LAYOUT = 160

function approxRailWidthPx(viewportWidth: number): number {
  return Math.round(
    Math.min(300, Math.max(220, viewportWidth * 0.24)),
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

function readStoredAiWidth(): number {
  const vw =
    typeof window !== 'undefined' ? window.innerWidth : 1280
  try {
    const raw = localStorage.getItem(AI_PANEL_WIDTH_KEY)
    const n = raw ? Number.parseInt(raw, 10) : NaN
    if (!Number.isFinite(n)) return clampAiPanelWidth(AI_PANEL_DEFAULT, vw)
    return clampAiPanelWidth(n, vw)
  } catch {
    return clampAiPanelWidth(AI_PANEL_DEFAULT, vw)
  }
}

export function BookEditor() {
  const { id } = useParams<{ id: string }>()
  const [book, setBook] = useState<Book | null>(null)
  const [stages, setStages] = useState<Record<StageId, string>>(() =>
    normalizeStages({}),
  )
  const [activeStage, setActiveStage] = useState<StageId>('plot_design')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aiPanelWidth, setAiPanelWidth] = useState(readStoredAiWidth)
  const splitDragRef = useRef<{ startX: number; startWidth: number } | null>(
    null,
  )
  const activeStageRef = useRef<StageId>(activeStage)

  useEffect(() => {
    activeStageRef.current = activeStage
  }, [activeStage])

  const applyToStageEditor = useCallback(
    (payload: ApplyToStageEditorPayload) => {
      setStages((prev) => {
        const stage = activeStageRef.current
        const cur = prev[stage] ?? ''
        const piece = payload.text.trim()
        if (!piece) return prev
        if (payload.mode === 'replace') {
          return { ...prev, [stage]: piece }
        }
        const sep =
          cur.length === 0 ? '' : cur.endsWith('\n') ? '\n' : '\n\n'
        return { ...prev, [stage]: cur + sep + piece }
      })
    },
    [],
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
      setStages(normalizeStages(b.stages))
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const handleSave = async () => {
    if (!id || !book) return
    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      const stageKeys = Object.keys(stages) as StageId[]
      const payload: Record<string, string> = {}
      for (const k of stageKeys) {
        payload[k] = stages[k]
      }
      const next = await saveBook(id, { stages: payload })
      if (!next) {
        setError('保存失败：书籍不存在')
        return
      }
      setBook(next)
      setStages(normalizeStages(next.stages))
      setMessage('已保存')
      window.setTimeout(() => setMessage(null), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleStageBodyChange = (value: string) => {
    setStages((prev) => ({ ...prev, [activeStage]: value }))
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

  const shiqing = book ? isShiqingShortBook(book) : false

  if (book && !shiqing) {
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
            当前仅「短篇 · 勾选世情分类」可使用完整写作台（剧情设计至编辑审阅与 AI 协作）。
          </p>
          <Link className="btn-pending-home" to="/">
            返回书架
          </Link>
        </div>
      </div>
    )
  }

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
          } as React.CSSProperties
        }
      >
        <nav className="workspace-rail" aria-label="写作阶段">
          <ul className="workspace-rail-list">
            {WORKSPACE_STAGES.map((s) => (
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
          <label className="workspace-stage-label" htmlFor="stage-body">
            {WORKSPACE_STAGES.find((s) => s.id === activeStage)?.label}
          </label>
          <textarea
            id="stage-body"
            className="editor-body workspace-textarea"
            value={stages[activeStage]}
            onChange={(e) => handleStageBodyChange(e.target.value)}
            placeholder="在此编辑当前阶段内容…"
            spellCheck={false}
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
          <div className="workspace-ai-header">AI 助手</div>
          <div className="workspace-ai-hint muted">
            上下文：本书 ·{' '}
            {WORKSPACE_STAGES.find((s) => s.id === activeStage)?.label}
            {' · '}
            使用 Pi（pi-ai / pi-web-ui）连接真实模型；首次可在对话内配置 API Key 与模型。
          </div>
          {book ? (
            <WorkspaceAiChat
              key={`${book.id}-${activeStage}`}
              sessionBookId={book.id}
              bookTitle={book.title}
              stageId={activeStage}
              stageBody={stages[activeStage]}
              allStages={stages}
              includePiArtifacts={WORKSPACE_AI_INCLUDE_PI_ARTIFACTS}
              applyToStageEditor={applyToStageEditor}
            />
          ) : null}
        </aside>
      </div>
    </div>
  )
}
