import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  MATERIAL_MANAGER_PROMPT_KIND,
  type Material,
  type MaterialStageId,
  MATERIAL_STAGE_LABELS,
  materialTypeLabel,
  normalizeMaterialStages,
  getMaterial,
  saveMaterial,
} from '../bridge'
import { WorkspaceAiChat } from '../components/WorkspaceAiChat'
import type { ApplyToStageEditorPayload } from '../pi/workspaceStageAgents'
import { WorkspaceTreeNav } from '../components/WorkspaceTreeNav'
import './BookEditor.css'

const MATERIAL_STAGE_KEYS: MaterialStageId[] = [
  'character',
  'intro',
  'gimmick',
  'plot_refine',
  'pacing',
  'draft_excerpt',
]

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
  const [aiChatEpoch, setAiChatEpoch] = useState(0)
  const splitDragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const saveInFlightRef = useRef(false)
  const activeStageRef = useRef<MaterialStageId>(activeStage)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const tokenBuffersRef = useRef<Partial<Record<MaterialStageId, string>>>({})
  const tokenBufferRafRefs = useRef<Partial<Record<MaterialStageId, number>>>({})
  const stagesRef = useRef<Record<MaterialStageId, string>>(stages)
  const [streamingStages, setStreamingStages] = useState<
    Partial<Record<MaterialStageId, boolean>>
  >({})
  const streamingStagesRef = useRef<Partial<Record<MaterialStageId, boolean>>>({})

  const setEditorStreaming = useCallback((stageId: MaterialStageId, next: boolean) => {
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
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')

  useEffect(() => {
    activeStageRef.current = activeStage
  }, [activeStage])

  useEffect(() => {
    stagesRef.current = stages
  }, [stages])

  useEffect(() => {
    return () => {
      Object.values(tokenBufferRafRefs.current).forEach((rafId) => {
        if (rafId !== undefined) cancelAnimationFrame(rafId)
      })
    }
  }, [])

  const updateStage = useCallback(
    (stageId: MaterialStageId, updater: (current: string) => string) => {
      setStages((prev) => {
        const current = prev[stageId] ?? ''
        const next = updater(current)
        if (next === current) return prev
        const updated = { ...prev, [stageId]: next }
        stagesRef.current = updated
        return updated
      })
    },
    [],
  )

  const cancelTokenFlush = useCallback((stageId: MaterialStageId) => {
    const rafId = tokenBufferRafRefs.current[stageId]
    if (rafId !== undefined) {
      cancelAnimationFrame(rafId)
      delete tokenBufferRafRefs.current[stageId]
    }
  }, [])

  const flushTokenBuffer = useCallback(
    (stageId: MaterialStageId) => {
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
      MaterialStageId,
      string | undefined,
    ][]) {
      if (!buffer) continue
      updateStage(stageId, (cur) => cur + buffer)
    }
  }, [updateStage])

  const autoScrollTextarea = useCallback((stageId: MaterialStageId) => {
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
    (stage: MaterialStageId, payload: ApplyToStageEditorPayload) => {
      if (payload.mode === 'replace') {
        cancelTokenFlush(stage)
        delete tokenBuffersRef.current[stage]
        setEditorStreaming(stage, false)
        updateStage(stage, () => payload.text.trim())
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

      if (payload.mode === 'streaming_end') {
        cancelTokenFlush(stage)
        flushTokenBuffer(stage)
        setEditorStreaming(stage, false)
        return
      }

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
      stagesRef.current = normalized
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
      flushAllTokenBuffers()
      const next = await saveMaterial(id, { stages: stagesRef.current })
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
  }, [id, material, flushAllTokenBuffers])

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
    cancelTokenFlush(activeStage)
    delete tokenBuffersRef.current[activeStage]
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
  const materialGenreText = material.parent_genre?.trim() || ''
  const materialTypeText = [
    materialTypeLabel(material.material_type),
    materialGenreText,
  ].filter(Boolean).join(' · ')

  return (
    <div className="editor-page editor-page--workspace">
      <header className="editor-header editor-header--agent">
        <Link className="back-link" to="/">
          ← 返回
        </Link>
        <div className="editor-header-meta muted">
          <span className="editor-header-meta-inner">
            <span className="editor-header-meta-text">
              {material.title || '未命名'}
              {' · '}
              {materialTypeText}
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
        <button
          type="button"
          className="btn-save"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </header>

      <div
        className="workspace-grid"
        style={{ '--workspace-ai-width': `${aiPanelWidth}px` } as CSSProperties}
      >
        <aside className="workspace-rail workspace-rail--tree">
          <WorkspaceTreeNav
            rootLabel={material.title}
            stages={MATERIAL_STAGE_KEYS.map((stageId) => ({
              id: stageId,
              label: MATERIAL_STAGE_LABELS[stageId],
            }))}
            defaultExpanded
            activeStageId={activeStage}
            onStageSelect={(stageId) => setActiveStage(stageId as MaterialStageId)}
            editingTitle={editingTitle}
            titleDraft={titleDraft}
            onTitleDraftChange={setTitleDraft}
            onTitleEditStart={() => {
              setTitleDraft(material.title)
              setEditingTitle(true)
            }}
            onTitleEditEnd={() => {
              const trimmed = titleDraft.trim()
              if (trimmed && trimmed !== material.title) {
                void (async () => {
                  try {
                    const next = await saveMaterial(material.id, { title: trimmed })
                    if (next) {
                      setMaterial(next)
                      setMessage('素材名已修改')
                      window.setTimeout(() => setMessage(null), 2000)
                    } else {
                      setError('保存素材名失败')
                    }
                  } catch (e) {
                    setError(e instanceof Error ? e.message : '保存素材名失败')
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
        </aside>

        <aside className="workspace-ai workspace-ai--center" aria-label="AI 对话">
          <div className="workspace-ai-header workspace-ai-header-row">
            <span className="workspace-ai-header-title">素材管理智能体</span>
            <div className="workspace-ai-header-actions">
              <button
                type="button"
                className="workspace-ai-new-chat"
                aria-label="清空素材库管理智能体对话并开始新会话"
                title="清空素材库管理智能体对话并开始新会话"
                onClick={() => setAiChatEpoch((epoch) => epoch + 1)}
              >
                新建对话
              </button>
            </div>
          </div>
          <div className="workspace-ai-hint muted">
            {materialTypeText} · {MATERIAL_STAGE_LABELS[activeStage]}
          </div>
          <div className="workspace-ai-chat-stack">
            <div className="workspace-ai-chat-layer workspace-ai-chat-layer--active">
              <WorkspaceAiChat
                key={`${material.id}-material-manager-${aiChatEpoch}`}
                sessionBookId={material.id}
                sessionEpoch={aiChatEpoch}
                promptKind={MATERIAL_MANAGER_PROMPT_KIND}
                bookTitle={material.title}
                materialTypeKey={material.material_type}
                materialType={materialTypeLabel(material.material_type)}
                materialGenre={materialGenreText || materialTypeLabel(material.material_type)}
                stageId={activeStage}
                stageBody={stageBody}
                allStages={stages}
                includePiArtifacts={WORKSPACE_AI_INCLUDE_PI_ARTIFACTS}
                applyToStageEditor={(payload) =>
                  applyToStageEditor(activeStageRef.current, payload)
                }
                workspaceType="material"
              />
            </div>
          </div>
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
              setAiPanelWidth((w) => clampAiPanelWidth(w - step, window.innerWidth))
            } else if (e.key === 'ArrowRight') {
              e.preventDefault()
              setAiPanelWidth((w) => clampAiPanelWidth(w + step, window.innerWidth))
            }
          }}
        />

        <div className="workspace-editor-pane workspace-editor-pane--primary">
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
            readOnly={Boolean(streamingStages[activeStage])}
          />
        </div>
      </div>
    </div>
  )
}
