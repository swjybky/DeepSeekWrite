import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  readSkillAgentPromptTemplateForType,
  resetSkillAgentPromptOverride,
  saveSkillAgentPromptOverride,
  skillTypeLabel,
  type SkillType,
} from '../bridge'
import './WorkspaceSettings.css'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
const SKILL_SETTING_TYPES: SkillType[] = ['short', 'long', 'script']

const PLACEHOLDER_HINT =
  '{{SKILL_TITLE}}  {{SKILL_LINE}}  {{SKILL_TYPE}}  {{STAGE_ID}}  {{STAGE_LABEL}}  {{STAGE_BODY}}  {{OTHER_STAGES_EXCERPT}}'

function statusLabel(status: SaveStatus): string {
  if (status === 'saving') return '保存中…'
  if (status === 'saved') return '已保存'
  if (status === 'error') return '保存失败'
  return '自动保存'
}

export function SkillSettings() {
  const navigate = useNavigate()
  const [skillType, setSkillType] = useState<SkillType>('short')
  const [promptDraft, setPromptDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  const promptDraftRef = useRef(promptDraft)
  const savedPromptRef = useRef('')
  const promptTimerRef = useRef<number | undefined>(undefined)
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const operationSeqRef = useRef(0)

  useEffect(() => {
    promptDraftRef.current = promptDraft
  }, [promptDraft])

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
            setError(cause instanceof Error ? cause.message : '保存技能库智能体设置失败')
          }
        },
      )
      return task
    },
    [],
  )

  const savePromptValue = useCallback(
    async (value: string): Promise<void> => {
      if (savedPromptRef.current === value) return
      await enqueueSave(async () => {
        await saveSkillAgentPromptOverride(value, skillType)
        savedPromptRef.current = value
      })
    },
    [enqueueSave, skillType],
  )

  const flushPrompt = useCallback((): Promise<void> => {
    if (promptTimerRef.current !== undefined) {
      window.clearTimeout(promptTimerRef.current)
      promptTimerRef.current = undefined
    }
    return savePromptValue(promptDraftRef.current)
  }, [savePromptValue])

  const schedulePromptSave = useCallback(
    (value: string) => {
      if (promptTimerRef.current !== undefined) {
        window.clearTimeout(promptTimerRef.current)
      }
      promptTimerRef.current = window.setTimeout(() => {
        promptTimerRef.current = undefined
        void savePromptValue(value).catch(() => undefined)
      }, 500)
    },
    [savePromptValue],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const prompt = await readSkillAgentPromptTemplateForType(skillType)
        if (cancelled) return
        promptDraftRef.current = prompt
        savedPromptRef.current = prompt
        setPromptDraft(prompt)
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
      if (promptTimerRef.current !== undefined) {
        window.clearTimeout(promptTimerRef.current)
      }
      if (promptDraftRef.current !== savedPromptRef.current) {
        void savePromptValue(promptDraftRef.current).catch(() => undefined)
      }
    }
  }, [savePromptValue, skillType])

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
      await saveQueueRef.current
      navigate('/')
    } catch {
      setSaveStatus('error')
    }
  }, [flushPrompt, navigate])

  const resetPrompt = useCallback(async () => {
    if (!window.confirm('恢复技能库管理智能体的内置默认提示词？')) {
      return
    }
    if (promptTimerRef.current !== undefined) {
      window.clearTimeout(promptTimerRef.current)
      promptTimerRef.current = undefined
    }
    await enqueueSave(async () => {
      await resetSkillAgentPromptOverride(skillType)
      const value = await readSkillAgentPromptTemplateForType(skillType)
      savedPromptRef.current = value
      promptDraftRef.current = value
      setPromptDraft(value)
    }).catch(() => undefined)
  }, [enqueueSave, skillType])

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
          className={`workspace-settings-save-state workspace-settings-save-state--${saveStatus}`}
          aria-live="polite"
        >
          {statusLabel(saveStatus)}
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
                  <p>停止输入 500ms 后自动保存，返回首页前会立即刷新。</p>
                </div>
                <p className="workspace-settings-placeholder-hint">
                  可用占位符：<code>{PLACEHOLDER_HINT}</code>
                </p>
                <textarea
                  value={promptDraft}
                  spellCheck={false}
                  onBlur={() => void flushPrompt().catch(() => undefined)}
                  onChange={(event) => {
                    const value = event.target.value
                    promptDraftRef.current = value
                    setPromptDraft(value)
                    schedulePromptSave(value)
                  }}
                />
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
