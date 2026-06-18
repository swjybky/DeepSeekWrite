import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  readSkillAgentPromptTemplateForType,
  resetSkillAgentPromptOverride,
  saveSkillAgentPromptOverride,
  skillTypeLabel,
  type SkillType,
} from '../bridge'
import {
  autoSaveStatusLabel,
  useKeyedAutoSave,
} from '../hooks/useKeyedAutoSave'
import { useTextHistory } from '../hooks/useTextHistory'
import './WorkspaceSettings.css'

const SKILL_SETTING_TYPES: SkillType[] = ['short', 'long', 'script']

const PLACEHOLDER_HINT =
  '{{SKILL_TITLE}}  {{SKILL_LINE}}  {{SKILL_TYPE}}  {{STAGE_ID}}  {{STAGE_LABEL}}  {{STAGE_BODY}}  {{OTHER_STAGES_EXCERPT}}'

export function SkillSettings() {
  const navigate = useNavigate()
  const [skillType, setSkillType] = useState<SkillType>('short')
  const [promptDraft, setPromptDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const promptDraftRef = useRef(promptDraft)
  const savedPromptRef = useRef('')
  const promptValuesByTypeRef = useRef<Partial<Record<SkillType, string>>>({})
  const textHistory = useTextHistory()
  const autoSave = useKeyedAutoSave<string>({
    getSnapshot: (key) => promptValuesByTypeRef.current[key as SkillType] ?? null,
    saveSnapshot: async (key, value) => {
      try {
        await saveSkillAgentPromptOverride(value, key as SkillType)
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

  const flushPrompt = useCallback((): Promise<void> => {
    return flushSkillPrompt(skillType).then(() => undefined)
  }, [flushSkillPrompt, skillType])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const prompt = await readSkillAgentPromptTemplateForType(skillType)
        if (cancelled) return
        promptDraftRef.current = prompt
        promptValuesByTypeRef.current[skillType] = prompt
        savedPromptRef.current = prompt
        setPromptDraft(prompt)
        textHistory.clear(`skill-settings:${skillType}`, prompt)
        markSkillPromptSaved(skillType)
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
      if (promptDraftRef.current !== savedPromptRef.current) void flushSkillPrompt(skillType)
    }
  }, [flushSkillPrompt, markSkillPromptSaved, skillType, textHistory])

  const switchSkillType = useCallback(
    async (next: SkillType) => {
      if (next === skillType) return
      await flushPrompt().catch(() => undefined)
      setSkillType(next)
      setPromptDraft('')
    },
    [flushPrompt, skillType],
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
    if (!window.confirm('恢复技能库管理智能体的内置默认提示词？')) {
      return
    }
    await flushPrompt().catch(() => undefined)
    try {
      await resetSkillAgentPromptOverride(skillType)
      const value = await readSkillAgentPromptTemplateForType(skillType)
      savedPromptRef.current = value
      promptDraftRef.current = value
      promptValuesByTypeRef.current[skillType] = value
      setPromptDraft(value)
      textHistory.record(
        `skill-settings:${skillType}`,
        promptDraft,
        value,
        'atomic',
      )
      markSkillPromptSaved(skillType)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '恢复默认提示词失败')
    }
  }, [flushPrompt, markSkillPromptSaved, promptDraft, skillType, textHistory])

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
          <h1>技能库智能体设置</h1>
          <p>短篇、长篇与剧本技能库分别保存管理智能体提示词。</p>
        </div>
        <span
          className={`workspace-settings-save-state workspace-settings-save-state--${skillPromptStatus(skillType)}`}
          aria-live="polite"
        >
          {autoSaveStatusLabel(skillPromptStatus(skillType))}
        </span>
      </header>

      {error ? <p className="workspace-settings-error">{error}</p> : null}

      <div className="workspace-settings-type-switch" role="tablist" aria-label="技能类型">
        {SKILL_SETTING_TYPES.map((type) => (
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
        ))}
      </div>

      <main className="workspace-settings-content">
        {loading ? (
          <div className="workspace-settings-loading">加载设置中…</div>
        ) : (
          <>
            <div className="workspace-settings-content-head">
              <div>
                <span>技能库</span>
                <h2>{skillTypeLabel(skillType)}管理智能体</h2>
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
                      `skill-settings:${skillType}`,
                      promptDraft,
                      event.target.value,
                      (value) => {
                        promptDraftRef.current = value
                        promptValuesByTypeRef.current[skillType] = value
                        setPromptDraft(value)
                        scheduleSkillPromptSave(skillType)
                      },
                    )
                  }}
                  onKeyDown={(event) =>
                    textHistory.handleKeyDown(
                      event,
                      `skill-settings:${skillType}`,
                      promptDraft,
                      (value) => {
                        promptDraftRef.current = value
                        promptValuesByTypeRef.current[skillType] = value
                        setPromptDraft(value)
                        scheduleSkillPromptSave(skillType)
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
