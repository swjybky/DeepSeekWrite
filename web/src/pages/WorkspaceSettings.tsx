import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MATERIAL_STAGE_LABELS,
  getWorkspaceAgentReadAccess,
  readWorkspaceAgentPromptTemplate,
  resetWorkspaceAgentPromptOverride,
  saveWorkspaceAgentPromptOverride,
  saveWorkspaceAgentReadAccess,
  type MaterialStageId,
  type StageId,
  type WorkspaceAgentId,
  type WorkspaceAgentReadAccessConfig,
} from '../bridge'
import { SHORT_WORKSPACE_CONTENT_STAGES } from '../workspaces/short/stages'
import {
  ALL_MATERIAL_STAGE_IDS,
  EXPERT_DRAFT_COORDINATOR_AGENT_ID,
  EXPERT_SECTION_WRITER_AGENT_ID,
  WORKSPACE_STANDARD_AGENT_IDS,
  WORKSPACE_AGENT_IDS,
  getDefaultWorkspaceAgentReadAccess,
  getDefaultWorkspaceAgentReadAccessEntry,
} from '../workspaces/short/stageReadAccess'
import './WorkspaceSettings.css'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type PromptDrafts = Record<WorkspaceAgentId, string>

const AGENT_LABELS: Record<WorkspaceAgentId, string> = {
  character_design: '人物设计',
  plot_design: '剧情',
  outline: '大纲',
  expert_draft_coordinator: '正文专家编写智能体',
  expert_section_writer: '分节写手智能体',
}

const EMPTY_PROMPTS = Object.fromEntries(
  WORKSPACE_AGENT_IDS.map((agentId) => [agentId, '']),
) as PromptDrafts
const WORKSPACE_PLACEHOLDER_HINT =
  '当前书籍：《{{BOOK_TITLE}}》  当前短篇分类：{{BOOK_GENRE}}'

function statusLabel(status: SaveStatus): string {
  if (status === 'saving') return '保存中…'
  if (status === 'saved') return '已保存'
  if (status === 'error') return '保存失败'
  return '自动保存'
}

export function WorkspaceSettings() {
  const navigate = useNavigate()
  const [activeAgentId, setActiveAgentId] =
    useState<WorkspaceAgentId>('character_design')
  const [promptDrafts, setPromptDrafts] = useState<PromptDrafts>(EMPTY_PROMPTS)
  const [readAccess, setReadAccess] = useState<WorkspaceAgentReadAccessConfig>(
    () => getDefaultWorkspaceAgentReadAccess(),
  )
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const activeAgentRef = useRef(activeAgentId)
  const promptDraftsRef = useRef(promptDrafts)
  const savedPromptsRef = useRef<PromptDrafts>(EMPTY_PROMPTS)
  const readAccessRef = useRef(readAccess)
  const promptTimersRef = useRef<
    Partial<Record<WorkspaceAgentId, number>>
  >({})
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const operationSeqRef = useRef(0)

  useEffect(() => {
    activeAgentRef.current = activeAgentId
  }, [activeAgentId])

  useEffect(() => {
    promptDraftsRef.current = promptDrafts
  }, [promptDrafts])

  useEffect(() => {
    readAccessRef.current = readAccess
  }, [readAccess])

  const enqueueSave = useCallback(
    (operation: () => Promise<void>): Promise<void> => {
      const seq = ++operationSeqRef.current
      setSaveStatus('saving')
      setError(null)
      const task = saveQueueRef.current
        .catch(() => undefined)
        .then(operation)
      saveQueueRef.current = task.then(
        () => {
          if (seq === operationSeqRef.current) setSaveStatus('saved')
        },
        (cause: unknown) => {
          if (seq === operationSeqRef.current) {
            setSaveStatus('error')
            setError(cause instanceof Error ? cause.message : '保存设置失败')
          }
        },
      )
      return task
    },
    [],
  )

  const savePromptValue = useCallback(
    async (agentId: WorkspaceAgentId, value: string): Promise<void> => {
      if (savedPromptsRef.current[agentId] === value) return
      await enqueueSave(async () => {
        await saveWorkspaceAgentPromptOverride(agentId, value)
        savedPromptsRef.current = {
          ...savedPromptsRef.current,
          [agentId]: value,
        }
      })
    },
    [enqueueSave],
  )

  const flushPrompt = useCallback(
    (agentId: WorkspaceAgentId): Promise<void> => {
      const timer = promptTimersRef.current[agentId]
      if (timer !== undefined) {
        window.clearTimeout(timer)
        delete promptTimersRef.current[agentId]
      }
      return savePromptValue(agentId, promptDraftsRef.current[agentId])
    },
    [savePromptValue],
  )

  const schedulePromptSave = useCallback(
    (agentId: WorkspaceAgentId, value: string) => {
      const previous = promptTimersRef.current[agentId]
      if (previous !== undefined) window.clearTimeout(previous)
      promptTimersRef.current[agentId] = window.setTimeout(() => {
        delete promptTimersRef.current[agentId]
        void savePromptValue(agentId, value).catch(() => undefined)
      }, 500)
    },
    [savePromptValue],
  )

  useEffect(() => {
    let cancelled = false
    const promptTimers = promptTimersRef.current
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const [prompts, config] = await Promise.all([
          Promise.all(
            WORKSPACE_AGENT_IDS.map(async (agentId) => [
              agentId,
              await readWorkspaceAgentPromptTemplate(agentId),
            ] as const),
          ),
          getWorkspaceAgentReadAccess(),
        ])
        if (cancelled) return
        const nextPrompts = Object.fromEntries(prompts) as PromptDrafts
        promptDraftsRef.current = nextPrompts
        savedPromptsRef.current = nextPrompts
        readAccessRef.current = config
        setPromptDrafts(nextPrompts)
        setReadAccess(config)
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : '加载创作空间设置失败')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      for (const timer of Object.values(promptTimers)) {
        if (timer !== undefined) window.clearTimeout(timer)
      }
      for (const agentId of WORKSPACE_AGENT_IDS) {
        if (
          promptDraftsRef.current[agentId] !==
          savedPromptsRef.current[agentId]
        ) {
          void savePromptValue(
            agentId,
            promptDraftsRef.current[agentId],
          ).catch(() => undefined)
        }
      }
    }
  }, [savePromptValue])

  const activeEntry = readAccess[activeAgentId]
  const activeLabel = AGENT_LABELS[activeAgentId]
  const activeIsExpert =
    activeAgentId === EXPERT_DRAFT_COORDINATOR_AGENT_ID ||
    activeAgentId === EXPERT_SECTION_WRITER_AGENT_ID

  const switchAgent = useCallback(
    async (next: WorkspaceAgentId) => {
      if (next === activeAgentRef.current) return
      await flushPrompt(activeAgentRef.current).catch(() => undefined)
      setActiveAgentId(next)
    },
    [flushPrompt],
  )

  const handleBack = useCallback(async () => {
    try {
      await flushPrompt(activeAgentRef.current)
      await saveQueueRef.current
      navigate('/')
    } catch {
      setSaveStatus('error')
    }
  }, [flushPrompt, navigate])

  const patchReadAccess = useCallback(
    (
      kind: 'workspace' | 'material',
      id: StageId | MaterialStageId,
      checked: boolean,
    ) => {
      const current = readAccessRef.current
      const entry = current[activeAgentRef.current]
      const nextEntry =
        kind === 'workspace'
          ? {
              ...entry,
              workspace: checked
                ? [...new Set([...entry.workspace, id as StageId])]
                : entry.workspace.filter((stageId) => stageId !== id),
            }
          : {
              ...entry,
              material: checked
                ? [...new Set([...entry.material, id as MaterialStageId])]
                : entry.material.filter((stageId) => stageId !== id),
            }
      const next: WorkspaceAgentReadAccessConfig = {
        ...current,
        [activeAgentRef.current]: nextEntry,
      }
      readAccessRef.current = next
      setReadAccess(next)
      void enqueueSave(async () => {
        await saveWorkspaceAgentReadAccess(next)
      }).catch(() => undefined)
    },
    [enqueueSave],
  )

  const resetPrompt = useCallback(async () => {
    const agentId = activeAgentRef.current
    if (!window.confirm(`恢复「${AGENT_LABELS[agentId]}」的内置默认提示词？`)) {
      return
    }
    const timer = promptTimersRef.current[agentId]
    if (timer !== undefined) {
      window.clearTimeout(timer)
      delete promptTimersRef.current[agentId]
    }
    await enqueueSave(async () => {
      await resetWorkspaceAgentPromptOverride(agentId)
      const value = await readWorkspaceAgentPromptTemplate(agentId)
      savedPromptsRef.current = { ...savedPromptsRef.current, [agentId]: value }
      promptDraftsRef.current = { ...promptDraftsRef.current, [agentId]: value }
      setPromptDrafts((prev) => ({ ...prev, [agentId]: value }))
    }).catch(() => undefined)
  }, [enqueueSave])

  const resetReadAccess = useCallback(async () => {
    const agentId = activeAgentRef.current
    if (!window.confirm(`恢复「${AGENT_LABELS[agentId]}」的默认读取范围？`)) {
      return
    }
    const next: WorkspaceAgentReadAccessConfig = {
      ...readAccessRef.current,
      [agentId]: getDefaultWorkspaceAgentReadAccessEntry(agentId),
    }
    readAccessRef.current = next
    setReadAccess(next)
    await enqueueSave(async () => {
      await saveWorkspaceAgentReadAccess(next)
    }).catch(() => undefined)
  }, [enqueueSave])

  return (
    <div className="workspace-settings-page">
      <header className="workspace-settings-header">
        <button
          type="button"
          className="workspace-settings-back"
          onClick={() => void handleBack()}
        >
          ← 返回首页
        </button>
        <div>
          <h1>创作空间设置</h1>
          <p>所有短篇书籍共享同一套智能体、提示词与读取范围。</p>
        </div>
        <span
          className={`workspace-settings-save-state workspace-settings-save-state--${saveStatus}`}
          aria-live="polite"
        >
          {statusLabel(saveStatus)}
        </span>
      </header>

      {error ? <p className="workspace-settings-error">{error}</p> : null}

      <main className="workspace-settings-layout">
        <aside className="workspace-settings-nav" aria-label="智能体配置项">
          <section>
            <h2>前置阶段</h2>
            {WORKSPACE_STANDARD_AGENT_IDS.map((stageId) => (
              <button
                key={stageId}
                type="button"
                className={
                  activeAgentId === stageId
                    ? 'workspace-settings-nav-item workspace-settings-nav-item--active'
                    : 'workspace-settings-nav-item'
                }
                onClick={() => void switchAgent(stageId)}
              >
                {AGENT_LABELS[stageId]}
              </button>
            ))}
          </section>
          <section>
            <h2>正文编写</h2>
            {[
              EXPERT_DRAFT_COORDINATOR_AGENT_ID,
              EXPERT_SECTION_WRITER_AGENT_ID,
            ].map((agentId) => (
              <button
                key={agentId}
                type="button"
                className={
                  activeAgentId === agentId
                    ? 'workspace-settings-nav-item workspace-settings-nav-item--active'
                    : 'workspace-settings-nav-item'
                }
                onClick={() => void switchAgent(agentId)}
              >
                {AGENT_LABELS[agentId]}
              </button>
            ))}
          </section>
        </aside>

        <section className="workspace-settings-content">
          {loading ? (
            <div className="workspace-settings-loading">加载设置中…</div>
          ) : (
            <>
              <div className="workspace-settings-content-head">
                <div>
                  <span>{activeIsExpert ? '正文编写' : '前置阶段'}</span>
                  <h2>{activeLabel}</h2>
                </div>
                <div className="workspace-settings-head-actions">
                  <button type="button" onClick={() => void resetReadAccess()}>
                    恢复默认读取范围
                  </button>
                  <button type="button" onClick={() => void resetPrompt()}>
                    恢复默认提示词
                  </button>
                </div>
              </div>

              <div className="workspace-settings-grid">
                <section className="workspace-settings-prompt-card">
                  <div className="workspace-settings-section-title">
                    <h3>系统提示词</h3>
                    <p>停止输入 500ms 后自动保存，切换配置项或返回首页前会立即刷新。</p>
                  </div>
                  <p className="workspace-settings-placeholder-hint">
                    可用占位符：<code>{WORKSPACE_PLACEHOLDER_HINT}</code>
                  </p>
                  <textarea
                    value={promptDrafts[activeAgentId]}
                    spellCheck={false}
                    onBlur={() =>
                      void flushPrompt(activeAgentId).catch(() => undefined)
                    }
                    onChange={(event) => {
                      const value = event.target.value
                      const agentId = activeAgentId
                      const next = {
                        ...promptDraftsRef.current,
                        [agentId]: value,
                      }
                      promptDraftsRef.current = next
                      setPromptDrafts(next)
                      schedulePromptSave(agentId, value)
                    }}
                  />
                </section>

                <aside className="workspace-settings-read-card">
                  <div className="workspace-settings-section-title">
                    <h3>可读取内容</h3>
                    <p>未勾选内容不会出现在读取工具或阶段摘录中。</p>
                  </div>

                  <fieldset>
                    <legend>创作空间阶段</legend>
                    {SHORT_WORKSPACE_CONTENT_STAGES.map((stage) => (
                      <label key={stage.id}>
                        <input
                          type="checkbox"
                          checked={activeEntry.workspace.includes(stage.id)}
                          onChange={(event) =>
                            patchReadAccess(
                              'workspace',
                              stage.id,
                              event.target.checked,
                            )
                          }
                        />
                        <span>{stage.label}</span>
                      </label>
                    ))}
                  </fieldset>

                  <fieldset>
                    <legend>关联素材库栏目</legend>
                    {ALL_MATERIAL_STAGE_IDS.map((stageId) => (
                      <label key={stageId}>
                        <input
                          type="checkbox"
                          checked={activeEntry.material.includes(stageId)}
                          onChange={(event) =>
                            patchReadAccess(
                              'material',
                              stageId,
                              event.target.checked,
                            )
                          }
                        />
                        <span>{MATERIAL_STAGE_LABELS[stageId]}</span>
                      </label>
                    ))}
                  </fieldset>
                </aside>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  )
}
