import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  materialTypeLabel,
  readMaterialAgentPromptTemplateForType,
  resetMaterialAgentPromptOverride,
  saveMaterialAgentPromptOverride,
  type MaterialType,
} from '../bridge'
import {
  autoSaveStatusLabel,
  useKeyedAutoSave,
} from '../hooks/useKeyedAutoSave'
import { useTextHistory } from '../hooks/useTextHistory'
import { useAppDialog } from '../components/useAppDialog'
import './WorkspaceSettings.css'

const MATERIAL_SETTING_TYPES: MaterialType[] = ['short', 'long', 'script']

const PLACEHOLDER_HINT =
  '{{MATERIAL_TITLE}}  {{MATERIAL_LINE}}  {{MATERIAL_TYPE}}  {{MATERIAL_GENRE}}  {{STAGE_ID}}  {{STAGE_LABEL}}  {{STAGE_BODY}}  {{OTHER_STAGES_EXCERPT}}'

export function MaterialSettings() {
  const navigate = useNavigate()
  const { confirm, dialog } = useAppDialog()
  const [materialType, setMaterialType] = useState<MaterialType>('short')
  const [promptDraft, setPromptDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const promptDraftRef = useRef(promptDraft)
  const savedPromptRef = useRef('')
  const promptValuesByTypeRef = useRef<Partial<Record<MaterialType, string>>>({})
  const textHistory = useTextHistory()
  const autoSave = useKeyedAutoSave<string>({
    getSnapshot: (key) => promptValuesByTypeRef.current[key as MaterialType] ?? null,
    saveSnapshot: async (key, value) => {
      try {
        await saveMaterialAgentPromptOverride(value, key as MaterialType)
        savedPromptRef.current = value
        setError(null)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '保存素材库智能体设置失败')
        throw cause
      }
    },
  })
  const {
    flush: flushMaterialPrompt,
    markSaved: markMaterialPromptSaved,
    schedule: scheduleMaterialPromptSave,
    statusFor: materialPromptStatus,
  } = autoSave

  useEffect(() => {
    promptDraftRef.current = promptDraft
  }, [promptDraft])

  const flushPrompt = useCallback((): Promise<void> => {
    return flushMaterialPrompt(materialType).then(() => undefined)
  }, [flushMaterialPrompt, materialType])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const prompt = await readMaterialAgentPromptTemplateForType(materialType)
        if (cancelled) return
        promptDraftRef.current = prompt
        promptValuesByTypeRef.current[materialType] = prompt
        savedPromptRef.current = prompt
        setPromptDraft(prompt)
        textHistory.clear(`material-settings:${materialType}`, prompt)
        markMaterialPromptSaved(materialType)
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : '加载素材库智能体设置失败')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      if (promptDraftRef.current !== savedPromptRef.current) void flushMaterialPrompt(materialType)
    }
  }, [flushMaterialPrompt, markMaterialPromptSaved, materialType, textHistory])

  const switchMaterialType = useCallback(
    async (next: MaterialType) => {
      if (next === materialType) return
      await flushPrompt().catch(() => undefined)
      setMaterialType(next)
      setPromptDraft('')
    },
    [flushPrompt, materialType],
  )

  const handleBack = useCallback(async () => {
    try {
      await flushPrompt()
      navigate('/')
    } catch {
      setError('保存素材库智能体设置失败')
    }
  }, [flushPrompt, navigate])

  const resetPrompt = useCallback(async () => {
    const ok = await confirm({
      title: '恢复默认提示词',
      message: '恢复素材库管理智能体的内置默认提示词？当前提示词覆盖会被清除。',
      confirmText: '恢复默认',
      variant: 'warning',
    })
    if (!ok) {
      return
    }
    await flushPrompt().catch(() => undefined)
    try {
      await resetMaterialAgentPromptOverride(materialType)
      const value = await readMaterialAgentPromptTemplateForType(materialType)
      savedPromptRef.current = value
      promptDraftRef.current = value
      promptValuesByTypeRef.current[materialType] = value
      setPromptDraft(value)
      textHistory.record(
        `material-settings:${materialType}`,
        promptDraft,
        value,
        'atomic',
      )
      markMaterialPromptSaved(materialType)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '恢复默认提示词失败')
    }
  }, [
    confirm,
    flushPrompt,
    markMaterialPromptSaved,
    materialType,
    promptDraft,
    textHistory,
  ])

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
          <h1>素材库智能体设置</h1>
          <p>短篇、长篇与剧本素材库分别保存管理智能体提示词。</p>
          <span
            className={`workspace-settings-save-state workspace-settings-save-state--${materialPromptStatus(materialType)}`}
            aria-live="polite"
          >
            {autoSaveStatusLabel(materialPromptStatus(materialType))}
          </span>
        </div>
      </header>

      {dialog}

      {error ? <p className="workspace-settings-error">{error}</p> : null}

      <div className="workspace-settings-type-switch" role="tablist" aria-label="素材类型">
        {MATERIAL_SETTING_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            role="tab"
            aria-selected={materialType === type}
            className={
              materialType === type
                ? 'workspace-settings-type-btn workspace-settings-type-btn--active'
                : 'workspace-settings-type-btn'
            }
            onClick={() => void switchMaterialType(type)}
          >
            {materialTypeLabel(type)}
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
                <span>素材库</span>
                <h2>{materialTypeLabel(materialType)}库管理智能体</h2>
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
                      `material-settings:${materialType}`,
                      promptDraft,
                      event.target.value,
                      (value) => {
                        promptDraftRef.current = value
                        promptValuesByTypeRef.current[materialType] = value
                        setPromptDraft(value)
                        scheduleMaterialPromptSave(materialType)
                      },
                    )
                  }}
                  onKeyDown={(event) =>
                    textHistory.handleKeyDown(
                      event,
                      `material-settings:${materialType}`,
                      promptDraft,
                      (value) => {
                        promptDraftRef.current = value
                        promptValuesByTypeRef.current[materialType] = value
                        setPromptDraft(value)
                        scheduleMaterialPromptSave(materialType)
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
