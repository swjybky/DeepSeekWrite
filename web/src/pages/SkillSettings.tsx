import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  SKILL_KIND_KEYS,
  SKILL_KIND_LABELS,
  SKILL_MANAGER_PROMPT_KIND,
  readSkillAgentPromptTemplateForType,
  readSkillManagerSkills,
  readSkillPromptTemplateForType,
  resetSkillAgentPromptOverride,
  resetSkillManagerSkills,
  saveSkillAgentPromptOverride,
  saveSkillManagerSkills,
  skillKindPromptKind,
  skillTypeLabel,
  type SkillManagerSkill,
  type SkillPromptKind,
  type SkillType,
} from '../bridge'
import { autoSaveStatusLabel, useKeyedAutoSave } from '../hooks/useKeyedAutoSave'
import { useTextHistory } from '../hooks/useTextHistory'
import { useAppDialog } from '../components/useAppDialog'
import './WorkspaceSettings.css'

const SKILL_SETTING_TYPES: SkillType[] = ['short', 'long', 'script']
const SKILL_PROMPT_SLOTS: Array<{ kind: SkillPromptKind; label: string }> = [
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

function parsePromptCacheKey(key: string): { skillType: SkillType; promptKind: SkillPromptKind } {
  const [type, ...kindParts] = key.split(':')
  return {
    skillType: (type || 'short') as SkillType,
    promptKind: (kindParts.join(':') || SKILL_MANAGER_PROMPT_KIND) as SkillPromptKind,
  }
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
}

export function SkillSettings() {
  const navigate = useNavigate()
  const { confirm, dialog } = useAppDialog()
  const [settingsMode, setSettingsMode] = useState<'prompt' | 'skills'>('prompt')
  const [skillType, setSkillType] = useState<SkillType>('short')
  const [promptKind, setPromptKind] = useState<SkillPromptKind>(SKILL_MANAGER_PROMPT_KIND)
  const [promptDraft, setPromptDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [managerSkills, setManagerSkills] = useState<SkillManagerSkill[]>([])
  const [managerSkillsLoading, setManagerSkillsLoading] = useState(true)
  const [managerSkillsSaving, setManagerSkillsSaving] = useState(false)
  const [managerSkillsSaved, setManagerSkillsSaved] = useState(false)
  const [managerSkillsDirty, setManagerSkillsDirty] = useState(false)
  const promptDraftRef = useRef(promptDraft)
  const savedPromptRef = useRef('')
  const promptValuesByKeyRef = useRef<Record<string, string>>({})
  const textHistory = useTextHistory()
  const autoSave = useKeyedAutoSave<string>({
    getSnapshot: (key) => promptValuesByKeyRef.current[key] ?? null,
    saveSnapshot: async (key, value) => {
      const parsed = parsePromptCacheKey(key)
      await saveSkillAgentPromptOverride(value, parsed.skillType, parsed.promptKind)
      savedPromptRef.current = value
      setError(null)
    },
  })
  const { flush: flushSkillPrompt, markSaved, schedule, statusFor } = autoSave

  useEffect(() => {
    promptDraftRef.current = promptDraft
  }, [promptDraft])

  const activePromptKey = promptCacheKey(skillType, promptKind)
  const flushPrompt = useCallback(
    () => flushSkillPrompt(activePromptKey).then(() => undefined),
    [activePromptKey, flushSkillPrompt],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const prompt = promptKind === SKILL_MANAGER_PROMPT_KIND
          ? await readSkillAgentPromptTemplateForType(skillType)
          : await readSkillPromptTemplateForType(promptKind, skillType)
        if (cancelled) return
        promptDraftRef.current = prompt
        promptValuesByKeyRef.current[activePromptKey] = prompt
        savedPromptRef.current = prompt
        setPromptDraft(prompt)
        textHistory.clear(`skill-settings:${activePromptKey}`, prompt)
        markSaved(activePromptKey)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '加载技能库智能体设置失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      if (promptDraftRef.current !== savedPromptRef.current) void flushSkillPrompt(activePromptKey)
    }
  }, [activePromptKey, flushSkillPrompt, markSaved, promptKind, skillType, textHistory])

  useEffect(() => {
    let cancelled = false
    void readSkillManagerSkills()
      .then((skills) => {
        if (!cancelled) setManagerSkills(skills)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '加载技能库管理技能失败')
      })
      .finally(() => {
        if (!cancelled) setManagerSkillsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const switchSkillType = useCallback(async (next: SkillType) => {
    if (next === skillType) return
    await flushPrompt().catch(() => undefined)
    setSkillType(next)
    setPromptDraft('')
  }, [flushPrompt, skillType])

  const switchPromptKind = useCallback(async (next: SkillPromptKind) => {
    if (next === promptKind) return
    await flushPrompt().catch(() => undefined)
    setPromptKind(next)
    setPromptDraft('')
  }, [flushPrompt, promptKind])

  const resetPrompt = useCallback(async () => {
    const ok = await confirm({
      title: '恢复默认提示词',
      message: '恢复技能库管理智能体的内置默认提示词？当前提示词覆盖会被清除。',
      confirmText: '恢复默认',
      variant: 'warning',
    })
    if (!ok) return
    await flushPrompt().catch(() => undefined)
    try {
      await resetSkillAgentPromptOverride(skillType, promptKind)
      const value = promptKind === SKILL_MANAGER_PROMPT_KIND
        ? await readSkillAgentPromptTemplateForType(skillType)
        : await readSkillPromptTemplateForType(promptKind, skillType)
      savedPromptRef.current = value
      promptDraftRef.current = value
      promptValuesByKeyRef.current[activePromptKey] = value
      setPromptDraft(value)
      textHistory.record(`skill-settings:${activePromptKey}`, promptDraft, value, 'atomic')
      markSaved(activePromptKey)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '恢复默认提示词失败')
    }
  }, [activePromptKey, confirm, flushPrompt, markSaved, promptDraft, promptKind, skillType, textHistory])

  const updateManagerSkill = useCallback((id: string, patch: Partial<SkillManagerSkill>) => {
    setManagerSkills((current) => current.map((skill) => skill.id === id ? { ...skill, ...patch } : skill))
    setManagerSkillsDirty(true)
    setManagerSkillsSaved(false)
  }, [])

  const addManagerSkill = useCallback(() => {
    setManagerSkills((current) => [
      ...current,
      { id: randomId(), name: '新管理技能', description: '', body: '' },
    ])
    setManagerSkillsDirty(true)
    setManagerSkillsSaved(false)
  }, [])

  const removeManagerSkill = useCallback(async (skill: SkillManagerSkill) => {
    const ok = await confirm({
      title: '删除管理技能',
      message: `删除管理技能「${skill.name || '未命名'}」？保存后技能库智能体将无法再加载它。`,
      confirmText: '删除',
      variant: 'danger',
    })
    if (!ok) return
    setManagerSkills((current) => current.filter((item) => item.id !== skill.id))
    setManagerSkillsDirty(true)
    setManagerSkillsSaved(false)
  }, [confirm])

  const persistManagerSkills = useCallback(async () => {
    setManagerSkillsSaving(true)
    setError(null)
    try {
      const saved = await saveSkillManagerSkills(managerSkills)
      setManagerSkills(saved)
      setManagerSkillsDirty(false)
      setManagerSkillsSaved(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存技能库管理技能失败')
    } finally {
      setManagerSkillsSaving(false)
    }
  }, [managerSkills])

  const restoreManagerSkills = useCallback(async () => {
    const ok = await confirm({
      title: '恢复默认管理技能',
      message: '恢复内置的“创建技能”和“整理技能”？当前管理技能覆盖会被清除。',
      confirmText: '恢复默认',
      variant: 'warning',
    })
    if (!ok) return
    setManagerSkillsSaving(true)
    setError(null)
    try {
      const defaults = await resetSkillManagerSkills()
      setManagerSkills(defaults)
      setManagerSkillsDirty(false)
      setManagerSkillsSaved(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '恢复默认管理技能失败')
    } finally {
      setManagerSkillsSaving(false)
    }
  }, [confirm])

  const handleBack = useCallback(async () => {
    await flushPrompt().catch(() => undefined)
    if (managerSkillsDirty) {
      const leave = await confirm({
        title: '管理技能尚未保存',
        message: '当前修改尚未保存，仍要返回首页吗？',
        confirmText: '放弃修改',
        variant: 'warning',
      })
      if (!leave) return
    }
    navigate('/')
  }, [confirm, flushPrompt, managerSkillsDirty, navigate])

  const managerStatus = managerSkillsSaving ? 'saving' : managerSkillsSaved ? 'saved' : 'idle'

  return (
    <div className="workspace-settings-page">
      <header className="workspace-settings-header">
        <button type="button" className="workspace-settings-back" onClick={() => void handleBack()}>← 返回首页</button>
        <div className="workspace-settings-title-block">
          <h1>技能库设置</h1>
          <p>配置技能库管理智能体提示词，以及智能体可按需加载的管理技能。</p>
          <span className={`workspace-settings-save-state workspace-settings-save-state--${settingsMode === 'skills' ? managerStatus : statusFor(activePromptKey)}`} aria-live="polite">
            {settingsMode === 'skills'
              ? managerSkillsSaving ? '保存中…' : managerSkillsSaved ? '已保存' : managerSkillsDirty ? '未保存' : ''
              : autoSaveStatusLabel(statusFor(activePromptKey))}
          </span>
        </div>
      </header>
      {dialog}
      {error ? <p className="workspace-settings-error">{error}</p> : null}
      <div className="workspace-settings-type-switch" role="tablist" aria-label="技能库设置类型">
        <button type="button" role="tab" aria-selected={settingsMode === 'prompt'} className={settingsMode === 'prompt' ? 'workspace-settings-type-btn workspace-settings-type-btn--active' : 'workspace-settings-type-btn'} onClick={() => setSettingsMode('prompt')}>智能体提示词</button>
        <button type="button" role="tab" aria-selected={settingsMode === 'skills'} className={settingsMode === 'skills' ? 'workspace-settings-type-btn workspace-settings-type-btn--active' : 'workspace-settings-type-btn'} onClick={() => setSettingsMode('skills')}>技能库技能管理</button>
        {settingsMode === 'prompt' ? SKILL_SETTING_TYPES.map((type) => (
          <button key={type} type="button" role="tab" aria-selected={skillType === type} className={skillType === type ? 'workspace-settings-type-btn workspace-settings-type-btn--active' : 'workspace-settings-type-btn'} onClick={() => void switchSkillType(type)}>{skillTypeLabel(type)}</button>
        )) : null}
        {settingsMode === 'prompt' ? SKILL_PROMPT_SLOTS.map((slot) => (
          <button key={slot.kind} type="button" role="tab" aria-selected={promptKind === slot.kind} className={promptKind === slot.kind ? 'workspace-settings-type-btn workspace-settings-type-btn--active' : 'workspace-settings-type-btn'} onClick={() => void switchPromptKind(slot.kind)}>{slot.label}</button>
        )) : null}
      </div>
      <main className="workspace-settings-content">
        {settingsMode === 'skills' ? (
          managerSkillsLoading ? <div className="workspace-settings-loading">加载管理技能中…</div> : (
            <section className="common-skills-panel">
              <div className="workspace-settings-content-head">
                <div><span>全局共享</span><h2>技能库管理技能</h2><p>短篇、长篇和剧本技能库智能体共用。名称用于 load_skill 精确加载，描述用于判断加载时机。</p></div>
                <div className="workspace-settings-head-actions">
                  <button type="button" onClick={addManagerSkill}>+ 添加技能</button>
                  <button type="button" disabled={managerSkillsSaving} onClick={() => void restoreManagerSkills()}>恢复默认</button>
                  <button type="button" disabled={managerSkillsSaving || !managerSkillsDirty} onClick={() => void persistManagerSkills()}>{managerSkillsSaving ? '保存中…' : '保存配置'}</button>
                </div>
              </div>
              {managerSkills.length === 0 ? <div className="common-skills-empty">暂无管理技能。可添加新技能，或恢复默认的“创建技能”和“整理技能”。</div> : (
                <div className="common-skills-list">
                  {managerSkills.map((skill) => (
                    <article className="common-skill-card" key={skill.id}>
                      <div className="common-skill-card-head"><strong>{skill.name || '未命名管理技能'}</strong><button type="button" onClick={() => void removeManagerSkill(skill)}>删除</button></div>
                      <label>技能名称<input type="text" value={skill.name} onChange={(event) => updateManagerSkill(skill.id, { name: event.target.value })} /></label>
                      <label>适用描述<textarea className="manager-skill-description" value={skill.description} onChange={(event) => updateManagerSkill(skill.id, { description: event.target.value })} /></label>
                      <label>完整指令正文<textarea className="manager-skill-body" spellCheck={false} value={skill.body} onChange={(event) => updateManagerSkill(skill.id, { body: event.target.value })} /></label>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )
        ) : loading ? <div className="workspace-settings-loading">加载设置中…</div> : (
          <>
            <div className="workspace-settings-content-head">
              <div><span>技能库</span><h2>{skillTypeLabel(skillType)} {' · '}{SKILL_PROMPT_SLOTS.find((slot) => slot.kind === promptKind)?.label ?? '整体管理'}</h2></div>
              <div className="workspace-settings-head-actions"><button type="button" onClick={() => void resetPrompt()}>恢复默认提示词</button></div>
            </div>
            <div className="workspace-settings-grid workspace-settings-grid--single">
              <section className="workspace-settings-prompt-card">
                <div className="workspace-settings-section-title"><h3>系统提示词</h3><p>停止输入 1 秒后自动保存，持续输入最长 5 秒落盘一次。</p></div>
                <p className="workspace-settings-placeholder-hint">可用占位符：<code>{PLACEHOLDER_HINT}</code></p>
                <textarea value={promptDraft} spellCheck={false} onBlur={() => void flushPrompt().catch(() => undefined)} onChange={(event) => textHistory.change(`skill-settings:${activePromptKey}`, promptDraft, event.target.value, (value) => { promptDraftRef.current = value; promptValuesByKeyRef.current[activePromptKey] = value; setPromptDraft(value); schedule(activePromptKey) })} onKeyDown={(event) => textHistory.handleKeyDown(event, `skill-settings:${activePromptKey}`, promptDraft, (value) => { promptDraftRef.current = value; promptValuesByKeyRef.current[activePromptKey] = value; setPromptDraft(value); schedule(activePromptKey) }, { redoKey: 'm', standardRedo: false })} />
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
