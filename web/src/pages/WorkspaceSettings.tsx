import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MATERIAL_STAGE_LABELS,
  bookTypeLabel,
  getWorkspaceAgentReadAccess,
  getWorkspaceAgentReadAccessDefaults,
  readWorkspaceAgentPromptTemplate,
  resetWorkspaceAgentPromptOverride,
  resetAllWorkspaceSettings,
  saveWorkspaceAgentPromptOverride,
  saveWorkspaceAgentReadAccess,
  syncWorkspaceAgentReadAccessDefaults,
  type BookType,
  type MaterialStageId,
  type StageId,
  type WorkspaceAgentId,
  type WorkspaceAgentReadAccessConfig,
} from '../bridge'
import { SHORT_WORKSPACE_CONTENT_STAGES } from '../workspaces/short/stages'
import { SCRIPT_WORKSPACE_CONTENT_STAGES } from '../workspaces/script/stages'
import {
  ALL_MATERIAL_STAGE_IDS,
  EXPERT_DRAFT_COORDINATOR_AGENT_ID,
  EXPERT_SECTION_WRITER_AGENT_ID,
  WORKSPACE_STANDARD_AGENT_IDS,
  WORKSPACE_AGENT_IDS,
  getDefaultWorkspaceAgentReadAccess,
  getDefaultWorkspaceAgentReadAccessEntry,
} from '../workspaces/short/stageReadAccess'
import {
  getDefaultWorkspaceAgentReadAccess as getDefaultScriptWorkspaceAgentReadAccess,
  getDefaultWorkspaceAgentReadAccessEntry as getDefaultScriptWorkspaceAgentReadAccessEntry,
} from '../workspaces/script/stageReadAccess'
import './WorkspaceSettings.css'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type PromptDrafts = Record<WorkspaceAgentId, string>
type WorkspaceSettingsType = Extract<BookType, 'short' | 'script'>
const WORKSPACE_SETTING_TYPES: WorkspaceSettingsType[] = ['short', 'script']

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
  '当前书籍：《{{BOOK_TITLE}}》  当前类型分类：{{BOOK_GENRE}}'

function getDefaultReadAccessForType(
  workspaceType: WorkspaceSettingsType,
): WorkspaceAgentReadAccessConfig {
  return workspaceType === 'script'
    ? getDefaultScriptWorkspaceAgentReadAccess()
    : getDefaultWorkspaceAgentReadAccess()
}

function getDefaultReadAccessEntryForType(
  workspaceType: WorkspaceSettingsType,
  agentId: WorkspaceAgentId,
) {
  return workspaceType === 'script'
    ? getDefaultScriptWorkspaceAgentReadAccessEntry(agentId)
    : getDefaultWorkspaceAgentReadAccessEntry(agentId)
}

function getWorkspaceContentStagesForType(workspaceType: WorkspaceSettingsType) {
  return workspaceType === 'script'
    ? SCRIPT_WORKSPACE_CONTENT_STAGES
    : SHORT_WORKSPACE_CONTENT_STAGES
}

function statusLabel(status: SaveStatus): string {
  if (status === 'saving') return '保存中…'
  if (status === 'saved') return '已保存'
  if (status === 'error') return '保存失败'
  return '自动保存'
}

export function WorkspaceSettings() {
  const navigate = useNavigate()
  const [workspaceType, setWorkspaceType] =
    useState<WorkspaceSettingsType>('short')
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
        await saveWorkspaceAgentPromptOverride(agentId, value, workspaceType)
        savedPromptsRef.current = {
          ...savedPromptsRef.current,
          [agentId]: value,
        }
      })
    },
    [enqueueSave, workspaceType],
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
              await readWorkspaceAgentPromptTemplate(agentId, workspaceType),
            ] as const),
          ),
          getWorkspaceAgentReadAccess(workspaceType),
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
  }, [savePromptValue, workspaceType])

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

  const switchWorkspaceType = useCallback(
    async (next: WorkspaceSettingsType) => {
      if (next === workspaceType) return
      await flushPrompt(activeAgentRef.current).catch(() => undefined)
      setWorkspaceType(next)
      setReadAccess(getDefaultReadAccessForType(next))
      setPromptDrafts(EMPTY_PROMPTS)
    },
    [flushPrompt, workspaceType],
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
        await saveWorkspaceAgentReadAccess(next, workspaceType)
      }).catch(() => undefined)
    },
    [enqueueSave, workspaceType],
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
      await resetWorkspaceAgentPromptOverride(agentId, workspaceType)
      const value = await readWorkspaceAgentPromptTemplate(agentId, workspaceType)
      savedPromptsRef.current = { ...savedPromptsRef.current, [agentId]: value }
      promptDraftsRef.current = { ...promptDraftsRef.current, [agentId]: value }
      setPromptDrafts((prev) => ({ ...prev, [agentId]: value }))
    }).catch(() => undefined)
  }, [enqueueSave, workspaceType])

  const resetReadAccess = useCallback(async () => {
    const agentId = activeAgentRef.current
    if (!window.confirm(`恢复「${AGENT_LABELS[agentId]}」的默认读取范围？`)) {
      return
    }
    const defaults = await getWorkspaceAgentReadAccessDefaults(workspaceType)
    const next: WorkspaceAgentReadAccessConfig = {
      ...readAccessRef.current,
      [agentId]: defaults[agentId] ?? getDefaultReadAccessEntryForType(workspaceType, agentId),
    }
    readAccessRef.current = next
    setReadAccess(next)
    await enqueueSave(async () => {
      await saveWorkspaceAgentReadAccess(next, workspaceType)
    }).catch(() => undefined)
  }, [enqueueSave, workspaceType])

  const resetAllSettings = useCallback(async () => {
    if (
      !window.confirm(
        `确定将「${bookTypeLabel(workspaceType)}创作空间」的所有智能体提示词和读取范围恢复为默认配置？此操作不可撤销。`,
      )
    ) {
      return
    }

    // 取消所有未保存的提示词定时保存
    for (const agentId of WORKSPACE_AGENT_IDS) {
      const timer = promptTimersRef.current[agentId]
      if (timer !== undefined) {
        window.clearTimeout(timer)
        delete promptTimersRef.current[agentId]
      }
    }

    setSaveStatus('saving')
    setError(null)
    try {
      await resetAllWorkspaceSettings(workspaceType)
      const [prompts, config] = await Promise.all([
        Promise.all(
          WORKSPACE_AGENT_IDS.map(async (agentId) => [
            agentId,
            await readWorkspaceAgentPromptTemplate(agentId, workspaceType),
          ] as const),
        ),
        getWorkspaceAgentReadAccess(workspaceType),
      ])
      const nextPrompts = Object.fromEntries(prompts) as PromptDrafts
      promptDraftsRef.current = nextPrompts
      savedPromptsRef.current = nextPrompts
      readAccessRef.current = config
      setPromptDrafts(nextPrompts)
      setReadAccess(config)
      setSaveStatus('saved')
    } catch (cause) {
      setSaveStatus('error')
      setError(cause instanceof Error ? cause.message : '还原默认配置失败')
    }
  }, [workspaceType])

  const syncReadAccessDefaults = useCallback(async () => {
    if (
      !window.confirm(
        `将当前「${bookTypeLabel(workspaceType)}」的用户读取范围配置同步为内置默认配置？此操作会修改项目源码中的默认 JSON 文件，供后续版本使用。`,
      )
    ) {
      return
    }
    setSaveStatus('saving')
    setError(null)
    try {
      await syncWorkspaceAgentReadAccessDefaults(workspaceType)
      setSaveStatus('saved')
    } catch (cause) {
      setSaveStatus('error')
      setError(cause instanceof Error ? cause.message : '同步默认配置失败')
    }
  }, [workspaceType])

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
          <p>短篇与剧本分别保存智能体提示词与读取范围。</p>
        </div>
        <span
          className={`workspace-settings-save-state workspace-settings-save-state--${saveStatus}`}
          aria-live="polite"
        >
          {statusLabel(saveStatus)}
        </span>
      </header>

      {error ? <p className="workspace-settings-error">{error}</p> : null}

      <div className="workspace-settings-type-switch" role="tablist" aria-label="创作空间类型">
        {WORKSPACE_SETTING_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            role="tab"
            aria-selected={workspaceType === type}
            className={
              workspaceType === type
                ? 'workspace-settings-type-btn workspace-settings-type-btn--active'
                : 'workspace-settings-type-btn'
            }
            onClick={() => void switchWorkspaceType(type)}
          >
            {bookTypeLabel(type)}
          </button>
        ))}
        <button
          type="button"
          className="workspace-settings-sync-defaults"
          onClick={() => void syncReadAccessDefaults()}
          title="将当前类型的用户读取范围配置写入项目默认 JSON 文件"
        >
          同步为内置默认
        </button>
      </div>

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
                  <h2>
                    {bookTypeLabel(workspaceType)} · {activeLabel}
                  </h2>
                </div>
                <div className="workspace-settings-head-actions">
                  <button
                    type="button"
                    className="workspace-settings-reset-all"
                    onClick={() => void resetAllSettings()}
                  >
                    一键还原默认配置
                  </button>
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
                    {getWorkspaceContentStagesForType(workspaceType).map((stage) => (
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
