import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  SKILL_STAGE_KEYS,
  SKILL_STAGE_LABELS,
  SKILL_KIND_KEYS,
  SKILL_KIND_LABELS,
  SKILL_MANAGER_PROMPT_KIND,
  readSkillAgentPromptTemplateForType,
  readSkillPromptTemplateForType,
  readCommonSkills,
  resetSkillAgentPromptOverride,
  saveCommonSkills,
  saveSkillAgentPromptOverride,
  skillKindPromptKind,
  skillTypeLabel,
  type CommonSkill,
  type SkillPromptKind,
  type SkillStageId,
  type SkillType,
} from '../bridge'
import {
  autoSaveStatusLabel,
  useKeyedAutoSave,
} from '../hooks/useKeyedAutoSave'
import { useTextHistory } from '../hooks/useTextHistory'
import { useAppDialog } from '../components/useAppDialog'
import './WorkspaceSettings.css'

const SKILL_SETTING_TYPES: SkillType[] = ['short', 'long', 'script']
const SKILL_PROMPT_SLOTS: Array<{
  kind: SkillPromptKind
  label: string
}> = [
  { kind: SKILL_MANAGER_PROMPT_KIND, label: '整体管理' },
  ...SKILL_KIND_KEYS.map((kind) => ({
    kind: skillKindPromptKind(kind),
    label: SKILL_KIND_LABELS[kind],
  })),
]

const PLACEHOLDER_HINT =
  '{{SKILL_TITLE}}  {{SKILL_LINE}}  {{SKILL_TYPE}}  {{SKILL_KIND}}  {{SKILL_KIND_LABEL}}  {{SKILL_OVERVIEW}}  {{CURRENT_ENTRY_TITLE}}  {{STAGE_ID}}  {{STAGE_LABEL}}  {{STAGE_BODY}}  {{OTHER_STAGES_EXCERPT}}'

function promptCacheKey(skillType: SkillType, promptKind: SkillPromptKind): string {
  return `${skillType}:${promptKind}`
}

function parsePromptCacheKey(key: string): {
  skillType: SkillType
  promptKind: SkillPromptKind
} {
  const [type, ...kindParts] = key.split(':')
  return {
    skillType: (type || 'short') as SkillType,
    promptKind: (kindParts.join(':') || SKILL_MANAGER_PROMPT_KIND) as SkillPromptKind,
  }
}

export function SkillSettings() {
  const navigate = useNavigate()
  const { confirm, dialog } = useAppDialog()
  const [settingsMode, setSettingsMode] = useState<'prompt' | 'common'>('prompt')
  const [skillType, setSkillType] = useState<SkillType>('short')
  const [promptKind, setPromptKind] =
    useState<SkillPromptKind>(SKILL_MANAGER_PROMPT_KIND)
  const [promptDraft, setPromptDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [commonSkills, setCommonSkills] = useState<CommonSkill[]>([])
  const [commonSkillsLoading, setCommonSkillsLoading] = useState(true)
  const [commonSkillsSaving, setCommonSkillsSaving] = useState(false)
  const [commonSkillsSaved, setCommonSkillsSaved] = useState(false)

  const promptDraftRef = useRef(promptDraft)
  const savedPromptRef = useRef('')
  const promptValuesByKeyRef = useRef<Record<string, string>>({})
  const textHistory = useTextHistory()
  const autoSave = useKeyedAutoSave<string>({
    getSnapshot: (key) => promptValuesByKeyRef.current[key] ?? null,
    saveSnapshot: async (key, value) => {
      try {
        const parsed = parsePromptCacheKey(key)
        await saveSkillAgentPromptOverride(
          value,
          parsed.skillType,
          parsed.promptKind,
        )
        savedPromptRef.current = value
        setError(null)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '保存技能库智能体设置失败')
        throw cause
      }
    },
  })
  const {
    flush: flushSkillPrompt,
    markSaved: markSkillPromptSaved,
    schedule: scheduleSkillPromptSave,
    statusFor: skillPromptStatus,
  } = autoSave

  useEffect(() => {
    promptDraftRef.current = promptDraft
  }, [promptDraft])

  const activePromptKey = promptCacheKey(skillType, promptKind)

  const flushPrompt = useCallback((): Promise<void> => {
    return flushSkillPrompt(activePromptKey).then(() => undefined)
  }, [activePromptKey, flushSkillPrompt])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const prompt =
          promptKind === SKILL_MANAGER_PROMPT_KIND
            ? await readSkillAgentPromptTemplateForType(skillType)
            : await readSkillPromptTemplateForType(promptKind, skillType)
        if (cancelled) return
        promptDraftRef.current = prompt
        promptValuesByKeyRef.current[activePromptKey] = prompt
        savedPromptRef.current = prompt
        setPromptDraft(prompt)
        textHistory.clear(`skill-settings:${activePromptKey}`, prompt)
        markSkillPromptSaved(activePromptKey)
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : '加载技能库智能体设置失败')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      if (promptDraftRef.current !== savedPromptRef.current) {
        void flushSkillPrompt(activePromptKey)
      }
    }
  }, [
    activePromptKey,
    flushSkillPrompt,
    markSkillPromptSaved,
    promptKind,
    skillType,
    textHistory,
  ])

  useEffect(() => {
    let cancelled = false
    void readCommonSkills()
      .then((skills) => {
        if (!cancelled) setCommonSkills(skills)
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : '加载通用技能失败')
        }
      })
      .finally(() => {
        if (!cancelled) setCommonSkillsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const switchSkillType = useCallback(
    async (next: SkillType) => {
      if (next === skillType) return
      await flushPrompt().catch(() => undefined)
      setSkillType(next)
      setPromptDraft('')
    },
    [flushPrompt, skillType],
  )

  const switchPromptKind = useCallback(
    async (next: SkillPromptKind) => {
      if (next === promptKind) return
      await flushPrompt().catch(() => undefined)
      setPromptKind(next)
      setPromptDraft('')
    },
    [flushPrompt, promptKind],
  )

  const handleBack = useCallback(async () => {
    try {
      await flushPrompt()
      navigate('/')
    } catch {
      setError('保存技能库智能体设置失败')
    }
  }, [flushPrompt, navigate])

  const resetPrompt = useCallback(async () => {
    const ok = await confirm({
      title: '恢复默认提示词',
      message: '恢复技能库管理智能体的内置默认提示词？当前提示词覆盖会被清除。',
      confirmText: '恢复默认',
      variant: 'warning',
    })
    if (!ok) {
      return
    }
    await flushPrompt().catch(() => undefined)
    try {
      await resetSkillAgentPromptOverride(skillType, promptKind)
      const value =
        promptKind === SKILL_MANAGER_PROMPT_KIND
          ? await readSkillAgentPromptTemplateForType(skillType)
          : await readSkillPromptTemplateForType(promptKind, skillType)
      savedPromptRef.current = value
      promptDraftRef.current = value
      promptValuesByKeyRef.current[activePromptKey] = value
      setPromptDraft(value)
      textHistory.record(
        `skill-settings:${activePromptKey}`,
        promptDraft,
        value,
        'atomic',
      )
      markSkillPromptSaved(activePromptKey)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '恢复默认提示词失败')
    }
  }, [
    activePromptKey,
    confirm,
    flushPrompt,
    markSkillPromptSaved,
    promptDraft,
    promptKind,
    skillType,
    textHistory,
  ])

  const addCommonSkill = useCallback(() => {
    setCommonSkillsSaved(false)
    setCommonSkills((current) => [
      ...current,
      {
        id: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
        title: '新通用技能',
        body: '',
        effective_stages: [],
      },
    ])
  }, [])

  const updateCommonSkill = useCallback(
    (id: string, patch: Partial<CommonSkill>) => {
      setCommonSkillsSaved(false)
      setCommonSkills((current) =>
        current.map((skill) => skill.id === id ? { ...skill, ...patch } : skill),
      )
    },
    [],
  )

  const toggleEffectiveStage = useCallback(
    (skill: CommonSkill, stageId: SkillStageId) => {
      const selected = new Set(skill.effective_stages)
      if (selected.has(stageId)) selected.delete(stageId)
      else selected.add(stageId)
      updateCommonSkill(skill.id, {
        effective_stages: SKILL_STAGE_KEYS.filter((id) => selected.has(id)),
      })
    },
    [updateCommonSkill],
  )

  const removeCommonSkill = useCallback(async (skill: CommonSkill) => {
    const ok = await confirm({
      title: '删除通用技能',
      message: `删除通用技能「${skill.title}」？`,
      confirmText: '删除',
      variant: 'danger',
    })
    if (!ok) return
    setCommonSkillsSaved(false)
    setCommonSkills((current) => current.filter((item) => item.id !== skill.id))
  }, [confirm])

  const persistCommonSkills = useCallback(async () => {
    setCommonSkillsSaving(true)
    setError(null)
    try {
      const saved = await saveCommonSkills(commonSkills)
      setCommonSkills(saved)
      setCommonSkillsSaved(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存通用技能失败')
    } finally {
      setCommonSkillsSaving(false)
    }
  }, [commonSkills])

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
          <h1>技能库设置</h1>
          <p>配置管理智能体提示词，以及随应用打包发布的通用技能。</p>
          <span
            className={`workspace-settings-save-state workspace-settings-save-state--${settingsMode === 'common' ? (commonSkillsSaving ? 'saving' : commonSkillsSaved ? 'saved' : 'idle') : skillPromptStatus(activePromptKey)}`}
            aria-live="polite"
          >
            {settingsMode === 'common'
              ? commonSkillsSaving ? '保存中…' : commonSkillsSaved ? '已保存' : ''
              : autoSaveStatusLabel(skillPromptStatus(activePromptKey))}
          </span>
        </div>
      </header>

      {dialog}

      {error ? <p className="workspace-settings-error">{error}</p> : null}

      <div className="workspace-settings-type-switch" role="tablist" aria-label="设置类型">
        <button
          type="button"
          className={settingsMode === 'prompt' ? 'workspace-settings-type-btn workspace-settings-type-btn--active' : 'workspace-settings-type-btn'}
          onClick={() => setSettingsMode('prompt')}
        >
          管理智能体
        </button>
        <button
          type="button"
          className={settingsMode === 'common' ? 'workspace-settings-type-btn workspace-settings-type-btn--active' : 'workspace-settings-type-btn'}
          onClick={() => setSettingsMode('common')}
        >
          内置通用技能
        </button>
        {settingsMode === 'prompt' ? SKILL_SETTING_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            role="tab"
            aria-selected={skillType === type}
            className={
              skillType === type
                ? 'workspace-settings-type-btn workspace-settings-type-btn--active'
                : 'workspace-settings-type-btn'
            }
            onClick={() => void switchSkillType(type)}
          >
            {skillTypeLabel(type)}
          </button>
        )) : null}
        {settingsMode === 'prompt' ? SKILL_PROMPT_SLOTS.map((slot) => (
          <button
            key={slot.kind}
            type="button"
            role="tab"
            aria-selected={promptKind === slot.kind}
            className={
              promptKind === slot.kind
                ? 'workspace-settings-type-btn workspace-settings-type-btn--active'
                : 'workspace-settings-type-btn'
            }
            onClick={() => void switchPromptKind(slot.kind)}
          >
            {slot.label}
          </button>
        )) : null}
      </div>

      <main className="workspace-settings-content">
        {settingsMode === 'common' ? (
          commonSkillsLoading ? (
            <div className="workspace-settings-loading">加载内置通用技能中…</div>
          ) : (
            <section className="common-skills-panel">
              <div className="workspace-settings-content-head">
                <div>
                <span>项目本地配置</span>
                  <h2>内置通用技能</h2>
                  <p>配置保存在 app/prompt_defaults/skill/common_skills.json，打包时随应用发布，不进入用户数据目录。</p>
                </div>
                <div className="workspace-settings-head-actions">
                  <button type="button" onClick={addCommonSkill}>+ 添加技能</button>
                  <button type="button" disabled={commonSkillsSaving} onClick={() => void persistCommonSkills()}>
                    {commonSkillsSaving ? '保存中…' : '保存配置'}
                  </button>
                </div>
              </div>

              {commonSkills.length === 0 ? (
                <div className="common-skills-empty">暂无内置通用技能，点击“添加技能”开始配置。</div>
              ) : (
                <div className="common-skills-list">
                  {commonSkills.map((skill, index) => (
                    <article className="common-skill-card" key={skill.id}>
                      <div className="common-skill-card-head">
                        <strong>内置通用技能 {index + 1}</strong>
                        <button type="button" onClick={() => void removeCommonSkill(skill)}>删除</button>
                      </div>
                      <label>
                        <span>技能名称</span>
                        <input
                          value={skill.title}
                          onChange={(event) => updateCommonSkill(skill.id, { title: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>技能内容</span>
                        <textarea
                          value={skill.body}
                          spellCheck={false}
                          onChange={(event) => updateCommonSkill(skill.id, { body: event.target.value })}
                        />
                      </label>
                      <fieldset>
                        <legend>生效阶段（可多选）</legend>
                        <div className="common-skill-stages">
                          {SKILL_STAGE_KEYS.map((stageId) => (
                            <label key={stageId}>
                              <input
                                type="checkbox"
                                checked={skill.effective_stages.includes(stageId)}
                                onChange={() => toggleEffectiveStage(skill, stageId)}
                              />
                              {SKILL_STAGE_LABELS[stageId]}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )
        ) : loading ? (
          <div className="workspace-settings-loading">加载设置中…</div>
        ) : (
          <>
            <div className="workspace-settings-content-head">
              <div>
                <span>技能库</span>
                <h2>
                  {skillTypeLabel(skillType)}
                  {' · '}
                  {SKILL_PROMPT_SLOTS.find((slot) => slot.kind === promptKind)?.label ?? '整体管理'}
                </h2>
              </div>
              <div className="workspace-settings-head-actions">
                <button type="button" onClick={() => void resetPrompt()}>
                  恢复默认提示词
                </button>
              </div>
            </div>

            <div className="workspace-settings-grid workspace-settings-grid--single">
              <section className="workspace-settings-prompt-card">
                <div className="workspace-settings-section-title">
                  <h3>系统提示词</h3>
                  <p>停止输入 1 秒后自动保存，持续输入最长 5 秒落盘一次。</p>
                </div>
                <p className="workspace-settings-placeholder-hint">
                  可用占位符：<code>{PLACEHOLDER_HINT}</code>
                </p>
                <textarea
                  value={promptDraft}
                  spellCheck={false}
                  onBlur={() => void flushPrompt().catch(() => undefined)}
                  onChange={(event) => {
                    textHistory.change(
                      `skill-settings:${activePromptKey}`,
                      promptDraft,
                      event.target.value,
                      (value) => {
                        promptDraftRef.current = value
                        promptValuesByKeyRef.current[activePromptKey] = value
                        setPromptDraft(value)
                        scheduleSkillPromptSave(activePromptKey)
                      },
                    )
                  }}
                  onKeyDown={(event) =>
                    textHistory.handleKeyDown(
                      event,
                      `skill-settings:${activePromptKey}`,
                      promptDraft,
                      (value) => {
                        promptDraftRef.current = value
                        promptValuesByKeyRef.current[activePromptKey] = value
                        setPromptDraft(value)
                        scheduleSkillPromptSave(activePromptKey)
                      },
                      { redoKey: 'm', standardRedo: false },
                    )
                  }
                />
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
