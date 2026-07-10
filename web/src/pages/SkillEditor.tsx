import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  SKILL_STAGE_KEYS,
  SKILL_STAGE_LABELS,
  SKILL_KIND_LABELS,
  SKILL_KIND_STAGE_IDS,
  type Skill,
  type SkillKind,
  type SkillStageEntry,
  type SkillStageId,
  type SkillSummary,
  getSkill,
  listSkills,
  loadCommonSkillsToSkill,
  normalizeSkillStages,
  saveSkill,
  skillTypeLabel,
} from '../bridge'
import { WorkspaceAiChat } from '../components/WorkspaceAiChat'
import { WorkspaceTreeNav } from '../components/WorkspaceTreeNav'
import { MarkdownTextEditor } from '../components/MarkdownTextEditor'
import { useAppDialog } from '../components/useAppDialog'
import type { ApplyToStageEditorPayload } from '../pi/workspaceStageAgents'
import {
  autoSaveStatusLabel,
  useKeyedAutoSave,
} from '../hooks/useKeyedAutoSave'
import { useTextHistory } from '../hooks/useTextHistory'
import './BookEditor.css'

const AI_PANEL_WIDTH_KEY = 'deepseekwrite:skill-ai-width'
const AI_PANEL_MIN = 240
const AI_PANEL_HARD_MAX = 1000
const WORKSPACE_AI_INCLUDE_PI_ARTIFACTS = false
const WORKSPACE_SPLITTER_W = 6
const WORKSPACE_COL_L = 18
const WORKSPACE_COL_R = 36
const WORKSPACE_COL_SUM = 18 + 36 + 36
const EDITOR_MIN_FOR_LAYOUT = 160
const SKILL_TREE_LIST_ID = 'skill-list'
const SKILL_ENTRY_CARD_PAGE_SIZE = 4

type SkillStages = Record<SkillStageId, SkillStageEntry[]>
/** 兼容旧 URL `view=overview`；界面已合并为列表（概述叠在列表上方）。 */
export type SkillTreeSection = typeof SKILL_TREE_LIST_ID | 'overview'

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

function newStageSkillEntry(): SkillStageEntry {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  return {
    id: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
    title: '未命名技能',
    body: '',
    created_at: now,
    updated_at: now,
  }
}

function skillEntryTitle(entry: SkillStageEntry): string {
  return entry.title?.trim() || '未命名技能'
}

function skillEntryBodyPreview(entry: SkillStageEntry): string {
  return entry.body.trim() || '暂无技能内容'
}

function stagesToPromptText(stages: SkillStages): Record<SkillStageId, string> {
  const out = {} as Record<SkillStageId, string>
  for (const stageId of SKILL_STAGE_KEYS) {
    out[stageId] = (stages[stageId] ?? [])
      .map((entry) => `## ${entry.title || '未命名技能'}\n\n${entry.body || ''}`.trim())
      .filter(Boolean)
      .join('\n\n---\n\n')
  }
  return out
}

export type SkillEditorGroupContext = {
  groupId: string
  title: string
  memberIdsOrdered: string[]
}

type SkillEditorProps = {
  skillId?: string
  groupContext?: SkillEditorGroupContext | null
  /** @deprecated 概述已合并进技能列表；保留以兼容旧 URL `view=` */
  initialView?: SkillTreeSection | null
  initialStageId?: SkillStageId | null
  initialEntryId?: string | null
  onGroupSkillChange?: (
    skillId: string,
    target?: {
      view?: SkillTreeSection
      stageId?: SkillStageId
      entryId?: string
    },
  ) => void
}

export function SkillEditor({
  skillId: skillIdProp,
  groupContext = null,
  initialView: _initialView = null,
  initialStageId = null,
  initialEntryId = null,
  onGroupSkillChange,
}: SkillEditorProps = {}) {
  const historyPortalTargetId = useId()
  const { id: routeId } = useParams<{ id: string }>()
  const id = skillIdProp ?? routeId
  const navigate = useNavigate()
  const { alert: showAlert, confirm, dialog } = useAppDialog()
  const [skill, setSkill] = useState<Skill | null>(null)
  const [stages, setStages] = useState<SkillStages>(() => normalizeSkillStages({}))
  const [skillSummaries, setSkillSummaries] = useState<SkillSummary[]>([])
  const [groupSkills, setGroupSkills] = useState<Skill[]>([])
  const [activeStage, setActiveStage] = useState<SkillStageId>('character_design')
  const [selectedEntryIds, setSelectedEntryIds] = useState<
    Partial<Record<SkillStageId, string>>
  >({})
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingCommonSkills, setLoadingCommonSkills] = useState(false)
  const [aiPanelWidth, setAiPanelWidth] = useState(readStoredAiWidth)
  const [aiChatEpoch, setAiChatEpoch] = useState(0)
  const [editorStreaming, setEditorStreaming] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [overviewDraft, setOverviewDraft] = useState('')
  const [entryCardPageIndex, setEntryCardPageIndex] = useState(0)
  const [overviewInitPromptRequest, setOverviewInitPromptRequest] = useState<{
    id: number
    prompt: string
  } | null>(null)

  const splitDragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const stagesRef = useRef<SkillStages>(stages)
  const overviewDraftRef = useRef('')
  const activeStageRef = useRef<SkillStageId>(activeStage)
  const selectedEntryIdsRef = useRef<Partial<Record<SkillStageId, string>>>({})
  const overviewInitPromptSeqRef = useRef(0)
  const tokenBufferRef = useRef('')
  const tokenBufferRafRef = useRef<number | undefined>(undefined)
  const initialStageIdRef = useRef(initialStageId)
  const initialEntryIdRef = useRef(initialEntryId)
  const textHistory = useTextHistory()

  useEffect(() => {
    initialStageIdRef.current = initialStageId
    initialEntryIdRef.current = initialEntryId
  }, [initialEntryId, initialStageId])

  const autoSave = useKeyedAutoSave<SkillStages>({
    getSnapshot: (key) => (key === id ? { ...stagesRef.current } : null),
    saveSnapshot: async (key, snapshot) => {
      try {
        const next = await saveSkill(key, { stages: snapshot })
        if (!next) throw new Error('保存失败：技能不存在')
        setSkill((current) => ({
          ...next,
          title: current?.title ?? next.title,
          stages: stagesRef.current,
        }))
        setError(null)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '保存失败')
        throw cause
      }
    },
  })
  const {
    flush: flushSkill,
    markSaved: markSkillSaved,
    schedule: scheduleSkillSave,
    statusFor: skillSaveStatus,
  } = autoSave

  const overviewAutoSave = useKeyedAutoSave<string>({
    getSnapshot: (key) => (key === id ? overviewDraftRef.current : null),
    saveSnapshot: async (key, snapshot) => {
      try {
        const next = await saveSkill(key, { overview: snapshot })
        if (!next) throw new Error('保存失败：技能不存在')
        setSkill((current) => ({
          ...next,
          title: current?.title ?? next.title,
          stages: stagesRef.current,
          overview: snapshot,
        }))
        setError(null)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '概述保存失败')
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
    stagesRef.current = stages
  }, [stages])

  useEffect(() => {
    overviewDraftRef.current = overviewDraft
  }, [overviewDraft])

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

  const setStagesAndRef = useCallback((updater: (current: SkillStages) => SkillStages) => {
    const current = stagesRef.current
    const next = updater(current)
    if (next === current) return
    stagesRef.current = next
    setStages(next)
    if (id) scheduleSkillSave(id)
  }, [id, scheduleSkillSave])

  const setSelectedIdsAndRef = useCallback(
    (updater: (current: Partial<Record<SkillStageId, string>>) => Partial<Record<SkillStageId, string>>) => {
      setSelectedEntryIds((prev) => {
        const next = updater(prev)
        selectedEntryIdsRef.current = next
        return next
      })
    },
    [],
  )

  const updateSelectedEntry = useCallback(
    (updater: (current: SkillStageEntry) => SkillStageEntry) => {
      const stageId = activeStageRef.current
      const entryId = selectedEntryIdsRef.current[stageId]
      if (!entryId) return
      setStagesAndRef((prev) => ({
        ...prev,
        [stageId]: (prev[stageId] ?? []).map((entry) =>
          entry.id === entryId ? updater(entry) : entry,
        ),
      }))
    },
    [setStagesAndRef],
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
        const entryId = selectedEntryIdsRef.current[stageId]
        const currentBody = (stagesRef.current[stageId] ?? []).find(
          (entry) => entry.id === entryId,
        )?.body ?? ''
        const current = currentBody + tokenBufferRef.current
        const next = payload.preserveWhitespace
          ? payload.text
          : payload.text.trim()
        textHistory.record(
          `skill:${id}:${stageId}:${entryId}:body`,
          current,
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
        const entryId = selectedEntryIdsRef.current[stageId]
        const currentBody = (stagesRef.current[stageId] ?? []).find(
          (entry) => entry.id === entryId,
        )?.body ?? ''
        const current = currentBody + tokenBufferRef.current
        textHistory.record(
          `skill:${id}:${stageId}:${entryId}:body`,
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
        textHistory.endGroup(`skill:${id}:${stageId}:${entryId}:body`)
        if (id) void flushSkill(id)
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
          `skill:${id}:${stageId}:${entryId}:body`,
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
      flushSkill,
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

  const syncSkillState = useCallback(
    (
      next: Skill,
      options?: {
        resetNavigation?: boolean
        initialStageId?: SkillStageId | null
        initialEntryId?: string | null
      },
    ) => {
      const normalized = normalizeSkillStages(next.stages)
      setSkill({ ...next, stages: normalized })
      stagesRef.current = normalized
      setStages(normalized)
      const overview = next.overview ?? ''
      overviewDraftRef.current = overview
      setOverviewDraft(overview)
      const stageKeys =
        SKILL_KIND_STAGE_IDS[(next.skill_kind ?? 'general') as SkillKind] ??
        SKILL_STAGE_KEYS

      if (options?.resetNavigation) {
        const ids: Partial<Record<SkillStageId, string>> = {}
        const requestedStageId = options.initialStageId
        const requestedEntryId = options.initialEntryId?.trim()
        const hasRequestedEntry =
          requestedStageId && requestedEntryId
            ? (normalized[requestedStageId] ?? []).some(
                (entry) => entry.id === requestedEntryId,
              )
            : false
        if (requestedStageId && hasRequestedEntry) {
          ids[requestedStageId] = requestedEntryId
        }
        selectedEntryIdsRef.current = ids
        setSelectedEntryIds(ids)
        const firstStageWithEntry =
          stageKeys.find((stageId) => (normalized[stageId] ?? []).length > 0) ??
          stageKeys[0] ??
          'character_design'
        setActiveStage(
          requestedStageId && hasRequestedEntry
            ? requestedStageId
            : firstStageWithEntry,
        )
        return
      }

      setSelectedEntryIds((prev) => {
        const merged: Partial<Record<SkillStageId, string>> = {}
        for (const stageId of stageKeys) {
          const entries = normalized[stageId] ?? []
          const currentId = prev[stageId]
          if (currentId && entries.some((entry) => entry.id === currentId)) {
            merged[stageId] = currentId
          }
        }
        selectedEntryIdsRef.current = merged
        return merged
      })
      if (!stageKeys.includes(activeStageRef.current)) {
        setActiveStage(stageKeys[0] ?? 'character_design')
      }
    },
    [],
  )

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const [s, summaries] = await Promise.all([
        getSkill(id),
        groupContext ? listSkills() : Promise.resolve([] as SkillSummary[]),
      ])
      if (!s) {
        setSkill(null)
        setError('未找到该技能')
        return
      }
      // 仅在技能库 id 变化时完整加载；同库内切换条目只改 URL，不走这里，避免整页/智能体重置
      syncSkillState(s, {
        resetNavigation: true,
        initialStageId: initialStageIdRef.current,
        initialEntryId: initialEntryIdRef.current,
      })
      markSkillSaved(s.id)
      markOverviewSaved(s.id)
      if (groupContext) {
        setSkillSummaries(summaries)
        const detailIds = groupContext.memberIdsOrdered.filter(
          (memberId) => memberId !== s.id,
        )
        const details = await Promise.all(detailIds.map((memberId) => getSkill(memberId)))
        setGroupSkills([
          s,
          ...details.filter((item): item is Skill => Boolean(item)),
        ])
      } else {
        setGroupSkills([])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [
    groupContext,
    id,
    markOverviewSaved,
    markSkillSaved,
    syncSkillState,
  ])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void load()
    })
    return () => {
      cancelled = true
    }
  }, [load])

  // 同库深链/树节点切换：只同步选中条目，不重新 load（否则 loading 会卸掉 AI 面板）
  useEffect(() => {
    if (loading || !skill || skill.id !== id) return
    const stageId = initialStageId
    const entryId = initialEntryId?.trim()
    if (!stageId || !entryId) return
    const currentId = selectedEntryIdsRef.current[stageId]
    if (currentId === entryId && activeStageRef.current === stageId) return
    const entries = stagesRef.current[stageId] ?? []
    if (!entries.some((entry) => entry.id === entryId)) return
    setActiveStage(stageId)
    activeStageRef.current = stageId
    setSelectedIdsAndRef((prev) => ({ ...prev, [stageId]: entryId }))
  }, [id, initialEntryId, initialStageId, loading, skill, setSelectedIdsAndRef])

  const flushAutoSave = useCallback(async () => {
    if (!id) return true
    flushAllTokenBuffers()
    const [skillOk, overviewOk] = await Promise.all([
      flushSkill(id),
      flushOverview(id),
    ])
    return skillOk && overviewOk
  }, [flushAllTokenBuffers, flushOverview, flushSkill, id])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return
      e.preventDefault()
      void flushAutoSave()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [flushAutoSave])

  const stagePromptBodies = useMemo(() => stagesToPromptText(stages), [stages])

  const handleStageSelect = (stageId: SkillStageId) => {
    void flushAutoSave()
    setActiveStage(stageId)
    setEntryCardPageIndex(0)
    setSelectedIdsAndRef((prev) => ({ ...prev, [stageId]: '' }))
  }

  const skillTreeBooks = useMemo(() => {
    if (!skill) return null
    const summaryById = new Map(skillSummaries.map((item) => [item.id, item]))
    const detailById = new Map(groupSkills.map((item) => [item.id, item]))
    detailById.set(skill.id, { ...skill, stages })
    const memberIds = groupContext?.memberIdsOrdered ?? [skill.id]
    return memberIds
      .map((memberId) => detailById.get(memberId) ?? summaryById.get(memberId))
      .filter((item): item is Skill | SkillSummary => Boolean(item))
      .map((item) => {
        const stageKeys = SKILL_KIND_STAGE_IDS[item.skill_kind] ?? SKILL_STAGE_KEYS
        const detail = detailById.get(item.id)
        const stageItems = detail?.stages ?? (item.id === skill.id ? stages : null)
        const entryChildren =
          stageItems == null
            ? []
            : stageKeys.flatMap((stageId) =>
                (stageItems[stageId] ?? []).map((entry) => ({
                  id: `${stageId}:${entry.id}`,
                  label: entry.title || '未命名技能',
                })),
              )
        const isActiveSkill = item.id === skill.id
        return {
          id: item.id,
          title: SKILL_KIND_LABELS[item.skill_kind],
          meta: item.title || '未命名技能库',
          stages: [
            {
              id: SKILL_TREE_LIST_ID,
              label: '技能列表',
              children: entryChildren,
              createChildLabel: isActiveSkill ? '新增技能' : undefined,
              branchClickBehavior: 'select' as const,
            },
          ],
        }
      })
  }, [groupContext?.memberIdsOrdered, groupSkills, skill, skillSummaries, stages])

  const handleTreeSkillSelect = async (
    skillId: string,
    treeNodeId?: SkillStageId | string,
  ) => {
    const rawNodeId = String(treeNodeId ?? '')
    const viewTarget =
      rawNodeId === SKILL_TREE_LIST_ID || rawNodeId === 'overview'
        ? SKILL_TREE_LIST_ID
        : null
    const [targetStageId, targetEntryId] = rawNodeId.split(':')
    const parsedTarget: {
      view: typeof SKILL_TREE_LIST_ID
      stageId: SkillStageId
      entryId: string
    } | null =
      targetStageId && targetEntryId && targetEntryId !== '__empty__'
        ? {
            view: SKILL_TREE_LIST_ID,
            stageId: targetStageId as SkillStageId,
            entryId: targetEntryId,
          }
        : null
    if (skillId === skill?.id) {
      if (viewTarget) {
        void flushAutoSave()
        setSelectedIdsAndRef((prev) => ({ ...prev, [activeStageRef.current]: '' }))
        if (groupContext && onGroupSkillChange) {
          onGroupSkillChange(skillId, { view: SKILL_TREE_LIST_ID })
        }
        return
      }
      if (parsedTarget) {
        selectSkillEntry(parsedTarget.stageId, parsedTarget.entryId)
        if (groupContext && onGroupSkillChange) {
          onGroupSkillChange(skillId, parsedTarget)
        }
      } else if (treeNodeId && !rawNodeId.includes(':')) {
        handleStageSelect(treeNodeId as SkillStageId)
      }
      return
    }
    await flushAutoSave()
    if (groupContext && onGroupSkillChange) {
      onGroupSkillChange(
        skillId,
        parsedTarget ?? (viewTarget ? { view: viewTarget } : undefined),
      )
      return
    }
    navigate(`/skill/${skillId}`)
  }

  const handleTreeSkillChildCreate = (skillId: string) => {
    if (skillId === skill?.id) {
      handleAddEntry()
      return
    }
    void flushAutoSave().then(() => {
      if (groupContext && onGroupSkillChange) {
        onGroupSkillChange(skillId, { view: SKILL_TREE_LIST_ID })
      } else {
        navigate(`/skill/${skillId}`)
      }
    })
  }

  const handleBack = useCallback(async () => {
    await flushAutoSave()
    navigate('/')
  }, [flushAutoSave, navigate])

  const handleLoadCommonSkills = useCallback(async () => {
    if (!id || loadingCommonSkills) return
    const ok = await confirm({
      title: '加载内置通用技能',
      message: '将内置通用技能加载到当前技能库。只会写入当前技能分类允许的阶段，已加载过的技能不会重复添加。',
      confirmText: '加载',
    })
    if (!ok) return
    setLoadingCommonSkills(true)
    setError(null)
    setMessage(null)
    try {
      const saved = await flushAutoSave()
      if (!saved) {
        setError('当前技能库保存失败，请处理后再加载内置通用技能。')
        return
      }
      const result = await loadCommonSkillsToSkill(id)
      if (!result) {
        setError('加载失败：技能库不存在')
        return
      }
      syncSkillState(result.skill)
      markSkillSaved(result.skill.id)
      markOverviewSaved(result.skill.id)
      if (result.available_count === 0) {
        await showAlert({
          title: '暂无通用技能',
          message: '请先在技能库设置中配置通用技能，再回到当前技能库加载。',
        })
        setMessage('暂无可加载的内置通用技能')
        return
      }
      if (result.already_loaded || result.added_count === 0) {
        await showAlert({
          title: '无需重复加载',
          message: '当前技能库已加载这些通用技能，不需要再次添加。',
        })
        setMessage('已加载，无需加载')
        return
      }
      setMessage(`已加载 ${result.added_count} 条内置通用技能`)
      window.setTimeout(() => setMessage(null), 2000)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '加载内置通用技能失败')
    } finally {
      setLoadingCommonSkills(false)
    }
  }, [
    confirm,
    flushAutoSave,
    id,
    loadingCommonSkills,
    markOverviewSaved,
    markSkillSaved,
    showAlert,
    syncSkillState,
  ])

  const handleAddEntry = () => {
    const stageId = activeStageRef.current
    const entry = newStageSkillEntry()
    setStagesAndRef((prev) => ({
      ...prev,
      [stageId]: [...(prev[stageId] ?? []), entry],
    }))
    setSelectedIdsAndRef((prev) => ({ ...prev, [stageId]: entry.id }))
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const handleDeleteEntry = (entryId: string) => {
    const stageId = activeStageRef.current
    const entries = stagesRef.current[stageId] ?? []
    const index = entries.findIndex((entry) => entry.id === entryId)
    const nextEntries = entries.filter((entry) => entry.id !== entryId)
    const nextSelected = nextEntries[Math.max(0, Math.min(index, nextEntries.length - 1))]
    setStagesAndRef((prev) => ({ ...prev, [stageId]: nextEntries }))
    setSelectedIdsAndRef((prev) => ({ ...prev, [stageId]: nextSelected?.id ?? '' }))
  }

  const selectSkillEntry = useCallback(
    (stageId: SkillStageId, entryId: string) => {
      setActiveStage(stageId)
      activeStageRef.current = stageId
      setSelectedIdsAndRef((prev) => ({ ...prev, [stageId]: entryId }))
    },
    [setSelectedIdsAndRef],
  )

  const createSkillEntry = useCallback(
    (input: { stageId: SkillStageId; title: string; body: string }) => {
      const entry = {
        ...newStageSkillEntry(),
        title: input.title.trim() || '未命名技能',
        body: input.body,
      }
      setStagesAndRef((prev) => ({
        ...prev,
        [input.stageId]: [...(prev[input.stageId] ?? []), entry],
      }))
      selectSkillEntry(input.stageId, entry.id)
      return entry
    },
    [selectSkillEntry, setStagesAndRef],
  )

  const editSkillEntry = useCallback(
    (input: {
      stageId: SkillStageId
      entryId: string
      title?: string
      body?: string
    }) => {
      let changed = false
      setStagesAndRef((prev) => ({
        ...prev,
        [input.stageId]: (prev[input.stageId] ?? []).map((entry) => {
          if (entry.id !== input.entryId) return entry
          changed = true
          return {
            ...entry,
            title: input.title ?? entry.title,
            body: input.body ?? entry.body,
            updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
          }
        }),
      }))
      return changed
    },
    [setStagesAndRef],
  )

  const writeSkillOverview = useCallback(
    (text: string) => {
      overviewDraftRef.current = text
      setOverviewDraft(text)
      if (id) scheduleOverviewSave(id)
    },
    [id, scheduleOverviewSave],
  )

  const handleInitOverview = useCallback(() => {
    const hasOverview = overviewDraftRef.current.trim().length > 0
    const overwriteInstruction = hasOverview
      ? '当前概述已有内容，请先读取并保留仍然有效的信息，在此基础上更新，最后调用 write_skill_overview，使用 replace 模式并设置 allow_overwrite_existing=true 写入概述。'
      : '当前概述为空，最后调用 write_skill_overview，使用 replace 模式写入概述。'
    overviewInitPromptSeqRef.current += 1
    setOverviewInitPromptRequest({
      id: overviewInitPromptSeqRef.current,
      prompt: `请初始化《${skill?.title || '当前技能库'}》的技能库概述。概述需要说明这个技能库的用途、适用阶段、核心写法原则、条目组织方式和后续维护建议。${overwriteInstruction}`,
    })
  }, [skill?.title])

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

  if (error && !skill) {
    return (
      <div className="editor-wrap">
        <p className="editor-error">{error}</p>
        <Link to="/">返回首页</Link>
      </div>
    )
  }

  if (!skill) {
    return (
      <div className="editor-wrap">
        <p className="muted">暂无技能数据</p>
        <Link to="/">返回首页</Link>
      </div>
    )
  }

  const activeSkillStageKeys =
    SKILL_KIND_STAGE_IDS[skill.skill_kind] ?? SKILL_STAGE_KEYS
  const activeEntries = stages[activeStage] ?? []
  const activeKindEntries = activeSkillStageKeys.flatMap((stageId) =>
    (stages[stageId] ?? []).map((entry) => ({ stageId, entry })),
  )
  const selectedEntryId = selectedEntryIds[activeStage] ?? ''
  const activeEntry = activeEntries.find((entry) => entry.id === selectedEntryId) ?? null
  const stageBody = activeEntry?.body ?? ''
  const { total: stageCharTotal, nonSpace: stageCharNonSpace } = stageTextCounts(stageBody)
  const isSkillEntryList = !activeEntry
  const activeTreeStageId = SKILL_TREE_LIST_ID
  const activeTreeChildId = selectedEntryId ? `${activeStage}:${selectedEntryId}` : ''
  const entryCardPageCount = Math.max(
    1,
    Math.ceil(activeKindEntries.length / SKILL_ENTRY_CARD_PAGE_SIZE),
  )
  const safeEntryCardPageIndex = Math.min(entryCardPageIndex, entryCardPageCount - 1)
  const entryCardStart = safeEntryCardPageIndex * SKILL_ENTRY_CARD_PAGE_SIZE
  const visibleEntryCards = activeKindEntries.slice(
    entryCardStart,
    entryCardStart + SKILL_ENTRY_CARD_PAGE_SIZE,
  )
  const skillTypeText = skillTypeLabel(skill.skill_type)
  const skillKindText = SKILL_KIND_LABELS[skill.skill_kind]
  const overviewLabel = `${skillKindText}概述`
  const currentOverviewSaveStatus = overviewSaveStatus(id)
  const entryBodyHistoryKey = `skill:${skill.id}:${activeStage}:${selectedEntryId}:body`
  const applyEntryBody = (value: string) =>
    updateSelectedEntry((entry) => ({ ...entry, body: value }))
  const showStageMetaOnCards = activeSkillStageKeys.length > 1

  return (
    <div className="editor-page editor-page--workspace">
      <header className="editor-header editor-header--agent">
        <button type="button" className="back-link" onClick={() => void handleBack()}>
          ← 返回
        </button>
        <div className="editor-header-meta muted">
          <span className="editor-header-meta-inner">
            <span className="editor-header-meta-text">
              {skill.title || '未命名技能库'}
              {' · '}
              {skillTypeText}
              {' · '}
              {skillKindText}
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
              className={`workspace-settings-save-state workspace-settings-save-state--${skillSaveStatus(id)}`}
              aria-live="polite"
            >
              {autoSaveStatusLabel(skillSaveStatus(id))}
            </span>
          </span>
        </div>
        <div className="editor-header-actions">
          <button
            type="button"
            className="editor-header-material-select"
            disabled={loadingCommonSkills}
            onClick={() => void handleLoadCommonSkills()}
          >
            {loadingCommonSkills ? '加载中...' : '加载内置通用技能'}
          </button>
        </div>
      </header>
      {dialog}

      <div
        className="workspace-grid"
        style={{ '--workspace-ai-width': `${aiPanelWidth}px` } as CSSProperties}
      >
        <aside className="workspace-rail workspace-rail--tree">
          <WorkspaceTreeNav
            books={skillTreeBooks ?? []}
            defaultExpanded
            collapseInactiveBooks={false}
            titleEditable={false}
            activeBookId={skill.id}
            activeStageId={activeTreeStageId}
            activeStageChildId={activeTreeChildId}
            ariaLabel={`${groupContext?.title ?? skill.title}树形结构`}
            onStageSelect={(treeNodeId) => void handleTreeSkillSelect(skill.id, treeNodeId)}
            onBookSelect={(skillId) => void handleTreeSkillSelect(skillId)}
            onBookStageSelect={(skillId, treeNodeId) =>
              void handleTreeSkillSelect(skillId, treeNodeId)
            }
            onBookStageChildSelect={(skillId, _treeNodeId, childId) =>
              void handleTreeSkillSelect(skillId, childId)
            }
            onBookStageChildCreate={(skillId) =>
              handleTreeSkillChildCreate(skillId)
            }
            editingTitle={editingTitle}
            titleDraft={titleDraft}
            onTitleDraftChange={(value) =>
              textHistory.change(
                `skill:${skill.id}:title`,
                titleDraft,
                value,
                setTitleDraft,
              )
            }
            onTitleEditStart={() => {
              textHistory.clear(`skill:${skill.id}:title`, skill.title)
              setTitleDraft(skill.title)
              setEditingTitle(true)
            }}
            onTitleEditEnd={() => {
              const trimmed = titleDraft.trim()
              if (trimmed && trimmed !== skill.title) {
                void (async () => {
                  try {
                    const next = await saveSkill(skill.id, { title: trimmed })
                    if (next) {
                      setSkill((current) => ({
                        ...next,
                        stages: stagesRef.current,
                        title: next.title || current?.title || trimmed,
                      }))
                      setMessage('技能库名已修改')
                      window.setTimeout(() => setMessage(null), 2000)
                    } else {
                      setError('保存技能库名失败')
                    }
                  } catch (e) {
                    setError(e instanceof Error ? e.message : '保存技能库名失败')
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
                `skill:${skill.id}:title`,
                titleDraft,
                setTitleDraft,
                { redoKey: 'm', standardRedo: false },
              )
            }
          />
        </aside>

        <aside className="workspace-ai workspace-ai--center" aria-label="AI 对话">
          <div className="workspace-ai-header workspace-ai-header-row">
            <span className="workspace-ai-header-title">技能管理智能体</span>
            <div className="workspace-ai-header-actions">
              <div
                id={historyPortalTargetId}
                className="workspace-ai-header-history-slot"
              />
              <button
                type="button"
                className="workspace-ai-new-chat"
                onClick={handleInitOverview}
              >
                初始化概述
              </button>
              <button
                type="button"
                className="workspace-ai-new-chat"
                aria-label="清空技能管理智能体对话并开始新会话"
                title="清空技能管理智能体对话并开始新会话"
                onClick={() => setAiChatEpoch((epoch) => epoch + 1)}
              >
                新建对话
              </button>
            </div>
          </div>
          <div className="workspace-ai-hint muted">
            技能库 · {skillTypeText} · {skillKindText}
            {activeEntry ? ` · ${activeEntry.title}` : ''}
          </div>
          <div className="workspace-ai-chat-stack">
            <div className="workspace-ai-chat-layer workspace-ai-chat-layer--active">
              <WorkspaceAiChat
                key={`${skill.id}-skill-manager-${aiChatEpoch}`}
                sessionBookId={skill.id}
                sessionEpoch={aiChatEpoch}
                chatHistoryScope={{
                  owner_type: 'skill',
                  owner_id: skill.id,
                  category_id: 'skill_manager',
                }}
                bookTitle={skill.title}
                historyPortalTargetId={historyPortalTargetId}
                skillType={skill.skill_type}
                skillKind={skill.skill_kind}
                skillOverview={overviewDraft}
                currentEntryTitle={activeEntry?.title ?? ''}
                skillStageItems={stages}
                getSkillStages={() => stagesRef.current}
                getSkillOverview={() => overviewDraftRef.current}
                selectSkillEntry={selectSkillEntry}
                createSkillEntry={createSkillEntry}
                editSkillEntry={editSkillEntry}
                writeSkillOverview={writeSkillOverview}
                stageId={activeStage}
                stageBody={stageBody}
                allStages={stagePromptBodies}
                externalPromptRequest={overviewInitPromptRequest}
                onExternalPromptRequestHandled={(requestId) => {
                  if (overviewInitPromptRequest?.id === requestId) {
                    setOverviewInitPromptRequest(null)
                  }
                }}
                includePiArtifacts={WORKSPACE_AI_INCLUDE_PI_ARTIFACTS}
                applyToStageEditor={applyToStageEditor}
                onRequestSave={async () => {
                  if (id) await flushAutoSave()
                }}
                workspaceType="skill"
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
          {isSkillEntryList ? (
            <section className="material-overview-panel" aria-labelledby="skill-overview-title">
              <div className="material-overview-head">
                <label
                  id="skill-overview-title"
                  className="material-overview-title"
                  htmlFor="skill-overview-body"
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
                id="skill-overview-body"
                className="material-overview-textarea"
                value={overviewDraft}
                onChange={(event) => {
                  const value = event.target.value
                  overviewDraftRef.current = value
                  setOverviewDraft(value)
                  if (id) scheduleOverviewSave(id)
                }}
                onBlur={() => {
                  if (id) void flushOverview(id)
                }}
                placeholder="概述这个技能库的用途、适用阶段、核心规则和条目组织方式…"
              />
            </section>
          ) : null}

          <div className="workspace-stage-heading">
            <label className="workspace-stage-label" htmlFor={activeEntry ? 'stage-body' : undefined}>
              {isSkillEntryList ? '技能列表' : skillEntryTitle(activeEntry)}
            </label>
            <span
              className="workspace-char-count muted"
              aria-live="polite"
              title={
                isSkillEntryList
                  ? `共 ${activeKindEntries.length.toLocaleString('zh-CN')} 个技能；每页 ${SKILL_ENTRY_CARD_PAGE_SIZE} 个`
                  : `不含空白字数 ${stageCharNonSpace.toLocaleString('zh-CN')}；总字符（含空格与换行）${stageCharTotal.toLocaleString('zh-CN')}`
              }
            >
              {isSkillEntryList ? (
                <>{activeKindEntries.length.toLocaleString('zh-CN')} 个技能</>
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

          {isSkillEntryList ? (
            <div className="material-entry-card-view" aria-label="技能列表">
              {activeKindEntries.length > 0 ? (
                <>
                  <div className="material-entry-card-list">
                    {visibleEntryCards.map(({ stageId, entry }, index) => (
                      <button
                        key={`${stageId}-${entry.id}`}
                        type="button"
                        className="material-entry-card"
                        onClick={() => {
                          void flushAutoSave()
                          selectSkillEntry(stageId, entry.id)
                        }}
                        title={`编辑${skillEntryTitle(entry)}`}
                      >
                        <span className="material-entry-card-index">
                          第 {entryCardStart + index + 1} 个
                          {showStageMetaOnCards
                            ? ` · ${SKILL_STAGE_LABELS[stageId]}`
                            : ''}
                        </span>
                        <span className="material-entry-card-name">
                          {skillEntryTitle(entry)}
                        </span>
                        <span className="material-entry-card-body">
                          {skillEntryBodyPreview(entry)}
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
                        setEntryCardPageIndex(Math.max(0, safeEntryCardPageIndex - 1))
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
                          Math.min(entryCardPageCount - 1, safeEntryCardPageIndex + 1),
                        )
                      }
                    >
                      下一页
                    </button>
                  </div>
                </>
              ) : (
                <div className="workspace-stage-empty">
                  <p className="muted">左侧点击“新增技能”开始沉淀技能卡片。</p>
                </div>
              )}
            </div>
          ) : activeEntry ? (
            <div className="skill-entry-editor">
              <div className="skill-entry-toolbar">
                <label className="field skill-entry-title-field">
                  <span className="field-label">技能名称</span>
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
                    placeholder="请输入技能名称"
                  />
                </label>
                <button
                  type="button"
                  className="btn-secondary btn-small"
                  onClick={() => handleDeleteEntry(activeEntry.id)}
                >
                  删除技能
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
                spellCheck={false}
                readOnly={editorStreaming}
                placeholder={`沉淀「${activeEntry.title || '当前技能'}」的写作技能、规则、示例或注意事项…`}
              />
            </div>
          ) : (
            <div className="workspace-stage-empty">
              <p className="muted">请选择或新增一个技能。</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
