import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MATERIAL_KIND_KEYS,
  MATERIAL_KIND_LABELS,
  SKILL_KIND_KEYS,
  SKILL_KIND_LABELS,
  bookTypeLabel,
  getWorkspaceAgentReadAccess,
  getWorkspaceAgentReadAccessDefaults,
  readWorkspaceAgentPromptTemplate,
  resetWorkspaceAgentPromptOverride,
  resetAllWorkspaceSettings,
  saveWorkspaceAgentPromptOverride,
  saveWorkspaceAgentReadAccess,
  syncWorkspaceSettingsDefaults,
  type BookType,
  type MaterialKind,
  type SkillKind,
  type StageId,
  type WorkspaceAgentId,
  type WorkspaceAgentReadAccessConfig,
} from '../bridge'
import { SHORT_WORKSPACE_CONTENT_STAGES } from '../workspaces/short/stages'
import { SCRIPT_WORKSPACE_CONTENT_STAGES } from '../workspaces/script/stages'
import {
  EXPERT_DRAFT_COORDINATOR_AGENT_ID,
  EXPERT_SECTION_WRITER_AGENT_ID,
  WORKSPACE_AGENT_IDS as SHORT_WORKSPACE_AGENT_IDS,
  getDefaultWorkspaceAgentReadAccess,
  getDefaultWorkspaceAgentReadAccessEntry,
  isRequiredWorkspaceStageForAgent,
  normalizeWorkspaceAgentReadAccess,
} from '../workspaces/short/stageReadAccess'
import {
  getDefaultWorkspaceAgentReadAccess as getDefaultScriptWorkspaceAgentReadAccess,
  getDefaultWorkspaceAgentReadAccessEntry as getDefaultScriptWorkspaceAgentReadAccessEntry,
  isRequiredWorkspaceStageForAgent as isRequiredScriptWorkspaceStageForAgent,
  normalizeWorkspaceAgentReadAccess as normalizeScriptWorkspaceAgentReadAccess,
} from '../workspaces/script/stageReadAccess'
import {
  LONG_WORKSPACE_CONTENT_STAGES,
  LONG_WORKSPACE_STAGES,
  longRootStageIdForStage,
  type LongRootStageId,
} from '../workspaces/long/stages'
import {
  EXPERT_SECTION_WRITER_AGENT_ID as LONG_SECTION_WRITER_AGENT_ID,
  WORKSPACE_AGENT_IDS as LONG_WORKSPACE_AGENT_IDS,
  getDefaultWorkspaceAgentReadAccess as getDefaultLongWorkspaceAgentReadAccess,
  getDefaultWorkspaceAgentReadAccessEntry as getDefaultLongWorkspaceAgentReadAccessEntry,
  isRequiredWorkspaceStageForAgent as isRequiredLongWorkspaceStageForAgent,
  normalizeWorkspaceAgentReadAccess as normalizeLongWorkspaceAgentReadAccess,
  type LongWorkspaceAgentId,
} from '../workspaces/long/stageReadAccess'
import {
  autoSaveStatusLabel,
  useKeyedAutoSave,
} from '../hooks/useKeyedAutoSave'
import { useTextHistory } from '../hooks/useTextHistory'
import { useAppDialog } from '../components/useAppDialog'
import './WorkspaceSettings.css'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type SettingsAgentId = WorkspaceAgentId | LongWorkspaceAgentId
type PromptDrafts = Record<string, string>
type WorkspaceSettingsType = Extract<BookType, 'short' | 'long' | 'script'>
const WORKSPACE_SETTING_TYPES: WorkspaceSettingsType[] = ['short', 'long', 'script']

const STANDARD_AGENT_LABELS: Record<WorkspaceAgentId, string> = {
  character_design: '人物',
  plot_design: '剧情',
  outline: '大纲',
  expert_draft_coordinator: '正文专家编写智能体',
  expert_section_writer: '分节写手智能体',
}

const LONG_AGENT_LABELS: Record<LongWorkspaceAgentId, string> = {
  worldbuilding: '世界观管理智能体',
  character_design: '人物管理智能体',
  plot_design: '剧情管理智能体',
  draft: '正文管理智能体',
  expert_section_writer: '写手智能体',
  continuity_ledger: '状态账本智能体（后台）',
}

function agentIdsForType(
  workspaceType: WorkspaceSettingsType,
): readonly SettingsAgentId[] {
  return workspaceType === 'long'
    ? LONG_WORKSPACE_AGENT_IDS
    : SHORT_WORKSPACE_AGENT_IDS
}

function emptyPromptsForType(workspaceType: WorkspaceSettingsType): PromptDrafts {
  return Object.fromEntries(
    agentIdsForType(workspaceType).map((agentId) => [agentId, '']),
  )
}

function agentLabel(
  workspaceType: WorkspaceSettingsType,
  agentId: SettingsAgentId,
): string {
  return workspaceType === 'long'
    ? LONG_AGENT_LABELS[agentId as LongWorkspaceAgentId]
    : STANDARD_AGENT_LABELS[agentId as WorkspaceAgentId]
}

function agentGroupsForType(workspaceType: WorkspaceSettingsType) {
  if (workspaceType === 'long') {
    return [
      {
        title: '前置阶段',
        ids: ['worldbuilding', 'character_design', 'plot_design'] as const,
      },
      {
        title: '正文编写',
        ids: ['draft', LONG_SECTION_WRITER_AGENT_ID] as const,
      },
      {
        title: '后台流转',
        ids: ['continuity_ledger'] as const,
      },
    ]
  }
  return [
    {
      title: '前置阶段',
      ids: ['character_design', 'plot_design', 'outline'] as const,
    },
    {
      title: '正文编写',
      ids: [
        EXPERT_DRAFT_COORDINATOR_AGENT_ID,
        EXPERT_SECTION_WRITER_AGENT_ID,
      ] as const,
    },
  ]
}

function getDefaultReadAccessForType(
  workspaceType: WorkspaceSettingsType,
): WorkspaceAgentReadAccessConfig {
  if (workspaceType === 'long') return getDefaultLongWorkspaceAgentReadAccess()
  return workspaceType === 'script'
    ? getDefaultScriptWorkspaceAgentReadAccess()
    : getDefaultWorkspaceAgentReadAccess()
}

function getDefaultReadAccessEntryForType(
  workspaceType: WorkspaceSettingsType,
  agentId: SettingsAgentId,
) {
  if (workspaceType === 'long') {
    return getDefaultLongWorkspaceAgentReadAccessEntry(
      agentId as LongWorkspaceAgentId,
    )
  }
  return workspaceType === 'script'
    ? getDefaultScriptWorkspaceAgentReadAccessEntry(agentId as WorkspaceAgentId)
    : getDefaultWorkspaceAgentReadAccessEntry(agentId as WorkspaceAgentId)
}

function getWorkspaceContentStagesForType(workspaceType: WorkspaceSettingsType) {
  if (workspaceType === 'long') return LONG_WORKSPACE_STAGES
  return workspaceType === 'script'
    ? SCRIPT_WORKSPACE_CONTENT_STAGES
    : SHORT_WORKSPACE_CONTENT_STAGES
}

function longRootStageIds(rootId: LongRootStageId): StageId[] {
  return LONG_WORKSPACE_CONTENT_STAGES
    .filter((stage) => stage.rootId === rootId)
    .map((stage) => stage.id as StageId)
}

function normalizeReadAccessForType(
  workspaceType: WorkspaceSettingsType,
  config: WorkspaceAgentReadAccessConfig,
): WorkspaceAgentReadAccessConfig {
  if (workspaceType === 'long') return normalizeLongWorkspaceAgentReadAccess(config)
  return workspaceType === 'script'
    ? normalizeScriptWorkspaceAgentReadAccess(config)
    : normalizeWorkspaceAgentReadAccess(config)
}

function isRequiredWorkspaceStageForType(
  workspaceType: WorkspaceSettingsType,
  agentId: SettingsAgentId,
  stageId: StageId,
): boolean {
  if (workspaceType === 'long') {
    return isRequiredLongWorkspaceStageForAgent(
      agentId as LongWorkspaceAgentId,
      stageId,
    )
  }
  return workspaceType === 'script'
    ? isRequiredScriptWorkspaceStageForAgent(agentId as WorkspaceAgentId, stageId)
    : isRequiredWorkspaceStageForAgent(agentId as WorkspaceAgentId, stageId)
}

export function WorkspaceSettings() {
  const navigate = useNavigate()
  const { confirm, dialog } = useAppDialog()
  const [workspaceType, setWorkspaceType] =
    useState<WorkspaceSettingsType>('short')
  const [activeAgentId, setActiveAgentId] =
    useState<SettingsAgentId>('character_design')
  const [promptDrafts, setPromptDrafts] = useState<PromptDrafts>(() =>
    emptyPromptsForType('short'),
  )
  const [readAccess, setReadAccess] = useState<WorkspaceAgentReadAccessConfig>(
    () => getDefaultWorkspaceAgentReadAccess(),
  )
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const activeAgentRef = useRef(activeAgentId)
  const promptDraftsRef = useRef(promptDrafts)
  const savedPromptsRef = useRef<PromptDrafts>(emptyPromptsForType('short'))
  const promptValuesByKeyRef = useRef<Record<string, string>>({})
  const readAccessRef = useRef(readAccess)
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const operationSeqRef = useRef(0)
  const textHistory = useTextHistory()
  const promptAutoSave = useKeyedAutoSave<string>({
    getSnapshot: (key) => {
      return promptValuesByKeyRef.current[key] ?? null
    },
    saveSnapshot: async (key, value) => {
      const [targetType, agentId] = key.split(':') as [
        WorkspaceSettingsType,
        SettingsAgentId,
      ]
      try {
        await saveWorkspaceAgentPromptOverride(agentId, value, targetType)
        savedPromptsRef.current = {
          ...savedPromptsRef.current,
          [agentId]: value,
        }
        setError(null)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '保存创作空间提示词失败')
        throw cause
      }
    },
  })
  const {
    flush: flushWorkspacePrompt,
    markSaved: markWorkspacePromptSaved,
    schedule: scheduleWorkspacePromptSave,
    statusFor: workspacePromptStatus,
  } = promptAutoSave

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

  const flushPrompt = useCallback(
    (agentId: SettingsAgentId): Promise<void> => {
      return flushWorkspacePrompt(`${workspaceType}:${agentId}`).then(() => undefined)
    },
    [flushWorkspacePrompt, workspaceType],
  )

  const schedulePromptSave = useCallback(
    (agentId: SettingsAgentId) => {
      scheduleWorkspacePromptSave(`${workspaceType}:${agentId}`)
    },
    [scheduleWorkspacePromptSave, workspaceType],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const workspaceAgentIds = agentIdsForType(workspaceType)
        const [prompts, config] = await Promise.all([
          Promise.all(
            workspaceAgentIds.map(async (agentId) => [
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
        for (const agentId of workspaceAgentIds) {
          const key = `${workspaceType}:${agentId}`
          promptValuesByKeyRef.current[key] = nextPrompts[agentId]
          textHistory.clear(`workspace-settings:${key}`, nextPrompts[agentId])
          markWorkspacePromptSaved(key)
        }
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
      for (const agentId of agentIdsForType(workspaceType)) {
        if (
          promptDraftsRef.current[agentId] !==
          savedPromptsRef.current[agentId]
        ) {
          void flushWorkspacePrompt(`${workspaceType}:${agentId}`)
        }
      }
    }
  }, [
    flushWorkspacePrompt,
    markWorkspacePromptSaved,
    textHistory,
    workspaceType,
  ])

  const activeEntry =
    readAccess[activeAgentId] ??
    getDefaultReadAccessEntryForType(workspaceType, activeAgentId)
  const activeLabel = agentLabel(workspaceType, activeAgentId)
  const activeSectionLabel =
    agentGroupsForType(workspaceType).find((group) =>
      (group.ids as readonly string[]).includes(activeAgentId),
    )?.title ?? '智能体配置'

  const switchAgent = useCallback(
    async (next: SettingsAgentId) => {
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
      const nextAgentId = agentIdsForType(next)[0] ?? 'character_design'
      setWorkspaceType(next)
      setReadAccess(getDefaultReadAccessForType(next))
      setActiveAgentId(nextAgentId)
      setPromptDrafts(emptyPromptsForType(next))
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
      kind: 'workspace' | 'material' | 'skill',
      id: StageId | MaterialKind | SkillKind,
      checked: boolean,
    ) => {
      const workspaceIds =
        kind === 'workspace' && workspaceType === 'long'
          ? longRootStageIds(longRootStageIdForStage(String(id)))
          : [id as StageId]
      if (
        kind === 'workspace' &&
        !checked &&
        workspaceIds.some((stageId) =>
          isRequiredWorkspaceStageForType(
            workspaceType,
            activeAgentRef.current,
            stageId,
          ),
        )
      ) {
        return
      }
      const current = readAccessRef.current
      const entry = current[activeAgentRef.current]
      const nextEntry =
        kind === 'workspace'
          ? {
              ...entry,
              workspace: checked
                ? [...new Set([...entry.workspace, ...workspaceIds])]
                : entry.workspace.filter((stageId) => !workspaceIds.includes(stageId)),
            }
          : kind === 'material'
            ? {
                ...entry,
                material: checked
                  ? [...new Set([...entry.material, id as MaterialKind])]
                  : entry.material.filter((stageId) => stageId !== id),
              }
            : {
                ...entry,
                skill: checked
                  ? [...new Set([...(entry.skill ?? []), id as SkillKind])]
                  : (entry.skill ?? []).filter((skillKind) => skillKind !== id),
              }
      const next = normalizeReadAccessForType(workspaceType, {
        ...current,
        [activeAgentRef.current]: nextEntry,
      })
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
    const ok = await confirm({
      title: '恢复默认提示词',
      message: `恢复「${agentLabel(workspaceType, agentId)}」的内置默认提示词？当前提示词覆盖会被清除。`,
      confirmText: '恢复默认',
      variant: 'warning',
    })
    if (!ok) {
      return
    }
    await flushPrompt(agentId).catch(() => undefined)
    await enqueueSave(async () => {
      await resetWorkspaceAgentPromptOverride(agentId, workspaceType)
      const value = await readWorkspaceAgentPromptTemplate(agentId, workspaceType)
      const previous = promptDraftsRef.current[agentId]
      savedPromptsRef.current = { ...savedPromptsRef.current, [agentId]: value }
      promptDraftsRef.current = { ...promptDraftsRef.current, [agentId]: value }
      promptValuesByKeyRef.current[`${workspaceType}:${agentId}`] = value
      setPromptDrafts((prev) => ({ ...prev, [agentId]: value }))
      textHistory.record(
        `workspace-settings:${workspaceType}:${agentId}`,
        previous,
        value,
        'atomic',
      )
      markWorkspacePromptSaved(`${workspaceType}:${agentId}`)
    }).catch(() => undefined)
  }, [
    confirm,
    enqueueSave,
    flushPrompt,
    markWorkspacePromptSaved,
    textHistory,
    workspaceType,
  ])

  const resetReadAccess = useCallback(async () => {
    const agentId = activeAgentRef.current
    const ok = await confirm({
      title: '恢复默认读取范围',
      message: `恢复「${agentLabel(workspaceType, agentId)}」的默认读取范围？`,
      confirmText: '恢复默认',
      variant: 'warning',
    })
    if (!ok) {
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
  }, [confirm, enqueueSave, workspaceType])

  const resetAllSettings = useCallback(async () => {
    const ok = await confirm({
      title: '一键还原默认配置',
      message: `确定将「${bookTypeLabel(workspaceType)}创作空间」的所有智能体提示词和读取范围恢复为默认配置？此操作不可撤销。`,
      confirmText: '还原默认',
      variant: 'danger',
    })
    if (!ok) {
      return
    }

    const workspaceAgentIds = agentIdsForType(workspaceType)
    await Promise.all(
      workspaceAgentIds.map((agentId) =>
        flushPrompt(agentId).catch(() => undefined),
      ),
    )

    setSaveStatus('saving')
    setError(null)
    try {
      await resetAllWorkspaceSettings(workspaceType)
      const [prompts, config] = await Promise.all([
        Promise.all(
          workspaceAgentIds.map(async (agentId) => [
            agentId,
            await readWorkspaceAgentPromptTemplate(agentId, workspaceType),
          ] as const),
        ),
        getWorkspaceAgentReadAccess(workspaceType),
      ])
      const nextPrompts = Object.fromEntries(prompts) as PromptDrafts
      const previousPrompts = promptDraftsRef.current
      promptDraftsRef.current = nextPrompts
      savedPromptsRef.current = nextPrompts
      readAccessRef.current = config
      setPromptDrafts(nextPrompts)
      setReadAccess(config)
      for (const agentId of workspaceAgentIds) {
        const key = `${workspaceType}:${agentId}`
        promptValuesByKeyRef.current[key] = nextPrompts[agentId]
        textHistory.record(
          `workspace-settings:${key}`,
          previousPrompts[agentId],
          nextPrompts[agentId],
          'atomic',
        )
        markWorkspacePromptSaved(key)
      }
      setSaveStatus('saved')
    } catch (cause) {
      setSaveStatus('error')
      setError(cause instanceof Error ? cause.message : '还原默认配置失败')
    }
  }, [confirm, flushPrompt, markWorkspacePromptSaved, textHistory, workspaceType])

  const syncSettingsDefaults = useCallback(async () => {
    const ok = await confirm({
      title: '同步提示词和读取范围',
      message: `将当前「${bookTypeLabel(workspaceType)}」的用户提示词和读取范围同步为内置默认配置？此操作会修改项目源码中的默认提示词文件和 read_access.json，供后续版本使用。`,
      confirmText: '同步默认',
      variant: 'warning',
    })
    if (!ok) {
      return
    }
    setSaveStatus('saving')
    setError(null)
    try {
      await Promise.all(
        agentIdsForType(workspaceType).map((agentId) => flushPrompt(agentId)),
      )
      await saveQueueRef.current
      await saveWorkspaceAgentReadAccess(readAccessRef.current, workspaceType)
      await syncWorkspaceSettingsDefaults(workspaceType)
      setSaveStatus('saved')
    } catch (cause) {
      setSaveStatus('error')
      setError(cause instanceof Error ? cause.message : '同步默认配置失败')
    }
  }, [confirm, flushPrompt, workspaceType])

  const activePromptKey = `${workspaceType}:${activeAgentId}`
  const activePromptHistoryKey = `workspace-settings:${activePromptKey}`
  const activePrompt = promptDrafts[activeAgentId] ?? ''
  const promptStatus = workspacePromptStatus(activePromptKey)
  const headerStatus =
    saveStatus === 'saving' || saveStatus === 'error' ? saveStatus : promptStatus
  const applyActivePrompt = (value: string) => {
    const next = { ...promptDraftsRef.current, [activeAgentId]: value }
    promptDraftsRef.current = next
    promptValuesByKeyRef.current[activePromptKey] = value
    setPromptDrafts(next)
    schedulePromptSave(activeAgentId)
  }

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
        <div className="workspace-settings-title-block">
          <h1>创作空间设置</h1>
          <p>短篇、长篇与剧本分别保存智能体提示词、素材读取范围和技能加载范围。</p>
          <span
            className={`workspace-settings-save-state workspace-settings-save-state--${headerStatus}`}
            aria-live="polite"
          >
            {headerStatus === 'error'
              ? '保存失败'
              : autoSaveStatusLabel(headerStatus)}
          </span>
        </div>
      </header>

      {dialog}

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
          onClick={() => void syncSettingsDefaults()}
          title="将当前类型的用户提示词和读取范围写入项目默认配置"
        >
          同步提示词和读取范围
        </button>
      </div>

      <main className="workspace-settings-layout">
        <aside className="workspace-settings-nav" aria-label="智能体配置项">
          {agentGroupsForType(workspaceType).map((group) => (
            <section key={group.title}>
              <h2>{group.title}</h2>
              {group.ids.map((agentId) => (
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
                  {agentLabel(workspaceType, agentId)}
                </button>
              ))}
            </section>
          ))}
        </aside>

        <section className="workspace-settings-content">
          {loading ? (
            <div className="workspace-settings-loading">加载设置中…</div>
          ) : (
            <>
              <div className="workspace-settings-content-head">
                <div>
                  <span>{activeSectionLabel}</span>
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
                    <p>停止输入 1 秒后自动保存，持续输入最长 5 秒落盘一次。</p>
                  </div>
                  <p className="workspace-settings-placeholder-hint">
                    书名、创作类型、分类和当前位置会在每次请求时自动提供，无需写入系统提示词。
                  </p>
                  <textarea
                    value={activePrompt}
                    spellCheck={false}
                    onBlur={() =>
                      void flushPrompt(activeAgentId).catch(() => undefined)
                    }
                    onChange={(event) => {
                      textHistory.change(
                        activePromptHistoryKey,
                        activePrompt,
                        event.target.value,
                        applyActivePrompt,
                      )
                    }}
                    onKeyDown={(event) =>
                      textHistory.handleKeyDown(
                        event,
                        activePromptHistoryKey,
                        activePrompt,
                        applyActivePrompt,
                      )
                    }
                  />
                </section>

                <aside className="workspace-settings-read-card">
                  <div className="workspace-settings-section-title">
                    <h3>可读取内容</h3>
                    <p>未勾选内容不会出现在读取工具或阶段摘录中。</p>
                  </div>

                  <fieldset>
                    <legend>创作空间阶段</legend>
                    {getWorkspaceContentStagesForType(workspaceType).map((stage) => {
                      const workspaceIds = workspaceType === 'long'
                        ? longRootStageIds(stage.id as LongRootStageId)
                        : [stage.id as StageId]
                      const locked = workspaceIds.some((stageId) =>
                        isRequiredWorkspaceStageForType(
                          workspaceType,
                          activeAgentId,
                          stageId,
                        ),
                      )
                      const checked = workspaceIds.every((stageId) =>
                        activeEntry.workspace.includes(stageId),
                      )
                      return (
                        <label
                          key={stage.id}
                          className={
                            locked
                              ? 'workspace-settings-read-option workspace-settings-read-option--locked'
                              : 'workspace-settings-read-option'
                          }
                          title={locked ? '当前阶段内容固定可读' : undefined}
                        >
                          <input
                            type="checkbox"
                            checked={locked || checked}
                            disabled={locked}
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
                      )
                    })}
                  </fieldset>

                  <fieldset>
                    <legend>素材库读取范围</legend>
                    {MATERIAL_KIND_KEYS.map((materialKind) => (
                      <label key={materialKind}>
                        <input
                          type="checkbox"
                          checked={activeEntry.material.includes(materialKind)}
                          onChange={(event) =>
                            patchReadAccess(
                              'material',
                              materialKind,
                              event.target.checked,
                            )
                          }
                        />
                        <span>{MATERIAL_KIND_LABELS[materialKind]}</span>
                      </label>
                    ))}
                  </fieldset>

                  <fieldset>
                    <legend>技能库加载范围</legend>
                    {SKILL_KIND_KEYS.map((skillKind) => (
                      <label key={skillKind}>
                        <input
                          type="checkbox"
                          checked={(activeEntry.skill ?? []).includes(skillKind)}
                          onChange={(event) =>
                            patchReadAccess(
                              'skill',
                              skillKind,
                              event.target.checked,
                            )
                          }
                        />
                        <span>{SKILL_KIND_LABELS[skillKind]}</span>
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
