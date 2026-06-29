import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  SHORT_GENRE_OPTIONS,
  SCRIPT_GENRE_OPTIONS,
  type AppearanceStyle,
  type AiModelConfig,
  type AiModelSettings,
  type BookSummary,
  type BookType,
  type MemoryEntry,
  type MaterialSummary,
  type MaterialType,
  type SkillSummary,
  type SkillType,
  type TextDisplayMode,
  type UpdateCheckResult,
  bookTypeLabel,
  createBook,
  createSkill,
  deleteBook,
  deleteSkill,
  exportBook,
  getBookCovers,
  getAiModelConfig,
  getStoredWorkspaceRoot,
  isBuiltinFreeTextModel,
  isPywebviewDesktopBundle,
  listBooks,
  listSkills,
  loadPersistedWorkspaceRoot,
  persistWorkspaceRoot,
  pickFolder,
  listMaterials,
  createMaterial,
  deleteMaterial,
  normalizeAiModelSettings,
  saveAiModelConfig,
  checkForUpdate,
  getMaterialParentGenres,
  getUserMemories,
  materialTypeLabel,
  saveUserMemories,
  skillTypeLabel,
  TEXT_MODEL_API_KEY_PLACEHOLDER,
  exportLibrary,
  importBook,
  importLibrary,
} from '../bridge'
import { APPEARANCE_STYLE_LABELS, useAppearance } from '../appearance'
import { CardGrid, bookToCardItem, materialToCardItem, skillToCardItem } from '../components/CardGrid'
import { MemoryManagerDialog } from '../components/MemoryManagerDialog'
import { useAppDialog } from '../components/useAppDialog'
import { LearningImitationDialog } from '../features/learningImitation/LearningImitationDialog'
import {
  startBackgroundUpdate,
  useBackgroundUpdate,
} from '../features/update/backgroundUpdate'
import { refreshPreferredWorkspaceChatModel } from '../pi/workspaceChatPreferences'
import { useHomeStore } from '../stores/homeStore'
import { TEXT_DISPLAY_MODE_LABELS, useTextDisplay } from '../textDisplay'
import './Home.css'

function truncatePath(path: string, max = 42): string {
  if (path.length <= max) return path
  const head = Math.floor(max / 2) - 1
  const tail = max - head - 1
  return `${path.slice(0, head)}…${path.slice(-tail)}`
}

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      className={spinning ? 'refresh-icon refresh-icon--spinning' : 'refresh-icon'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  )
}

function emptyAiModelSettings(): AiModelSettings {
  return {
    text: {
      models: [],
      default_model_id: '',
    },
    image: null,
  }
}

function defaultTextModelLabel(settings: AiModelSettings | null): string {
  const models = settings?.text.models ?? []
  if (!models.length) return '未配置'
  const active =
    models.find((model) => model.id === settings?.text.default_model_id) ?? models[0]
  return active.label || active.model_id || active.id
}

function imageModelLabel(settings: AiModelSettings | null): string {
  return settings?.image?.model || '未配置'
}

function createDraftModel(index: number): AiModelConfig {
  return {
    id: `model_${index}`,
    label: '',
    provider: '',
    model_id: '',
    api_key: '',
  }
}

function createAvailableDraftModel(models: AiModelConfig[]): AiModelConfig {
  const ids = new Set(models.map((model) => model.id))
  let index = models.length + 1
  while (ids.has(`model_${index}`)) index += 1
  return createDraftModel(index)
}

type OfficialTextModelPreset = Omit<AiModelConfig, 'api_key'>

type ModelEditorState = {
  mode: 'official' | 'custom'
  draft: AiModelConfig
  preset?: OfficialTextModelPreset
  error: string | null
}

const OFFICIAL_TEXT_MODEL_PRESETS: OfficialTextModelPreset[] = [
  {
    id: 'deepseekflash',
    label: 'Deepseek Flash',
    provider: 'deepseek',
    model_id: 'deepseek-v4-flash',
  },
  {
    id: 'deepseek_pro',
    label: 'DeepSeek V4 Pro',
    provider: 'deepseek',
    model_id: 'deepseek-v4-pro',
  },
]

function getOfficialTextModelPreset(
  model: Pick<AiModelConfig, 'id'>,
): OfficialTextModelPreset | undefined {
  return OFFICIAL_TEXT_MODEL_PRESETS.find((preset) => preset.id === model.id.trim())
}

function cloneAiSettings(settings: AiModelSettings | null): AiModelSettings {
  const normalized = normalizeAiModelSettings(settings ?? emptyAiModelSettings())
  return {
    text: {
      default_model_id: normalized.text.default_model_id,
      models: normalized.text.models.map((model) => ({ ...model })),
    },
    image: normalized.image ? { ...normalized.image } : null,
  }
}

type ModelConfigDialogProps = {
  initialSettings: AiModelSettings
  saving: boolean
  onClose: () => void
  onSave: (settings: AiModelSettings) => Promise<void>
  onRefresh: () => Promise<AiModelSettings>
}

type RefreshOptions = {
  showLoading?: boolean
}

function ModelConfigDialog({
  initialSettings,
  saving,
  onClose,
  onSave,
  onRefresh,
}: ModelConfigDialogProps) {
  const [draft, setDraft] = useState<AiModelSettings>(() =>
    cloneAiSettings(initialSettings),
  )
  const [error, setError] = useState<string | null>(null)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [modelEditor, setModelEditor] = useState<ModelEditorState | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      const settings = await onRefresh()
      setDraft(cloneAiSettings(settings))
    } catch (e) {
      setError(e instanceof Error ? e.message : '刷新模型配置失败')
    } finally {
      setRefreshing(false)
    }
  }, [onRefresh])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (cancelled) return
      void handleRefresh()
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [handleRefresh])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        event.preventDefault()
        if (modelEditor) {
          setModelEditor(null)
        } else if (modelPickerOpen) {
          setModelPickerOpen(false)
        } else {
          onClose()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [modelEditor, modelPickerOpen, onClose, saving])

  const updateModel = useCallback(
    (index: number, patch: Partial<AiModelConfig>) => {
      setDraft((prev) => {
        const previous = prev.text.models[index]
        const models = prev.text.models.map((model, i) =>
          i === index ? { ...model, ...patch } : model,
        )
        const default_model_id =
          patch.id != null && previous?.id === prev.text.default_model_id
            ? patch.id
            : prev.text.default_model_id
        return {
          ...prev,
          text: {
            ...prev.text,
            models,
            default_model_id,
          },
        }
      })
    },
    [],
  )

  const appendModel = useCallback((next: AiModelConfig) => {
    setDraft((prev) => {
      if (prev.text.models.some((model) => model.id === next.id)) {
        return prev
      }
      const models = [...prev.text.models, next]
      return {
        ...prev,
        text: {
          models,
          default_model_id: prev.text.default_model_id || next.id,
        },
      }
    })
    setError(null)
  }, [])

  const openModelEditor = useCallback(
    (preset?: OfficialTextModelPreset) => {
      const draftModel = preset
        ? { ...preset, api_key: '' }
        : createAvailableDraftModel(draft.text.models)
      setModelEditor({
        mode: preset ? 'official' : 'custom',
        draft: draftModel,
        preset,
        error: null,
      })
      setModelPickerOpen(false)
      setError(null)
    },
    [draft.text.models],
  )

  const updateModelEditor = useCallback((patch: Partial<AiModelConfig>) => {
    setModelEditor((prev) =>
      prev
        ? {
            ...prev,
            draft: { ...prev.draft, ...patch },
            error: null,
          }
        : prev,
    )
  }, [])

  const submitModelEditor = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!modelEditor) return

      const existingIds = new Set(draft.text.models.map((model) => model.id))
      if (modelEditor.mode === 'official' && modelEditor.preset) {
        const model_id = modelEditor.draft.model_id.trim()
        const api_key = modelEditor.draft.api_key.trim()
        if (!model_id || !api_key) {
          setModelEditor((prev) =>
            prev ? { ...prev, error: '请填写模型名称和 API Key' } : prev,
          )
          return
        }
        if (existingIds.has(modelEditor.preset.id)) {
          setModelEditor((prev) =>
            prev ? { ...prev, error: '该官方模型已经添加' } : prev,
          )
          return
        }
        appendModel({
          ...modelEditor.preset,
          model_id,
          api_key,
        })
        setModelEditor(null)
        return
      }

      const id = modelEditor.draft.id.trim()
      const provider = modelEditor.draft.provider.trim()
      const model_id = modelEditor.draft.model_id.trim()
      if (!id || !provider || !model_id) {
        setModelEditor((prev) =>
          prev ? { ...prev, error: '请补齐配置 ID、模型来源和模型名称' } : prev,
        )
        return
      }
      if (existingIds.has(id)) {
        setModelEditor((prev) =>
          prev ? { ...prev, error: '配置 ID 已存在，请换一个 ID' } : prev,
        )
        return
      }

      const next: AiModelConfig = {
        id,
        label: modelEditor.draft.label.trim() || id || model_id,
        provider,
        model_id,
        api_key: modelEditor.draft.api_key.trim(),
      }
      const baseUrl = modelEditor.draft.base_url?.trim()
      const api = modelEditor.draft.api?.trim()
      if (baseUrl) next.base_url = baseUrl
      if (api) next.api = api
      if (modelEditor.draft.reasoning !== undefined) {
        next.reasoning = Boolean(modelEditor.draft.reasoning)
      }
      if (modelEditor.draft.stream !== undefined) {
        next.stream = Boolean(modelEditor.draft.stream)
      }
      appendModel(next)
      setModelEditor(null)
    },
    [appendModel, draft.text.models, modelEditor],
  )

  const removeModel = useCallback((index: number) => {
    setDraft((prev) => {
      const removed = prev.text.models[index]
      const models = prev.text.models.filter((_, i) => i !== index)
      const default_model_id =
        removed?.id === prev.text.default_model_id
          ? models[0]?.id ?? ''
          : prev.text.default_model_id
      return {
        ...prev,
        text: {
          models,
          default_model_id,
        },
      }
    })
  }, [])

  const updateImage = useCallback((field: keyof NonNullable<AiModelSettings['image']>, value: string) => {
    setDraft((prev) => ({
      ...prev,
      image: {
        ...(prev.image ?? { model: '', api_key: '' }),
        [field]: value,
      },
    }))
  }, [])

  const clearImage = useCallback(() => {
    setDraft((prev) => ({ ...prev, image: null }))
  }, [])

  const validateAndSave = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)

    const models = draft.text.models.map((model) => {
      const officialPreset = getOfficialTextModelPreset(model)
      if (officialPreset) {
        return {
          ...officialPreset,
          model_id: model.model_id.trim(),
          api_key: model.api_key.trim(),
        }
      }
      return {
        ...model,
        id: model.id.trim(),
        label: model.label.trim() || model.id.trim() || model.model_id.trim(),
        provider: model.provider.trim(),
        model_id: model.model_id.trim(),
        api_key: model.api_key.trim(),
        base_url: model.base_url?.trim() || undefined,
        api: model.api?.trim() || undefined,
      }
    })
    const incomplete = models.find(
      (model) => !model.id || !model.provider || !model.model_id,
    )
    if (incomplete) {
      setError('请补齐文字模型的 ID、来源和模型名')
      return
    }
    const officialWithoutKey = models.find(
      (model) => getOfficialTextModelPreset(model) && !model.api_key,
    )
    if (officialWithoutKey) {
      setError(`请填写 ${officialWithoutKey.label} 的 API Key`)
      return
    }

    const imageDraft = draft.image
      ? {
          model: draft.image.model.trim(),
          api_key: draft.image.api_key.trim(),
          base_url: draft.image.base_url?.trim() || undefined,
        }
      : null
    const hasPartialImage =
      imageDraft &&
      (imageDraft.model || imageDraft.api_key || imageDraft.base_url) &&
      (!imageDraft.model || !imageDraft.api_key)
    if (hasPartialImage) {
      setError('请补齐图像模型名称和 API Key，或清空图像模型')
      return
    }

    const settings = normalizeAiModelSettings({
      text: {
        models,
        default_model_id: draft.text.default_model_id || models[0]?.id || '',
      },
      image: imageDraft?.model && imageDraft.api_key ? imageDraft : null,
    })
    try {
      await onSave(settings)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存模型配置失败')
    }
  }

  return (
    <div
      className="model-config-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onClose()
      }}
    >
      <section
        className="model-config-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-config-title"
      >
        <form className="model-config-form" onSubmit={validateAndSave}>
          <header className="model-config-head">
            <h2 id="model-config-title">模型配置</h2>
            <button
              type="button"
              className="model-config-close"
              aria-label="关闭模型配置"
              disabled={saving}
              onClick={onClose}
            >
              ×
            </button>
          </header>

          <div className="model-config-body">
            <section className="model-config-section">
              <div className="model-config-section-head">
                <h3>文字模型</h3>
                <div className="model-config-section-actions">
                  <button
                    type="button"
                    className="btn-secondary btn-small btn-icon"
                    aria-label="刷新模型配置"
                    title="刷新模型配置"
                    disabled={saving || refreshing}
                    onClick={() => void handleRefresh()}
                  >
                    <RefreshIcon spinning={refreshing} />
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-small"
                    onClick={() => setModelPickerOpen(true)}
                  >
                    添加模型
                  </button>
                </div>
              </div>

              {draft.text.models.length === 0 ? (
                <div className="model-config-empty">未配置文字模型</div>
              ) : (
                <div className="model-config-list">
                  {draft.text.models.map((model, index) => {
                    const builtinFreeModel = isBuiltinFreeTextModel(model)
                    const officialPreset = getOfficialTextModelPreset(model)
                    return (
                      <article
                        className={
                          builtinFreeModel
                            ? 'model-config-item model-config-item--locked'
                            : 'model-config-item'
                        }
                        key={`model-config-${index}`}
                      >
                        <div className="model-config-item-head">
                          <label className="model-config-default">
                            <input
                              type="radio"
                              name="defaultTextModel"
                              checked={draft.text.default_model_id === model.id}
                              onChange={() =>
                                setDraft((prev) => ({
                                  ...prev,
                                  text: { ...prev.text, default_model_id: model.id },
                                }))
                              }
                            />
                            默认
                          </label>
                          {builtinFreeModel ? (
                            <span className="model-config-lock-tag">内置</span>
                          ) : (
                            <button
                              type="button"
                              className="btn-secondary btn-small"
                              disabled={saving}
                              onClick={() => removeModel(index)}
                            >
                              删除
                            </button>
                          )}
                        </div>

                        {builtinFreeModel ? (
                          <div className="model-config-locked-summary">
                            <strong>{model.label || 'DeepSeekWriteFree'}</strong>
                            <span>{model.model_id}</span>
                          </div>
                        ) : officialPreset ? (
                          <div className="model-config-official">
                            <div className="model-config-official-title">
                              <strong>{officialPreset.label}</strong>
                              <span>官方预设</span>
                            </div>
                            <div className="model-config-official-summary">
                              <span>
                                <em>配置 ID</em>
                                <strong>{officialPreset.id}</strong>
                              </span>
                              <span>
                                <em>模型来源</em>
                                <strong>{officialPreset.provider}</strong>
                              </span>
                            </div>
                            <div className="model-config-official-fields">
                              <label className="field">
                                <span className="field-label">模型名称</span>
                                <input
                                  type="text"
                                  value={model.model_id}
                                  onChange={(e) => updateModel(index, { model_id: e.target.value })}
                                  placeholder={officialPreset.model_id}
                                />
                              </label>
                              <label className="field">
                                <span className="field-label">API Key</span>
                                <input
                                  type="password"
                                  value={model.api_key}
                                  onChange={(e) => updateModel(index, { api_key: e.target.value })}
                                  placeholder="请输入 DeepSeek 官方 API Key"
                                />
                              </label>
                            </div>
                          </div>
                        ) : (
                          <div className="model-config-grid">
                            <label className="field">
                              <span className="field-label">配置 ID</span>
                              <input
                                type="text"
                                value={model.id}
                                onChange={(e) => updateModel(index, { id: e.target.value })}
                                placeholder="deepseekflash"
                              />
                            </label>
                            <label className="field">
                              <span className="field-label">显示名称</span>
                              <input
                                type="text"
                                value={model.label}
                                onChange={(e) => updateModel(index, { label: e.target.value })}
                                placeholder="DeepSeek Flash"
                              />
                            </label>
                            <label className="field">
                              <span className="field-label">模型来源</span>
                              <input
                                type="text"
                                value={model.provider}
                                onChange={(e) => updateModel(index, { provider: e.target.value })}
                                placeholder="deepseek"
                              />
                            </label>
                            <label className="field">
                              <span className="field-label">模型名称</span>
                              <input
                                type="text"
                                value={model.model_id}
                                onChange={(e) => updateModel(index, { model_id: e.target.value })}
                                placeholder="deepseek-v4-flash"
                              />
                            </label>
                            <label className="field">
                              <span className="field-label">API Key</span>
                              <input
                                type="password"
                                value={model.api_key}
                                onChange={(e) => updateModel(index, { api_key: e.target.value })}
                                placeholder={TEXT_MODEL_API_KEY_PLACEHOLDER}
                              />
                            </label>
                            <label className="field">
                              <span className="field-label">API 地址</span>
                              <input
                                type="text"
                                value={model.base_url ?? ''}
                                onChange={(e) => updateModel(index, { base_url: e.target.value })}
                                placeholder="官方来源无需填写 Base URL"
                              />
                            </label>
                            <label className="field">
                              <span className="field-label">API 类型</span>
                              <select
                                value={model.api ?? ''}
                                onChange={(e) => updateModel(index, { api: e.target.value })}
                              >
                                <option value="">默认</option>
                                <option value="openai-completions">openai-completions</option>
                                <option value="openai-responses">openai-responses</option>
                                <option value="anthropic-messages">anthropic-messages</option>
                                <option value="google-generative-ai">google-generative-ai</option>
                              </select>
                            </label>
                            <div className="model-config-switches">
                              <label className="model-config-check">
                                <input
                                  type="checkbox"
                                  checked={Boolean(model.reasoning)}
                                  onChange={(e) =>
                                    updateModel(index, { reasoning: e.target.checked })
                                  }
                                />
                                推理
                              </label>
                              <label className="model-config-check">
                                <input
                                  type="checkbox"
                                  checked={Boolean(model.stream)}
                                  onChange={(e) =>
                                    updateModel(index, { stream: e.target.checked })
                                  }
                                />
                                流式
                              </label>
                            </div>
                          </div>
                        )}
                      </article>
                    )
                  })}
                </div>
              )}
            </section>

            <section className="model-config-section">
              <div className="model-config-section-head">
                <h3>图像模型</h3>
                <button
                  type="button"
                  className="btn-secondary btn-small"
                  onClick={clearImage}
                  disabled={saving || !draft.image}
                >
                  清空
                </button>
              </div>
              <div className="model-config-grid model-config-grid--image">
                <label className="field">
                  <span className="field-label">模型名称</span>
                  <input
                    type="text"
                    value={draft.image?.model ?? ''}
                    onChange={(e) => updateImage('model', e.target.value)}
                    placeholder="image-model"
                  />
                </label>
                <label className="field">
                  <span className="field-label">API Key</span>
                  <input
                    type="password"
                    value={draft.image?.api_key ?? ''}
                    onChange={(e) => updateImage('api_key', e.target.value)}
                    placeholder="sk-..."
                  />
                </label>
                <label className="field model-config-field-wide">
                  <span className="field-label">API 地址</span>
                  <input
                    type="text"
                    value={draft.image?.base_url ?? ''}
                    onChange={(e) => updateImage('base_url', e.target.value)}
                    placeholder="https://sucloud.vip"
                  />
                </label>
              </div>
            </section>

            {error && <p className="form-error">{error}</p>}
          </div>

          <footer className="model-config-foot">
            <button
              type="button"
              className="btn-secondary"
              disabled={saving}
              onClick={onClose}
            >
              取消
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </footer>

        </form>

        {modelPickerOpen && (
          <div
            className="model-picker-backdrop"
            role="presentation"
            onClick={(event) => {
              if (event.target === event.currentTarget) setModelPickerOpen(false)
            }}
          >
            <section
              className="model-picker-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="model-picker-title"
            >
              <header className="model-config-head">
                <h2 id="model-picker-title">选择模型类型</h2>
                <button
                  type="button"
                  className="model-config-close"
                  aria-label="关闭模型选择"
                  onClick={() => setModelPickerOpen(false)}
                >
                  ×
                </button>
              </header>
              <div className="model-picker-options">
                {OFFICIAL_TEXT_MODEL_PRESETS.map((preset, index) => {
                  const alreadyAdded = draft.text.models.some(
                    (model) => model.id === preset.id,
                  )
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className="model-picker-option"
                      disabled={alreadyAdded}
                      autoFocus={index === 0}
                      onClick={() => openModelEditor(preset)}
                    >
                      <strong>
                        DeepSeek 官方{' '}
                        {preset.label.replace('DeepSeek ', '').replace('Deepseek ', '')}
                      </strong>
                      <span>
                        {alreadyAdded ? '已添加' : '仅需填写模型名称和 API Key'}
                      </span>
                    </button>
                  )
                })}
                <button
                  type="button"
                  className="model-picker-option"
                  onClick={() => openModelEditor()}
                >
                  <strong>其他厂商模型</strong>
                  <span>手动填写模型来源、名称、API 地址等完整配置</span>
                </button>
              </div>
            </section>
          </div>
        )}

        {modelEditor && (
          <div
            className="model-editor-backdrop"
            role="presentation"
            onClick={(event) => {
              if (event.target === event.currentTarget) setModelEditor(null)
            }}
          >
            <section
              className="model-editor-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="model-editor-title"
            >
              <form className="model-editor-form" onSubmit={submitModelEditor}>
                <header className="model-config-head">
                  <h2 id="model-editor-title">
                    {modelEditor.mode === 'official'
                      ? '配置 DeepSeek 官方模型'
                      : '配置其他厂商模型'}
                  </h2>
                  <button
                    type="button"
                    className="model-config-close"
                    aria-label="关闭模型配置"
                    onClick={() => setModelEditor(null)}
                  >
                    ×
                  </button>
                </header>

                <div className="model-editor-body">
                  {modelEditor.mode === 'official' && modelEditor.preset ? (
                    <div className="model-config-official">
                      <div className="model-config-official-title">
                        <strong>{modelEditor.preset.label}</strong>
                        <span>官方预设</span>
                      </div>
                      <p className="model-editor-note">
                        配置 ID 和模型来源会自动使用 DeepSeek 官方预设。
                      </p>
                      <div className="model-config-official-fields">
                        <label className="field">
                          <span className="field-label">模型名称</span>
                          <input
                            type="text"
                            value={modelEditor.draft.model_id}
                            onChange={(e) => updateModelEditor({ model_id: e.target.value })}
                            placeholder={modelEditor.preset.model_id}
                            autoFocus
                          />
                        </label>
                        <label className="field">
                          <span className="field-label">API Key</span>
                          <input
                            type="password"
                            value={modelEditor.draft.api_key}
                            onChange={(e) => updateModelEditor({ api_key: e.target.value })}
                            placeholder="请输入 DeepSeek 官方 API Key"
                          />
                        </label>
                      </div>
                    </div>
                  ) : (
                    <div className="model-config-grid">
                      <label className="field">
                        <span className="field-label">配置 ID</span>
                        <input
                          type="text"
                          value={modelEditor.draft.id}
                          onChange={(e) => updateModelEditor({ id: e.target.value })}
                          placeholder="deepseekflash"
                          autoFocus
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">显示名称</span>
                        <input
                          type="text"
                          value={modelEditor.draft.label}
                          onChange={(e) => updateModelEditor({ label: e.target.value })}
                          placeholder="DeepSeek Flash"
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">模型来源</span>
                        <input
                          type="text"
                          value={modelEditor.draft.provider}
                          onChange={(e) => updateModelEditor({ provider: e.target.value })}
                          placeholder="deepseek"
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">模型名称</span>
                        <input
                          type="text"
                          value={modelEditor.draft.model_id}
                          onChange={(e) => updateModelEditor({ model_id: e.target.value })}
                          placeholder="deepseek-v4-flash"
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">API Key</span>
                        <input
                          type="password"
                          value={modelEditor.draft.api_key}
                          onChange={(e) => updateModelEditor({ api_key: e.target.value })}
                          placeholder={TEXT_MODEL_API_KEY_PLACEHOLDER}
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">API 地址</span>
                        <input
                          type="text"
                          value={modelEditor.draft.base_url ?? ''}
                          onChange={(e) => updateModelEditor({ base_url: e.target.value })}
                          placeholder="官方来源无需填写 Base URL"
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">API 类型</span>
                        <select
                          value={modelEditor.draft.api ?? ''}
                          onChange={(e) => updateModelEditor({ api: e.target.value })}
                        >
                          <option value="">默认</option>
                          <option value="openai-completions">openai-completions</option>
                          <option value="openai-responses">openai-responses</option>
                          <option value="anthropic-messages">anthropic-messages</option>
                          <option value="google-generative-ai">google-generative-ai</option>
                        </select>
                      </label>
                      <div className="model-config-switches">
                        <label className="model-config-check">
                          <input
                            type="checkbox"
                            checked={Boolean(modelEditor.draft.reasoning)}
                            onChange={(e) =>
                              updateModelEditor({ reasoning: e.target.checked })
                            }
                          />
                          推理
                        </label>
                        <label className="model-config-check">
                          <input
                            type="checkbox"
                            checked={Boolean(modelEditor.draft.stream)}
                            onChange={(e) =>
                              updateModelEditor({ stream: e.target.checked })
                            }
                          />
                          流式
                        </label>
                      </div>
                    </div>
                  )}

                  {modelEditor.error && <p className="form-error">{modelEditor.error}</p>}
                </div>

                <footer className="model-config-foot">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setModelEditor(null)}
                  >
                    取消
                  </button>
                  <button type="submit" className="btn-primary">
                    添加到配置
                  </button>
                </footer>
              </form>
            </section>
          </div>
        )}
      </section>
    </div>
  )
}

type AppearanceStyleDialogProps = {
  currentStyle: AppearanceStyle
  saving: boolean
  error: string | null
  onClose: () => void
  onSelect: (style: AppearanceStyle) => Promise<void>
}

const APPEARANCE_OPTIONS: Array<{
  id: AppearanceStyle
  label: string
  tone: string
}> = [
  { id: 'classic', label: APPEARANCE_STYLE_LABELS.classic, tone: '宣纸暖色' },
  { id: 'modern', label: APPEARANCE_STYLE_LABELS.modern, tone: '白色清爽' },
]

const TEXT_DISPLAY_OPTIONS: Array<{ id: TextDisplayMode; description: string }> = [
  { id: 'text', description: '直接显示和编辑纯文本，不解析 Markdown 标记。' },
  { id: 'markdown', description: '默认按 Markdown 排版预览，并可随时切换到源码编辑。' },
]

type TextDisplayDialogProps = {
  currentMode: TextDisplayMode
  saving: boolean
  error: string | null
  onClose: () => void
  onSelect: (mode: TextDisplayMode) => Promise<void>
}

function TextDisplayDialog({
  currentMode,
  saving,
  error,
  onClose,
  onSelect,
}: TextDisplayDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, saving])

  return (
    <div
      className="text-display-config-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onClose()
      }}
    >
      <section
        className="text-display-config-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="text-display-config-title"
      >
        <header className="text-display-config-head">
          <h2 id="text-display-config-title">文字显示</h2>
          <button
            type="button"
            className="model-config-close"
            aria-label="关闭文字显示配置"
            disabled={saving}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="text-display-config-body">
          <p className="text-display-config-hint">统一设置创作空间、素材库和技能库的内容显示方式。</p>
          <div className="text-display-config-options" role="radiogroup" aria-label="文字显示模式">
            {TEXT_DISPLAY_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={
                  currentMode === option.id
                    ? 'text-display-config-option text-display-config-option--active'
                    : 'text-display-config-option'
                }
                role="radio"
                aria-checked={currentMode === option.id}
                disabled={saving}
                onClick={() => void onSelect(option.id)}
              >
                <span className="text-display-config-option-mark" aria-hidden="true" />
                <span>
                  <strong>{TEXT_DISPLAY_MODE_LABELS[option.id]}</strong>
                  <em>{option.description}</em>
                </span>
              </button>
            ))}
          </div>
          {saving ? <p className="text-display-config-status">保存中…</p> : null}
          {error ? <p className="form-error">{error}</p> : null}
        </div>
      </section>
    </div>
  )
}

function AppearanceStyleDialog({
  currentStyle,
  saving,
  error,
  onClose,
  onSelect,
}: AppearanceStyleDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, saving])

  return (
    <div
      className="style-config-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onClose()
      }}
    >
      <section
        className="style-config-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="style-config-title"
      >
        <header className="style-config-head">
          <h2 id="style-config-title">风格配置</h2>
          <button
            type="button"
            className="model-config-close"
            aria-label="关闭风格配置"
            disabled={saving}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="style-config-body">
          <div className="style-config-options" role="radiogroup" aria-label="软件风格">
            {APPEARANCE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={
                  currentStyle === option.id
                    ? 'style-config-option style-config-option--active'
                    : 'style-config-option'
                }
                role="radio"
                aria-checked={currentStyle === option.id}
                disabled={saving}
                onClick={() => void onSelect(option.id)}
              >
                <span className="style-config-option-mark" aria-hidden="true" />
                <span>
                  <strong>{option.label}</strong>
                  <em>{option.tone}</em>
                </span>
              </button>
            ))}
          </div>
          {saving ? <p className="style-config-status">保存中…</p> : null}
          {error ? <p className="form-error">{error}</p> : null}
        </div>
      </section>
    </div>
  )
}

type CreateDialogProps = {
  title: string
  titleId: string
  submitting: boolean
  submitLabel?: string
  submittingLabel?: string
  submitDisabled?: boolean
  onClose: () => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  children: React.ReactNode
}

function CreateDialog({
  title,
  titleId,
  submitting,
  submitLabel = '创建',
  submittingLabel = '创建中…',
  submitDisabled = false,
  onClose,
  onSubmit,
  children,
}: CreateDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, submitting])

  return (
    <div
      className="create-dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose()
      }}
    >
      <section
        className="create-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <form className="create-dialog-form" onSubmit={onSubmit}>
          <header className="create-dialog-head">
            <h2 id={titleId}>{title}</h2>
            <button
              type="button"
              className="create-dialog-close"
              aria-label={`关闭${title}`}
              disabled={submitting}
              onClick={onClose}
            >
              ×
            </button>
          </header>
          <div className="create-dialog-body">{children}</div>
          <footer className="create-dialog-foot">
            <button
              type="button"
              className="btn-secondary"
              disabled={submitting}
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={submitting || submitDisabled}
            >
              {submitting ? submittingLabel : submitLabel}
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}

type UpdateDialogProps = {
  checking: boolean
  result: UpdateCheckResult | null
  error: string | null
  onClose: () => void
  onRetry: () => void
  onDownload: () => void
}

function UpdateDialog({
  checking,
  result,
  error,
  onClose,
  onRetry,
  onDownload,
}: UpdateDialogProps) {
  const updateAvailable = Boolean(result?.success && result.update_available)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="update-dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
      >
        <header className="update-dialog-head">
          <div>
            <span className="update-dialog-kicker">VERSION UPDATE</span>
            <h2 id="update-dialog-title">软件更新</h2>
          </div>
          <button
            type="button"
            className="model-config-close"
            aria-label="关闭软件更新"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="update-dialog-body">
          {checking ? (
            <div className="update-dialog-loading" role="status">
              <span className="update-dialog-spinner" aria-hidden="true" />
              <strong>正在获取版本更新信息</strong>
              <span>请稍候，马上就好…</span>
            </div>
          ) : error ? (
            <div className="update-dialog-state update-dialog-state--error" role="alert">
              <strong>暂时无法获取更新信息</strong>
              <span>{error}</span>
            </div>
          ) : result ? (
            <>
              <div className="update-dialog-version-card">
                <div className="update-dialog-version-copy">
                  <span>{updateAvailable ? '发现新版本' : '当前已是最新版本'}</span>
                  <strong>
                    v{result.latest_version || result.current_version}
                  </strong>
                </div>
                <span
                  className={
                    updateAvailable
                      ? 'update-dialog-badge'
                      : 'update-dialog-badge update-dialog-badge--current'
                  }
                >
                  {updateAvailable ? '可更新' : '已是最新'}
                </span>
              </div>

              <div className="update-dialog-meta">
                <span>当前版本：v{result.current_version}</span>
                {result.file_name ? <span>安装包：{result.file_name}</span> : null}
              </div>

              <section className="update-dialog-release" aria-labelledby="update-release-title">
                <h3 id="update-release-title">版本更新信息</h3>
                {result.release_notes.length > 0 ? (
                  <ul>
                    {result.release_notes.map((note, index) => (
                      <li key={`${note}-${index}`}>{note}</li>
                    ))}
                  </ul>
                ) : (
                  <p>本次版本包含功能优化与已知问题修复。</p>
                )}
              </section>

              {updateAvailable ? (
                <div className="update-dialog-notice">
                  <strong>安装提示</strong>
                  <p>
                    点击“下载新版本”后，请到系统下载处查看安装包，重新安装软件即可。
                  </p>
                </div>
              ) : null}

            </>
          ) : null}
        </div>

        <footer className="update-dialog-foot">
          {error ? (
            <button type="button" className="btn-primary" onClick={onRetry}>
              重新检查
            </button>
          ) : updateAvailable ? (
            <button
              type="button"
              className="btn-primary update-dialog-download"
              disabled={checking}
              onClick={onDownload}
            >
              下载新版本
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              disabled={checking}
              onClick={onClose}
            >
              关闭
            </button>
          )}
        </footer>
      </section>
    </div>
  )
}

export function Home() {
  const { confirm, dialog } = useAppDialog()
  const {
    appearanceStyle,
    savingAppearance,
    appearanceError,
    setAppearanceStyle,
  } = useAppearance()
  const books = useHomeStore((state) => state.books)
  const materials = useHomeStore((state) => state.materials)
  const skills = useHomeStore((state) => state.skills)
  const bookCovers = useHomeStore((state) => state.bookCovers)
  const cachedWorkspaceRoot = useHomeStore((state) => state.workspaceRoot)
  const cachedAiSettings = useHomeStore((state) => state.aiSettings)
  const setBooks = useHomeStore((state) => state.setBooks)
  const setMaterials = useHomeStore((state) => state.setMaterials)
  const setSkills = useHomeStore((state) => state.setSkills)
  const setBookCovers = useHomeStore((state) => state.setBookCovers)
  const setWorkspaceRoot = useHomeStore((state) => state.setWorkspaceRoot)
  const setAiSettings = useHomeStore((state) => state.setAiSettings)
  const workspaceRoot = cachedWorkspaceRoot ?? getStoredWorkspaceRoot()
  const aiSettings = cachedAiSettings ?? emptyAiModelSettings()

  // ==================== 创作空间状态 ====================
  const [loadingBooks, setLoadingBooks] = useState(
    () => !useHomeStore.getState().hasBooks,
  )
  const [showBookForm, setShowBookForm] = useState(false)
  const [bookTitle, setBookTitle] = useState('')
  const [bookType, setBookType] = useState<BookType>('short')
  const [shortGenre, setShortGenre] = useState<string>(SHORT_GENRE_OPTIONS[0])
  const [bookLinkedSkillId, setBookLinkedSkillId] = useState('')
  const [bookLinkedMaterialId, setBookLinkedMaterialId] = useState('')
  const [submittingBook, setSubmittingBook] = useState(false)
  const [deletingBookId, setDeletingBookId] = useState<string | null>(null)
  const [bookError, setBookError] = useState<string | null>(null)
  const [userMemoryOpen, setUserMemoryOpen] = useState(false)
  const [userMemoryType, setUserMemoryType] = useState<'short' | 'script'>('short')
  const [userMemories, setUserMemories] = useState<MemoryEntry[]>([])
  const [userMemoryResetKey, setUserMemoryResetKey] = useState(0)
  const [loadingUserMemories, setLoadingUserMemories] = useState(false)
  const [savingUserMemories, setSavingUserMemories] = useState(false)
  const [userMemoryError, setUserMemoryError] = useState<string | null>(null)

  // ==================== 素材库状态 ====================
  const [loadingMaterials, setLoadingMaterials] = useState(
    () => !useHomeStore.getState().hasMaterials,
  )
  const [showMaterialForm, setShowMaterialForm] = useState(false)
  const [materialTitle, setMaterialTitle] = useState('')
  const [materialType, setMaterialType] = useState<MaterialType>('short')
  const [materialParentGenre, setMaterialParentGenre] = useState<string>(getMaterialParentGenres('short')[0] ?? '')
  const [submittingMaterial, setSubmittingMaterial] = useState(false)
  const [deletingMaterialId, setDeletingMaterialId] = useState<string | null>(null)
  const [materialError, setMaterialError] = useState<string | null>(null)

  // ==================== 技能库状态 ====================
  const [loadingSkills, setLoadingSkills] = useState(
    () => !useHomeStore.getState().hasSkills,
  )
  const [showSkillForm, setShowSkillForm] = useState(false)
  const [skillTitle, setSkillTitle] = useState('')
  const [skillType, setSkillType] = useState<SkillType>('short')
  const [loadCommonSkills, setLoadCommonSkills] = useState(false)
  const [submittingSkill, setSubmittingSkill] = useState(false)
  const [deletingSkillId, setDeletingSkillId] = useState<string | null>(null)
  const [skillError, setSkillError] = useState<string | null>(null)

  // ==================== 导入/导出状态 ====================
  const [exportBookOpen, setExportBookOpen] = useState(false)
  const [exportMaterialOpen, setExportMaterialOpen] = useState(false)
  const [exportSkillOpen, setExportSkillOpen] = useState(false)
  const [selectedExportBookId, setSelectedExportBookId] = useState('')
  const [selectedExportMaterialId, setSelectedExportMaterialId] = useState('')
  const [selectedExportSkillId, setSelectedExportSkillId] = useState('')
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [importingBook, setImportingBook] = useState(false)
  const [importingMaterial, setImportingMaterial] = useState(false)
  const [importingSkill, setImportingSkill] = useState(false)

  // ==================== 模型配置状态 ====================
  const [loadingAiSettings, setLoadingAiSettings] = useState(
    () => !useHomeStore.getState().hasAiSettings,
  )
  const [modelConfigOpen, setModelConfigOpen] = useState(false)
  const [styleConfigOpen, setStyleConfigOpen] = useState(false)
  const [textDisplayOpen, setTextDisplayOpen] = useState(false)
  const [learningImitationOpen, setLearningImitationOpen] = useState(false)
  const [learningImitationBackground, setLearningImitationBackground] = useState(false)
  const [workspaceDrawerOpen, setWorkspaceDrawerOpen] = useState(false)
  const [otherFunctionsOpen, setOtherFunctionsOpen] = useState(false)
  const otherFunctionsRef = useRef<HTMLDivElement | null>(null)
  const [savingAiSettings, setSavingAiSettings] = useState(false)
  const [modelConfigError, setModelConfigError] = useState<string | null>(null)
  const [styleConfigError, setStyleConfigError] = useState<string | null>(null)
  const [textDisplayError, setTextDisplayError] = useState<string | null>(null)
  const backgroundUpdate = useBackgroundUpdate()
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [currentAppVersion, setCurrentAppVersion] = useState<string | null>(null)
  const [updateCheckResult, setUpdateCheckResult] = useState<UpdateCheckResult | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const downloadingUpdate = backgroundUpdate.status === 'downloading'

  useEffect(() => {
    if (!otherFunctionsOpen) return

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && otherFunctionsRef.current?.contains(target)) return
      setOtherFunctionsOpen(false)
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOtherFunctionsOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [otherFunctionsOpen])

  // ==================== 创作空间封面加载 ====================
  const loadBookCovers = useCallback(async (bookList: BookSummary[]) => {
    if (bookList.length === 0) {
      setBookCovers({})
      return
    }
    try {
      setBookCovers(await getBookCovers(bookList.map((b) => b.id)))
    } catch {
      setBookCovers({})
    }
  }, [setBookCovers])

  // ==================== 创作空间数据加载 ====================
  const refreshBooks = useCallback(async (options?: RefreshOptions) => {
    const showLoading = options?.showLoading ?? !useHomeStore.getState().hasBooks
    if (showLoading) setLoadingBooks(true)
    setBookError(null)
    try {
      const list = await listBooks()
      setBooks(list)
      void loadBookCovers(list)
    } catch (e) {
      setBookError(e instanceof Error ? e.message : '加载创作空间失败')
    } finally {
      setLoadingBooks(false)
    }
  }, [loadBookCovers, setBooks])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const showLoading = !useHomeStore.getState().hasBooks
      if (showLoading) setLoadingBooks(true)
      setBookError(null)
      const w = await loadPersistedWorkspaceRoot()
      if (cancelled) return
      setWorkspaceRoot(w)
      try {
        const list = await listBooks()
        if (!cancelled) setBooks(list)
        if (!cancelled) void loadBookCovers(list)
      } catch (e) {
        if (!cancelled) setBookError(e instanceof Error ? e.message : '加载创作空间失败')
      } finally {
        if (!cancelled) setLoadingBooks(false)
      }
    })()

    let lateTimer: number | undefined
    if (isPywebviewDesktopBundle()) {
      lateTimer = window.setTimeout(() => {
        if (cancelled) return
        void (async () => {
          const w = await loadPersistedWorkspaceRoot()
          const currentRoot = useHomeStore.getState().workspaceRoot
          if (!cancelled && w != null && !currentRoot) {
            setWorkspaceRoot(w)
          }
        })()
      }, 450)
    }

    return () => {
      cancelled = true
      if (lateTimer != null) window.clearTimeout(lateTimer)
    }
  }, [loadBookCovers, setBooks, setWorkspaceRoot])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const showLoading = !useHomeStore.getState().hasAiSettings
      if (showLoading) setLoadingAiSettings(true)
      setModelConfigError(null)
      try {
        const settings = await getAiModelConfig()
        if (!cancelled) setAiSettings(settings)
      } catch (e) {
        if (!cancelled) {
          setModelConfigError(e instanceof Error ? e.message : '加载模型配置失败')
        }
      } finally {
        if (!cancelled) setLoadingAiSettings(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [setAiSettings])

  // ==================== 素材库数据加载 ====================
  const refreshMaterials = useCallback(async (options?: RefreshOptions) => {
    const showLoading = options?.showLoading ?? !useHomeStore.getState().hasMaterials
    if (showLoading) setLoadingMaterials(true)
    setMaterialError(null)
    try {
      const list = await listMaterials()
      setMaterials(list)
    } catch (e) {
      setMaterialError(e instanceof Error ? e.message : '加载素材库失败')
    } finally {
      setLoadingMaterials(false)
    }
  }, [setMaterials])

  // ==================== 技能库数据加载 ====================
  const refreshSkills = useCallback(async (options?: RefreshOptions) => {
    const showLoading = options?.showLoading ?? !useHomeStore.getState().hasSkills
    if (showLoading) setLoadingSkills(true)
    setSkillError(null)
    try {
      const list = await listSkills()
      setSkills(list)
    } catch (e) {
      setSkillError(e instanceof Error ? e.message : '加载技能库失败')
    } finally {
      setLoadingSkills(false)
    }
  }, [setSkills])

  // 初始加载素材与技能；已有缓存时在后台刷新，避免回首页闪 loading。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshMaterials({ showLoading: !useHomeStore.getState().hasMaterials })
      void refreshSkills({ showLoading: !useHomeStore.getState().hasSkills })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshMaterials, refreshSkills])

  // 进入首页后自动在后台刷新一次，防止桥接未就绪导致首次加载为空。
  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (cancelled) return
      void refreshBooks({ showLoading: false })
      void refreshMaterials({ showLoading: false })
      void refreshSkills({ showLoading: false })
    }, 600)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [refreshBooks, refreshMaterials, refreshSkills])

  // 页面重新可见时自动刷新，从编辑器返回首页可立即看到最新数据。
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      void refreshBooks({ showLoading: false })
      void refreshMaterials({ showLoading: false })
      void refreshSkills({ showLoading: false })
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [refreshBooks, refreshMaterials, refreshSkills])

  // ==================== 工作目录操作 ====================
  const handlePickWorkspace = async () => {
    setBookError(null)
    try {
      const p = await pickFolder()
      if (p) {
        setWorkspaceRoot(p)
        await persistWorkspaceRoot(p)
        await refreshBooks()
        await refreshMaterials()
        await refreshSkills()
      }
    } catch (e) {
      setBookError(e instanceof Error ? e.message : '选择文件夹失败')
    }
  }

  const handleSaveAiSettings = async (settings: AiModelSettings) => {
    setSavingAiSettings(true)
    setModelConfigError(null)
    try {
      const saved = await saveAiModelConfig(settings)
      setAiSettings(saved)
      await refreshPreferredWorkspaceChatModel()
      setModelConfigOpen(false)
    } catch (e) {
      const message = e instanceof Error ? e.message : '保存模型配置失败'
      setModelConfigError(message)
      if (e instanceof Error) throw e
      throw new Error(message, { cause: e })
    } finally {
      setSavingAiSettings(false)
    }
  }

  const refreshAiSettings = useCallback(async () => {
    setModelConfigError(null)
    try {
      const settings = await getAiModelConfig()
      setAiSettings(settings)
      return settings
    } catch (e) {
      const message = e instanceof Error ? e.message : '加载模型配置失败'
      setModelConfigError(message)
      throw new Error(message, { cause: e })
    }
  }, [setAiSettings])

  const handleSaveAppearanceStyle = async (style: AppearanceStyle) => {
    setStyleConfigError(null)
    try {
      await setAppearanceStyle(style)
    } catch (e) {
      setStyleConfigError(e instanceof Error ? e.message : '保存风格配置失败')
    }
  }

  // ==================== 文字显示状态 ====================
  const { mode: textDisplayMode, saving: savingTextDisplay, error: textDisplayContextError, setMode: setTextDisplayMode } = useTextDisplay()

  const handleSaveTextDisplayMode = async (mode: TextDisplayMode) => {
    setTextDisplayError(null)
    try {
      await setTextDisplayMode(mode)
    } catch (e) {
      setTextDisplayError(e instanceof Error ? e.message : '保存文字显示设置失败')
    }
  }

  const handleCheckUpdate = async () => {
    setUpdateDialogOpen(true)
    setCheckingUpdate(true)
    setUpdateCheckResult(null)
    setUpdateError(null)
    try {
      const check = await checkForUpdate()
      setCurrentAppVersion(check.current_version)
      if (!check.success) {
        throw new Error(check.error || '检查更新失败')
      }
      setUpdateCheckResult(check)
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : '软件更新失败')
    } finally {
      setCheckingUpdate(false)
    }
  }

  const handleDownloadUpdate = () => {
    if (!startBackgroundUpdate()) return
    setUpdateDialogOpen(false)
  }

  // ==================== 书籍操作 ====================
  const handleCreateBook = async (e: React.FormEvent) => {
    e.preventDefault()
    const ws = workspaceRoot?.trim()
    if (!ws) {
      setBookError('请先在上方选择工作文件夹')
      return
    }
    setSubmittingBook(true)
    setBookError(null)
    try {
      const cats = bookType === 'short' || bookType === 'script' ? [shortGenre] : []
      const linkedSkillId = bookType === 'short' || bookType === 'script' ? bookLinkedSkillId : ''
      const linkedMaterialId = bookType === 'short' || bookType === 'script' ? bookLinkedMaterialId : ''
      await createBook(bookTitle, bookType, cats, ws, linkedSkillId || null, linkedMaterialId || null)
      setBookTitle('')
      setBookType('short')
      setShortGenre(SHORT_GENRE_OPTIONS[0])
      setBookLinkedSkillId('')
      setBookLinkedMaterialId('')
      setShowBookForm(false)
      await refreshBooks()
    } catch (err) {
      setBookError(err instanceof Error ? err.message : '创建书籍失败')
    } finally {
      setSubmittingBook(false)
    }
  }

  const handleDeleteBook = async (bookId: string) => {
    const b = books.find((book) => book.id === bookId)
    if (!b) return
    const ok = await confirm({
      title: '移除创作空间',
      message: `确定从创作空间移除「${b.title}」？`,
      details: '书本文件夹仍会保留在工作目录中。',
      confirmText: '移除',
      variant: 'danger',
    })
    if (!ok) return
    setDeletingBookId(bookId)
    try {
      await deleteBook(bookId)
      await refreshBooks()
    } catch (err) {
      setBookError(err instanceof Error ? err.message : '删除书籍失败')
    } finally {
      setDeletingBookId(null)
    }
  }

  // ==================== 素材操作 ====================
  const handleCreateMaterial = async (e: React.FormEvent) => {
    e.preventDefault()
    const ws = workspaceRoot?.trim()
    if (!ws) {
      setMaterialError('请先在上方选择工作文件夹')
      return
    }
    setSubmittingMaterial(true)
    setMaterialError(null)
    try {
      const parentGenre =
        materialType === 'short' || materialType === 'script'
          ? materialParentGenre
          : undefined
      const subGenre = undefined
      await createMaterial(materialTitle, materialType, parentGenre, subGenre, ws)
      setMaterialTitle('')
      setMaterialType('short')
      setMaterialParentGenre(getMaterialParentGenres('short')[0] ?? '')
      setShowMaterialForm(false)
      await refreshMaterials()
    } catch (err) {
      setMaterialError(err instanceof Error ? err.message : '创建素材失败')
    } finally {
      setSubmittingMaterial(false)
    }
  }

  const handleDeleteMaterial = async (materialId: string) => {
    const m = materials.find((mat) => mat.id === materialId)
    if (!m) return
    const ok = await confirm({
      title: '删除素材',
      message: `确定删除素材「${m.title}」？`,
      details: '本地素材文件夹也将一并删除，此操作不可恢复。',
      confirmText: '删除',
      variant: 'danger',
    })
    if (!ok) return
    setDeletingMaterialId(materialId)
    try {
      await deleteMaterial(materialId)
      await refreshMaterials()
    } catch (err) {
      setMaterialError(err instanceof Error ? err.message : '删除素材失败')
    } finally {
      setDeletingMaterialId(null)
    }
  }

  // ==================== 技能操作 ====================
  const handleCreateSkill = async (e: React.FormEvent) => {
    e.preventDefault()
    const ws = workspaceRoot?.trim()
    if (!ws) {
      setSkillError('请先在上方选择工作文件夹')
      return
    }
    setSubmittingSkill(true)
    setSkillError(null)
    try {
      await createSkill(skillTitle, skillType, ws, loadCommonSkills)
      setSkillTitle('')
      setSkillType('short')
      setLoadCommonSkills(false)
      setShowSkillForm(false)
      await refreshSkills()
    } catch (err) {
      setSkillError(err instanceof Error ? err.message : '创建技能失败')
    } finally {
      setSubmittingSkill(false)
    }
  }

  const handleDeleteSkill = async (skillId: string) => {
    const s = skills.find((item) => item.id === skillId)
    if (!s) return
    const ok = await confirm({
      title: '删除技能',
      message: `确定删除技能「${s.title}」？`,
      details: '本地技能文件夹也将一并删除，此操作不可恢复。',
      confirmText: '删除',
      variant: 'danger',
    })
    if (!ok) return
    setDeletingSkillId(skillId)
    try {
      await deleteSkill(skillId)
      await refreshSkills()
    } catch (err) {
      setSkillError(err instanceof Error ? err.message : '删除技能失败')
    } finally {
      setDeletingSkillId(null)
    }
  }

  // ==================== 导入/导出操作 ====================
  const openExportBookDialog = () => {
    if (books.length === 0) return
    setBookError(null)
    setSelectedExportBookId((current) =>
      books.some((item) => item.id === current) ? current : books[0]?.id ?? '',
    )
    setExportBookOpen(true)
  }

  const openExportMaterialDialog = () => {
    if (materials.length === 0) return
    setMaterialError(null)
    setSelectedExportMaterialId((current) =>
      materials.some((item) => item.id === current) ? current : materials[0]?.id ?? '',
    )
    setExportMaterialOpen(true)
  }

  const openExportSkillDialog = () => {
    if (skills.length === 0) return
    setSkillError(null)
    setSelectedExportSkillId((current) =>
      skills.some((item) => item.id === current) ? current : skills[0]?.id ?? '',
    )
    setExportSkillOpen(true)
  }

  const handleExportBook = async (bookId: string) => {
    setExportingId(bookId)
    setBookError(null)
    let shouldClose = false
    try {
      const result = await exportBook(bookId)
      if (result.error) {
        setBookError(result.error)
      } else {
        shouldClose = true
      }
    } catch (err) {
      setBookError(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExportingId(null)
      if (shouldClose) setExportBookOpen(false)
    }
  }

  const handleExportMaterial = async (materialId: string) => {
    setExportingId(materialId)
    setMaterialError(null)
    let shouldClose = false
    try {
      const result = await exportLibrary('material', materialId)
      if (result.error) {
        setMaterialError(result.error)
      } else {
        shouldClose = true
      }
    } catch (err) {
      setMaterialError(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExportingId(null)
      if (shouldClose) setExportMaterialOpen(false)
    }
  }

  const handleExportSkill = async (skillId: string) => {
    setExportingId(skillId)
    setSkillError(null)
    let shouldClose = false
    try {
      const result = await exportLibrary('skill', skillId)
      if (result.error) {
        setSkillError(result.error)
      } else {
        shouldClose = true
      }
    } catch (err) {
      setSkillError(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExportingId(null)
      if (shouldClose) setExportSkillOpen(false)
    }
  }

  const handleExportBookSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedExportBookId) return
    await handleExportBook(selectedExportBookId)
  }

  const handleExportMaterialSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedExportMaterialId) return
    await handleExportMaterial(selectedExportMaterialId)
  }

  const handleExportSkillSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedExportSkillId) return
    await handleExportSkill(selectedExportSkillId)
  }

  const handleImportBook = async () => {
    setImportingBook(true)
    setBookError(null)
    try {
      const result = await importBook(workspaceRoot)
      if (result.error) {
        setBookError(result.error)
      } else if (result.success) {
        await refreshBooks()
      }
    } catch (err) {
      setBookError(err instanceof Error ? err.message : '导入失败')
    } finally {
      setImportingBook(false)
    }
  }

  const handleImportMaterial = async () => {
    setImportingMaterial(true)
    setMaterialError(null)
    try {
      const result = await importLibrary('material', workspaceRoot)
      if (result.error) {
        setMaterialError(result.error)
      } else if (result.success) {
        await refreshMaterials()
        await refreshSkills()
      }
    } catch (err) {
      setMaterialError(err instanceof Error ? err.message : '导入失败')
    } finally {
      setImportingMaterial(false)
    }
  }

  const handleImportSkill = async () => {
    setImportingSkill(true)
    setSkillError(null)
    try {
      const result = await importLibrary('skill', workspaceRoot)
      if (result.error) {
        setSkillError(result.error)
      } else if (result.success) {
        await refreshMaterials()
        await refreshSkills()
      }
    } catch (err) {
      setSkillError(err instanceof Error ? err.message : '导入失败')
    } finally {
      setImportingSkill(false)
    }
  }

  // ==================== 素材类型/分类改变处理 ====================
  const handleMaterialParentGenreChange = useCallback((genre: string) => {
    setMaterialParentGenre(genre)
  }, [])

  const handleMaterialTypeChange = useCallback((type: MaterialType) => {
    setMaterialType(type)
    setMaterialParentGenre(getMaterialParentGenres(type)[0] ?? '')
  }, [])

  // ==================== 渲染 ====================
  const loadUserMemoryList = useCallback(async (type: 'short' | 'script') => {
    setLoadingUserMemories(true)
    setUserMemoryError(null)
    try {
      const next = await getUserMemories(type)
      setUserMemories(next)
      setUserMemoryResetKey((value) => value + 1)
    } catch (err) {
      setUserMemoryError(err instanceof Error ? err.message : '读取记忆失败')
    } finally {
      setLoadingUserMemories(false)
    }
  }, [])

  const openUserMemoryManager = useCallback(() => {
    void (async () => {
      await loadUserMemoryList(userMemoryType)
      setUserMemoryOpen(true)
    })()
  }, [loadUserMemoryList, userMemoryType])

  const switchUserMemoryType = useCallback(
    (type: 'short' | 'script') => {
      if (type === userMemoryType) return
      setUserMemoryType(type)
      void loadUserMemoryList(type)
    },
    [loadUserMemoryList, userMemoryType],
  )

  const handleSaveUserMemories = useCallback(
    async (next: MemoryEntry[]) => {
      setSavingUserMemories(true)
      setUserMemoryError(null)
      try {
        const saved = await saveUserMemories(userMemoryType, next)
        setUserMemories(saved)
        setUserMemoryResetKey((value) => value + 1)
        setUserMemoryOpen(false)
      } catch (err) {
        setUserMemoryError(err instanceof Error ? err.message : '保存记忆失败')
      } finally {
        setSavingUserMemories(false)
      }
    },
    [userMemoryType],
  )

  const visibleBooks = useMemo(
    () => books.filter((book) => book.status !== 'completed'),
    [books],
  )
  const completedBooks = useMemo(
    () => books.filter((book) => book.status === 'completed'),
    [books],
  )
  const bookCardItems = useMemo(
    () => visibleBooks.map((b) => bookToCardItem(b, bookCovers[b.id])),
    [visibleBooks, bookCovers],
  )
  const completedBookCardItems = useMemo(
    () => completedBooks.map((b) => bookToCardItem(b, bookCovers[b.id])),
    [completedBooks, bookCovers],
  )
  const materialCardItems = useMemo(() => materials.map(materialToCardItem), [materials])
  const skillCardItems = useMemo(() => skills.map(skillToCardItem), [skills])
  const bookExportItems = useMemo(
    () => books.map(bookToExportDialogItem),
    [books],
  )
  const materialExportItems = useMemo(
    () => materials.map(materialToExportDialogItem),
    [materials],
  )
  const skillExportItems = useMemo(
    () => skills.map(skillToExportDialogItem),
    [skills],
  )

  return (
    <div className="home">
      <header className="home-header">
        <div className="home-brand">
          <h1 className="home-title">DeepSeekWrite</h1>
          <span className="home-tagline muted">简素为骨 · 笔墨为形</span>
        </div>
        <nav className="home-config-nav" aria-label="系统设置">
          <button
            type="button"
            className={
              workspaceDrawerOpen
                ? 'home-config-trigger home-config-trigger--active'
                : 'home-config-trigger'
            }
            aria-expanded={workspaceDrawerOpen}
            onClick={() => {
              setOtherFunctionsOpen(false)
              setWorkspaceDrawerOpen((open) => !open)
            }}
          >
            工作目录
          </button>
          <button
            type="button"
            className={modelConfigOpen ? 'home-config-trigger home-config-trigger--active' : 'home-config-trigger'}
            title={
              loadingAiSettings
                ? '加载模型配置中…'
                : `默认：${defaultTextModelLabel(aiSettings)} · 图像：${imageModelLabel(aiSettings)}`
            }
            disabled={loadingAiSettings}
            onClick={() => {
              setOtherFunctionsOpen(false)
              setModelConfigError(null)
              setModelConfigOpen(true)
            }}
          >
            {loadingAiSettings ? '模型配置…' : '模型配置'}
          </button>
          <button
            type="button"
            className={
              learningImitationOpen || learningImitationBackground
                ? 'home-config-trigger home-config-trigger--active'
                : 'home-config-trigger'
            }
            aria-expanded={learningImitationOpen}
            onClick={() => {
              setOtherFunctionsOpen(false)
              setLearningImitationOpen(true)
            }}
          >
            {learningImitationBackground && !learningImitationOpen
              ? '学习仿写后台中'
              : '学习仿写'}
          </button>
          <div className="home-config-menu" ref={otherFunctionsRef}>
            <button
              type="button"
              className={
                otherFunctionsOpen ||
                styleConfigOpen ||
                textDisplayOpen ||
                userMemoryOpen ||
                updateDialogOpen ||
                checkingUpdate ||
                downloadingUpdate
                  ? 'home-config-trigger home-config-trigger--active home-config-trigger--menu'
                  : 'home-config-trigger home-config-trigger--menu'
              }
              aria-haspopup="menu"
              aria-expanded={otherFunctionsOpen}
              onClick={() => setOtherFunctionsOpen((open) => !open)}
            >
              其他功能
            </button>
            {otherFunctionsOpen ? (
              <div className="home-config-menu-panel" role="menu" aria-label="其他功能">
                <button
                  type="button"
                  className="home-config-menu-item"
                  role="menuitem"
                  title={`当前：${APPEARANCE_STYLE_LABELS[appearanceStyle]}`}
                  disabled={savingAppearance}
                  onClick={() => {
                    setOtherFunctionsOpen(false)
                    setStyleConfigError(null)
                    setStyleConfigOpen(true)
                  }}
                >
                  <span>风格配置</span>
                  <small>{APPEARANCE_STYLE_LABELS[appearanceStyle]}</small>
                </button>
                <button
                  type="button"
                  className="home-config-menu-item"
                  role="menuitem"
                  disabled={savingTextDisplay}
                  onClick={() => {
                    setOtherFunctionsOpen(false)
                    setTextDisplayError(null)
                    setTextDisplayOpen(true)
                  }}
                >
                  <span>{savingTextDisplay ? '文字显示…' : '文字显示'}</span>
                  <small>{TEXT_DISPLAY_MODE_LABELS[textDisplayMode]}</small>
                </button>
                <button
                  type="button"
                  className="home-config-menu-item"
                  role="menuitem"
                  disabled={loadingUserMemories}
                  onClick={() => {
                    setOtherFunctionsOpen(false)
                    openUserMemoryManager()
                  }}
                >
                  <span>{loadingUserMemories ? '记忆加载中' : '记忆管理'}</span>
                  <small>短篇与剧本记忆</small>
                </button>
                <button
                  type="button"
                  className="home-config-menu-item"
                  role="menuitem"
                  title={currentAppVersion ? `当前版本：v${currentAppVersion}` : '查看版本更新信息'}
                  disabled={checkingUpdate || downloadingUpdate}
                  onClick={() => {
                    setOtherFunctionsOpen(false)
                    void handleCheckUpdate()
                  }}
                >
                  <span>
                    {downloadingUpdate
                      ? '后台下载中'
                      : checkingUpdate
                        ? '检查中…'
                        : '软件更新'}
                  </span>
                  <small>{currentAppVersion ? `v${currentAppVersion}` : '检查新版本'}</small>
                </button>
              </div>
            ) : null}
          </div>
        </nav>
      </header>

      {dialog}

      {updateDialogOpen ? (
        <UpdateDialog
          checking={checkingUpdate}
          result={updateCheckResult}
          error={updateError}
          onClose={() => setUpdateDialogOpen(false)}
          onRetry={() => void handleCheckUpdate()}
          onDownload={() => void handleDownloadUpdate()}
        />
      ) : null}

      {modelConfigError && !modelConfigOpen ? (
        <p className="home-config-error" role="alert">
          {modelConfigError}
        </p>
      ) : null}

      {(styleConfigError || appearanceError) && !styleConfigOpen ? (
        <p className="home-config-error" role="alert">
          {styleConfigError || appearanceError}
        </p>
      ) : null}

      {textDisplayError && !textDisplayOpen ? (
        <p className="home-config-error" role="alert">
          {textDisplayError}
        </p>
      ) : null}

      {workspaceDrawerOpen ? (
        <section className="home-config-drawer" aria-label="工作目录设置">
          <div className="home-config-drawer-inner">
            <div className="home-config-drawer-text">
              <span className="home-config-drawer-label">当前工作目录</span>
              <span className="home-config-drawer-path" title={workspaceRoot ?? undefined}>
                {workspaceRoot ? truncatePath(workspaceRoot, 72) : '尚未选择，创建项目前需指定本机文件夹'}
              </span>
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void handlePickWorkspace()}
            >
              {workspaceRoot ? '更改目录' : '选择文件夹'}
            </button>
          </div>
        </section>
      ) : null}

      <div className="home-cards-layout">
        {/* 书籍卡片 */}
        <section className="main-card books-card" aria-label="创作空间">
          <header className="card-header">
            <div className="card-header-icon book-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <div className="card-header-content">
              <h2 className="card-header-title">创作空间</h2>
              <span className="card-header-count">{visibleBooks.length} 本书</span>
            </div>
            <div className="card-header-actions">
              <button
                type="button"
                className="btn-secondary btn-small btn-icon"
                aria-label="刷新创作空间"
                title="刷新创作空间"
                disabled={loadingBooks}
                onClick={() => void refreshBooks()}
              >
                <RefreshIcon spinning={loadingBooks} />
              </button>
              <button
                type="button"
                className="btn-secondary btn-small"
                disabled={importingBook}
                onClick={() => void handleImportBook()}
              >
                {importingBook ? '导入中…' : '导入'}
              </button>
              <button
                type="button"
                className="btn-secondary btn-small"
                disabled={books.length === 0}
                onClick={openExportBookDialog}
              >
                导出
              </button>
              <Link
                className="btn-secondary btn-small"
                to="/workspace-settings"
              >
                设置
              </Link>
              <button
                type="button"
                className="btn-primary btn-small"
                onClick={() => {
                  setBookError(null)
                  setShowBookForm(true)
                }}
              >
                + 创建书籍
              </button>
            </div>
          </header>

          <div className="card-content-area">
            {loadingBooks ? (
              <div className="loading-state">
                <div className="spinner" />
                <span>加载中…</span>
              </div>
            ) : visibleBooks.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
                <p>暂无书籍</p>
                <span className="empty-hint">点击「创建书籍」开始写作</span>
              </div>
            ) : (
              <CardGrid
                items={bookCardItems}
                emptyText="暂无书籍"
                onDelete={handleDeleteBook}
                deletingId={deletingBookId}
              />
            )}
          </div>

          {!loadingBooks && completedBooks.length > 0 ? (
            <div className="books-completed-section" aria-label="已完成书籍">
              <h3 className="books-completed-heading muted">
                已完成 · {completedBooks.length} 本
              </h3>
              <CardGrid
                items={completedBookCardItems}
                emptyText="暂无已完成书籍"
                onDelete={handleDeleteBook}
                deletingId={deletingBookId}
              />
            </div>
          ) : null}
        </section>

        <div className="library-stack" aria-label="素材库和技能库">
        {/* 素材卡片 */}
        <section className="main-card materials-card library-card" aria-label="素材库">
          <header className="card-header">
            <div className="card-header-icon material-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div className="card-header-content">
              <h2 className="card-header-title">素材库</h2>
              <span className="card-header-count">{materials.length} 个素材</span>
            </div>
            <div className="card-header-actions">
              <button
                type="button"
                className="btn-secondary btn-small btn-icon"
                aria-label="刷新素材库"
                title="刷新素材库"
                disabled={loadingMaterials}
                onClick={() => void refreshMaterials()}
              >
                <RefreshIcon spinning={loadingMaterials} />
              </button>
              <button
                type="button"
                className="btn-secondary btn-small"
                disabled={importingMaterial}
                onClick={() => void handleImportMaterial()}
              >
                {importingMaterial ? '导入中…' : '导入'}
              </button>
              <button
                type="button"
                className="btn-secondary btn-small"
                disabled={materials.length === 0}
                onClick={openExportMaterialDialog}
              >
                导出
              </button>
              <Link
                className="btn-secondary btn-small"
                to="/material-settings"
              >
                设置
              </Link>
              <button
                type="button"
                className="btn-primary btn-small"
                onClick={() => {
                  setMaterialError(null)
                  setShowMaterialForm(true)
                }}
              >
                + 创建素材
              </button>
            </div>
          </header>
          <div className="card-content-area">
            {loadingMaterials ? (
              <div className="loading-state">
                <div className="spinner" />
                <span>加载中…</span>
              </div>
            ) : materials.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <p>暂无素材</p>
                <span className="empty-hint">点击「创建素材」添加素材</span>
              </div>
            ) : (
              <CardGrid
                items={materialCardItems}
                emptyText="暂无素材"
                onDelete={handleDeleteMaterial}
                deletingId={deletingMaterialId}
              />
            )}
          </div>
        </section>

        {/* 技能卡片 */}
        <section className="main-card skills-card library-card" aria-label="技能库">
          <header className="card-header">
            <div className="card-header-icon skill-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 3v3" />
                <path d="M18.5 5.5l-2.1 2.1" />
                <path d="M21 12h-3" />
                <path d="M18.5 18.5l-2.1-2.1" />
                <path d="M12 21v-3" />
                <path d="M5.5 18.5l2.1-2.1" />
                <path d="M3 12h3" />
                <path d="M5.5 5.5l2.1 2.1" />
                <path d="M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0z" />
              </svg>
            </div>
            <div className="card-header-content">
              <h2 className="card-header-title">技能库</h2>
              <span className="card-header-count">{skills.length} 个技能</span>
            </div>
            <div className="card-header-actions">
              <button
                type="button"
                className="btn-secondary btn-small btn-icon"
                aria-label="刷新技能库"
                title="刷新技能库"
                disabled={loadingSkills}
                onClick={() => void refreshSkills()}
              >
                <RefreshIcon spinning={loadingSkills} />
              </button>
              <button
                type="button"
                className="btn-secondary btn-small"
                disabled={importingSkill}
                onClick={() => void handleImportSkill()}
              >
                {importingSkill ? '导入中…' : '导入'}
              </button>
              <button
                type="button"
                className="btn-secondary btn-small"
                disabled={skills.length === 0}
                onClick={openExportSkillDialog}
              >
                导出
              </button>
              <Link
                className="btn-secondary btn-small"
                to="/skill-settings"
              >
                设置
              </Link>
              <button
                type="button"
                className="btn-primary btn-small"
                onClick={() => {
                  setSkillError(null)
                  setShowSkillForm(true)
                }}
              >
                + 创建技能
              </button>
            </div>
          </header>
          <div className="card-content-area">
            {loadingSkills ? (
              <div className="loading-state">
                <div className="spinner" />
                <span>加载中…</span>
              </div>
            ) : skills.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M12 3v3" />
                    <path d="M18.5 5.5l-2.1 2.1" />
                    <path d="M21 12h-3" />
                    <path d="M18.5 18.5l-2.1-2.1" />
                    <path d="M12 21v-3" />
                    <path d="M5.5 18.5l2.1-2.1" />
                    <path d="M3 12h3" />
                    <path d="M5.5 5.5l2.1 2.1" />
                    <path d="M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0z" />
                  </svg>
                </div>
                <p>暂无技能</p>
                <span className="empty-hint">点击「创建技能」添加技能</span>
              </div>
            ) : (
              <CardGrid
                items={skillCardItems}
                emptyText="暂无技能"
                onDelete={handleDeleteSkill}
                deletingId={deletingSkillId}
              />
            )}
          </div>
        </section>
        </div>
      </div>

      {exportBookOpen && (
        <LibraryExportDialog
          title="导出创作空间"
          titleId="export-book-title"
          itemLabel="书籍"
          items={bookExportItems}
          selectedId={selectedExportBookId}
          submitting={exportingId !== null}
          error={bookError}
          onSelect={setSelectedExportBookId}
          onClose={() => setExportBookOpen(false)}
          onSubmit={handleExportBookSubmit}
        />
      )}

      {exportMaterialOpen && (
        <LibraryExportDialog
          title="导出素材"
          titleId="export-material-title"
          itemLabel="素材"
          items={materialExportItems}
          selectedId={selectedExportMaterialId}
          submitting={exportingId !== null}
          error={materialError}
          onSelect={setSelectedExportMaterialId}
          onClose={() => setExportMaterialOpen(false)}
          onSubmit={handleExportMaterialSubmit}
        />
      )}

      {exportSkillOpen && (
        <LibraryExportDialog
          title="导出技能"
          titleId="export-skill-title"
          itemLabel="技能"
          items={skillExportItems}
          selectedId={selectedExportSkillId}
          submitting={exportingId !== null}
          error={skillError}
          onSelect={setSelectedExportSkillId}
          onClose={() => setExportSkillOpen(false)}
          onSubmit={handleExportSkillSubmit}
        />
      )}

      {showBookForm && (
        <CreateDialog
          title="创建书籍"
          titleId="create-book-title"
          submitting={submittingBook}
          onClose={() => setShowBookForm(false)}
          onSubmit={handleCreateBook}
        >
          <label className="field">
            <span className="field-label">书名</span>
            <input
              type="text"
              value={bookTitle}
              onChange={(e) => setBookTitle(e.target.value)}
              placeholder="请输入书名"
              required
              autoFocus
            />
          </label>

          <fieldset className="field">
            <legend className="field-label">类型</legend>
            <div className="radio-row">
              <label className="radio">
                <input
                  type="radio"
                  name="bookType"
                  checked={bookType === 'short'}
                  onChange={() => setBookType('short')}
                />
                短篇
              </label>
              <label className="radio">
                <input
                  type="radio"
                  name="bookType"
                  checked={bookType === 'script'}
                  onChange={() => setBookType('script')}
                />
                剧本
              </label>
              <label className="radio">
                <input
                  type="radio"
                  name="bookType"
                  checked={bookType === 'long'}
                  onChange={() => {
                    setBookType('long')
                    setBookLinkedSkillId('')
                    setBookLinkedMaterialId('')
                  }}
                />
                长篇
              </label>
            </div>
          </fieldset>

          {(bookType === 'short' || bookType === 'script') && (
            <>
              <fieldset className="field">
                <legend className="field-label">{bookTypeLabel(bookType)}分类</legend>
                <div className="genre-grid">
                  {(bookType === 'script' ? SCRIPT_GENRE_OPTIONS : SHORT_GENRE_OPTIONS).map((g) => (
                    <label key={g} className="radio">
                      <input
                        type="radio"
                        name="shortGenre"
                        checked={shortGenre === g}
                        onChange={() => setShortGenre(g)}
                      />
                      {g}
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="field">
                <span className="field-label">绑定技能库</span>
                <select
                  value={bookLinkedSkillId}
                  onChange={(e) => setBookLinkedSkillId(e.target.value)}
                  disabled={loadingSkills}
                >
                  <option value="">不绑定</option>
                  {skills.map((skill) => (
                    <option key={skill.id} value={skill.id}>
                      {skill.title}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="field-label">绑定素材库</span>
                <select
                  value={bookLinkedMaterialId}
                  onChange={(e) => setBookLinkedMaterialId(e.target.value)}
                  disabled={loadingMaterials}
                >
                  <option value="">不绑定</option>
                  {materials.map((material) => (
                    <option key={material.id} value={material.id}>
                      {material.title}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          {bookError && <p className="form-error">{bookError}</p>}
        </CreateDialog>
      )}

      {showMaterialForm && (
        <CreateDialog
          title="创建素材"
          titleId="create-material-title"
          submitting={submittingMaterial}
          onClose={() => setShowMaterialForm(false)}
          onSubmit={handleCreateMaterial}
        >
          <label className="field">
            <span className="field-label">素材标题</span>
            <input
              type="text"
              value={materialTitle}
              onChange={(e) => setMaterialTitle(e.target.value)}
              placeholder="请输入素材标题"
              required
              autoFocus
            />
          </label>

          <fieldset className="field">
            <legend className="field-label">素材类型</legend>
            <div className="radio-row">
              <label className="radio">
                <input
                  type="radio"
                  name="materialType"
                  checked={materialType === 'long'}
                  onChange={() => handleMaterialTypeChange('long')}
                />
                长篇
              </label>
              <label className="radio">
                <input
                  type="radio"
                  name="materialType"
                  checked={materialType === 'short'}
                  onChange={() => handleMaterialTypeChange('short')}
                />
                短篇
              </label>
              <label className="radio">
                <input
                  type="radio"
                  name="materialType"
                  checked={materialType === 'script'}
                  onChange={() => handleMaterialTypeChange('script')}
                />
                剧本
              </label>
            </div>
          </fieldset>

          {(materialType === 'short' || materialType === 'script') && (
            <fieldset className="field">
              <legend className="field-label">大分类</legend>
              <div className="genre-grid">
                {getMaterialParentGenres(materialType).map((g) => (
                  <label key={g} className="radio">
                    <input
                      type="radio"
                      name="materialParentGenre"
                      checked={materialParentGenre === g}
                      onChange={() => handleMaterialParentGenreChange(g)}
                    />
                    {g}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {materialError && <p className="form-error">{materialError}</p>}
        </CreateDialog>
      )}

      {showSkillForm && (
        <CreateDialog
          title="创建技能"
          titleId="create-skill-title"
          submitting={submittingSkill}
          onClose={() => setShowSkillForm(false)}
          onSubmit={handleCreateSkill}
        >
          <label className="field">
            <span className="field-label">技能标题</span>
            <input
              type="text"
              value={skillTitle}
              onChange={(e) => setSkillTitle(e.target.value)}
              placeholder="请输入技能标题"
              required
              autoFocus
            />
          </label>

          <fieldset className="field">
            <legend className="field-label">技能类型</legend>
            <div className="radio-row">
              {(['short', 'long', 'script'] as const).map((type) => (
                <label key={type} className="radio">
                  <input
                    type="radio"
                    name="skillType"
                    checked={skillType === type}
                    onChange={() => setSkillType(type)}
                  />
                  {skillTypeLabel(type)}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="radio create-form-checkbox">
            <input
              type="checkbox"
              checked={loadCommonSkills}
              onChange={(event) => setLoadCommonSkills(event.target.checked)}
            />
            <span>
              加载通用技能库
              <small>按通用技能设置中的生效阶段，复制到新技能库</small>
            </span>
          </label>

          {skillError && <p className="form-error">{skillError}</p>}
        </CreateDialog>
      )}

      {userMemoryOpen && (
        <MemoryManagerDialog
          title="用户记忆"
          memories={userMemories}
          saving={savingUserMemories}
          loading={loadingUserMemories}
          error={userMemoryError}
          resetKey={userMemoryResetKey}
          headerActions={
            <div className="memory-dialog-tabs" role="tablist" aria-label="记忆类型">
              {(['short', 'script'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  className={
                    userMemoryType === type
                      ? 'memory-dialog-tab memory-dialog-tab--active'
                      : 'memory-dialog-tab'
                  }
                  onClick={() => switchUserMemoryType(type)}
                  disabled={savingUserMemories || loadingUserMemories || userMemoryType === type}
                >
                  {bookTypeLabel(type)}
                </button>
              ))}
            </div>
          }
          onClose={() => {
            if (!savingUserMemories) setUserMemoryOpen(false)
          }}
          onSave={handleSaveUserMemories}
        />
      )}

      {modelConfigOpen && (
        <ModelConfigDialog
          initialSettings={aiSettings}
          saving={savingAiSettings}
          onClose={() => {
            if (!savingAiSettings) setModelConfigOpen(false)
          }}
          onSave={handleSaveAiSettings}
          onRefresh={refreshAiSettings}
        />
      )}

      {styleConfigOpen && (
        <AppearanceStyleDialog
          currentStyle={appearanceStyle}
          saving={savingAppearance}
          error={styleConfigError || appearanceError}
          onClose={() => setStyleConfigOpen(false)}
          onSelect={handleSaveAppearanceStyle}
        />
      )}

      {textDisplayOpen && (
        <TextDisplayDialog
          currentMode={textDisplayMode}
          saving={savingTextDisplay}
          error={textDisplayError ?? textDisplayContextError}
          onClose={() => setTextDisplayOpen(false)}
          onSelect={handleSaveTextDisplayMode}
        />
      )}

      {(learningImitationOpen || learningImitationBackground) && (
        <LearningImitationDialog
          visible={learningImitationOpen}
          workspaceRoot={workspaceRoot}
          materials={materials}
          skills={skills}
          onClose={() => {
            setLearningImitationOpen(false)
            setLearningImitationBackground(false)
          }}
          onRunInBackground={() => {
            setLearningImitationOpen(false)
            setLearningImitationBackground(true)
          }}
          onBackgroundFinished={() => {
            setLearningImitationBackground(false)
          }}
          onRefreshMaterials={() => refreshMaterials({ showLoading: false })}
          onRefreshSkills={() => refreshSkills({ showLoading: false })}
        />
      )}
    </div>
  )
}

type ExportDialogItem = {
  id: string
  title: string
  meta: string
}

type LibraryExportDialogProps = {
  title: string
  titleId: string
  itemLabel: string
  items: ExportDialogItem[]
  selectedId: string
  submitting: boolean
  error: string | null
  onSelect: (id: string) => void
  onClose: () => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}

function LibraryExportDialog({
  title,
  titleId,
  itemLabel,
  items,
  selectedId,
  submitting,
  error,
  onSelect,
  onClose,
  onSubmit,
}: LibraryExportDialogProps) {
  return (
    <CreateDialog
      title={title}
      titleId={titleId}
      submitting={submitting}
      submitLabel="导出"
      submittingLabel="导出中…"
      submitDisabled={!selectedId || items.length === 0}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <fieldset className="field export-dialog-field">
        <legend className="field-label">选择要导出的{itemLabel}</legend>
        {items.length === 0 ? (
          <p className="export-dialog-empty">暂无可导出的{itemLabel}</p>
        ) : (
          <div className="export-dialog-list" role="radiogroup" aria-label={`选择要导出的${itemLabel}`}>
            {items.map((item, index) => (
              <label
                key={item.id}
                className={
                  selectedId === item.id
                    ? 'export-dialog-item export-dialog-item--active'
                    : 'export-dialog-item'
                }
              >
                <input
                  type="radio"
                  name={titleId}
                  checked={selectedId === item.id}
                  disabled={submitting}
                  autoFocus={index === 0}
                  onChange={() => onSelect(item.id)}
                />
                <span className="export-dialog-item-copy">
                  <strong>{item.title}</strong>
                  <em>{item.meta}</em>
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      {error && <p className="form-error">{error}</p>}
    </CreateDialog>
  )
}

function materialToExportDialogItem(material: MaterialSummary): ExportDialogItem {
  return {
    id: material.id,
    title: material.title || '未命名素材',
    meta: [materialTypeLabel(material.material_type), material.parent_genre]
      .filter(Boolean)
      .join(' · '),
  }
}

function bookToExportDialogItem(book: BookSummary): ExportDialogItem {
  return {
    id: book.id,
    title: book.title || '未命名书籍',
    meta: [bookTypeLabel(book.book_type), book.status === 'completed' ? '已完成' : '编辑中']
      .filter(Boolean)
      .join(' · '),
  }
}

function skillToExportDialogItem(skill: SkillSummary): ExportDialogItem {
  return {
    id: skill.id,
    title: skill.title || '未命名技能',
    meta: `${skillTypeLabel(skill.skill_type)} · ${skill.stage_skill_count ?? 0} 条技能`,
  }
}
