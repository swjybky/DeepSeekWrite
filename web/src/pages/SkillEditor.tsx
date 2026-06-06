import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  SKILL_STAGE_KEYS,
  SKILL_STAGE_LABELS,
  type Skill,
  type SkillStageEntry,
  type SkillStageId,
  getSkill,
  normalizeSkillStages,
  saveSkill,
} from '../bridge'
import { WorkspaceAiChat } from '../components/WorkspaceAiChat'
import { WorkspaceTreeNav } from '../components/WorkspaceTreeNav'
import type { ApplyToStageEditorPayload } from '../pi/workspaceStageAgents'
import './BookEditor.css'

const AI_PANEL_WIDTH_KEY = 'write-claw:skill-ai-width'
const AI_PANEL_MIN = 240
const AI_PANEL_HARD_MAX = 1000
const WORKSPACE_AI_INCLUDE_PI_ARTIFACTS = false
const WORKSPACE_SPLITTER_W = 6
const WORKSPACE_COL_L = 18
const WORKSPACE_COL_R = 36
const WORKSPACE_COL_SUM = 18 + 36 + 36
const EDITOR_MIN_FOR_LAYOUT = 160

type SkillStages = Record<SkillStageId, SkillStageEntry[]>

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

function newStageSkillEntry(stageId: SkillStageId): SkillStageEntry {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  return {
    id: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
    title: SKILL_STAGE_LABELS[stageId],
    body: '',
    created_at: now,
    updated_at: now,
  }
}

function selectedIdsFromStages(stages: SkillStages): Partial<Record<SkillStageId, string>> {
  const out: Partial<Record<SkillStageId, string>> = {}
  for (const stageId of SKILL_STAGE_KEYS) {
    const first = stages[stageId]?.[0]
    if (first) out[stageId] = first.id
  }
  return out
}

function stagesToPromptText(stages: SkillStages): Record<SkillStageId, string> {
  const out = {} as Record<SkillStageId, string>
  for (const stageId of SKILL_STAGE_KEYS) {
    out[stageId] = (stages[stageId] ?? [])
      .map((entry) => `## ${entry.title || '未命名技能'}\n\n${entry.body || ''}`.trim())
      .filter(Boolean)
      .join('\n\n---\n\n')
  }
  return out
}

export function SkillEditor() {
  const { id } = useParams<{ id: string }>()
  const [skill, setSkill] = useState<Skill | null>(null)
  const [stages, setStages] = useState<SkillStages>(() => normalizeSkillStages({}))
  const [activeStage, setActiveStage] = useState<SkillStageId>('character_design')
  const [selectedEntryIds, setSelectedEntryIds] = useState<
    Partial<Record<SkillStageId, string>>
  >({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aiPanelWidth, setAiPanelWidth] = useState(readStoredAiWidth)
  const [aiChatEpoch, setAiChatEpoch] = useState(0)
  const [editorStreaming, setEditorStreaming] = useState(false)

  const splitDragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const saveInFlightRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const stagesRef = useRef<SkillStages>(stages)
  const activeStageRef = useRef<SkillStageId>(activeStage)
  const selectedEntryIdsRef = useRef<Partial<Record<SkillStageId, string>>>({})
  const tokenBufferRef = useRef('')
  const tokenBufferRafRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    stagesRef.current = stages
  }, [stages])

  useEffect(() => {
    activeStageRef.current = activeStage
  }, [activeStage])

  useEffect(() => {
    selectedEntryIdsRef.current = selectedEntryIds
  }, [selectedEntryIds])

  useEffect(() => {
    return () => {
      if (tokenBufferRafRef.current !== undefined) {
        cancelAnimationFrame(tokenBufferRafRef.current)
      }
    }
  }, [])

  const setStagesAndRef = useCallback((updater: (current: SkillStages) => SkillStages) => {
    setStages((prev) => {
      const next = updater(prev)
      stagesRef.current = next
      return next
    })
  }, [])

  const setSelectedIdsAndRef = useCallback(
    (updater: (current: Partial<Record<SkillStageId, string>>) => Partial<Record<SkillStageId, string>>) => {
      setSelectedEntryIds((prev) => {
        const next = updater(prev)
        selectedEntryIdsRef.current = next
        return next
      })
    },
    [],
  )

  const updateSelectedEntry = useCallback(
    (updater: (current: SkillStageEntry) => SkillStageEntry) => {
      const stageId = activeStageRef.current
      const entryId = selectedEntryIdsRef.current[stageId]
      if (!entryId) return
      setStagesAndRef((prev) => ({
        ...prev,
        [stageId]: (prev[stageId] ?? []).map((entry) =>
          entry.id === entryId ? updater(entry) : entry,
        ),
      }))
    },
    [setStagesAndRef],
  )

  const cancelTokenFlush = useCallback(() => {
    if (tokenBufferRafRef.current !== undefined) {
      cancelAnimationFrame(tokenBufferRafRef.current)
      tokenBufferRafRef.current = undefined
    }
  }, [])

  const flushTokenBuffer = useCallback(() => {
    tokenBufferRafRef.current = undefined
    const buffer = tokenBufferRef.current
    if (!buffer) return
    tokenBufferRef.current = ''
    updateSelectedEntry((entry) => ({ ...entry, body: entry.body + buffer }))
  }, [updateSelectedEntry])

  const flushAllTokenBuffers = useCallback(() => {
    cancelTokenFlush()
    flushTokenBuffer()
  }, [cancelTokenFlush, flushTokenBuffer])

  const autoScrollTextarea = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const wasAtBottom =
      textarea.scrollHeight - textarea.scrollTop <= textarea.clientHeight + 20
    if (wasAtBottom) textarea.scrollTop = textarea.scrollHeight
  }, [])

  const applyToStageEditor = useCallback(
    (payload: ApplyToStageEditorPayload) => {
      if (payload.mode === 'replace') {
        cancelTokenFlush()
        tokenBufferRef.current = ''
        setEditorStreaming(false)
        updateSelectedEntry((entry) => ({ ...entry, body: payload.text.trim() }))
        requestAnimationFrame(autoScrollTextarea)
        return
      }

      if (payload.mode === 'append_token') {
        if (!payload.text) return
        setEditorStreaming(true)
        tokenBufferRef.current += payload.text
        if (tokenBufferRafRef.current === undefined) {
          tokenBufferRafRef.current = requestAnimationFrame(() => {
            flushTokenBuffer()
            requestAnimationFrame(autoScrollTextarea)
          })
        }
        return
      }

      if (payload.mode === 'streaming_end') {
        cancelTokenFlush()
        flushTokenBuffer()
        setEditorStreaming(false)
        return
      }

      cancelTokenFlush()
      tokenBufferRef.current = ''
      setEditorStreaming(false)
      const trimmed = payload.text.trim()
      if (!trimmed) return
      updateSelectedEntry((entry) => {
        const sep = entry.body.length === 0 ? '' : entry.body.endsWith('\n') ? '\n' : '\n\n'
        return { ...entry, body: entry.body + sep + trimmed }
      })
      requestAnimationFrame(autoScrollTextarea)
    },
    [autoScrollTextarea, cancelTokenFlush, flushTokenBuffer, updateSelectedEntry],
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

  const syncSkillState = useCallback(
    (next: Skill, options?: { resetNavigation?: boolean }) => {
      const normalized = normalizeSkillStages(next.stages)
      setSkill({ ...next, stages: normalized })
      stagesRef.current = normalized
      setStages(normalized)

      if (options?.resetNavigation) {
        const ids = selectedIdsFromStages(normalized)
        selectedEntryIdsRef.current = ids
        setSelectedEntryIds(ids)
        setActiveStage('character_design')
        return
      }

      setSelectedEntryIds((prev) => {
        const merged: Partial<Record<SkillStageId, string>> = {}
        for (const stageId of SKILL_STAGE_KEYS) {
          const entries = normalized[stageId] ?? []
          const currentId = prev[stageId]
          if (currentId && entries.some((entry) => entry.id === currentId)) {
            merged[stageId] = currentId
          } else if (entries[0]) {
            merged[stageId] = entries[0].id
          }
        }
        selectedEntryIdsRef.current = merged
        return merged
      })
    },
    [],
  )

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const s = await getSkill(id)
      if (!s) {
        setSkill(null)
        setError('未找到该技能')
        return
      }
      syncSkillState(s, { resetNavigation: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [id, syncSkillState])

  const hasLoadedRef = useRef(false)
  useEffect(() => {
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true
      void load()
    }
  }, [load])

  const handleSave = useCallback(async () => {
    if (!id || !skill || saveInFlightRef.current) return
    saveInFlightRef.current = true
    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      flushAllTokenBuffers()
      const next = await saveSkill(id, {
        stages: stagesRef.current,
      })
      if (!next) {
        setError('保存失败：技能不存在')
        return
      }
      syncSkillState(next)
      setMessage('已保存')
      window.setTimeout(() => setMessage(null), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      saveInFlightRef.current = false
      setSaving(false)
    }
  }, [flushAllTokenBuffers, id, skill, syncSkillState])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return
      e.preventDefault()
      void handleSave()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSave])

  const stagePromptBodies = useMemo(() => stagesToPromptText(stages), [stages])

  const handleStageSelect = (stageId: SkillStageId) => {
    setActiveStage(stageId)
    const entries = stagesRef.current[stageId] ?? []
    if (!selectedEntryIdsRef.current[stageId] && entries[0]) {
      setSelectedIdsAndRef((prev) => ({ ...prev, [stageId]: entries[0].id }))
    }
  }

  const handleAddEntry = () => {
    const stageId = activeStageRef.current
    const entry = newStageSkillEntry(stageId)
    setStagesAndRef((prev) => ({
      ...prev,
      [stageId]: [...(prev[stageId] ?? []), entry],
    }))
    setSelectedIdsAndRef((prev) => ({ ...prev, [stageId]: entry.id }))
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const handleDeleteEntry = (entryId: string) => {
    const stageId = activeStageRef.current
    const entries = stagesRef.current[stageId] ?? []
    const index = entries.findIndex((entry) => entry.id === entryId)
    const nextEntries = entries.filter((entry) => entry.id !== entryId)
    const nextSelected = nextEntries[Math.max(0, Math.min(index, nextEntries.length - 1))]
    setStagesAndRef((prev) => ({ ...prev, [stageId]: nextEntries }))
    setSelectedIdsAndRef((prev) => ({ ...prev, [stageId]: nextSelected?.id ?? '' }))
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

  if (error && !skill) {
    return (
      <div className="editor-wrap">
        <p className="editor-error">{error}</p>
        <Link to="/">返回首页</Link>
      </div>
    )
  }

  if (!skill) {
    return (
      <div className="editor-wrap">
        <p className="muted">暂无技能数据</p>
        <Link to="/">返回首页</Link>
      </div>
    )
  }

  const activeEntries = stages[activeStage] ?? []
  const selectedEntryId = selectedEntryIds[activeStage] ?? ''
  const activeEntry = activeEntries.find((entry) => entry.id === selectedEntryId) ?? null
  const stageBody = activeEntry?.body ?? ''
  const { total: stageCharTotal, nonSpace: stageCharNonSpace } = stageTextCounts(stageBody)
  const stageLabel = SKILL_STAGE_LABELS[activeStage]

  return (
    <div className="editor-page editor-page--workspace">
      <header className="editor-header editor-header--agent">
        <Link className="back-link" to="/">
          ← 返回
        </Link>
        <div className="editor-header-meta muted">
          <span className="editor-header-meta-inner">
            <span className="editor-header-meta-text">
              {skill.title || '未命名技能库'}
              {' · '}
              {stageLabel}
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
            rootLabel="阶段技能"
            stages={SKILL_STAGE_KEYS.map((stageId) => ({
              id: stageId,
              label: `${SKILL_STAGE_LABELS[stageId]}（${stages[stageId]?.length ?? 0}）`,
            }))}
            defaultExpanded
            activeStageId={activeStage}
            onStageSelect={(stageId) => handleStageSelect(stageId as SkillStageId)}
          />
        </aside>

        <aside className="workspace-ai workspace-ai--center" aria-label="AI 对话">
          <div className="workspace-ai-header workspace-ai-header-row">
            <span className="workspace-ai-header-title">技能管理智能体</span>
            <div className="workspace-ai-header-actions">
              <Link
                className="workspace-ai-prompt-edit"
                aria-label="配置技能管理智能体"
                title="配置技能管理智能体"
                to="/skill-settings"
              >
                设置
              </Link>
              <button
                type="button"
                className="workspace-ai-new-chat"
                aria-label="清空技能管理智能体对话并开始新会话"
                title="清空技能管理智能体对话并开始新会话"
                onClick={() => setAiChatEpoch((epoch) => epoch + 1)}
              >
                新建对话
              </button>
            </div>
          </div>
          <div className="workspace-ai-hint muted">
            技能库 · {stageLabel}
            {activeEntry ? ` · ${activeEntry.title}` : ''}
          </div>
          <div className="workspace-ai-chat-stack">
            <div className="workspace-ai-chat-layer workspace-ai-chat-layer--active">
              <WorkspaceAiChat
                key={`${skill.id}-skill-manager-${aiChatEpoch}`}
                sessionBookId={skill.id}
                sessionEpoch={aiChatEpoch}
                bookTitle={skill.title}
                stageId={activeStage}
                stageBody={stageBody}
                allStages={stagePromptBodies}
                includePiArtifacts={WORKSPACE_AI_INCLUDE_PI_ARTIFACTS}
                applyToStageEditor={applyToStageEditor}
                workspaceType="skill"
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
            setAiPanelWidth(clampAiPanelWidth(drag.startWidth + delta, window.innerWidth))
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
              {stageLabel}
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

          <section className="skill-stage-items" aria-label="阶段技能列表">
            <div className="skill-stage-items-head">
              <span>{activeEntries.length} 个阶段技能</span>
              <button type="button" className="btn-secondary btn-small" onClick={handleAddEntry}>
                新增技能
              </button>
            </div>
            {activeEntries.length === 0 ? (
              <p className="skill-stage-items-empty muted">
                当前阶段还没有技能，点击“新增技能”开始沉淀。
              </p>
            ) : (
              <div className="skill-stage-item-list">
                {activeEntries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={
                      entry.id === selectedEntryId
                        ? 'skill-stage-item skill-stage-item--active'
                        : 'skill-stage-item'
                    }
                    onClick={() =>
                      setSelectedIdsAndRef((prev) => ({ ...prev, [activeStage]: entry.id }))
                    }
                  >
                    {entry.title || '未命名技能'}
                  </button>
                ))}
              </div>
            )}
          </section>

          {activeEntry ? (
            <div className="skill-entry-editor">
              <div className="skill-entry-toolbar">
                <label className="field skill-entry-title-field">
                  <span className="field-label">技能名称</span>
                  <input
                    type="text"
                    value={activeEntry.title}
                    onChange={(e) =>
                      updateSelectedEntry((entry) => ({
                        ...entry,
                        title: e.target.value,
                      }))
                    }
                    placeholder="请输入技能名称"
                  />
                </label>
                <button
                  type="button"
                  className="btn-secondary btn-small"
                  onClick={() => handleDeleteEntry(activeEntry.id)}
                >
                  删除技能
                </button>
              </div>
              <textarea
                id="stage-body"
                ref={textareaRef}
                className="editor-body workspace-textarea"
                value={activeEntry.body}
                onChange={(e) =>
                  updateSelectedEntry((entry) => ({
                    ...entry,
                    body: e.target.value,
                  }))
                }
                spellCheck={false}
                readOnly={editorStreaming}
                placeholder={`沉淀「${activeEntry.title || stageLabel}」的写作技能、规则、示例或注意事项…`}
              />
            </div>
          ) : (
            <div className="workspace-stage-empty">
              <p className="muted">请选择或新增一个阶段技能。</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
