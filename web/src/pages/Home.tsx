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
  type MaterialKind,
  type MaterialLibraryGroup,
  type Material,
  type MaterialStageEntry,
  type MaterialStageId,
  type MaterialSummary,
  type Skill,
  type SkillKind,
  type SkillLibraryGroup,
  type SkillStageEntry,
  type SkillStageId,
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
  getMaterial,
  createMaterial,
  saveMaterial,
  deleteMaterial,
  listMaterialLibraryGroups,
  createMaterialLibraryGroup,
  deleteMaterialLibraryGroup,
  getSkill,
  saveSkill,
  listSkillLibraryGroups,
  createSkillLibraryGroup,
  deleteSkillLibraryGroup,
  occupiedLibraryIdsFromGroups,
  normalizeAiModelSettings,
  saveAiModelConfig,
  checkForUpdate,
  getMaterialParentGenres,
  getUserMemories,
  emptyLinkedMaterialIdsByKind,
  emptyLinkedSkillIdsByKind,
  MATERIAL_KIND_KEYS,
  MATERIAL_KIND_LABELS,
  MATERIAL_KIND_STAGE_IDS,
  SKILL_KIND_KEYS,
  SKILL_KIND_LABELS,
  SKILL_KIND_STAGE_IDS,
  SKILL_STAGE_KEYS,
  SKILL_STAGE_LABELS,
  materialMatchesKind,
  materialMetaLabel,
  materialTypeLabel,
  skillMatchesKind,
  saveUserMemories,
  skillTypeLabel,
  TEXT_MODEL_API_KEY_PLACEHOLDER,
  exportLibrary,
  importBook,
  importLibrary,
} from '../bridge'
import { APPEARANCE_STYLE_LABELS, useAppearance } from '../appearance'
import {
  CardGrid,
  bookToCardItem,
  materialGroupToCardItem,
  materialToCardItem,
  skillGroupToCardItem,
  skillToCardItem,
} from '../components/CardGrid'
import { MemoryManagerDialog } from '../components/MemoryManagerDialog'
import { useAppDialog } from '../components/useAppDialog'
import { LearningImitationDialog } from '../features/learningImitation/LearningImitationDialog'
import {
  startBackgroundUpdate,
  useBackgroundUpdate,
} from '../features/update/backgroundUpdate'
import { testAiTextModelConnection } from '../pi/testAiModelConnection'
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

function ChevronLeftIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
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

type ModelConnectionTestState = {
  status: 'testing' | 'success' | 'error'
  message: string
}

function ModelConnectionTestLabel({
  result,
}: {
  result?: ModelConnectionTestState
}) {
  if (!result) return null
  const text =
    result.status === 'testing'
      ? '测试中…'
      : result.status === 'success'
        ? '成功'
        : result.message || '联通失败'
  return (
    <span
      className={`model-test-result model-test-result--${result.status}`}
      role="status"
      title={text}
    >
      {text}
    </span>
  )
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
  onSave: (settings: AiModelSettings) => Promise<AiModelSettings>
  onRefresh: () => Promise<AiModelSettings>
}

type RefreshOptions = {
  showLoading?: boolean
}

type ModelRefreshOptions = {
  silentIfBusy?: boolean
}

type MaterialSplitMode = 'group' | 'single'
type SkillSplitMode = 'group' | 'single'

/**
 * 一键拆分时从综合/通用技能库拆出的目标分类（按条目内容归类，不是按阶段硬拆）：
 * - plot：剧情相关 + 人设相关
 * - general：跨阶段重复的通用能力（去 AI 味、逻辑审核等）
 * - other：其余不想归入剧情/通用的条目
 */
const SKILL_SPLIT_KIND_KEYS = ['plot', 'general', 'other'] as const
type SkillSplitKind = (typeof SKILL_SPLIT_KIND_KEYS)[number]

function materialKindShortLabel(kind: MaterialKind): string {
  return MATERIAL_KIND_LABELS[kind].replace(/素材库$/, '')
}

function skillKindShortLabel(kind: SkillKind): string {
  return SKILL_KIND_LABELS[kind].replace(/技能库$/, '')
}

function materialEntryHasContent(entry: MaterialStageEntry): boolean {
  return Boolean(entry.title?.trim() || entry.body?.trim())
}

function skillEntryHasContent(entry: SkillStageEntry): boolean {
  return Boolean(entry.title?.trim() || entry.body?.trim())
}

function materialKindHasContent(material: Material, kind: MaterialKind): boolean {
  const stageItems = material.stage_items ?? {}
  return MATERIAL_KIND_STAGE_IDS[kind].some((stageId) =>
    (stageItems[stageId] ?? []).some(materialEntryHasContent),
  )
}

function skillEntryFingerprint(entry: SkillStageEntry): string {
  const title = entry.title?.trim() || ''
  const body = entry.body?.trim() || ''
  if (entry.source_common_skill_id?.trim()) {
    return `common:${entry.source_common_skill_id.trim()}`
  }
  return `content:${title}\n${body}`
}

function skillEntrySearchText(entry: SkillStageEntry): string {
  return `${entry.title ?? ''}\n${entry.body ?? ''}`.toLowerCase()
}

/** 跨阶段重复的通用能力：去 AI 味、逻辑审核等 → 通用技能库 */
function isGeneralSplitSkillEntry(entry: SkillStageEntry): boolean {
  const text = skillEntrySearchText(entry)
  return (
    /去除.*ai|ai\s*味|ai\s*痕迹|生成痕迹|humanizer/.test(text) ||
    /逻辑(判断|审查|审核|校验)|一致性审查|故事发展逻辑/.test(text)
  )
}

/** 剧情 / 人设相关 → 剧情设计技能库 */
function isPlotSplitSkillEntry(entry: SkillStageEntry): boolean {
  const text = skillEntrySearchText(entry)
  return (
    /剧情|导语|大纲|细化|书名/.test(text) ||
    /人设|人物设计|角色设计/.test(text)
  )
}

function classifySkillEntryForSplit(entry: SkillStageEntry): SkillSplitKind {
  if (isGeneralSplitSkillEntry(entry)) return 'general'
  if (isPlotSplitSkillEntry(entry)) return 'plot'
  return 'other'
}

function cloneSkillEntry(entry: SkillStageEntry, now: string): SkillStageEntry {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
    title: entry.title?.trim() || '未命名技能',
    body: entry.body ?? '',
    created_at: now,
    updated_at: now,
    ...(entry.source_common_skill_id
      ? { source_common_skill_id: entry.source_common_skill_id }
      : {}),
  }
}

/**
 * 按条目内容拆分技能库：
 * 1. 去 AI 味 / 逻辑审核等跨阶段重复能力 → general（去重后只保留一份）
 * 2. 剧情、人设相关 → plot（保留原阶段槽位）
 * 3. 其余 → other
 */
function splitSkillStagesByContent(
  skill: Skill,
): Partial<Record<SkillSplitKind, Partial<Record<SkillStageId, SkillStageEntry[]>>>> {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const out: Partial<
    Record<SkillSplitKind, Partial<Record<SkillStageId, SkillStageEntry[]>>>
  > = {}
  const generalSeen = new Set<string>()
  const sourceStages = skill.stages ?? {}

  for (const stageId of SKILL_STAGE_KEYS) {
    for (const entry of sourceStages[stageId] ?? []) {
      if (!skillEntryHasContent(entry)) continue
      const kind = classifySkillEntryForSplit(entry)
      if (kind === 'general') {
        const fingerprint = skillEntryFingerprint(entry)
        if (generalSeen.has(fingerprint)) continue
        generalSeen.add(fingerprint)
      }
      const bucket = (out[kind] ??= {})
      const list = (bucket[stageId] ??= [])
      list.push(cloneSkillEntry(entry, now))
    }
  }
  return out
}

function copyMaterialStageItemsForKind(
  material: Material,
  kind: MaterialKind,
): Partial<Record<MaterialStageId, MaterialStageEntry[]>> {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const out: Partial<Record<MaterialStageId, MaterialStageEntry[]>> = {}
  const sourceItems = material.stage_items ?? {}
  for (const stageId of MATERIAL_KIND_STAGE_IDS[kind]) {
    const entries = (sourceItems[stageId] ?? []).filter(materialEntryHasContent)
    if (!entries.length) continue
    out[stageId] = entries.map((entry) => ({
      id: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
      title: entry.title?.trim() || '未命名素材',
      body: entry.body ?? '',
      created_at: now,
      updated_at: now,
    }))
  }
  return out
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
  const [notice, setNotice] = useState<string | null>(null)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [modelEditor, setModelEditor] = useState<ModelEditorState | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [modelTestResults, setModelTestResults] = useState<
    Record<string, ModelConnectionTestState>
  >({})
  const draftDirtyRef = useRef(false)
  const modelPickerOpenRef = useRef(false)
  const modelEditorOpenRef = useRef(false)
  const noticeTimerRef = useRef<number | null>(null)

  const clearNoticeTimer = useCallback(() => {
    if (noticeTimerRef.current == null) return
    window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = null
  }, [])

  const markDraftDirty = useCallback(() => {
    draftDirtyRef.current = true
    clearNoticeTimer()
    setNotice(null)
  }, [clearNoticeTimer])

  const showSaveNotice = useCallback((message: string) => {
    clearNoticeTimer()
    setNotice(message)
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null)
      noticeTimerRef.current = null
    }, 1800)
  }, [clearNoticeTimer])

  const canApplyRefreshedSettings = useCallback(
    () =>
      !draftDirtyRef.current &&
      !modelPickerOpenRef.current &&
      !modelEditorOpenRef.current,
    [],
  )

  const openModelPicker = useCallback(() => {
    modelPickerOpenRef.current = true
    setModelPickerOpen(true)
    setError(null)
    setNotice(null)
  }, [])

  const closeModelPicker = useCallback(() => {
    modelPickerOpenRef.current = false
    setModelPickerOpen(false)
  }, [])

  const closeModelEditor = useCallback(() => {
    modelEditorOpenRef.current = false
    setModelEditor(null)
    setModelTestResults((prev) => {
      if (!prev.editor) return prev
      const rest = { ...prev }
      delete rest.editor
      return rest
    })
  }, [])

  const handleRefresh = useCallback(async (options?: ModelRefreshOptions) => {
    if (!canApplyRefreshedSettings()) {
      if (!options?.silentIfBusy) {
        setError('当前有未保存的模型配置，请先保存或取消后再刷新')
      }
      return
    }
    setRefreshing(true)
    setError(null)
    setNotice(null)
    try {
      const settings = await onRefresh()
      if (!canApplyRefreshedSettings()) {
        if (!options?.silentIfBusy) {
          setError('模型配置已刷新，但当前正在编辑，暂未覆盖本地内容')
        }
        return
      }
      setDraft(cloneAiSettings(settings))
      setModelTestResults({})
      draftDirtyRef.current = false
    } catch (e) {
      setError(e instanceof Error ? e.message : '刷新模型配置失败')
    } finally {
      setRefreshing(false)
    }
  }, [canApplyRefreshedSettings, onRefresh])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (cancelled) return
      void handleRefresh({ silentIfBusy: true })
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [handleRefresh])

  useEffect(() => clearNoticeTimer, [clearNoticeTimer])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        event.preventDefault()
        if (modelEditor) {
          closeModelEditor()
        } else if (modelPickerOpen) {
          closeModelPicker()
        } else {
          onClose()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [closeModelEditor, closeModelPicker, modelEditor, modelPickerOpen, onClose, saving])

  const updateModel = useCallback(
    (index: number, patch: Partial<AiModelConfig>) => {
      markDraftDirty()
      setModelTestResults((prev) => {
        const key = `model-${index}`
        if (!prev[key]) return prev
        const rest = { ...prev }
        delete rest[key]
        return rest
      })
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
    [markDraftDirty],
  )

  const appendModel = useCallback((next: AiModelConfig) => {
    markDraftDirty()
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
  }, [markDraftDirty])

  const openModelEditor = useCallback(
    (preset?: OfficialTextModelPreset) => {
      const draftModel = preset
        ? { ...preset, api_key: '' }
        : createAvailableDraftModel(draft.text.models)
      modelEditorOpenRef.current = true
      modelPickerOpenRef.current = false
      setModelEditor({
        mode: preset ? 'official' : 'custom',
        draft: draftModel,
        preset,
        error: null,
      })
      setModelTestResults((prev) => {
        if (!prev.editor) return prev
        const rest = { ...prev }
        delete rest.editor
        return rest
      })
      setModelPickerOpen(false)
      setError(null)
      setNotice(null)
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
    setModelTestResults((prev) => {
      if (!prev.editor) return prev
      const rest = { ...prev }
      delete rest.editor
      return rest
    })
  }, [])

  const testModelConnection = useCallback(
    async (key: string, model: AiModelConfig) => {
      setModelTestResults((prev) => ({
        ...prev,
        [key]: { status: 'testing', message: '测试中…' },
      }))
      const result = await testAiTextModelConnection(model)
      setModelTestResults((prev) => ({
        ...prev,
        [key]: {
          status: result.ok ? 'success' : 'error',
          message: result.ok ? '成功' : result.message,
        },
      }))
    },
    [],
  )

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
        closeModelEditor()
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
      closeModelEditor()
    },
    [appendModel, closeModelEditor, draft.text.models, modelEditor],
  )

  const removeModel = useCallback((index: number) => {
    markDraftDirty()
    setModelTestResults({})
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
  }, [markDraftDirty])

  const updateImage = useCallback((field: keyof NonNullable<AiModelSettings['image']>, value: string) => {
    markDraftDirty()
    setDraft((prev) => ({
      ...prev,
      image: {
        ...(prev.image ?? { model: '', api_key: '' }),
        [field]: value,
      },
    }))
  }, [markDraftDirty])

  const clearImage = useCallback(() => {
    markDraftDirty()
    setDraft((prev) => ({ ...prev, image: null }))
  }, [markDraftDirty])

  const validateAndSave = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setNotice(null)

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
      const saved = await onSave(settings)
      setDraft(cloneAiSettings(saved))
      draftDirtyRef.current = false
      showSaveNotice('配置保存成功')
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
            {notice && (
              <div className="model-config-save-toast" role="status">
                {notice}
              </div>
            )}
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
                    onClick={openModelPicker}
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
                    const testKey = `model-${index}`
                    const testResult = modelTestResults[testKey]
                    const testingConnection = testResult?.status === 'testing'
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
                              onChange={() => {
                                markDraftDirty()
                                setDraft((prev) => ({
                                  ...prev,
                                  text: { ...prev.text, default_model_id: model.id },
                                }))
                              }}
                            />
                            默认
                          </label>
                          <div className="model-config-item-actions">
                            <ModelConnectionTestLabel result={testResult} />
                            <button
                              type="button"
                              className="btn-secondary btn-small"
                              disabled={saving || testingConnection}
                              onClick={() => void testModelConnection(testKey, model)}
                            >
                              {testingConnection ? '测试中…' : '测试联通'}
                            </button>
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
              if (event.target === event.currentTarget) closeModelPicker()
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
                  onClick={closeModelPicker}
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
              if (event.target === event.currentTarget) closeModelEditor()
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
                    onClick={closeModelEditor}
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

                <footer className="model-config-foot model-editor-foot">
                  <ModelConnectionTestLabel result={modelTestResults.editor} />
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={modelTestResults.editor?.status === 'testing'}
                    onClick={() => void testModelConnection('editor', modelEditor.draft)}
                  >
                    {modelTestResults.editor?.status === 'testing'
                      ? '测试中…'
                      : '测试联通'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={closeModelEditor}
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
  { id: 'night', label: APPEARANCE_STYLE_LABELS.night, tone: '黑色沉浸' },
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
  const [bookLinkedSkillIdsByKind, setBookLinkedSkillIdsByKind] =
    useState<Record<SkillKind, string[]>>(() => emptyLinkedSkillIdsByKind())
  const [bookLinkedMaterialIdsByKind, setBookLinkedMaterialIdsByKind] =
    useState<Record<MaterialKind, string[]>>(() => emptyLinkedMaterialIdsByKind())
  const [submittingBook, setSubmittingBook] = useState(false)
  const [deletingBookId, setDeletingBookId] = useState<string | null>(null)
  const [bookError, setBookError] = useState<string | null>(null)
  const [userMemoryOpen, setUserMemoryOpen] = useState(false)
  const [userMemoryType, setUserMemoryType] =
    useState<'short' | 'long' | 'script'>('short')
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
  const [materialKind, setMaterialKind] = useState<MaterialKind>('character')
  const [materialParentGenre, setMaterialParentGenre] = useState<string>(getMaterialParentGenres('short')[0] ?? '')
  const [submittingMaterial, setSubmittingMaterial] = useState(false)
  const [deletingMaterialId, setDeletingMaterialId] = useState<string | null>(null)
  const [materialError, setMaterialError] = useState<string | null>(null)
  const [materialActionsExpanded, setMaterialActionsExpanded] = useState(false)
  const [showMaterialSplitDialog, setShowMaterialSplitDialog] = useState(false)
  const [materialSplitSourceId, setMaterialSplitSourceId] = useState('')
  const [materialSplitMode, setMaterialSplitMode] = useState<MaterialSplitMode>('group')
  const [materialSplitGroupTitle, setMaterialSplitGroupTitle] = useState('')
  const [splittingMaterial, setSplittingMaterial] = useState(false)
  const [materialSplitError, setMaterialSplitError] = useState<string | null>(null)

  // ==================== 技能库状态 ====================
  const [loadingSkills, setLoadingSkills] = useState(
    () => !useHomeStore.getState().hasSkills,
  )
  const [showSkillForm, setShowSkillForm] = useState(false)
  const [skillTitle, setSkillTitle] = useState('')
  const [skillType, setSkillType] = useState<SkillType>('short')
  const [skillKind, setSkillKind] = useState<SkillKind>('general')
  const [loadCommonSkills, setLoadCommonSkills] = useState(false)
  const [submittingSkill, setSubmittingSkill] = useState(false)
  const [deletingSkillId, setDeletingSkillId] = useState<string | null>(null)
  const [skillError, setSkillError] = useState<string | null>(null)
  const [skillActionsExpanded, setSkillActionsExpanded] = useState(false)
  const [showSkillSplitDialog, setShowSkillSplitDialog] = useState(false)
  const [skillSplitSourceId, setSkillSplitSourceId] = useState('')
  const [skillSplitMode, setSkillSplitMode] = useState<SkillSplitMode>('group')
  const [skillSplitGroupTitle, setSkillSplitGroupTitle] = useState('')
  const [splittingSkill, setSplittingSkill] = useState(false)
  const [skillSplitError, setSkillSplitError] = useState<string | null>(null)

  // ==================== 素材/技能分组状态 ====================
  const [materialGroups, setMaterialGroups] = useState<MaterialLibraryGroup[]>([])
  const [skillGroups, setSkillGroups] = useState<SkillLibraryGroup[]>([])
  const [showMaterialGroupForm, setShowMaterialGroupForm] = useState(false)
  const [showSkillGroupForm, setShowSkillGroupForm] = useState(false)
  const [materialGroupTitle, setMaterialGroupTitle] = useState('')
  const [skillGroupTitle, setSkillGroupTitle] = useState('')
  const [materialGroupMembers, setMaterialGroupMembers] = useState<
    Partial<Record<MaterialKind, string>>
  >({})
  const [skillGroupMembers, setSkillGroupMembers] = useState<
    Partial<Record<SkillKind, string>>
  >({})
  const [submittingMaterialGroup, setSubmittingMaterialGroup] = useState(false)
  const [submittingSkillGroup, setSubmittingSkillGroup] = useState(false)
  const [deletingMaterialGroupId, setDeletingMaterialGroupId] = useState<string | null>(null)
  const [deletingSkillGroupId, setDeletingSkillGroupId] = useState<string | null>(null)
  const [materialGroupError, setMaterialGroupError] = useState<string | null>(null)
  const [skillGroupError, setSkillGroupError] = useState<string | null>(null)

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

  const bookMaterialOptionsByKind = useMemo(
    () =>
      MATERIAL_KIND_KEYS.reduce(
        (out, kind) => {
          out[kind] = materials.filter(
            (material) =>
              material.material_type === bookType && materialMatchesKind(material, kind),
          )
          return out
        },
        {} as Record<MaterialKind, MaterialSummary[]>,
      ),
    [bookType, materials],
  )

  const bookSkillOptionsByKind = useMemo(
    () =>
      SKILL_KIND_KEYS.reduce(
        (out, kind) => {
          out[kind] = skills.filter(
            (skill) =>
              skill.skill_type === bookType && skillMatchesKind(skill, kind),
          )
          return out
        },
        {} as Record<SkillKind, SkillSummary[]>,
      ),
    [bookType, skills],
  )

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
      const [list, groups] = await Promise.all([
        listMaterials(),
        listMaterialLibraryGroups(),
      ])
      setMaterials(list)
      setMaterialGroups(groups)
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
      const [list, groups] = await Promise.all([
        listSkills(),
        listSkillLibraryGroups(),
      ])
      setSkills(list)
      setSkillGroups(groups)
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

  const handleSaveAiSettings = async (
    settings: AiModelSettings,
  ): Promise<AiModelSettings> => {
    setSavingAiSettings(true)
    setModelConfigError(null)
    try {
      const saved = await saveAiModelConfig(settings)
      setAiSettings(saved)
      try {
        await refreshPreferredWorkspaceChatModel()
      } catch (e) {
        console.warn('[WriteClaw] 刷新 AI 模型偏好失败，模型配置已保存。', e)
      }
      return saved
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
      await createBook(
        bookTitle,
        bookType,
        cats,
        ws,
        null,
        null,
        bookLinkedMaterialIdsByKind,
        bookLinkedSkillIdsByKind,
      )
      setBookTitle('')
      setBookType('short')
      setShortGenre(SHORT_GENRE_OPTIONS[0])
      setBookLinkedSkillIdsByKind(emptyLinkedSkillIdsByKind())
      setBookLinkedMaterialIdsByKind(emptyLinkedMaterialIdsByKind())
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
    if (!ws && isPywebviewDesktopBundle()) {
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
      await createMaterial(materialTitle, materialType, parentGenre, subGenre, ws || null, materialKind)
      setMaterialTitle('')
      setMaterialType('short')
      setMaterialKind('character')
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
      await createSkill(skillTitle, skillType, ws, loadCommonSkills, skillKind)
      setSkillTitle('')
      setSkillType('short')
      setSkillKind('general')
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

  // ==================== 分组操作 ====================
  const occupiedMaterialIds = useMemo(
    () => occupiedLibraryIdsFromGroups(materialGroups),
    [materialGroups],
  )
  const occupiedSkillIds = useMemo(
    () => occupiedLibraryIdsFromGroups(skillGroups),
    [skillGroups],
  )

  const ungroupedMaterials = useMemo(
    () => materials.filter((item) => !occupiedMaterialIds.has(item.id)),
    [materials, occupiedMaterialIds],
  )
  const ungroupedSkills = useMemo(
    () => skills.filter((item) => !occupiedSkillIds.has(item.id)),
    [skills, occupiedSkillIds],
  )

  const materialGroupOptionsByKind = useMemo(
    () =>
      MATERIAL_KIND_KEYS.reduce(
        (out, kind) => {
          out[kind] = materials.filter(
            (material) =>
              materialMatchesKind(material, kind) &&
              !occupiedMaterialIds.has(material.id),
          )
          return out
        },
        {} as Record<MaterialKind, MaterialSummary[]>,
      ),
    [materials, occupiedMaterialIds],
  )

  const materialSplitCandidates = useMemo(
    () =>
      materials
        .filter((material) => material.material_kind === 'mixed')
        .sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN')),
    [materials],
  )

  const skillSplitCandidates = useMemo(
    () =>
      skills
        .filter((skill) => skill.skill_kind === 'general')
        .sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN')),
    [skills],
  )

  const skillGroupOptionsByKind = useMemo(
    () =>
      SKILL_KIND_KEYS.reduce(
        (out, kind) => {
          out[kind] = skills.filter(
            (skill) =>
              skillMatchesKind(skill, kind) && !occupiedSkillIds.has(skill.id),
          )
          return out
        },
        {} as Record<SkillKind, SkillSummary[]>,
      ),
    [skills, occupiedSkillIds],
  )

  const openMaterialGroupForm = () => {
    setMaterialGroupError(null)
    setMaterialGroupTitle('')
    setMaterialGroupMembers({})
    setShowMaterialGroupForm(true)
  }

  const openMaterialSplitDialog = () => {
    const source = materialSplitCandidates[0]
    setMaterialError(null)
    setMaterialSplitError(null)
    setMaterialSplitMode('group')
    setMaterialSplitSourceId(source?.id ?? '')
    setMaterialSplitGroupTitle(source ? `${source.title}分组` : '')
    setShowMaterialSplitDialog(true)
  }

  const openSkillSplitDialog = () => {
    const source = skillSplitCandidates[0]
    setSkillError(null)
    setSkillSplitError(null)
    setSkillSplitMode('group')
    setSkillSplitSourceId(source?.id ?? '')
    setSkillSplitGroupTitle(source ? `${source.title}分组` : '')
    setShowSkillSplitDialog(true)
  }

  const openSkillGroupForm = () => {
    setSkillGroupError(null)
    setSkillGroupTitle('')
    setSkillGroupMembers({})
    setShowSkillGroupForm(true)
  }

  const handleCreateMaterialGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmittingMaterialGroup(true)
    setMaterialGroupError(null)
    try {
      await createMaterialLibraryGroup(materialGroupTitle, materialGroupMembers)
      setShowMaterialGroupForm(false)
      setMaterialGroupTitle('')
      setMaterialGroupMembers({})
      await refreshMaterials()
    } catch (err) {
      setMaterialGroupError(err instanceof Error ? err.message : '创建素材分组失败')
    } finally {
      setSubmittingMaterialGroup(false)
    }
  }

  const handleSplitMaterial = async (e: React.FormEvent) => {
    e.preventDefault()
    const ws = workspaceRoot?.trim()
    if (!ws && isPywebviewDesktopBundle()) {
      setMaterialSplitError('请先在上方选择工作文件夹')
      return
    }
    const sourceSummary = materials.find((item) => item.id === materialSplitSourceId)
    if (!sourceSummary) {
      setMaterialSplitError('请选择要拆分的素材库')
      return
    }
    setSplittingMaterial(true)
    setMaterialSplitError(null)
    try {
      const source = await getMaterial(sourceSummary.id)
      if (!source) throw new Error('素材库不存在或已被删除')

      const createdMembers: Partial<Record<MaterialKind, string>> = {}
      const sourceTitle = source.title.trim() || sourceSummary.title || '未命名素材'

      for (const kind of MATERIAL_KIND_KEYS) {
        if (!materialKindHasContent(source, kind)) continue
        const stageItems = copyMaterialStageItemsForKind(source, kind)
        const title =
          source.material_kind === kind
            ? sourceTitle
            : `${sourceTitle}-${materialKindShortLabel(kind)}`
        const created = await createMaterial(
          title,
          source.material_type,
          source.parent_genre || null,
          source.sub_genre || null,
          ws || null,
          kind,
        )
        await saveMaterial(created.id, {
          overview: source.overview ?? '',
          stage_items: stageItems,
        })
        createdMembers[kind] = created.id
      }

      if (Object.values(createdMembers).every((id) => !id)) {
        throw new Error('这个素材库没有可拆分的条目内容')
      }

      if (materialSplitMode === 'group') {
        await createMaterialLibraryGroup(
          materialSplitGroupTitle.trim() || `${sourceTitle}分组`,
          createdMembers,
        )
      }

      setShowMaterialSplitDialog(false)
      setMaterialSplitSourceId('')
      setMaterialSplitGroupTitle('')
      await refreshMaterials()
    } catch (err) {
      setMaterialSplitError(err instanceof Error ? err.message : '拆分素材库失败')
    } finally {
      setSplittingMaterial(false)
    }
  }

  const handleSplitSkill = async (e: React.FormEvent) => {
    e.preventDefault()
    const ws = workspaceRoot?.trim()
    if (!ws && isPywebviewDesktopBundle()) {
      setSkillSplitError('请先在上方选择工作文件夹')
      return
    }
    const sourceSummary = skills.find((item) => item.id === skillSplitSourceId)
    if (!sourceSummary) {
      setSkillSplitError('请选择要拆分的技能库')
      return
    }
    setSplittingSkill(true)
    setSkillSplitError(null)
    try {
      const source = await getSkill(sourceSummary.id)
      if (!source) throw new Error('技能库不存在或已被删除')

      const createdMembers: Partial<Record<SkillKind, string>> = {}
      const sourceTitle = source.title.trim() || sourceSummary.title || '未命名技能'
      const splitBuckets = splitSkillStagesByContent(source)

      for (const kind of SKILL_SPLIT_KIND_KEYS) {
        const stages = splitBuckets[kind]
        if (!stages || Object.values(stages).every((entries) => !entries?.length)) {
          continue
        }
        const title =
          source.skill_kind === kind
            ? sourceTitle
            : `${sourceTitle}-${skillKindShortLabel(kind)}`
        const created = await createSkill(
          title,
          source.skill_type,
          ws || null,
          false,
          kind,
        )
        await saveSkill(created.id, {
          overview: source.overview ?? '',
          stages,
        })
        createdMembers[kind] = created.id
      }

      if (Object.values(createdMembers).every((id) => !id)) {
        throw new Error('这个技能库没有可拆分的条目内容')
      }

      if (skillSplitMode === 'group') {
        await createSkillLibraryGroup(
          skillSplitGroupTitle.trim() || `${sourceTitle}分组`,
          createdMembers,
        )
      }

      setShowSkillSplitDialog(false)
      setSkillSplitSourceId('')
      setSkillSplitGroupTitle('')
      await refreshSkills()
    } catch (err) {
      setSkillSplitError(err instanceof Error ? err.message : '拆分技能库失败')
    } finally {
      setSplittingSkill(false)
    }
  }

  const handleCreateSkillGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmittingSkillGroup(true)
    setSkillGroupError(null)
    try {
      await createSkillLibraryGroup(skillGroupTitle, skillGroupMembers)
      setShowSkillGroupForm(false)
      setSkillGroupTitle('')
      setSkillGroupMembers({})
      await refreshSkills()
    } catch (err) {
      setSkillGroupError(err instanceof Error ? err.message : '创建技能分组失败')
    } finally {
      setSubmittingSkillGroup(false)
    }
  }

  const handleDeleteMaterialCard = async (id: string) => {
    if (materialGroups.some((group) => group.id === id)) {
      const group = materialGroups.find((item) => item.id === id)
      if (!group) return
      const ok = await confirm({
        title: '删除素材分组',
        message: `确定删除分组「${group.title}」？`,
        details: '仅解除分组，不会删除组内素材库。',
        confirmText: '删除分组',
        variant: 'danger',
      })
      if (!ok) return
      setDeletingMaterialGroupId(id)
      try {
        await deleteMaterialLibraryGroup(id)
        await refreshMaterials()
      } catch (err) {
        setMaterialError(err instanceof Error ? err.message : '删除素材分组失败')
      } finally {
        setDeletingMaterialGroupId(null)
      }
      return
    }
    await handleDeleteMaterial(id)
  }

  const handleDeleteSkillCard = async (id: string) => {
    if (skillGroups.some((group) => group.id === id)) {
      const group = skillGroups.find((item) => item.id === id)
      if (!group) return
      const ok = await confirm({
        title: '删除技能分组',
        message: `确定删除分组「${group.title}」？`,
        details: '仅解除分组，不会删除组内技能库。',
        confirmText: '删除分组',
        variant: 'danger',
      })
      if (!ok) return
      setDeletingSkillGroupId(id)
      try {
        await deleteSkillLibraryGroup(id)
        await refreshSkills()
      } catch (err) {
        setSkillError(err instanceof Error ? err.message : '删除技能分组失败')
      } finally {
        setDeletingSkillGroupId(null)
      }
      return
    }
    await handleDeleteSkill(id)
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

  const handleBookLinkedMaterialChange = useCallback(
    (kind: MaterialKind, materialId: string) => {
      setBookLinkedMaterialIdsByKind((current) => ({
        ...emptyLinkedMaterialIdsByKind(),
        ...current,
        [kind]: materialId ? [materialId] : [],
      }))
    },
    [],
  )

  const handleBookLinkedSkillChange = useCallback(
    (kind: SkillKind, skillId: string) => {
      setBookLinkedSkillIdsByKind((current) => ({
        ...emptyLinkedSkillIdsByKind(),
        ...current,
        [kind]: skillId ? [skillId] : [],
      }))
    },
    [],
  )

  // ==================== 渲染 ====================
  const loadUserMemoryList = useCallback(async (type: 'short' | 'long' | 'script') => {
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
    (type: 'short' | 'long' | 'script') => {
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
  const materialCardItems = useMemo(
    () => [
      ...materialGroups.map(materialGroupToCardItem),
      ...ungroupedMaterials.map(materialToCardItem),
    ],
    [materialGroups, ungroupedMaterials],
  )
  const skillCardItems = useMemo(
    () => [
      ...skillGroups.map(skillGroupToCardItem),
      ...ungroupedSkills.map(skillToCardItem),
    ],
    [skillGroups, ungroupedSkills],
  )
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
              <span className="card-header-count">
                {materialGroups.length > 0
                  ? `${materialGroups.length} 个分组 · ${ungroupedMaterials.length} 个未分组`
                  : `${materials.length} 个素材`}
              </span>
            </div>
            <div className="card-header-actions material-header-actions">
              <button
                type="button"
                className="btn-secondary btn-small btn-icon material-actions-toggle"
                aria-label={materialActionsExpanded ? '收回素材库操作按钮' : '展开素材库操作按钮'}
                aria-controls="material-extra-actions"
                aria-expanded={materialActionsExpanded}
                title={materialActionsExpanded ? '收回素材库操作按钮' : '展开素材库操作按钮'}
                onClick={() => setMaterialActionsExpanded((value) => !value)}
              >
                {materialActionsExpanded ? <ChevronRightIcon /> : <ChevronLeftIcon />}
              </button>
              {materialActionsExpanded ? (
                <div className="material-extra-actions" id="material-extra-actions">
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
                    className="btn-secondary btn-small"
                    disabled={materialSplitCandidates.length === 0}
                    onClick={openMaterialSplitDialog}
                  >
                    一键拆分
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-small"
                    disabled={materials.length === 0}
                    onClick={openMaterialGroupForm}
                  >
                    + 新建分组
                  </button>
                </div>
              ) : null}
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
            ) : materials.length === 0 && materialGroups.length === 0 ? (
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
                onDelete={(id) => void handleDeleteMaterialCard(id)}
                deletingId={deletingMaterialId ?? deletingMaterialGroupId}
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
              <span className="card-header-count">
                {skillGroups.length > 0
                  ? `${skillGroups.length} 个分组 · ${ungroupedSkills.length} 个未分组`
                  : `${skills.length} 个技能`}
              </span>
            </div>
            <div className="card-header-actions skill-header-actions">
              <button
                type="button"
                className="btn-secondary btn-small btn-icon skill-actions-toggle"
                aria-label={skillActionsExpanded ? '收回技能库操作按钮' : '展开技能库操作按钮'}
                aria-controls="skill-extra-actions"
                aria-expanded={skillActionsExpanded}
                title={skillActionsExpanded ? '收回技能库操作按钮' : '展开技能库操作按钮'}
                onClick={() => setSkillActionsExpanded((value) => !value)}
              >
                {skillActionsExpanded ? <ChevronRightIcon /> : <ChevronLeftIcon />}
              </button>
              {skillActionsExpanded ? (
                <div className="skill-extra-actions" id="skill-extra-actions">
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
                    className="btn-secondary btn-small"
                    disabled={skillSplitCandidates.length === 0}
                    onClick={openSkillSplitDialog}
                  >
                    一键拆分
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-small"
                    disabled={skills.length === 0}
                    onClick={openSkillGroupForm}
                  >
                    + 新建分组
                  </button>
                </div>
              ) : null}
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
            ) : skills.length === 0 && skillGroups.length === 0 ? (
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
                onDelete={(id) => void handleDeleteSkillCard(id)}
                deletingId={deletingSkillId ?? deletingSkillGroupId}
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
                  onChange={() => {
                    setBookType('short')
                    setBookLinkedSkillIdsByKind(emptyLinkedSkillIdsByKind())
                    setBookLinkedMaterialIdsByKind(emptyLinkedMaterialIdsByKind())
                  }}
                />
                短篇
              </label>
              <label className="radio">
                <input
                  type="radio"
                  name="bookType"
                  checked={bookType === 'script'}
                  onChange={() => {
                    setBookType('script')
                    setBookLinkedSkillIdsByKind(emptyLinkedSkillIdsByKind())
                    setBookLinkedMaterialIdsByKind(emptyLinkedMaterialIdsByKind())
                  }}
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
                    setBookLinkedSkillIdsByKind(emptyLinkedSkillIdsByKind())
                    setBookLinkedMaterialIdsByKind(emptyLinkedMaterialIdsByKind())
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

            </>
          )}

          <fieldset className="field">
            <legend className="field-label">绑定技能库</legend>
            <div className="material-bind-select-grid">
              {SKILL_KIND_KEYS.map((kind) => {
                const candidates = bookSkillOptionsByKind[kind] ?? []
                return (
                  <label key={kind} className="material-bind-select-field">
                    <span>{SKILL_KIND_LABELS[kind]}</span>
                    <select
                      value={bookLinkedSkillIdsByKind[kind]?.[0] ?? ''}
                      onChange={(e) => handleBookLinkedSkillChange(kind, e.target.value)}
                      disabled={loadingSkills}
                    >
                      <option value="">不绑定</option>
                      {candidates.map((skill) => {
                        const stages = SKILL_KIND_STAGE_IDS[kind]
                          .map((stageId) => SKILL_STAGE_LABELS[stageId])
                          .join('、')
                        return (
                          <option key={`${kind}-${skill.id}`} value={skill.id}>
                            {`${skill.title}（${stages}）`}
                          </option>
                        )
                      })}
                    </select>
                  </label>
                )
              })}
            </div>
          </fieldset>

          <fieldset className="field">
            <legend className="field-label">绑定素材库</legend>
            <div className="material-bind-select-grid">
              {MATERIAL_KIND_KEYS.map((kind) => {
                const candidates = bookMaterialOptionsByKind[kind] ?? []
                return (
                  <label key={kind} className="material-bind-select-field">
                    <span>{MATERIAL_KIND_LABELS[kind]}</span>
                    <select
                      value={bookLinkedMaterialIdsByKind[kind]?.[0] ?? ''}
                      onChange={(e) => handleBookLinkedMaterialChange(kind, e.target.value)}
                      disabled={loadingMaterials}
                    >
                      <option value="">不绑定</option>
                      {candidates.map((material) => {
                        const meta = materialMetaLabel(material)
                        return (
                          <option key={`${kind}-${material.id}`} value={material.id}>
                            {meta ? `${material.title}（${meta}）` : material.title}
                          </option>
                        )
                      })}
                    </select>
                    {!loadingMaterials && candidates.length === 0 ? (
                      <span className="field-hint">暂无可用素材库</span>
                    ) : null}
                  </label>
                )
              })}
            </div>
          </fieldset>

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

          <fieldset className="field">
            <legend className="field-label">用途部门</legend>
            <div className="genre-grid">
              {MATERIAL_KIND_KEYS.map((kind) => (
                <label key={kind} className="radio">
                  <input
                    type="radio"
                    name="materialKind"
                    checked={materialKind === kind}
                    onChange={() => setMaterialKind(kind)}
                  />
                  {MATERIAL_KIND_LABELS[kind]}
                </label>
              ))}
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

      {showMaterialSplitDialog && (
        <CreateDialog
          title="一键拆分素材库"
          titleId="split-material-title"
          submitting={splittingMaterial}
          submitLabel="开始拆分"
          submittingLabel="拆分中…"
          submitDisabled={!materialSplitSourceId}
          onClose={() => setShowMaterialSplitDialog(false)}
          onSubmit={handleSplitMaterial}
        >
          <label className="field">
            <span className="field-label">选择老素材库</span>
            <select
              value={materialSplitSourceId}
              onChange={(event) => {
                const value = event.target.value
                const next = materials.find((item) => item.id === value)
                setMaterialSplitSourceId(value)
                if (next) setMaterialSplitGroupTitle(`${next.title}分组`)
              }}
              required
              autoFocus
            >
              <option value="">请选择素材库</option>
              {materialSplitCandidates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}（{MATERIAL_KIND_LABELS[item.material_kind]} · {materialTypeLabel(item.material_type)}）
                </option>
              ))}
            </select>
          </label>

          {materialSplitCandidates.length === 0 && (
            <p className="material-split-note">
              当前没有可拆分的综合素材库。
            </p>
          )}

          <fieldset className="field">
            <legend className="field-label">拆分方式</legend>
            <div className="material-split-mode-grid">
              <label className="material-split-mode">
                <input
                  type="radio"
                  name="materialSplitMode"
                  checked={materialSplitMode === 'group'}
                  onChange={() => setMaterialSplitMode('group')}
                />
                <span>
                  拆成分组
                  <small>生成多个部门素材库，并自动放入一个新分组</small>
                </span>
              </label>
              <label className="material-split-mode">
                <input
                  type="radio"
                  name="materialSplitMode"
                  checked={materialSplitMode === 'single'}
                  onChange={() => setMaterialSplitMode('single')}
                />
                <span>
                  拆成单个的
                  <small>只生成独立素材库，不创建分组</small>
                </span>
              </label>
            </div>
          </fieldset>

          {materialSplitMode === 'group' && (
            <label className="field">
              <span className="field-label">分组名称</span>
              <input
                type="text"
                value={materialSplitGroupTitle}
                onChange={(event) => setMaterialSplitGroupTitle(event.target.value)}
                placeholder="例如：短篇追妻素材组"
              />
            </label>
          )}

          <p className="material-split-note">
            只会复制有内容的素材部门；原素材库会保留，不会被删除。
          </p>

          {materialSplitError && <p className="form-error">{materialSplitError}</p>}
        </CreateDialog>
      )}

      {showSkillSplitDialog && (
        <CreateDialog
          title="一键拆分技能库"
          titleId="split-skill-title"
          submitting={splittingSkill}
          submitLabel="开始拆分"
          submittingLabel="拆分中…"
          submitDisabled={!skillSplitSourceId}
          onClose={() => setShowSkillSplitDialog(false)}
          onSubmit={handleSplitSkill}
        >
          <label className="field">
            <span className="field-label">选择通用技能库</span>
            <select
              value={skillSplitSourceId}
              onChange={(event) => {
                const value = event.target.value
                const next = skills.find((item) => item.id === value)
                setSkillSplitSourceId(value)
                if (next) setSkillSplitGroupTitle(`${next.title}分组`)
              }}
              required
              autoFocus
            >
              <option value="">请选择技能库</option>
              {skillSplitCandidates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}（{SKILL_KIND_LABELS[item.skill_kind]} · {skillTypeLabel(item.skill_type)}）
                </option>
              ))}
            </select>
          </label>

          {skillSplitCandidates.length === 0 && (
            <p className="material-split-note">
              当前没有可拆分的通用技能库。
            </p>
          )}

          <fieldset className="field">
            <legend className="field-label">拆分方式</legend>
            <div className="material-split-mode-grid">
              <label className="material-split-mode">
                <input
                  type="radio"
                  name="skillSplitMode"
                  checked={skillSplitMode === 'group'}
                  onChange={() => setSkillSplitMode('group')}
                />
                <span>
                  拆成分组
                  <small>生成多个分类技能库，并自动放入一个新分组</small>
                </span>
              </label>
              <label className="material-split-mode">
                <input
                  type="radio"
                  name="skillSplitMode"
                  checked={skillSplitMode === 'single'}
                  onChange={() => setSkillSplitMode('single')}
                />
                <span>
                  拆成单个的
                  <small>只生成独立技能库，不创建分组</small>
                </span>
              </label>
            </div>
          </fieldset>

          {skillSplitMode === 'group' && (
            <label className="field">
              <span className="field-label">分组名称</span>
              <input
                type="text"
                value={skillSplitGroupTitle}
                onChange={(event) => setSkillSplitGroupTitle(event.target.value)}
                placeholder="例如：短篇通用技能组"
              />
            </label>
          )}

          <p className="material-split-note">
            按条目内容拆分：剧情/人设进剧情库，去 AI 味与逻辑审核等跨阶段重复能力进通用库，其余进其他库；原技能库会保留，不会被删除。
          </p>

          {skillSplitError && <p className="form-error">{skillSplitError}</p>}
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

          <fieldset className="field">
            <legend className="field-label">技能分类</legend>
            <div className="genre-grid">
              {SKILL_KIND_KEYS.map((kind) => (
                <label key={kind} className="radio">
                  <input
                    type="radio"
                    name="skillKind"
                    checked={skillKind === kind}
                    onChange={() => setSkillKind(kind)}
                  />
                  {SKILL_KIND_LABELS[kind]}
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
              加载内置通用技能
              <small>只复制当前技能分类允许生效的阶段</small>
            </span>
          </label>

          {skillError && <p className="form-error">{skillError}</p>}
        </CreateDialog>
      )}

      {showMaterialGroupForm && (
        <CreateDialog
          title="新建素材分组"
          titleId="create-material-group-title"
          submitting={submittingMaterialGroup}
          submitDisabled={
            !materialGroupTitle.trim() ||
            Object.values(materialGroupMembers).every((id) => !id)
          }
          onClose={() => setShowMaterialGroupForm(false)}
          onSubmit={handleCreateMaterialGroup}
        >
          <label className="field">
            <span className="field-label">分组名称</span>
            <input
              type="text"
              value={materialGroupTitle}
              onChange={(e) => setMaterialGroupTitle(e.target.value)}
              placeholder="例如：短篇追妻素材组"
              required
              autoFocus
            />
          </label>
          <fieldset className="field">
            <legend className="field-label">按部门各选一个素材库</legend>
            <div className="genre-grid" style={{ gridTemplateColumns: '1fr' }}>
              {MATERIAL_KIND_KEYS.map((kind) => (
                <label key={kind} className="field">
                  <span className="field-label">{MATERIAL_KIND_LABELS[kind]}</span>
                  <select
                    value={materialGroupMembers[kind] ?? ''}
                    onChange={(e) => {
                      const value = e.target.value
                      setMaterialGroupMembers((prev) => {
                        const next = { ...prev }
                        if (!value) delete next[kind]
                        else next[kind] = value
                        return next
                      })
                    }}
                  >
                    <option value="">不选</option>
                    {materialGroupOptionsByKind[kind].map((material) => (
                      <option key={material.id} value={material.id}>
                        {material.title}（{materialTypeLabel(material.material_type)}）
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </fieldset>
          {materialGroupError && <p className="form-error">{materialGroupError}</p>}
        </CreateDialog>
      )}

      {showSkillGroupForm && (
        <CreateDialog
          title="新建技能分组"
          titleId="create-skill-group-title"
          submitting={submittingSkillGroup}
          submitDisabled={
            !skillGroupTitle.trim() ||
            Object.values(skillGroupMembers).every((id) => !id)
          }
          onClose={() => setShowSkillGroupForm(false)}
          onSubmit={handleCreateSkillGroup}
        >
          <label className="field">
            <span className="field-label">分组名称</span>
            <input
              type="text"
              value={skillGroupTitle}
              onChange={(e) => setSkillGroupTitle(e.target.value)}
              placeholder="例如：短篇写作技能组"
              required
              autoFocus
            />
          </label>
          <fieldset className="field">
            <legend className="field-label">按分类各选一个技能库</legend>
            <div className="genre-grid" style={{ gridTemplateColumns: '1fr' }}>
              {SKILL_KIND_KEYS.map((kind) => (
                <label key={kind} className="field">
                  <span className="field-label">{SKILL_KIND_LABELS[kind]}</span>
                  <select
                    value={skillGroupMembers[kind] ?? ''}
                    onChange={(e) => {
                      const value = e.target.value
                      setSkillGroupMembers((prev) => {
                        const next = { ...prev }
                        if (!value) delete next[kind]
                        else next[kind] = value
                        return next
                      })
                    }}
                  >
                    <option value="">不选</option>
                    {skillGroupOptionsByKind[kind].map((skill) => (
                      <option key={skill.id} value={skill.id}>
                        {skill.title}（{skillTypeLabel(skill.skill_type)}）
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </fieldset>
          {skillGroupError && <p className="form-error">{skillGroupError}</p>}
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
              {(['short', 'long', 'script'] as const).map((type) => (
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
    meta: materialMetaLabel(material),
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
    meta: `${skillTypeLabel(skill.skill_type)} · ${SKILL_KIND_LABELS[skill.skill_kind]} · ${skill.stage_skill_count ?? 0} 条技能`,
  }
}
