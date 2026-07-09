import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  MATERIAL_MANAGER_PROMPT_KIND,
  MATERIAL_KIND_LABELS,
  MATERIAL_KIND_STAGE_IDS,
  MATERIAL_STAGE_KIND,
  MATERIAL_STAGE_KEYS,
  type Material,
  type MaterialStageEntry,
  type MaterialStageId,
  type MaterialSummary,
  getMaterial,
  listMaterials,
  materialStageItemsToStages,
  materialTypeLabel,
  normalizeMaterialStageItems,
  saveMaterial,
} from '../bridge'
import { WorkspaceAiChat } from '../components/WorkspaceAiChat'
import type { ApplyToStageEditorPayload } from '../pi/workspaceStageAgents'
import { WorkspaceTreeNav } from '../components/WorkspaceTreeNav'
import { MarkdownTextEditor } from '../components/MarkdownTextEditor'
import {
  autoSaveStatusLabel,
  useKeyedAutoSave,
} from '../hooks/useKeyedAutoSave'
import { useTextHistory } from '../hooks/useTextHistory'
import './BookEditor.css'

type MaterialStageItems = Record<MaterialStageId, MaterialStageEntry[]>

const MATERIAL_ENTRY_LABELS: Record<MaterialStageId, string> = {
  gimmick: '梗',
  character: '人设',
  pacing: '剧情',
  intro: '导语',
  plot_refine: '剧情细化',
  draft_excerpt: '正文',
  other: '其他素材',
}

const AI_PANEL_WIDTH_KEY = 'deepseekwrite:material-ai-width'
const AI_PANEL_MIN = 240
const AI_PANEL_HARD_MAX = 1000
const WORKSPACE_AI_INCLUDE_PI_ARTIFACTS = false
const WORKSPACE_SPLITTER_W = 6
const WORKSPACE_COL_L = 18
const WORKSPACE_COL_R = 36
const WORKSPACE_COL_SUM = 18 + 36 + 36
const EDITOR_MIN_FOR_LAYOUT = 160
const MATERIAL_ENTRY_CARD_PAGE_SIZE = 4
const PLOT_TREE_STAGE_ID: MaterialStageId = 'pacing'
const PLOT_STAGE_STORAGE_KEYS: MaterialStageId[] = ['pacing', 'intro', 'plot_refine']
const ENTRY_TREE_ID_SEPARATOR = '::'

type MaterialStageOption = {
  stageId: MaterialStageId
  label: string
}

function visibleStageKeysForMaterial(
  material: Pick<MaterialSummary, 'material_kind' | 'material_type'> | null,
): MaterialStageId[] {
  if (material?.material_kind === 'plot') return [PLOT_TREE_STAGE_ID]
  return editableStageKeysForMaterial(material)
}

function editableStageKeysForMaterial(
  material: Pick<MaterialSummary, 'material_kind' | 'material_type'> | null,
): MaterialStageId[] {
  if (!material) return MATERIAL_KIND_STAGE_IDS.mixed
  if (material.material_kind === 'plot') {
    return plotStageKeysForMaterial(material)
  }
  return MATERIAL_KIND_STAGE_IDS[material.material_kind] ?? MATERIAL_KIND_STAGE_IDS.mixed
}

function plotCategoryOptionsForMaterial(
  material: Pick<MaterialSummary, 'material_type'> | null,
): MaterialStageOption[] {
  if (material?.material_type === 'long') {
    return [
      { stageId: 'pacing', label: '总纲设计' },
      { stageId: 'intro', label: '卷纲设计' },
      { stageId: 'plot_refine', label: '章纲设计' },
    ]
  }
  if (material?.material_type === 'script') {
    return [
      { stageId: 'pacing', label: '剧情设计' },
      { stageId: 'plot_refine', label: '剧情细化' },
    ]
  }
  return [
    { stageId: 'pacing', label: '剧情设计' },
    { stageId: 'plot_refine', label: '剧情细化' },
    { stageId: 'intro', label: '导语设计' },
  ]
}

function plotStageKeysForMaterial(
  material: Pick<MaterialSummary, 'material_type'> | null,
): MaterialStageId[] {
  const optionIds = plotCategoryOptionsForMaterial(material).map((option) => option.stageId)
  return [
    ...optionIds,
    ...PLOT_STAGE_STORAGE_KEYS.filter((stageId) => !optionIds.includes(stageId)),
  ]
}

function defaultStageKeyForMaterial(
  material: Pick<MaterialSummary, 'material_kind' | 'material_type'> | null,
): MaterialStageId {
  return editableStageKeysForMaterial(material)[0] ?? 'character'
}

function stageKeysForTreeStage(
  material: Pick<MaterialSummary, 'material_kind' | 'material_type'> | null,
  stageId: MaterialStageId,
): MaterialStageId[] {
  if (material?.material_kind === 'plot' && stageId === PLOT_TREE_STAGE_ID) {
    return editableStageKeysForMaterial(material)
  }
  return [stageId]
}

function materialListLabel(
  material: Pick<MaterialSummary, 'material_kind' | 'material_type'> | null,
  stageId: MaterialStageId,
): string {
  if (material?.material_kind === 'plot') return '剧情素材'
  if (stageId === 'gimmick') return '梗素材'
  if (stageId === 'draft_excerpt') return '正文素材'
  return MATERIAL_ENTRY_LABELS[stageId]
}

function materialCategoryLabel(
  material: Pick<MaterialSummary, 'material_kind' | 'material_type'> | null,
  stageId: MaterialStageId,
): string {
  if (material?.material_kind === 'plot') {
    return (
      plotCategoryOptionsForMaterial(material).find((option) => option.stageId === stageId)
        ?.label ??
      (stageId === 'intro' ? '导语设计' : MATERIAL_ENTRY_LABELS[stageId])
    )
  }
  return MATERIAL_ENTRY_LABELS[stageId]
}

function treeChildId(stageId: MaterialStageId, entryId: string): string {
  return `${stageId}${ENTRY_TREE_ID_SEPARATOR}${entryId}`
}

function parseTreeChildId(
  childId: string,
  fallbackStageId: MaterialStageId,
): { stageId: MaterialStageId; entryId: string } {
  const separatorIndex = childId.indexOf(ENTRY_TREE_ID_SEPARATOR)
  if (separatorIndex < 0) return { stageId: fallbackStageId, entryId: childId }
  const stageId = childId.slice(0, separatorIndex) as MaterialStageId
  const entryId = childId.slice(separatorIndex + ENTRY_TREE_ID_SEPARATOR.length)
  return { stageId, entryId }
}

function usableWidthLessSplitter(viewportWidth: number): number {
  return Math.max(0, viewportWidth - WORKSPACE_SPLITTER_W)
}

function approxRailWidthPx(viewportWidth: number): number {
  return Math.round(
    (usableWidthLessSplitter(viewportWidth) * WORKSPACE_COL_L) / WORKSPACE_COL_SUM,
  )
}

function defaultAiPanelWidthPx(viewportWidth: number): number {
  return Math.round(
    (usableWidthLessSplitter(viewportWidth) * WORKSPACE_COL_R) / WORKSPACE_COL_SUM,
  )
}

function maxAiWidthForViewport(viewportWidth: number): number {
  const rail = approxRailWidthPx(viewportWidth)
  const raw = viewportWidth - rail - WORKSPACE_SPLITTER_W - EDITOR_MIN_FOR_LAYOUT
  return Math.min(AI_PANEL_HARD_MAX, Math.max(AI_PANEL_MIN, Math.floor(raw)))
}

function clampAiPanelWidth(width: number, viewportWidth: number): number {
  const cap = maxAiWidthForViewport(viewportWidth)
  return Math.min(cap, Math.max(AI_PANEL_MIN, width))
}

function stageTextCounts(text: string): { total: number; nonSpace: number } {
  return {
    total: text.length,
    nonSpace: text.replace(/\p{White_Space}/gu, '').length,
  }
}

function readStoredAiWidth(): number {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  try {
    const raw = localStorage.getItem(AI_PANEL_WIDTH_KEY)
    const n = raw ? Number.parseInt(raw, 10) : NaN
    if (!Number.isFinite(n)) return clampAiPanelWidth(defaultAiPanelWidthPx(vw), vw)
    return clampAiPanelWidth(n, vw)
  } catch {
    return clampAiPanelWidth(defaultAiPanelWidthPx(vw), vw)
  }
}

function cloneMaterialStageItems(items: MaterialStageItems): MaterialStageItems {
  const out = {} as MaterialStageItems
  for (const stageId of MATERIAL_STAGE_KEYS) {
    out[stageId] = (items[stageId] ?? []).map((entry) => ({ ...entry }))
  }
  return out
}

function newMaterialStageEntry(stageId: MaterialStageId, index: number): MaterialStageEntry {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const label = MATERIAL_ENTRY_LABELS[stageId]
  return {
    id: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
    title: `未命名${label}${index > 0 ? ` ${index + 1}` : ''}`,
    body: '',
    created_at: now,
    updated_at: now,
  }
}

function entryTitle(entry: MaterialStageEntry, stageId: MaterialStageId): string {
  return entry.title?.trim() || `未命名${MATERIAL_ENTRY_LABELS[stageId]}`
}

function entryBodyPreview(entry: MaterialStageEntry, label: string): string {
  return entry.body.trim() || `暂无${label}内容`
}

function materialSummaryFromMaterial(material: Material): MaterialSummary {
  return {
    id: material.id,
    title: material.title,
    material_type: material.material_type,
    material_kind: material.material_kind,
    parent_genre: material.parent_genre,
    sub_genre: material.sub_genre,
    output_dir: material.output_dir,
  }
}

function upsertMaterialSummary(
  summaries: MaterialSummary[],
  material: MaterialSummary,
): MaterialSummary[] {
  const index = summaries.findIndex((item) => item.id === material.id)
  if (index < 0) return [material, ...summaries]
  return summaries.map((item) => (item.id === material.id ? material : item))
}

function materialTreeMeta(material: MaterialSummary): string {
  return [
    materialTypeLabel(material.material_type),
    material.parent_genre?.trim(),
  ].filter(Boolean).join(' · ')
}

export type MaterialEditorGroupContext = {
  groupId: string
  title: string
  memberIdsOrdered: string[]
}

type MaterialEditorProps = {
  materialId?: string
  groupContext?: MaterialEditorGroupContext | null
  onGroupMaterialChange?: (materialId: string) => void
}

export function MaterialEditor({
  materialId: materialIdProp,
  groupContext = null,
  onGroupMaterialChange,
}: MaterialEditorProps = {}) {
  const historyPortalTargetId = useId()
  const { id: routeId } = useParams<{ id: string }>()
  const id = materialIdProp ?? routeId
  const navigate = useNavigate()
  const [material, setMaterial] = useState<Material | null>(null)
  const [stageItems, setStageItems] = useState<MaterialStageItems>(() =>
    normalizeMaterialStageItems({}),
  )
  const [materialSummaries, setMaterialSummaries] = useState<MaterialSummary[]>([])
  const [activeStage, setActiveStage] = useState<MaterialStageId>('character')
  const [selectedEntryIds, setSelectedEntryIds] = useState<
    Partial<Record<MaterialStageId, string>>
  >({})
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aiPanelWidth, setAiPanelWidth] = useState(readStoredAiWidth)
  const [aiChatEpoch, setAiChatEpoch] = useState(0)
  const [editorStreaming, setEditorStreaming] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [entryCardPageIndex, setEntryCardPageIndex] = useState(0)
  const [overviewDraft, setOverviewDraft] = useState('')
  const [overviewInitPromptRequest, setOverviewInitPromptRequest] = useState<{
    id: number
    prompt: string
  } | null>(null)

  const splitDragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const stageItemsRef = useRef<MaterialStageItems>(stageItems)
  const overviewDraftRef = useRef('')
  const overviewInitPromptSeqRef = useRef(0)
  const activeStageRef = useRef<MaterialStageId>(activeStage)
  const selectedEntryIdsRef = useRef<Partial<Record<MaterialStageId, string>>>({})
  const pendingStageOnLoadRef = useRef<MaterialStageId | null>(null)
  const tokenBufferRef = useRef('')
  const tokenBufferRafRef = useRef<number | undefined>(undefined)
  const textHistory = useTextHistory()

  const autoSave = useKeyedAutoSave<MaterialStageItems>({
    getSnapshot: (key) =>
      key === id ? cloneMaterialStageItems(stageItemsRef.current) : null,
    saveSnapshot: async (key, snapshot) => {
      try {
        const next = await saveMaterial(key, { stage_items: snapshot })
        if (!next) throw new Error('保存失败：素材不存在')
        const liveItems = stageItemsRef.current
        setMaterial((current) => ({
          ...next,
          title: current?.title ?? next.title,
          overview: overviewDraftRef.current,
          stage_items: liveItems,
          stages: materialStageItemsToStages(liveItems),
        }))
        setMaterialSummaries((current) =>
          upsertMaterialSummary(
            current,
            materialSummaryFromMaterial({
              ...next,
              title: next.title,
              stage_items: liveItems,
              stages: materialStageItemsToStages(liveItems),
            }),
          ),
        )
        setError(null)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '保存失败')
        throw cause
      }
    },
  })
  const {
    flush: flushMaterial,
    markSaved: markMaterialSaved,
    schedule: scheduleMaterialSave,
    statusFor: materialSaveStatus,
  } = autoSave

  const overviewAutoSave = useKeyedAutoSave<string>({
    getSnapshot: (key) => (key === id ? overviewDraftRef.current : null),
    saveSnapshot: async (key, snapshot) => {
      try {
        const next = await saveMaterial(key, { overview: snapshot })
        if (!next) throw new Error('保存失败：素材不存在')
        const liveItems = stageItemsRef.current
        const liveOverview = overviewDraftRef.current
        setMaterial((current) => ({
          ...next,
          title: current?.title ?? next.title,
          overview: liveOverview,
          stage_items: liveItems,
          stages: materialStageItemsToStages(liveItems),
        }))
        setError(null)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '保存素材库概述失败')
        throw cause
      }
    },
  })
  const {
    flush: flushOverview,
    markSaved: markOverviewSaved,
    schedule: scheduleOverviewSave,
    statusFor: overviewSaveStatus,
  } = overviewAutoSave

  useEffect(() => {
    stageItemsRef.current = stageItems
  }, [stageItems])

  useEffect(() => {
    activeStageRef.current = activeStage
  }, [activeStage])

  useEffect(() => {
    selectedEntryIdsRef.current = selectedEntryIds
  }, [selectedEntryIds])

  useEffect(() => {
    return () => {
      if (tokenBufferRafRef.current !== undefined) {
        cancelAnimationFrame(tokenBufferRafRef.current)
      }
    }
  }, [])

  const setStageItemsAndRef = useCallback(
    (updater: (current: MaterialStageItems) => MaterialStageItems) => {
      const current = stageItemsRef.current
      const next = updater(current)
      if (next === current) return
      stageItemsRef.current = next
      setStageItems(next)
      if (id) scheduleMaterialSave(id)
    },
    [id, scheduleMaterialSave],
  )

  const setSelectedIdsAndRef = useCallback(
    (
      updater: (
        current: Partial<Record<MaterialStageId, string>>,
      ) => Partial<Record<MaterialStageId, string>>,
    ) => {
      setSelectedEntryIds((prev) => {
        const next = updater(prev)
        selectedEntryIdsRef.current = next
        return next
      })
    },
    [],
  )

  const setOverviewDraftAndRef = useCallback(
    (value: string) => {
      overviewDraftRef.current = value
      setOverviewDraft(value)
      if (id) scheduleOverviewSave(id)
    },
    [id, scheduleOverviewSave],
  )

  const handleInitializeOverview = useCallback(() => {
    const hasOverview = overviewDraftRef.current.trim().length > 0
    const prompt = `请${hasOverview ? '更新' : '初始化'}本素材库的概述文档：先调用 list_material_entries 获取本素材库全部素材条目列表，不要只看当前条目；再逐条调用 read_material_entry 阅读正文，并为每条素材形成一句简短简介；最后整理成一份简短、简要的说明文档，包含素材库定位、条目索引和使用建议，概述正文建议控制在 50-100 字；${
      hasOverview
        ? '当前概述已有内容，请读取并保留仍然有效的信息，在此基础上更新，最后调用 write_material_overview，使用 replace 模式并设置 allow_overwrite_existing=true 写入概述。'
        : '当前概述为空，最后调用 write_material_overview，使用 replace 模式写入概述。'
    }`
    overviewInitPromptSeqRef.current += 1
    setOverviewInitPromptRequest({
      id: overviewInitPromptSeqRef.current,
      prompt,
    })
  }, [])

  const handleOverviewInitPromptHandled = useCallback((requestId: number) => {
    setOverviewInitPromptRequest((current) =>
      current?.id === requestId ? null : current,
    )
  }, [])

  const ensureSelectedEntry = useCallback(
    (stageId: MaterialStageId): string => {
      const current = stageItemsRef.current
      const entries = current[stageId] ?? []
      const selectedId = selectedEntryIdsRef.current[stageId]
      if (selectedId && entries.some((entry) => entry.id === selectedId)) {
        return selectedId
      }

      const entry = newMaterialStageEntry(stageId, entries.length)
      const nextItems = {
        ...current,
        [stageId]: [...entries, entry],
      }
      stageItemsRef.current = nextItems
      setStageItems(nextItems)
      if (id) scheduleMaterialSave(id)
      const nextSelected = {
        ...selectedEntryIdsRef.current,
        [stageId]: entry.id,
      }
      selectedEntryIdsRef.current = nextSelected
      setSelectedEntryIds(nextSelected)
      return entry.id
    },
    [id, scheduleMaterialSave],
  )

  const updateSelectedEntry = useCallback(
    (updater: (current: MaterialStageEntry) => MaterialStageEntry) => {
      const stageId = activeStageRef.current
      const entryId = ensureSelectedEntry(stageId)
      setStageItemsAndRef((prev) => ({
        ...prev,
        [stageId]: (prev[stageId] ?? []).map((entry) =>
          entry.id === entryId ? updater(entry) : entry,
        ),
      }))
    },
    [ensureSelectedEntry, setStageItemsAndRef],
  )

  const cancelTokenFlush = useCallback(() => {
    if (tokenBufferRafRef.current !== undefined) {
      cancelAnimationFrame(tokenBufferRafRef.current)
      tokenBufferRafRef.current = undefined
    }
  }, [])

  const flushTokenBuffer = useCallback(() => {
    tokenBufferRafRef.current = undefined
    const buffer = tokenBufferRef.current
    if (!buffer) return
    tokenBufferRef.current = ''
    updateSelectedEntry((entry) => ({ ...entry, body: entry.body + buffer }))
  }, [updateSelectedEntry])

  const flushAllTokenBuffers = useCallback(() => {
    cancelTokenFlush()
    flushTokenBuffer()
  }, [cancelTokenFlush, flushTokenBuffer])

  const autoScrollTextarea = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const wasAtBottom =
      textarea.scrollHeight - textarea.scrollTop <= textarea.clientHeight + 20
    if (wasAtBottom) textarea.scrollTop = textarea.scrollHeight
  }, [])

  const applyToStageEditor = useCallback(
    (payload: ApplyToStageEditorPayload) => {
      if (payload.mode === 'replace') {
        cancelTokenFlush()
        tokenBufferRef.current = ''
        setEditorStreaming(false)
        const stageId = activeStageRef.current
        const entryId = ensureSelectedEntry(stageId)
        const currentBody = (stageItemsRef.current[stageId] ?? []).find(
          (entry) => entry.id === entryId,
        )?.body ?? ''
        const next = payload.preserveWhitespace
          ? payload.text
          : payload.text.trim()
        textHistory.record(
          `material:${id}:${stageId}:${entryId}:body`,
          currentBody,
          next,
          next.length === 0 ? 'stream' : 'atomic',
        )
        updateSelectedEntry((entry) => ({ ...entry, body: next }))
        requestAnimationFrame(autoScrollTextarea)
        return
      }

      if (payload.mode === 'append_token') {
        if (!payload.text) return
        setEditorStreaming(true)
        const stageId = activeStageRef.current
        const entryId = ensureSelectedEntry(stageId)
        const currentBody = (stageItemsRef.current[stageId] ?? []).find(
          (entry) => entry.id === entryId,
        )?.body ?? ''
        const current = currentBody + tokenBufferRef.current
        textHistory.record(
          `material:${id}:${stageId}:${entryId}:body`,
          current,
          current + payload.text,
          'stream',
        )
        tokenBufferRef.current += payload.text
        if (tokenBufferRafRef.current === undefined) {
          tokenBufferRafRef.current = requestAnimationFrame(() => {
            flushTokenBuffer()
            requestAnimationFrame(autoScrollTextarea)
          })
        }
        return
      }

      if (payload.mode === 'streaming_end') {
        cancelTokenFlush()
        flushTokenBuffer()
        setEditorStreaming(false)
        const stageId = activeStageRef.current
        const entryId = selectedEntryIdsRef.current[stageId]
        textHistory.endGroup(`material:${id}:${stageId}:${entryId}:body`)
        if (id) void flushMaterial(id)
        return
      }

      cancelTokenFlush()
      tokenBufferRef.current = ''
      setEditorStreaming(false)
      const trimmed = payload.text.trim()
      if (!trimmed) return
      updateSelectedEntry((entry) => {
        const sep = entry.body.length === 0 ? '' : entry.body.endsWith('\n') ? '\n' : '\n\n'
        const next = entry.body + sep + trimmed
        const stageId = activeStageRef.current
        const entryId = selectedEntryIdsRef.current[stageId]
        textHistory.record(
          `material:${id}:${stageId}:${entryId}:body`,
          entry.body,
          next,
          'atomic',
        )
        return { ...entry, body: next }
      })
      requestAnimationFrame(autoScrollTextarea)
    },
    [
      autoScrollTextarea,
      cancelTokenFlush,
      ensureSelectedEntry,
      flushMaterial,
      flushTokenBuffer,
      id,
      textHistory,
      updateSelectedEntry,
    ],
  )

  useEffect(() => {
    try {
      localStorage.setItem(AI_PANEL_WIDTH_KEY, String(aiPanelWidth))
    } catch {
      /* ignore */
    }
  }, [aiPanelWidth])

  useEffect(() => {
    const onResize = () => {
      setAiPanelWidth((w) => clampAiPanelWidth(w, window.innerWidth))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const syncMaterialState = useCallback(
    (next: Material, options?: { resetNavigation?: boolean }) => {
      const normalized = normalizeMaterialStageItems(
        next.stage_items,
        next.stage_items ? null : next.stages,
      )
      const stages = materialStageItemsToStages(normalized)
      const merged = { ...next, stage_items: normalized, stages }
      const editableStageKeys = editableStageKeysForMaterial(merged)
      const overview = merged.overview ?? ''
      setMaterial(merged)
      overviewDraftRef.current = overview
      setOverviewDraft(overview)
      stageItemsRef.current = normalized
      setStageItems(normalized)

      if (options?.resetNavigation) {
        const pendingStage = pendingStageOnLoadRef.current
        pendingStageOnLoadRef.current = null
        const firstStage =
          pendingStage && editableStageKeys.includes(pendingStage)
            ? pendingStage
            : defaultStageKeyForMaterial(merged)
        const ids: Partial<Record<MaterialStageId, string>> = {}
        selectedEntryIdsRef.current = ids
        setSelectedEntryIds(ids)
        setActiveStage(firstStage)
        return
      }

      setSelectedEntryIds((prev) => {
        const mergedIds: Partial<Record<MaterialStageId, string>> = {}
        for (const stageId of editableStageKeys) {
          const entries = normalized[stageId] ?? []
          const currentId = prev[stageId]
          if (currentId && entries.some((entry) => entry.id === currentId)) {
            mergedIds[stageId] = currentId
          }
        }
        selectedEntryIdsRef.current = mergedIds
        return mergedIds
      })
    },
    [],
  )

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const [m, summaries] = await Promise.all([
        getMaterial(id),
        listMaterials(),
      ])
      if (!m) {
        setMaterial(null)
        setMaterialSummaries(summaries)
        setError('未找到该素材')
        return
      }
      setMaterialSummaries(upsertMaterialSummary(summaries, materialSummaryFromMaterial(m)))
      syncMaterialState(m, { resetNavigation: true })
      markMaterialSaved(m.id)
      markOverviewSaved(m.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [id, markMaterialSaved, markOverviewSaved, syncMaterialState])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void load()
    })
    return () => {
      cancelled = true
    }
  }, [load])

  const flushAutoSave = useCallback(async () => {
    if (!id) return true
    flushAllTokenBuffers()
    const [materialOk, overviewOk] = await Promise.all([
      flushMaterial(id),
      flushOverview(id),
    ])
    return materialOk && overviewOk
  }, [flushAllTokenBuffers, flushMaterial, flushOverview, id])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return
      e.preventDefault()
      void flushAutoSave()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [flushAutoSave])

  const stagePromptBodies = useMemo(
    () => materialStageItemsToStages(stageItems),
    [stageItems],
  )

  const materialTreeBooks = useMemo(() => {
    if (!material) return []
    const activeSummary = materialSummaryFromMaterial(material)
    let summaries: MaterialSummary[]
    if (groupContext) {
      const byId = new Map(materialSummaries.map((item) => [item.id, item]))
      byId.set(activeSummary.id, activeSummary)
      summaries = groupContext.memberIdsOrdered
        .map((memberId) => byId.get(memberId))
        .filter((item): item is MaterialSummary => Boolean(item))
      if (!summaries.some((item) => item.id === material.id)) {
        summaries = [activeSummary, ...summaries]
      }
    } else {
      const groupedSummaries = materialSummaries.filter(
        (summary) => summary.material_kind === material.material_kind,
      )
      summaries = groupedSummaries.some((summary) => summary.id === material.id)
        ? groupedSummaries
        : [activeSummary, ...groupedSummaries]
    }

    return summaries.map((summary) => {
      const isActive = summary.id === material.id
      return {
        id: summary.id,
        title: summary.title,
        meta: materialTreeMeta(summary),
        stages: visibleStageKeysForMaterial(summary).map((stageId) => {
          const listStageIds = stageKeysForTreeStage(summary, stageId)
          const listLabel = materialListLabel(summary, stageId)
          return {
            id: stageId,
            label: `${listLabel}列表`,
            ...(isActive
              ? {
                  children: listStageIds.flatMap((itemStageId) =>
                    (stageItems[itemStageId] ?? []).map((entry) => ({
                      id: treeChildId(itemStageId, entry.id),
                      label:
                        summary.material_kind === 'plot'
                          ? `${materialCategoryLabel(summary, itemStageId)} · ${entryTitle(entry, itemStageId)}`
                          : entryTitle(entry, itemStageId),
                    })),
                  ),
                  createChildLabel: `新建${listLabel}`,
                  branchClickBehavior: 'select' as const,
                }
              : {}),
          }
        }),
      }
    })
  }, [groupContext, material, materialSummaries, stageItems])

  const handleStageSelect = (stageId: MaterialStageId) => {
    void flushAutoSave()
    setActiveStage(stageId)
    setEntryCardPageIndex(0)
    setSelectedIdsAndRef((prev) => ({ ...prev, [stageId]: '' }))
  }

  const handleEntrySelect = (stageId: MaterialStageId, entryId: string) => {
    void flushAutoSave()
    setActiveStage(stageId)
    setSelectedIdsAndRef((prev) => ({ ...prev, [stageId]: entryId }))
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const handleStageChildSelect = (stageId: MaterialStageId, childId: string) => {
    const target = parseTreeChildId(childId, stageId)
    handleEntrySelect(target.stageId, target.entryId)
  }

  const handleAddEntry = (stageId = activeStageRef.current) => {
    const entries = stageItemsRef.current[stageId] ?? []
    const entry = newMaterialStageEntry(stageId, entries.length)
    setStageItemsAndRef((prev) => ({
      ...prev,
      [stageId]: [...(prev[stageId] ?? []), entry],
    }))
    setActiveStage(stageId)
    setSelectedIdsAndRef((prev) => ({ ...prev, [stageId]: entry.id }))
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const handleDeleteEntry = (entryId: string) => {
    const stageId = activeStageRef.current
    const entries = stageItemsRef.current[stageId] ?? []
    const index = entries.findIndex((entry) => entry.id === entryId)
    const nextEntries = entries.filter((entry) => entry.id !== entryId)
    const nextSelected = nextEntries[Math.max(0, Math.min(index, nextEntries.length - 1))]
    setStageItemsAndRef((prev) => ({ ...prev, [stageId]: nextEntries }))
    setSelectedIdsAndRef((prev) => ({ ...prev, [stageId]: nextSelected?.id ?? '' }))
    if (!nextSelected && material?.material_kind === 'plot') {
      setActiveStage(defaultStageKeyForMaterial(material))
    }
  }

  const handleEntryCategoryChange = (nextStageId: MaterialStageId) => {
    const currentStageId = activeStageRef.current
    if (currentStageId === nextStageId) return
    const entryId = selectedEntryIdsRef.current[currentStageId]
    if (!entryId) return
    const entry = (stageItemsRef.current[currentStageId] ?? []).find(
      (item) => item.id === entryId,
    )
    if (!entry) return

    setStageItemsAndRef((prev) => ({
      ...prev,
      [currentStageId]: (prev[currentStageId] ?? []).filter(
        (item) => item.id !== entryId,
      ),
      [nextStageId]: [
        ...(prev[nextStageId] ?? []).filter((item) => item.id !== entryId),
        entry,
      ],
    }))
    setActiveStage(nextStageId)
    setSelectedIdsAndRef((prev) => ({
      ...prev,
      [currentStageId]: '',
      [nextStageId]: entryId,
    }))
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const handleTreeMaterialSelect = async (
    materialId: string,
    stageId?: MaterialStageId,
  ) => {
    if (materialId === material?.id) {
      if (stageId) handleStageSelect(stageId)
      return
    }
    await flushAutoSave()
    pendingStageOnLoadRef.current = stageId ?? null
    if (groupContext && onGroupMaterialChange) {
      onGroupMaterialChange(materialId)
      return
    }
    navigate(`/material/${materialId}`)
  }

  const handleTreeMaterialStageChildSelect = (
    materialId: string,
    stageId: MaterialStageId,
    childId: string,
  ) => {
    if (materialId === material?.id) {
      handleStageChildSelect(stageId, childId)
      return
    }
    void handleTreeMaterialSelect(materialId, stageId)
  }

  const handleTreeMaterialStageChildCreate = (
    materialId: string,
    stageId: MaterialStageId,
  ) => {
    if (materialId === material?.id) {
      handleAddEntry(stageId)
      return
    }
    void handleTreeMaterialSelect(materialId, stageId)
  }

  const getMaterialStageItemsForAi = useCallback(
    () => stageItemsRef.current,
    [],
  )

  const getMaterialOverviewForAi = useCallback(
    () => overviewDraftRef.current,
    [],
  )

  const selectMaterialEntryForAi = useCallback(
    (stageId: MaterialStageId, entryId: string) => {
      setActiveStage(stageId)
      setSelectedIdsAndRef((prev) => ({ ...prev, [stageId]: entryId }))
      requestAnimationFrame(() => textareaRef.current?.focus())
    },
    [setSelectedIdsAndRef],
  )

  const createMaterialEntryForAi = useCallback(
    (input: { stageId: MaterialStageId; title: string; body: string }) => {
      const entries = stageItemsRef.current[input.stageId] ?? []
      const base = newMaterialStageEntry(input.stageId, entries.length)
      const entry: MaterialStageEntry = {
        ...base,
        title: input.title.trim() || base.title,
        body: input.body,
      }
      setStageItemsAndRef((prev) => ({
        ...prev,
        [input.stageId]: [...(prev[input.stageId] ?? []), entry],
      }))
      setActiveStage(input.stageId)
      setSelectedIdsAndRef((prev) => ({ ...prev, [input.stageId]: entry.id }))
      requestAnimationFrame(() => textareaRef.current?.focus())
      return entry
    },
    [setSelectedIdsAndRef, setStageItemsAndRef],
  )

  const editMaterialEntryForAi = useCallback(
    (input: {
      stageId: MaterialStageId
      entryId: string
      title?: string
      body?: string
    }) => {
      let found = false
      const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
      setStageItemsAndRef((prev) => {
        const entries = prev[input.stageId] ?? []
        if (!entries.some((entry) => entry.id === input.entryId)) return prev
        found = true
        return {
          ...prev,
          [input.stageId]: entries.map((entry) =>
            entry.id === input.entryId
              ? {
                  ...entry,
                  title: input.title === undefined ? entry.title : input.title,
                  body: input.body === undefined ? entry.body : input.body,
                  updated_at: now,
                }
              : entry,
          ),
        }
      })
      if (found) {
        setActiveStage(input.stageId)
        setSelectedIdsAndRef((prev) => ({ ...prev, [input.stageId]: input.entryId }))
        requestAnimationFrame(() => textareaRef.current?.focus())
      }
      return found
    },
    [setSelectedIdsAndRef, setStageItemsAndRef],
  )

  const handleBack = useCallback(async () => {
    await flushAutoSave()
    navigate('/')
  }, [flushAutoSave, navigate])

  if (!id) {
    return (
      <div className="editor-wrap">
        <p className="editor-error">无效链接</p>
        <Link to="/">返回首页</Link>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="editor-wrap">
        <p className="muted">加载中…</p>
      </div>
    )
  }

  if (error && !material) {
    return (
      <div className="editor-wrap">
        <p className="editor-error">{error}</p>
        <Link to="/">返回首页</Link>
      </div>
    )
  }

  if (!material) {
    return (
      <div className="editor-wrap">
        <p className="muted">暂无素材数据</p>
        <Link to="/">返回首页</Link>
      </div>
    )
  }

  const isPlotMaterial = material.material_kind === 'plot'
  const plotCategoryOptions = isPlotMaterial ? plotCategoryOptionsForMaterial(material) : []
  const activePlotCategoryIsValid = plotCategoryOptions.some(
    (option) => option.stageId === activeStage,
  )
  const treeActiveStage = isPlotMaterial ? PLOT_TREE_STAGE_ID : activeStage
  const activeEntries = stageItems[activeStage] ?? []
  const selectedEntryId = selectedEntryIds[activeStage] ?? ''
  const activeEntry = activeEntries.find((entry) => entry.id === selectedEntryId) ?? null
  const activeTreeChildId = activeEntry ? treeChildId(activeStage, activeEntry.id) : ''
  const listStageIds = stageKeysForTreeStage(material, treeActiveStage)
  const listLabel = materialListLabel(material, treeActiveStage)
  const entryCards = listStageIds.flatMap((stageId) =>
    (stageItems[stageId] ?? []).map((entry) => ({
      stageId,
      entry,
      categoryLabel: materialCategoryLabel(material, stageId),
    })),
  )
  const isMaterialEntryList = !activeEntry
  const stageBody = activeEntry?.body ?? ''
  const { total: stageCharTotal, nonSpace: stageCharNonSpace } = stageTextCounts(stageBody)
  const stageLabel = isPlotMaterial ? listLabel : materialListLabel(material, activeStage)
  const entryCardPageCount = Math.max(
    1,
    Math.ceil(entryCards.length / MATERIAL_ENTRY_CARD_PAGE_SIZE),
  )
  const safeEntryCardPageIndex = Math.min(
    entryCardPageIndex,
    entryCardPageCount - 1,
  )
  const entryCardStart = safeEntryCardPageIndex * MATERIAL_ENTRY_CARD_PAGE_SIZE
  const visibleEntryCards = entryCards.slice(
    entryCardStart,
    entryCardStart + MATERIAL_ENTRY_CARD_PAGE_SIZE,
  )
  const materialGenreText = material.parent_genre?.trim() || ''
  const materialTypeText = [
    materialTypeLabel(material.material_type),
    MATERIAL_KIND_LABELS[material.material_kind],
    materialGenreText,
  ].filter(Boolean).join(' · ')
  const entryBodyHistoryKey = `material:${material.id}:${activeStage}:${selectedEntryId}:body`
  const applyEntryBody = (value: string) =>
    updateSelectedEntry((entry) => ({ ...entry, body: value }))
  const currentMaterialSaveStatus = materialSaveStatus(id)
  const currentOverviewSaveStatus = overviewSaveStatus(id)
  const combinedSaveStatus =
    currentMaterialSaveStatus !== 'idle'
      ? currentMaterialSaveStatus
      : currentOverviewSaveStatus
  const overviewLabel = `${MATERIAL_KIND_LABELS[material.material_kind]}概述`

  return (
    <div className="editor-page editor-page--workspace">
      <header className="editor-header editor-header--agent">
        <button type="button" className="back-link" onClick={() => void handleBack()}>
          ← 返回
        </button>
        <div className="editor-header-meta muted">
          <span className="editor-header-meta-inner">
            <span className="editor-header-meta-text">
              {material.title || '未命名素材库'}
              {' · '}
              {materialTypeText}
              {' · '}
              {stageLabel}
              {activeEntry ? ` · ${entryTitle(activeEntry, activeStage)}` : ''}
            </span>
            {error || message ? (
              <span
                className={
                  error
                    ? 'editor-header-flash editor-header-flash--error'
                    : 'editor-header-flash editor-header-flash--ok'
                }
                aria-live="polite"
              >
                {error ?? message}
              </span>
            ) : null}
            <span
              className={`workspace-settings-save-state workspace-settings-save-state--${combinedSaveStatus}`}
              aria-live="polite"
            >
              {autoSaveStatusLabel(combinedSaveStatus)}
            </span>
          </span>
        </div>
      </header>

      <div
        className="workspace-grid"
        style={{ '--workspace-ai-width': `${aiPanelWidth}px` } as CSSProperties}
      >
        <aside className="workspace-rail workspace-rail--tree">
          <WorkspaceTreeNav
            books={materialTreeBooks}
            defaultExpanded={false}
            activeBookId={material.id}
            activeStageId={treeActiveStage}
            activeStageChildId={activeTreeChildId}
            ariaLabel={
              groupContext
                ? `${groupContext.title}树形结构`
                : `${MATERIAL_KIND_LABELS[material.material_kind]}树形结构`
            }
            onStageSelect={(stageId) => handleStageSelect(stageId as MaterialStageId)}
            onBookSelect={(materialId) => void handleTreeMaterialSelect(materialId)}
            onBookStageSelect={(materialId, stageId) =>
              void handleTreeMaterialSelect(materialId, stageId as MaterialStageId)
            }
            onStageChildSelect={(stageId, childId) =>
              handleStageChildSelect(stageId as MaterialStageId, childId)
            }
            onBookStageChildSelect={(materialId, stageId, childId) =>
              handleTreeMaterialStageChildSelect(
                materialId,
                stageId as MaterialStageId,
                childId,
              )
            }
            onStageChildCreate={(stageId) => handleAddEntry(stageId as MaterialStageId)}
            onBookStageChildCreate={(materialId, stageId) =>
              handleTreeMaterialStageChildCreate(
                materialId,
                stageId as MaterialStageId,
              )
            }
            editingTitle={editingTitle}
            titleDraft={titleDraft}
            onTitleDraftChange={(value) =>
              textHistory.change(
                `material:${material.id}:title`,
                titleDraft,
                value,
                setTitleDraft,
              )
            }
            onTitleEditStart={() => {
              textHistory.clear(`material:${material.id}:title`, material.title)
              setTitleDraft(material.title)
              setEditingTitle(true)
            }}
            onTitleEditEnd={() => {
              const trimmed = titleDraft.trim()
              if (trimmed && trimmed !== material.title) {
                void (async () => {
                  try {
                    const next = await saveMaterial(material.id, { title: trimmed })
                    if (next) {
                      const liveItems = stageItemsRef.current
                      setMaterial({
                        ...next,
                        overview: overviewDraftRef.current,
                        stage_items: liveItems,
                        stages: materialStageItemsToStages(liveItems),
                      })
                      setMaterialSummaries((current) =>
                        upsertMaterialSummary(
                          current,
                          materialSummaryFromMaterial({
                            ...next,
                            stage_items: liveItems,
                            stages: materialStageItemsToStages(liveItems),
                          }),
                        ),
                      )
                      setMessage('素材库名已修改')
                      window.setTimeout(() => setMessage(null), 2000)
                    } else {
                      setError('保存素材库名失败')
                    }
                  } catch (e) {
                    setError(e instanceof Error ? e.message : '保存素材库名失败')
                  }
                })()
              }
              setEditingTitle(false)
              setTitleDraft('')
            }}
            onTitleEditCancel={() => {
              setEditingTitle(false)
              setTitleDraft('')
            }}
            onTitleInputKeyDown={(event) =>
              textHistory.handleKeyDown(
                event,
                `material:${material.id}:title`,
                titleDraft,
                setTitleDraft,
                { redoKey: 'm', standardRedo: false },
              )
            }
          />
        </aside>

        <aside className="workspace-ai workspace-ai--center" aria-label="AI 对话">
          <div className="workspace-ai-header workspace-ai-header-row">
            <span className="workspace-ai-header-title">素材管理智能体</span>
            <div className="workspace-ai-header-actions">
              <button
                type="button"
                className="workspace-ai-new-chat"
                aria-label="初始化素材库概述"
                title="帮您初始化本素材库的概述文档，让智能体更方便使用。"
                onClick={handleInitializeOverview}
              >
                初始化概述
              </button>
              <div
                id={historyPortalTargetId}
                className="workspace-ai-header-history-slot"
              />
              <button
                type="button"
                className="workspace-ai-new-chat"
                aria-label="清空素材库管理智能体对话并开始新会话"
                title="清空素材库管理智能体对话并开始新会话"
                onClick={() => setAiChatEpoch((epoch) => epoch + 1)}
              >
                新建对话
              </button>
            </div>
          </div>
          <div className="workspace-ai-hint muted">
            {materialTypeText} · {stageLabel}
            {activeEntry ? ` · ${entryTitle(activeEntry, activeStage)}` : ''}
          </div>
          <div className="workspace-ai-chat-stack">
            <div className="workspace-ai-chat-layer workspace-ai-chat-layer--active">
              <WorkspaceAiChat
                key={`${material.id}-material-manager-${aiChatEpoch}`}
                sessionBookId={material.id}
                sessionEpoch={aiChatEpoch}
                chatHistoryScope={{
                  owner_type: 'material',
                  owner_id: material.id,
                  category_id: 'material_manager',
                }}
                promptKind={MATERIAL_MANAGER_PROMPT_KIND}
                historyPortalTargetId={historyPortalTargetId}
                externalPromptRequest={overviewInitPromptRequest}
                onExternalPromptRequestHandled={handleOverviewInitPromptHandled}
                bookTitle={material.title}
                materialTypeKey={material.material_type}
                materialType={materialTypeLabel(material.material_type)}
                materialKind={material.material_kind}
                materialEntryKind={MATERIAL_STAGE_KIND[activeStage]}
                materialGenre={materialGenreText || materialTypeLabel(material.material_type)}
                materialOverview={overviewDraft}
                currentEntryTitle={activeEntry ? entryTitle(activeEntry, activeStage) : ''}
                materialStageItems={stageItems}
                getMaterialStageItems={getMaterialStageItemsForAi}
                getMaterialOverview={getMaterialOverviewForAi}
                selectMaterialEntry={selectMaterialEntryForAi}
                createMaterialEntry={createMaterialEntryForAi}
                editMaterialEntry={editMaterialEntryForAi}
                writeMaterialOverview={setOverviewDraftAndRef}
                stageId={activeStage}
                stageBody={stageBody}
                allStages={stagePromptBodies}
                includePiArtifacts={WORKSPACE_AI_INCLUDE_PI_ARTIFACTS}
                applyToStageEditor={applyToStageEditor}
                onRequestSave={async () => {
                  await flushAutoSave()
                }}
                workspaceType="material"
              />
            </div>
          </div>
        </aside>

        <div
          className="workspace-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整对话区宽度"
          tabIndex={0}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.preventDefault()
            splitDragRef.current = {
              startX: e.clientX,
              startWidth: aiPanelWidth,
            }
            ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            const drag = splitDragRef.current
            if (!drag) return
            const delta = e.clientX - drag.startX
            setAiPanelWidth(clampAiPanelWidth(drag.startWidth + delta, window.innerWidth))
          }}
          onPointerUp={(e) => {
            splitDragRef.current = null
            try {
              ;(e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId)
            } catch {
              /* ignore */
            }
          }}
          onPointerCancel={(e) => {
            splitDragRef.current = null
            try {
              ;(e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId)
            } catch {
              /* ignore */
            }
          }}
          onKeyDown={(e) => {
            const step = 16
            if (e.key === 'ArrowLeft') {
              e.preventDefault()
              setAiPanelWidth((w) => clampAiPanelWidth(w - step, window.innerWidth))
            } else if (e.key === 'ArrowRight') {
              e.preventDefault()
              setAiPanelWidth((w) => clampAiPanelWidth(w + step, window.innerWidth))
            }
          }}
        />

        <div className="workspace-editor-pane workspace-editor-pane--primary">
          {isMaterialEntryList ? (
            <section className="material-overview-panel" aria-labelledby="material-overview-title">
              <div className="material-overview-head">
                <label
                  id="material-overview-title"
                  className="material-overview-title"
                  htmlFor="material-overview-body"
                >
                  {overviewLabel}
                </label>
                <span
                  className={`workspace-settings-save-state workspace-settings-save-state--${currentOverviewSaveStatus}`}
                  aria-live="polite"
                >
                  {autoSaveStatusLabel(currentOverviewSaveStatus)}
                </span>
              </div>
              <textarea
                id="material-overview-body"
                className="material-overview-textarea"
                value={overviewDraft}
                onChange={(event) => setOverviewDraftAndRef(event.target.value)}
                onBlur={() => void flushOverview(id)}
                placeholder={`描述这个${MATERIAL_KIND_LABELS[material.material_kind]}收录了哪些内容、适合怎样调用或搭配使用…`}
                spellCheck={false}
              />
            </section>
          ) : null}

          <div className="workspace-stage-heading">
            <label
              className="workspace-stage-label"
              htmlFor={activeEntry ? 'stage-body' : undefined}
            >
              {stageLabel}
              {activeEntry ? ` · ${entryTitle(activeEntry, activeStage)}` : ''}
            </label>
            <span
              className="workspace-char-count muted"
              aria-live="polite"
              title={
                isMaterialEntryList
                  ? `共 ${entryCards.length.toLocaleString('zh-CN')} 个${listLabel}；每页 ${MATERIAL_ENTRY_CARD_PAGE_SIZE} 个`
                  : `不含空白字数 ${stageCharNonSpace.toLocaleString('zh-CN')}；总字符（含空格与换行）${stageCharTotal.toLocaleString('zh-CN')}`
              }
            >
              {isMaterialEntryList ? (
                <>
                  {entryCards.length.toLocaleString('zh-CN')} 个{listLabel}
                </>
              ) : (
                <>
                  {stageCharNonSpace.toLocaleString('zh-CN')} 字
                  <span className="workspace-char-count-sep" aria-hidden>
                    {' · '}
                  </span>
                  <span className="workspace-char-count-detail">
                    {stageCharTotal.toLocaleString('zh-CN')} 字符
                  </span>
                </>
              )}
            </span>
          </div>

          {isMaterialEntryList ? (
            <div className="material-entry-card-view">
              {entryCards.length > 0 ? (
                <>
                  <div className="material-entry-card-list">
                    {visibleEntryCards.map(({ stageId, entry, categoryLabel }, index) => (
                      <button
                        key={`${stageId}-${entry.id}`}
                        type="button"
                        className="material-entry-card"
                        onClick={() => handleEntrySelect(stageId, entry.id)}
                        title={`编辑${entryTitle(entry, stageId)}`}
                      >
                        <span className="material-entry-card-index">
                          第 {entryCardStart + index + 1} 个
                          {isPlotMaterial ? ` · ${categoryLabel}` : ''}
                        </span>
                        <span className="material-entry-card-name">
                          {entryTitle(entry, stageId)}
                        </span>
                        <span className="material-entry-card-body">
                          {entryBodyPreview(entry, categoryLabel)}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="material-entry-pagination">
                    <button
                      type="button"
                      className="material-entry-page-button"
                      disabled={safeEntryCardPageIndex <= 0}
                      onClick={() =>
                        setEntryCardPageIndex(
                          Math.max(0, safeEntryCardPageIndex - 1),
                        )
                      }
                    >
                      上一页
                    </button>
                    <span className="material-entry-page-state muted">
                      {safeEntryCardPageIndex + 1} / {entryCardPageCount}
                    </span>
                    <button
                      type="button"
                      className="material-entry-page-button"
                      disabled={safeEntryCardPageIndex >= entryCardPageCount - 1}
                      onClick={() =>
                        setEntryCardPageIndex(
                          Math.min(
                            entryCardPageCount - 1,
                            safeEntryCardPageIndex + 1,
                          ),
                        )
                      }
                    >
                      下一页
                    </button>
                  </div>
                </>
              ) : (
                <div className="workspace-stage-empty">
                  <p className="muted">左侧点击“新建{listLabel}”开始添加素材卡片。</p>
                </div>
              )}
            </div>
          ) : activeEntry ? (
            <div className="skill-entry-editor">
              <div className="skill-entry-toolbar">
                <label className="field skill-entry-title-field">
                  <span className="field-label">{stageLabel}名称</span>
                  <input
                    type="text"
                    value={activeEntry.title}
                    onChange={(e) =>
                      updateSelectedEntry((entry) => ({
                        ...entry,
                        title: e.target.value,
                      }))
                    }
                    onBlur={() => void flushAutoSave()}
                    placeholder={`请输入${stageLabel}名称`}
                  />
                </label>
                {isPlotMaterial ? (
                  <label className="field material-entry-category-field">
                    <span className="field-label">分类</span>
                    <select
                      value={activePlotCategoryIsValid ? activeStage : ''}
                      onChange={(event) =>
                        handleEntryCategoryChange(event.target.value as MaterialStageId)
                      }
                    >
                      {activePlotCategoryIsValid ? null : (
                        <option value="" disabled>
                          {materialCategoryLabel(material, activeStage)}
                        </option>
                      )}
                      {plotCategoryOptions.map((option) => (
                        <option key={option.stageId} value={option.stageId}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <button
                  type="button"
                  className="btn-secondary btn-small"
                  onClick={() => handleDeleteEntry(activeEntry.id)}
                >
                  删除{stageLabel}
                </button>
              </div>
              <MarkdownTextEditor
                id="stage-body"
                textareaRef={textareaRef}
                className="editor-body workspace-textarea"
                value={activeEntry.body}
                onValueChange={(value) =>
                  textHistory.change(
                    entryBodyHistoryKey,
                    activeEntry.body,
                    value,
                    applyEntryBody,
                  )
                }
                onKeyDown={(event) =>
                  textHistory.handleKeyDown(
                    event,
                    entryBodyHistoryKey,
                    activeEntry.body,
                    applyEntryBody,
                    { redoKey: 'm', standardRedo: false },
                  )
                }
                onBlur={() => void flushAutoSave()}
                placeholder={`在此编辑「${entryTitle(activeEntry, activeStage)}」内容…`}
                spellCheck={false}
                readOnly={editorStreaming}
              />
            </div>
          ) : (
            <div className="workspace-stage-empty">
              <p className="muted">
                左侧点击“新建{stageLabel}”开始添加素材条目。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
