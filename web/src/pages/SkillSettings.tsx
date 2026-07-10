import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  SKILL_KIND_KEYS,
  SKILL_KIND_LABELS,
  SKILL_MANAGER_PROMPT_KIND,
  readSkillAgentPromptTemplateForType,
  readSkillPromptTemplateForType,
  resetSkillAgentPromptOverride,
  saveSkillAgentPromptOverride,
  skillKindPromptKind,
  skillTypeLabel,
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

export function SkillSettings() {
  const navigate = useNavigate()
  const { confirm, dialog } = useAppDialog()
  const [skillType, setSkillType] = useState<SkillType>('short')
  const [promptKind, setPromptKind] = useState<SkillPromptKind>(SKILL_MANAGER_PROMPT_KIND)
  const [promptDraft, setPromptDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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

  return (
    <div className="workspace-settings-page">
      <header className="workspace-settings-header">
        <button type="button" className="workspace-settings-back" onClick={() => void flushPrompt().then(() => navigate('/'))}>← 返回首页</button>
        <div className="workspace-settings-title-block">
          <h1>技能库设置</h1>
          <p>配置技能库管理智能体提示词。官方内置通用技能库为只读系统库。</p>
          <span className={`workspace-settings-save-state workspace-settings-save-state--${statusFor(activePromptKey)}`} aria-live="polite">
            {autoSaveStatusLabel(statusFor(activePromptKey))}
          </span>
        </div>
      </header>
      {dialog}
      {error ? <p className="workspace-settings-error">{error}</p> : null}
      <div className="workspace-settings-type-switch" role="tablist" aria-label="技能库智能体设置">
        {SKILL_SETTING_TYPES.map((type) => (
          <button key={type} type="button" role="tab" aria-selected={skillType === type} className={skillType === type ? 'workspace-settings-type-btn workspace-settings-type-btn--active' : 'workspace-settings-type-btn'} onClick={() => void switchSkillType(type)}>{skillTypeLabel(type)}</button>
        ))}
        {SKILL_PROMPT_SLOTS.map((slot) => (
          <button key={slot.kind} type="button" role="tab" aria-selected={promptKind === slot.kind} className={promptKind === slot.kind ? 'workspace-settings-type-btn workspace-settings-type-btn--active' : 'workspace-settings-type-btn'} onClick={() => void switchPromptKind(slot.kind)}>{slot.label}</button>
        ))}
      </div>
      <main className="workspace-settings-content">
        {loading ? <div className="workspace-settings-loading">加载设置中…</div> : (
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
