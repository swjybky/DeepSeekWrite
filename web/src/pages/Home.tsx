import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  SHORT_GENRE_OPTIONS,
  type AiModelConfig,
  type AiModelSettings,
  type BookSummary,
  type BookType,
  type MaterialSummary,
  type MaterialType,
  type SkillSummary,
  createBook,
  createSkill,
  deleteBook,
  deleteSkill,
  getBookCover,
  getAiModelConfig,
  getBridgeApi,
  getStoredWorkspaceRoot,
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
  SHORT_MATERIAL_GENRES,
  exportLibrary,
  importLibrary,
} from '../bridge'
import { CardGrid, bookToCardItem, materialToCardItem, skillToCardItem } from '../components/CardGrid'
import { refreshPreferredWorkspaceChatModel } from '../pi/workspaceChatPreferences'
import './Home.css'

function truncatePath(path: string, max = 42): string {
  if (path.length <= max) return path
  const head = Math.floor(max / 2) - 1
  const tail = max - head - 1
  return `${path.slice(0, head)}…${path.slice(-tail)}`
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
}

function ModelConfigDialog({
  initialSettings,
  saving,
  onClose,
  onSave,
}: ModelConfigDialogProps) {
  const [draft, setDraft] = useState<AiModelSettings>(() =>
    cloneAiSettings(initialSettings),
  )
  const [error, setError] = useState<string | null>(null)

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

  const addModel = useCallback(() => {
    setDraft((prev) => {
      const next = createDraftModel(prev.text.models.length + 1)
      const models = [...prev.text.models, next]
      return {
        ...prev,
        text: {
          models,
          default_model_id: prev.text.default_model_id || next.id,
        },
      }
    })
  }, [])

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

    const models = draft.text.models.map((model) => ({
      ...model,
      id: model.id.trim(),
      label: model.label.trim() || model.id.trim() || model.model_id.trim(),
      provider: model.provider.trim(),
      model_id: model.model_id.trim(),
      api_key: model.api_key.trim(),
      base_url: model.base_url?.trim() || undefined,
      api: model.api?.trim() || undefined,
    }))
    const incomplete = models.find(
      (model) => !model.id || !model.provider || !model.model_id || !model.api_key,
    )
    if (incomplete) {
      setError('请补齐文字模型的 ID、来源、模型名和 API Key')
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
                <button type="button" className="btn-secondary btn-small" onClick={addModel}>
                  添加模型
                </button>
              </div>

              {draft.text.models.length === 0 ? (
                <div className="model-config-empty">未配置文字模型</div>
              ) : (
                <div className="model-config-list">
                  {draft.text.models.map((model, index) => (
                    <article className="model-config-item" key={`${model.id}-${index}`}>
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
                        <button
                          type="button"
                          className="btn-secondary btn-small"
                          disabled={saving}
                          onClick={() => removeModel(index)}
                        >
                          删除
                        </button>
                      </div>

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
                            placeholder="sk-..."
                          />
                        </label>
                        <label className="field">
                          <span className="field-label">API 地址</span>
                          <input
                            type="text"
                            value={model.base_url ?? ''}
                            onChange={(e) => updateModel(index, { base_url: e.target.value })}
                            placeholder="https://api.example.com/v1"
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
                    </article>
                  ))}
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
      </section>
    </div>
  )
}

export function Home() {
  const location = useLocation()

  // ==================== 创作空间状态 ====================
  const [books, setBooks] = useState<BookSummary[]>([])
  const [loadingBooks, setLoadingBooks] = useState(true)
  const [showBookForm, setShowBookForm] = useState(false)
  const [bookTitle, setBookTitle] = useState('')
  const [bookType, setBookType] = useState<BookType>('short')
  const [shortGenre, setShortGenre] = useState<string>(SHORT_GENRE_OPTIONS[0])
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(() => getStoredWorkspaceRoot())
  const [submittingBook, setSubmittingBook] = useState(false)
  const [deletingBookId, setDeletingBookId] = useState<string | null>(null)
  const [bookError, setBookError] = useState<string | null>(null)
  const [bookCovers, setBookCovers] = useState<Record<string, string>>({})

  // ==================== 素材库状态 ====================
  const [materials, setMaterials] = useState<MaterialSummary[]>([])
  const [loadingMaterials, setLoadingMaterials] = useState(true)
  const [showMaterialForm, setShowMaterialForm] = useState(false)
  const [materialTitle, setMaterialTitle] = useState('')
  const [materialType, setMaterialType] = useState<MaterialType>('short')
  const [materialParentGenre, setMaterialParentGenre] = useState<string>(Object.keys(SHORT_MATERIAL_GENRES)[0])
  const [materialSubGenre, setMaterialSubGenre] = useState<string>(SHORT_MATERIAL_GENRES['世情'][0])
  const [submittingMaterial, setSubmittingMaterial] = useState(false)
  const [deletingMaterialId, setDeletingMaterialId] = useState<string | null>(null)
  const [materialError, setMaterialError] = useState<string | null>(null)

  // ==================== 技能库状态 ====================
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [loadingSkills, setLoadingSkills] = useState(true)
  const [showSkillForm, setShowSkillForm] = useState(false)
  const [skillTitle, setSkillTitle] = useState('')
  const [submittingSkill, setSubmittingSkill] = useState(false)
  const [deletingSkillId, setDeletingSkillId] = useState<string | null>(null)
  const [skillError, setSkillError] = useState<string | null>(null)

  // ==================== 导入/导出状态 ====================
  const [exportMaterialOpen, setExportMaterialOpen] = useState(false)
  const [exportSkillOpen, setExportSkillOpen] = useState(false)
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [importingMaterial, setImportingMaterial] = useState(false)
  const [importingSkill, setImportingSkill] = useState(false)

  // ==================== 模型配置状态 ====================
  const [aiSettings, setAiSettings] = useState<AiModelSettings>(() => emptyAiModelSettings())
  const [loadingAiSettings, setLoadingAiSettings] = useState(true)
  const [modelConfigOpen, setModelConfigOpen] = useState(false)
  const [workspaceDrawerOpen, setWorkspaceDrawerOpen] = useState(false)
  const [savingAiSettings, setSavingAiSettings] = useState(false)
  const [modelConfigError, setModelConfigError] = useState<string | null>(null)

  // ==================== 创作空间封面加载 ====================
  const loadBookCovers = useCallback(async (bookList: BookSummary[]) => {
    const api = await getBridgeApi()
    if (!api?.get_book_cover) return
    const results = await Promise.all(
      bookList.map(async (b) => {
        try {
          const res = await getBookCover(b.id)
          return { id: b.id, data: res.cover_data }
        } catch {
          return { id: b.id, data: null as string | null }
        }
      }),
    )
    const map: Record<string, string> = {}
    for (const r of results) {
      if (r.data) map[r.id] = r.data
    }
    setBookCovers(map)
  }, [])

  // ==================== 创作空间数据加载 ====================
  const refreshBooks = useCallback(async () => {
    setLoadingBooks(true)
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
  }, [loadBookCovers])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoadingBooks(true)
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
          if (!cancelled && w != null) {
            setWorkspaceRoot((prev) => prev ?? w)
          }
        })()
      }, 450)
    }

    return () => {
      cancelled = true
      if (lateTimer != null) window.clearTimeout(lateTimer)
    }
  }, [loadBookCovers, location.pathname])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoadingAiSettings(true)
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
  }, [])

  // ==================== 素材库数据加载 ====================
  const refreshMaterials = useCallback(async () => {
    setLoadingMaterials(true)
    setMaterialError(null)
    try {
      const list = await listMaterials()
      setMaterials(list)
    } catch (e) {
      setMaterialError(e instanceof Error ? e.message : '加载素材库失败')
    } finally {
      setLoadingMaterials(false)
    }
  }, [])

  // ==================== 技能库数据加载 ====================
  const refreshSkills = useCallback(async () => {
    setLoadingSkills(true)
    setSkillError(null)
    try {
      const list = await listSkills()
      setSkills(list)
    } catch (e) {
      setSkillError(e instanceof Error ? e.message : '加载技能库失败')
    } finally {
      setLoadingSkills(false)
    }
  }, [])

  // 初始加载素材与技能
  const hasLoadedLibraries = useRef(false)
  useEffect(() => {
    if (!hasLoadedLibraries.current) {
      hasLoadedLibraries.current = true
      void refreshMaterials()
      void refreshSkills()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      const cats = bookType === 'short' ? [shortGenre] : []
      await createBook(bookTitle, bookType, cats, ws)
      setBookTitle('')
      setBookType('short')
      setShortGenre(SHORT_GENRE_OPTIONS[0])
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
    const ok = window.confirm(`确定从创作空间移除「${b.title}」？\n书本文件夹仍会保留在工作目录中。`)
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
      const parentGenre = materialType === 'short' ? materialParentGenre : undefined
      const subGenre = materialType === 'short' ? materialSubGenre : undefined
      await createMaterial(materialTitle, materialType, parentGenre, subGenre, ws)
      setMaterialTitle('')
      setMaterialType('short')
      setMaterialParentGenre(Object.keys(SHORT_MATERIAL_GENRES)[0])
      setMaterialSubGenre(SHORT_MATERIAL_GENRES['世情'][0])
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
    const ok = window.confirm(`确定删除素材「${m.title}」？\n素材文件夹仍会保留在工作目录中。`)
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
      await createSkill(skillTitle, ws)
      setSkillTitle('')
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
    const ok = window.confirm(`确定删除技能「${s.title}」？\n技能文件夹仍会保留在工作目录中。`)
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
  const handleExportMaterial = async (materialId: string) => {
    setExportingId(materialId)
    setMaterialError(null)
    try {
      const result = await exportLibrary('material', materialId)
      if (result.error) {
        setMaterialError(result.error)
      }
    } catch (err) {
      setMaterialError(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExportingId(null)
      setExportMaterialOpen(false)
    }
  }

  const handleExportSkill = async (skillId: string) => {
    setExportingId(skillId)
    setSkillError(null)
    try {
      const result = await exportLibrary('skill', skillId)
      if (result.error) {
        setSkillError(result.error)
      }
    } catch (err) {
      setSkillError(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExportingId(null)
      setExportSkillOpen(false)
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
    const subGenres = SHORT_MATERIAL_GENRES[genre] || []
    setMaterialSubGenre(subGenres[0] || '')
  }, [])

  const handleMaterialTypeChange = useCallback((type: MaterialType) => {
    setMaterialType(type)
    if (type === 'short') {
      const currentSubGenres = SHORT_MATERIAL_GENRES[materialParentGenre] || []
      setMaterialSubGenre(currentSubGenres[0] || '')
    }
  }, [materialParentGenre])

  // ==================== 渲染 ====================
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

  return (
    <div className="home">
      <header className="home-header">
        <div className="home-brand">
          <h1 className="home-title">DeepseekWrite</h1>
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
            onClick={() => setWorkspaceDrawerOpen((open) => !open)}
          >
            工作目录
          </button>
          <button
            type="button"
            className="home-config-trigger"
            title={
              loadingAiSettings
                ? '加载模型配置中…'
                : `默认：${defaultTextModelLabel(aiSettings)} · 图像：${imageModelLabel(aiSettings)}`
            }
            disabled={loadingAiSettings}
            onClick={() => {
              setModelConfigError(null)
              setModelConfigOpen(true)
            }}
          >
            {loadingAiSettings ? '模型配置…' : '模型配置'}
          </button>
        </nav>
      </header>

      {modelConfigError && !modelConfigOpen ? (
        <p className="home-config-error" role="alert">
          {modelConfigError}
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
              <Link
                className="btn-secondary btn-small"
                to="/workspace-settings"
              >
                设置
              </Link>
              <button
                type="button"
                className={showBookForm ? 'btn-secondary btn-small' : 'btn-primary btn-small'}
                onClick={() => setShowBookForm((v) => !v)}
              >
                {showBookForm ? '收起' : '+ 创建书籍'}
              </button>
            </div>
          </header>

          {showBookForm && (
            <form className="create-form" onSubmit={handleCreateBook}>
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
                      checked={bookType === 'long'}
                      onChange={() => setBookType('long')}
                    />
                    长篇
                  </label>
                </div>
              </fieldset>

              {bookType === 'short' && (
                <fieldset className="field">
                  <legend className="field-label">短篇分类</legend>
                  <div className="genre-grid">
                    {SHORT_GENRE_OPTIONS.map((g) => (
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
              )}

              {bookError && <p className="form-error">{bookError}</p>}

              <button type="submit" className="btn-primary" disabled={submittingBook}>
                {submittingBook ? '创建中…' : '创建'}
              </button>
            </form>
          )}

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
                onClick={() => setExportMaterialOpen(true)}
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
                className={showMaterialForm ? 'btn-secondary btn-small' : 'btn-primary btn-small'}
                onClick={() => setShowMaterialForm((v) => !v)}
              >
                {showMaterialForm ? '收起' : '+ 创建素材'}
              </button>
            </div>
          </header>

          {exportMaterialOpen && (
            <div className="export-picker">
              <div className="export-picker-header">
                <span className="export-picker-title">选择要导出的素材</span>
                <button
                  type="button"
                  className="btn-secondary btn-small"
                  onClick={() => setExportMaterialOpen(false)}
                >
                  取消
                </button>
              </div>
              <ul className="export-picker-list">
                {materials.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      className="export-picker-item"
                      disabled={exportingId === m.id}
                      onClick={() => void handleExportMaterial(m.id)}
                    >
                      <span className="export-picker-item-title">{m.title}</span>
                      <span className="export-picker-item-meta">
                        {m.material_type === 'short' ? `${m.parent_genre || ''}${m.sub_genre ? ' · ' + m.sub_genre : ''}` : '长篇'}
                      </span>
                      {exportingId === m.id && <span className="export-picker-item-loading">导出中…</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {showMaterialForm && (
            <form className="create-form" onSubmit={handleCreateMaterial}>
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
                </div>
              </fieldset>

              {materialType === 'short' && (
                <>
                  <fieldset className="field">
                    <legend className="field-label">大分类</legend>
                    <div className="genre-grid">
                      {Object.keys(SHORT_MATERIAL_GENRES).map((g) => (
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

                  <fieldset className="field">
                    <legend className="field-label">子分类</legend>
                    <div className="genre-grid">
                      {(SHORT_MATERIAL_GENRES[materialParentGenre] || []).map((g) => (
                        <label key={g} className="radio">
                          <input
                            type="radio"
                            name="materialSubGenre"
                            checked={materialSubGenre === g}
                            onChange={() => setMaterialSubGenre(g)}
                          />
                          {g}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </>
              )}

              {materialError && <p className="form-error">{materialError}</p>}

              <button type="submit" className="btn-primary" disabled={submittingMaterial}>
                {submittingMaterial ? '创建中…' : '创建'}
              </button>
            </form>
          )}

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
                onClick={() => setExportSkillOpen(true)}
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
                className={showSkillForm ? 'btn-secondary btn-small' : 'btn-primary btn-small'}
                onClick={() => setShowSkillForm((v) => !v)}
              >
                {showSkillForm ? '收起' : '+ 创建技能'}
              </button>
            </div>
          </header>

          {exportSkillOpen && (
            <div className="export-picker">
              <div className="export-picker-header">
                <span className="export-picker-title">选择要导出的技能</span>
                <button
                  type="button"
                  className="btn-secondary btn-small"
                  onClick={() => setExportSkillOpen(false)}
                >
                  取消
                </button>
              </div>
              <ul className="export-picker-list">
                {skills.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="export-picker-item"
                      disabled={exportingId === s.id}
                      onClick={() => void handleExportSkill(s.id)}
                    >
                      <span className="export-picker-item-title">{s.title}</span>
                      <span className="export-picker-item-meta">
                        {s.stage_skill_count ?? 0} 条技能
                      </span>
                      {exportingId === s.id && <span className="export-picker-item-loading">导出中…</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {showSkillForm && (
            <form className="create-form" onSubmit={handleCreateSkill}>
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

              {skillError && <p className="form-error">{skillError}</p>}

              <button type="submit" className="btn-primary" disabled={submittingSkill}>
                {submittingSkill ? '创建中…' : '创建'}
              </button>
            </form>
          )}

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

      {modelConfigOpen && (
        <ModelConfigDialog
          initialSettings={aiSettings}
          saving={savingAiSettings}
          onClose={() => {
            if (!savingAiSettings) setModelConfigOpen(false)
          }}
          onSave={handleSaveAiSettings}
        />
      )}
    </div>
  )
}
