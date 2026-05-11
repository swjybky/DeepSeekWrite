import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  type Material,
  type MaterialStageId,
  MATERIAL_STAGE_LABELS,
  normalizeMaterialStages,
  getMaterial,
  saveMaterial,
} from '../bridge'
import { WorkspaceAiChat } from '../components/WorkspaceAiChat'
import type { ApplyToStageEditorPayload } from '../pi/workspaceStageAgents'
import './BookEditor.css'

const MATERIAL_STAGE_KEYS: MaterialStageId[] = ['character', 'gimmick', 'pacing']

const AI_PANEL_WIDTH_KEY = 'write-claw:material-ai-width'
const AI_PANEL_MIN = 240
const AI_PANEL_HARD_MAX = 1000
const WORKSPACE_AI_INCLUDE_PI_ARTIFACTS = false
const WORKSPACE_SPLITTER_W = 6
const WORKSPACE_COL_L = 18
const WORKSPACE_COL_R = 36
const WORKSPACE_COL_SUM = 18 + 36 + 36
const EDITOR_MIN_FOR_LAYOUT = 160

function usableWidthLessSplitter(viewportWidth: number): number {
  return Math.max(0, viewportWidth - WORKSPACE_SPLITTER_W)
}

function approxRailWidthPx(viewportWidth: number): number {
  return Math.round(
    (usableWidthLessSplitter(viewportWidth) * WORKSPACE_COL_L) / WORKSPACE_COL_SUM,
  )
}

function defaultAiPanelWidthPx(viewportWidth: number): number {
  return Math.round(
    (usableWidthLessSplitter(viewportWidth) * WORKSPACE_COL_R) / WORKSPACE_COL_SUM,
  )
}

function maxAiWidthForViewport(viewportWidth: number): number {
  const rail = approxRailWidthPx(viewportWidth)
  const raw = viewportWidth - rail - WORKSPACE_SPLITTER_W - EDITOR_MIN_FOR_LAYOUT
  return Math.min(AI_PANEL_HARD_MAX, Math.max(AI_PANEL_MIN, Math.floor(raw)))
}

function clampAiPanelWidth(width: number, viewportWidth: number): number {
  const cap = maxAiWidthForViewport(viewportWidth)
  return Math.min(cap, Math.max(AI_PANEL_MIN, width))
}

function stageTextCounts(text: string): { total: number; nonSpace: number } {
  return {
    total: text.length,
    nonSpace: text.replace(/\p{White_Space}/gu, '').length,
  }
}

function readStoredAiWidth(): number {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  try {
    const raw = localStorage.getItem(AI_PANEL_WIDTH_KEY)
    const n = raw ? Number.parseInt(raw, 10) : NaN
    if (!Number.isFinite(n)) return clampAiPanelWidth(defaultAiPanelWidthPx(vw), vw)
    return clampAiPanelWidth(n, vw)
  } catch {
    return clampAiPanelWidth(defaultAiPanelWidthPx(vw), vw)
  }
}

export function MaterialEditor() {
  const { id } = useParams<{ id: string }>()
  const [material, setMaterial] = useState<Material | null>(null)
  const [stages, setStages] = useState<Record<MaterialStageId, string>>(() =>
    normalizeMaterialStages({}),
  )
  const [activeStage, setActiveStage] = useState<MaterialStageId>('character')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aiPanelWidth, setAiPanelWidth] = useState(readStoredAiWidth)
  const [aiChatEpochByStage, setAiChatEpochByStage] = useState<Partial<Record<MaterialStageId, number>>>({})
  const splitDragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const saveInFlightRef = useRef(false)
  const activeStageRef = useRef<MaterialStageId>(activeStage)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const tokenBufferRef = useRef<string>('')
  const tokenBufferRafRef = useRef<number | null>(null)
  const stagesRef = useRef<Record<MaterialStageId, string>>(stages)
  const [isStreaming, setIsStreaming] = useState(false)

  useEffect(() => {
    activeStageRef.current = activeStage
  }, [activeStage])

  useEffect(() => {
    stagesRef.current = stages
  }, [stages])

  useEffect(() => {
    return () => {
      if (tokenBufferRafRef.current) {
        cancelAnimationFrame(tokenBufferRafRef.current)
      }
    }
  }, [])

  const updateStage = useCallback(
    (stageId: MaterialStageId, updater: (current: string) => string) => {
      setStages((prev) => {
        const current = prev[stageId] ?? ''
        const next = updater(current)
        if (next === current) return prev
        return { ...prev, [stageId]: next }
      })
    },
    [],
  )

  const flushTokenBuffer = useCallback(() => {
    tokenBufferRafRef.current = null
    const buffer = tokenBufferRef.current
    if (!buffer) return
    tokenBufferRef.current = ''
    const stage = activeStageRef.current
    updateStage(stage, (cur) => cur + buffer)
  }, [updateStage])

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
        if (tokenBufferRafRef.current) {
          cancelAnimationFrame(tokenBufferRafRef.current)
          tokenBufferRafRef.current = null
        }
        tokenBufferRef.current = ''
        setIsStreaming(false)
        updateStage(stage, () => payload.text.trim())
        requestAnimationFrame(autoScrollTextarea)
        return
      }

      if (payload.mode === 'append_token') {
        if (!payload.text) return
        setIsStreaming(true)
        tokenBufferRef.current += payload.text
        const buffer = tokenBufferRef.current
        tokenBufferRef.current = ''
        if (tokenBufferRafRef.current) {
          cancelAnimationFrame(tokenBufferRafRef.current)
          tokenBufferRafRef.current = null
        }
        updateStage(stage, (cur) => cur + buffer)
        requestAnimationFrame(autoScrollTextarea)
        return
      }

      if (payload.mode === 'streaming_end') {
        if (tokenBufferRafRef.current) {
          cancelAnimationFrame(tokenBufferRafRef.current)
          tokenBufferRafRef.current = null
        }
        tokenBufferRef.current = ''
        setIsStreaming(false)
        return
      }

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
    [updateStage, autoScrollTextarea],
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
      const m = await getMaterial(id)
      if (!m) {
        setMaterial(null)
        setError('未找到该素材')
        return
      }
      setMaterial(m)
      const normalized = normalizeMaterialStages(m.stages)
      setStages(normalized)
      setActiveStage('character')
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [id])

  const hasLoadedRef = useRef(false)
  useEffect(() => {
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true
      void load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSave = useCallback(async () => {
    if (!id || !material || saveInFlightRef.current) return
    saveInFlightRef.current = true
    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      if (tokenBufferRef.current && !tokenBufferRafRef.current) {
        flushTokenBuffer()
      }
      if (tokenBufferRafRef.current) {
        cancelAnimationFrame(tokenBufferRafRef.current)
        tokenBufferRafRef.current = null
        flushTokenBuffer()
      }
      const next = await saveMaterial(id, { stages })
      if (!next) {
        setError('保存失败：素材不存在')
        return
      }
      setMaterial(next)
      setStages(normalizeMaterialStages(next.stages))
      setMessage('已保存')
      window.setTimeout(() => setMessage(null), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      saveInFlightRef.current = false
      setSaving(false)
    }
  }, [id, material, stages, flushTokenBuffer])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return
      e.preventDefault()
      void handleSave()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSave])

  const handleStageBodyChange = (value: string) => {
    if (tokenBufferRef.current) {
      tokenBufferRef.current = ''
    }
    updateStage(activeStage, () => value)
  }

  if (!id) {
    return (
      <div className="editor-wrap">
        <p className="editor-error">无效链接</p>
        <Link to="/">返回首页</Link>
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

  if (error && !material) {
    return (
      <div className="editor-wrap">
        <p className="editor-error">{error}</p>
        <Link to="/">返回首页</Link>
      </div>
    )
  }

  if (!material) {
    return (
      <div className="editor-wrap">
        <p className="muted">暂无素材数据</p>
        <Link to="/">返回首页</Link>
      </div>
    )
  }

  const stageBody = stages[activeStage] ?? ''
  const { total: stageCharTotal, nonSpace: stageCharNonSpace } = stageTextCounts(stageBody)

  // 构建素材类型显示文本
  const materialTypeText = material.material_type === 'short'
    ? `短篇素材 · ${material.parent_genre || ''} · ${material.sub_genre || ''}`
    : '长篇素材'

  return (
    <div className="editor-page editor-page--workspace">
      <header className="editor-header">
        <Link className="back-link" to="/">
          ← 首页
        </Link>
        <div className="editor-title-block">
          <h1 className="editor-title">{material.title}</h1>
          <span className="editor-sub">
            {materialTypeText}
            {material.output_dir ? (
              <span className="editor-path" title={material.output_dir}>
                {' · '}
                {material.output_dir.length > 36
                  ? `${material.output_dir.slice(0, 18)}…${material.output_dir.slice(-14)}`
                  : material.output_dir}
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
        style={{ '--workspace-ai-width': `${aiPanelWidth}px` } as CSSProperties}
      >
        <nav className="workspace-rail" aria-label="素材阶段">
          <ul className="workspace-rail-list">
            {MATERIAL_STAGE_KEYS.map((stageId) => (
              <li key={stageId}>
                <button
                  type="button"
                  className={
                    activeStage === stageId
                      ? 'rail-item rail-item--active'
                      : 'rail-item'
                  }
                  onClick={() => setActiveStage(stageId)}
                >
                  {MATERIAL_STAGE_LABELS[stageId]}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="workspace-editor-pane">
          <div className="workspace-stage-heading">
            <label className="workspace-stage-label" htmlFor="stage-body">
              {MATERIAL_STAGE_LABELS[activeStage]}
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
            placeholder={`在此编辑${MATERIAL_STAGE_LABELS[activeStage]}内容…`}
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
            const next = drag.startWidth - delta
            setAiPanelWidth(clampAiPanelWidth(next, window.innerWidth))
          }}
          onPointerUp={(e) => {
            splitDragRef.current = null
            try {
              ;(e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId)
            } catch {
              /* ignore */
            }
          }}
          onPointerCancel={(e) => {
            splitDragRef.current = null
            try {
              ;(e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId)
            } catch {
              /* ignore */
            }
          }}
          onKeyDown={(e) => {
            const step = 16
            if (e.key === 'ArrowLeft') {
              e.preventDefault()
              setAiPanelWidth((w) => clampAiPanelWidth(w + step, window.innerWidth))
            } else if (e.key === 'ArrowRight') {
              e.preventDefault()
              setAiPanelWidth((w) => clampAiPanelWidth(w - step, window.innerWidth))
            }
          }}
        />

        <aside className="workspace-ai" aria-label="AI 对话">
          <div className="workspace-ai-header workspace-ai-header-row">
            <span className="workspace-ai-header-title">AI 助手</span>
            {material ? (
              <div className="workspace-ai-header-actions">
                <button
                  type="button"
                  className="workspace-ai-new-chat"
                  aria-label="清空当前阶段 AI 对话并开始新会话"
                  title="仅影响当前阶段对应的助手会话"
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
            上下文：{materialTypeText} · {MATERIAL_STAGE_LABELS[activeStage]}
          </div>
          {material ? (
            <div className="workspace-ai-chat-stack">
              {MATERIAL_STAGE_KEYS.map((stageId) => {
                const epoch = aiChatEpochByStage[stageId] ?? 0
                const layerKey =
                  epoch > 0
                    ? `${material.id}-material-${stageId}-${epoch}`
                    : `${material.id}-material-${stageId}`
                const isActive = activeStage === stageId
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
                      sessionBookId={material.id}
                      sessionEpoch={epoch}
                      promptKind={material.material_type === 'short' && material.parent_genre === '世情' ? 'shiqing' : 'qinggan'}
                      bookTitle={material.title}
                      stageId={stageId as unknown as import('../bridge').StageId}
                      stageBody={stages[stageId] ?? ''}
                      allStages={(isActive ? stages : {}) as unknown as Partial<Record<import('../bridge').StageId, string>>}
                      includePiArtifacts={WORKSPACE_AI_INCLUDE_PI_ARTIFACTS}
                      promptRevision={0}
                      applyToStageEditor={applyToStageEditor}
                      isPaused={!isActive}
                    />
                  </div>
                )
              })}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
