import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MATERIAL_KIND_LABELS,
  type MaterialKind,
  materialTypeLabel,
  readMaterialKindPromptTemplateForType,
  readMaterialAgentPromptTemplateForType,
  resetMaterialKindPromptOverride,
  resetMaterialAgentPromptOverride,
  saveMaterialKindPromptOverride,
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
const MATERIAL_PROMPT_SLOTS: Array<{ id: 'manager' | MaterialKind; label: string }> = [
  { id: 'manager', label: '整体' },
  { id: 'character', label: '人设' },
  { id: 'gimmick', label: '梗' },
  { id: 'plot', label: '剧情' },
  { id: 'draft', label: '正文' },
  { id: 'other', label: '其他' },
]

const PLACEHOLDER_HINT =
  '{{MATERIAL_TITLE}}  {{MATERIAL_LINE}}  {{MATERIAL_TYPE}}  {{MATERIAL_GENRE}}  {{MATERIAL_KIND}}  {{MATERIAL_KIND_LABEL}}  {{MATERIAL_OVERVIEW}}  {{CURRENT_ENTRY_TITLE}}  {{STAGE_ID}}  {{STAGE_LABEL}}  {{STAGE_BODY}}  {{OTHER_STAGES_EXCERPT}}'

type MaterialPromptSlot = (typeof MATERIAL_PROMPT_SLOTS)[number]['id']

function promptKey(materialType: MaterialType, slot: MaterialPromptSlot): string {
  return `${materialType}:${slot}`
}

function splitPromptKey(key: string): { materialType: MaterialType; slot: MaterialPromptSlot } {
  const [materialTypeRaw, slotRaw] = key.split(':')
  const materialType = MATERIAL_SETTING_TYPES.includes(materialTypeRaw as MaterialType)
    ? materialTypeRaw as MaterialType
    : 'short'
  const slot = MATERIAL_PROMPT_SLOTS.some((item) => item.id === slotRaw)
    ? slotRaw as MaterialPromptSlot
    : 'manager'
  return { materialType, slot }
}

function slotLabel(slot: MaterialPromptSlot): string {
  if (slot === 'manager') return '整体提示词'
  return `${MATERIAL_KIND_LABELS[slot]}提示词`
}

export function MaterialSettings() {
  const navigate = useNavigate()
  const { confirm, dialog } = useAppDialog()
  const [materialType, setMaterialType] = useState<MaterialType>('short')
  const [promptSlot, setPromptSlot] = useState<MaterialPromptSlot>('manager')
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
      try {
        const parsed = splitPromptKey(key)
        if (parsed.slot === 'manager') {
          await saveMaterialAgentPromptOverride(value, parsed.materialType)
        } else {
          await saveMaterialKindPromptOverride(value, parsed.materialType, parsed.slot)
        }
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

  const activePromptKey = promptKey(materialType, promptSlot)
  const historyKey = `material-settings:${activePromptKey}`

  const flushPrompt = useCallback((): Promise<void> => {
    return flushMaterialPrompt(activePromptKey).then(() => undefined)
  }, [activePromptKey, flushMaterialPrompt])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const prompt = promptSlot === 'manager'
          ? await readMaterialAgentPromptTemplateForType(materialType)
          : await readMaterialKindPromptTemplateForType(materialType, promptSlot)
        if (cancelled) return
        promptDraftRef.current = prompt
        promptValuesByKeyRef.current[activePromptKey] = prompt
        savedPromptRef.current = prompt
        setPromptDraft(prompt)
        textHistory.clear(historyKey, prompt)
        markMaterialPromptSaved(activePromptKey)
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
      if (promptDraftRef.current !== savedPromptRef.current) void flushMaterialPrompt(activePromptKey)
    }
  }, [
    activePromptKey,
    flushMaterialPrompt,
    historyKey,
    markMaterialPromptSaved,
    materialType,
    promptSlot,
    textHistory,
  ])

  const switchMaterialType = useCallback(
    async (next: MaterialType) => {
      if (next === materialType) return
      await flushPrompt().catch(() => undefined)
      setMaterialType(next)
      setPromptDraft('')
    },
    [flushPrompt, materialType],
  )

  const switchPromptSlot = useCallback(
    async (next: MaterialPromptSlot) => {
      if (next === promptSlot) return
      await flushPrompt().catch(() => undefined)
      setPromptSlot(next)
      setPromptDraft('')
    },
    [flushPrompt, promptSlot],
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
      if (promptSlot === 'manager') {
        await resetMaterialAgentPromptOverride(materialType)
      } else {
        await resetMaterialKindPromptOverride(materialType, promptSlot)
      }
      const value = promptSlot === 'manager'
        ? await readMaterialAgentPromptTemplateForType(materialType)
        : await readMaterialKindPromptTemplateForType(materialType, promptSlot)
      savedPromptRef.current = value
      promptDraftRef.current = value
      promptValuesByKeyRef.current[activePromptKey] = value
      setPromptDraft(value)
      textHistory.record(
        historyKey,
        promptDraft,
        value,
        'atomic',
      )
      markMaterialPromptSaved(activePromptKey)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '恢复默认提示词失败')
    }
  }, [
    confirm,
    activePromptKey,
    flushPrompt,
    historyKey,
    markMaterialPromptSaved,
    materialType,
    promptSlot,
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
          <p>短篇、长篇与剧本素材库分别保存整体提示词和素材部门提示词。</p>
          <span
            className={`workspace-settings-save-state workspace-settings-save-state--${materialPromptStatus(activePromptKey)}`}
            aria-live="polite"
          >
            {autoSaveStatusLabel(materialPromptStatus(activePromptKey))}
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

      <div className="workspace-settings-type-switch" role="tablist" aria-label="提示词槽位">
        {MATERIAL_PROMPT_SLOTS.map((slot) => (
          <button
            key={slot.id}
            type="button"
            role="tab"
            aria-selected={promptSlot === slot.id}
            className={
              promptSlot === slot.id
                ? 'workspace-settings-type-btn workspace-settings-type-btn--active'
                : 'workspace-settings-type-btn'
            }
            onClick={() => void switchPromptSlot(slot.id)}
          >
            {slot.label}
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
                <h2>{materialTypeLabel(materialType)} · {slotLabel(promptSlot)}</h2>
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
                      historyKey,
                      promptDraft,
                      event.target.value,
                      (value) => {
                        promptDraftRef.current = value
                        promptValuesByKeyRef.current[activePromptKey] = value
                        setPromptDraft(value)
                        scheduleMaterialPromptSave(activePromptKey)
                      },
                    )
                  }}
                  onKeyDown={(event) =>
                    textHistory.handleKeyDown(
                      event,
                      historyKey,
                      promptDraft,
                      (value) => {
                        promptDraftRef.current = value
                        promptValuesByKeyRef.current[activePromptKey] = value
                        setPromptDraft(value)
                        scheduleMaterialPromptSave(activePromptKey)
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
