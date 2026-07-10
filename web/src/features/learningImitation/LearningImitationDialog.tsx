import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Brain,
  Keyboard,
  Library,
  PenLine,
  Sparkles,
} from 'lucide'
import {
  LEARNING_STAGE_IDS,
  LEARNING_STAGE_LABELS,
  MATERIAL_STAGE_LABELS,
  MATERIAL_KIND_LABELS,
  SKILL_STAGE_LABELS,
  SKILL_KIND_LABELS,
  SHORT_GENRE_OPTIONS,
  cloneEmptyLearningResult,
  createMaterial,
  createSkill,
  getMaterial,
  getSkill,
  getMaterialParentGenres,
  materialMetaLabel,
  materialMatchesKind,
  skillMatchesKind,
  normalizeMaterialStageItems,
  normalizeSkillStages,
  readLearningImitationPromptTemplate,
  resetLearningImitationPromptOverride,
  saveLearningImitationPromptOverride,
  saveMaterial,
  saveSkill,
  skillTypeLabel,
  type LearningDocument,
  type LearningMaterialStageId,
  type LearningResult,
  type LearningStageId,
  type Material,
  type MaterialKind,
  type MaterialStageEntry,
  type MaterialSummary,
  type MaterialType,
  type Skill,
  type SkillKind,
  type SkillStageEntry,
  type SkillStageId,
  type SkillSummary,
  type SkillType,
} from '../../bridge'
import {
  extractTextDocumentFile,
  fileExtensionOf,
  isLearningDocumentFile,
  LEARNING_DOCUMENT_ACCEPTED_TYPES,
  LEARNING_DOCUMENT_SUPPORTED_LABEL,
} from '../../utils/documentText'
import { LearningAiChat, type LearningAiChatHandle } from './LearningAiChat'
import {
  appendText,
  MATERIAL_STAGE_KEYS,
  stageHasResult,
  updateLearningResult,
  type LearningWritePayload,
} from './learningAgentTools'
import './LearningImitationDialog.css'

const MIN_DOCUMENTS = 1
const MAX_DOCUMENTS = 5
const CHUNK_SIZE = 12000

type LearningIconNode = typeof Library
type LearningPersistMode = 'overwrite' | 'append'
type LearningMaterialTargetKind = Extract<MaterialKind, 'character' | 'gimmick' | 'plot' | 'draft'>
type LearningSaveAction = 'create' | 'update'

function learningSkillKind(stageId: LearningStageId): SkillKind {
  if (stageId === 'plot_learning') return 'plot'
  if (stageId === 'style_learning') return 'style'
  return 'general'
}

type PendingSaveChoice = {
  stageId: LearningStageId
  targetKind: 'material' | 'skill'
  materialTargets: PendingMaterialSaveTarget[]
  skillTarget: PendingSkillSaveTarget | null
}

type PendingMaterialSaveTarget = {
  action: LearningSaveAction
  kind: LearningMaterialTargetKind
  targetId?: string
  title: string
  newTitle: string
  stageIds: LearningMaterialStageId[]
}

type PendingSkillSaveTarget = {
  action: LearningSaveAction
  targetId?: string
  title: string
  newTitle: string
  entries: Array<{
    stageId: SkillStageId
    title: string
  }>
}

type SaveStageOptions = {
  materialTitlesByKind?: Partial<Record<LearningMaterialTargetKind, string>>
  skillTitle?: string
}

type LearningPresetAction = {
  stageId: LearningStageId
  label: string
  detail: string
  prompt: string
  icon: LearningIconNode
}

const LEARNING_PRESET_ACTIONS: LearningPresetAction[] = [
  {
    stageId: 'material_split',
    label: '一键拆出素材库',
    detail: '梗、人设、剧情、片段',
    icon: Library,
    prompt: [
      '请执行「一键拆出素材库」。',
      '先调用 list_learning_documents 了解所有样本，再按需要读取每篇样本的关键分块，综合提炼可复用素材。',
      '最后必须调用 write_learning_result，mode 使用 replace，并写入 gimmick、character、pacing、intro、plot_refine、draft_excerpt 六个字段。',
      '不要等待我补充确认；如果样本数量有效，请直接完成预览写入。',
    ].join('\n'),
  },
  {
    stageId: 'plot_learning',
    label: '一键学习剧情设计',
    detail: '结构、冲突、转折、节奏',
    icon: Brain,
    prompt: [
      '请执行「一键学习剧情设计」。',
      '先调用 list_learning_documents 了解所有样本，再按需要读取样本正文，归纳它们可复用的剧情组织方法。',
      '最后必须调用 write_learning_result，mode 使用 replace，并写入 plot_design_skill 和 plot_refine_skill。',
      '结果要像技能库条目，包含方法、步骤、判断标准和可执行模板。',
    ].join('\n'),
  },
  {
    stageId: 'style_learning',
    label: '一键文风学习',
    detail: '句式、对白、情绪、收束',
    icon: PenLine,
    prompt: [
      '请执行「一键文风学习」。',
      '先调用 list_learning_documents 了解所有样本，再按需要读取样本正文，归纳能指导分节写手产出新正文的文风规则。',
      '最后必须调用 write_learning_result，mode 使用 replace，并写入 style_skill_title 和 style_skill_body。',
      '不要大段复制原文，以规则、模板、检查清单和短示例为主。',
    ].join('\n'),
  },
]

const LEARNING_MATERIAL_TARGET_KINDS: LearningMaterialTargetKind[] = [
  'character',
  'gimmick',
  'plot',
  'draft',
]

const LEARNING_STAGE_MATERIAL_KIND: Record<LearningMaterialStageId, LearningMaterialTargetKind> = {
  character: 'character',
  gimmick: 'gimmick',
  pacing: 'plot',
  intro: 'plot',
  plot_refine: 'plot',
  draft_excerpt: 'draft',
}

const LEARNING_MATERIAL_KIND_SHORT_LABELS: Record<LearningMaterialTargetKind, string> = {
  character: '人设库',
  gimmick: '梗库',
  plot: '剧情库',
  draft: '正文库',
}

function defaultLearningMaterialTitle(kind: LearningMaterialTargetKind): string {
  return `学习仿写-${MATERIAL_KIND_LABELS[kind]} ${new Date().toLocaleDateString()}`
}

function defaultLearningSkillTitle(): string {
  return `学习仿写技能 ${new Date().toLocaleDateString()}`
}

function emptyLearningMaterialTargetIds(): Record<LearningMaterialTargetKind, string> {
  return {
    character: '',
    gimmick: '',
    plot: '',
    draft: '',
  }
}

function LearningIcon({ icon }: { icon: LearningIconNode }) {
  return (
    <svg
      aria-hidden="true"
      className="learning-action-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icon.map(([tag, attrs], index) => createElement(tag, { ...attrs, key: index }))}
    </svg>
  )
}

type Props = {
  visible?: boolean
  workspaceRoot: string | null | undefined
  materials: MaterialSummary[]
  skills: SkillSummary[]
  onClose: () => void
  onRunInBackground?: () => void
  onBackgroundFinished?: () => void
  onRefreshMaterials: () => Promise<void>
  onRefreshSkills: () => Promise<void>
}

function newId(prefix: string): string {
  return `${prefix}_${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
}

function splitTextIntoChunks(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  const chunks: string[] = []
  for (let i = 0; i < normalized.length; i += CHUNK_SIZE) {
    chunks.push(normalized.slice(i, i + CHUNK_SIZE))
  }
  return chunks
}

function countReadableChars(text: string): number {
  return text.replace(/\p{White_Space}/gu, '').length
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function newSkillEntry(title: string, body: string): SkillStageEntry {
  const now = nowIso()
  return {
    id: newId('learned_skill'),
    title,
    body,
    created_at: now,
    updated_at: now,
  }
}

function newMaterialEntry(stageId: LearningMaterialStageId, body: string): MaterialStageEntry {
  const now = nowIso()
  return {
    id: newId('learned_material'),
    title: `学习仿写-${MATERIAL_STAGE_LABELS[stageId]}-${new Date().toLocaleDateString()}`,
    body,
    created_at: now,
    updated_at: now,
  }
}

function collectMaterialDrafts(source: LearningResult): Map<
  LearningMaterialTargetKind,
  Array<{ stage: LearningMaterialStageId; body: string }>
> {
  const draftsByKind = new Map<
    LearningMaterialTargetKind,
    Array<{ stage: LearningMaterialStageId; body: string }>
  >()
  for (const stage of MATERIAL_STAGE_KEYS) {
    const body = source.material_split[stage].trim()
    if (!body) continue
    const kind = LEARNING_STAGE_MATERIAL_KIND[stage]
    draftsByKind.set(kind, [
      ...(draftsByKind.get(kind) ?? []),
      { stage, body },
    ])
  }
  return draftsByKind
}

function buildSkillDraftList(
  stageId: LearningStageId,
  source: LearningResult,
): Array<{
  stageId: SkillStageId
  title: string
  body: string
}> {
  if (stageId === 'plot_learning') {
    return [
      {
        stageId: 'plot_design',
        title: '剧情设计',
        body: wrapSkillBody(PLOT_DESIGN_SKILL_PREFIX, source.plot_learning.plotDesignSkill),
      },
      {
        stageId: 'plot_design',
        title: '剧情细化',
        body: wrapSkillBody(PLOT_REFINE_SKILL_PREFIX, source.plot_learning.plotRefineSkill),
      },
    ]
  }
  if (stageId === 'style_learning') {
    const body = source.style_learning.body.trim()
    if (!body) return []
    return [
      {
        stageId: 'expert_section_writer',
        title: source.style_learning.title.trim() || '分节写手技能',
        body: wrapSkillBody(SECTION_WRITER_SKILL_PREFIX, body),
      },
    ]
  }
  return []
}

function mergeMaterialEntries(
  current: MaterialStageEntry[],
  stageId: LearningMaterialStageId,
  entry: MaterialStageEntry,
  mode: LearningPersistMode,
): MaterialStageEntry[] {
  if (mode === 'append') return [...current, entry]
  const learnedPrefix = `学习仿写-${MATERIAL_STAGE_LABELS[stageId]}-`
  return [
    ...current.filter((item) => !item.title?.startsWith(learnedPrefix)),
    entry,
  ]
}

const PLOT_DESIGN_SKILL_PREFIX = `---
name: 剧情设计
description: 用户想要进行剧情设计的时候时，加载此技能
---

1. 根据用户的需求开始读取素材相关内容
2. 按照剧情设计技能思路，进行剧情设计
3.设计完把内容写入到剧情设计文本框内`

const PLOT_REFINE_SKILL_PREFIX = `---
name: 剧情细化
description: 当用户想要进行剧情细化的时候，加载此技能
---

## 剧情细化
1. 使用工具开始读取相关素材内容，读取剧情设计和导语设计内容
2. 按照剧情细化技能，开始对剧情设计的内容进行细化动作
3. 将细化后的文本写入到细化文本框中`

const SECTION_WRITER_SKILL_PREFIX = `---
name: 分节写手技能
description: 当用户在进行小节编写的时候，一定加载当前技能
---
读取大纲和正文相关片段，先了解本章节需要编写的内容，一次只写一章节的内容，按章节字数要求和剧情点来决定写多少内容
学习【 短篇言情行文写法分析】，开始编写正文`

function wrapSkillBody(prefix: string, body: string): string {
  const trimmed = body.trim()
  if (!trimmed) return prefix
  return `${prefix}\n\n${trimmed}`
}

function mergePersistedText(
  current: string,
  incoming: string,
  mode: LearningPersistMode,
): string {
  return mode === 'append' ? appendText(current, incoming) : incoming
}

function mergeSkillEntryByTitle(
  current: SkillStageEntry[],
  draft: {
    title: string
    body: string
  },
  mode: LearningPersistMode,
): SkillStageEntry[] {
  const title = draft.title.trim()
  const body = draft.body.trim()
  if (!title || !body) return current

  const existingIndex = current.findIndex((entry) => entry.title.trim() === title)
  if (existingIndex < 0) {
    return [...current, newSkillEntry(title, body)]
  }

  const now = nowIso()
  return current.map((entry, index) => {
    if (index !== existingIndex) return entry
    return {
      ...entry,
      title: entry.title.trim() || title,
      body: mergePersistedText(entry.body, body, mode),
      updated_at: now,
      created_at: entry.created_at ?? now,
    }
  })
}

function applySkillDraftsByTitle(
  stages: Record<SkillStageId, SkillStageEntry[]>,
  drafts: Array<{
    stageId: SkillStageId
    title: string
    body: string
  }>,
  mode: LearningPersistMode,
): {
  stages: Record<SkillStageId, SkillStageEntry[]>
  changed: boolean
} {
  const next = { ...stages }
  let changed = false
  for (const draft of drafts) {
    if (!draft.body.trim()) continue
    next[draft.stageId] = mergeSkillEntryByTitle(
      next[draft.stageId] ?? [],
      draft,
      mode,
    )
    changed = true
  }
  return { stages: next, changed }
}

export function LearningImitationDialog({
  visible = true,
  workspaceRoot,
  materials,
  skills,
  onClose,
  onRunInBackground,
  onBackgroundFinished,
  onRefreshMaterials,
  onRefreshSkills,
}: Props) {
  const [documents, setDocuments] = useState<LearningDocument[]>([])
  const [activeStage, setActiveStage] = useState<LearningStageId>('material_split')
  const [result, setResult] = useState<LearningResult>(() => cloneEmptyLearningResult())
  const [selectedMaterialIdsByKind, setSelectedMaterialIdsByKind] = useState<
    Record<LearningMaterialTargetKind, string>
  >(() => emptyLearningMaterialTargetIds())
  const [selectedSkillId, setSelectedSkillId] = useState('')
  const [newLibraryType, setNewLibraryType] = useState<MaterialType>('short')
  const [newMaterialGenre, setNewMaterialGenre] = useState(
    getMaterialParentGenres('short')[0] ?? SHORT_GENRE_OPTIONS[0] ?? '',
  )
  const [processingFiles, setProcessingFiles] = useState(false)
  const [savingStage, setSavingStage] = useState<LearningStageId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [promptEditorStage, setPromptEditorStage] = useState<LearningStageId | null>(null)
  const [promptDraft, setPromptDraft] = useState('')
  const [promptSaving, setPromptSaving] = useState(false)
  const [promptRevision, setPromptRevision] = useState(0)
  const [customInputMode, setCustomInputMode] = useState(false)
  const [agentRunning, setAgentRunning] = useState(false)
  const [learningModelLabel, setLearningModelLabel] = useState('')
  const [runningPresetStage, setRunningPresetStage] = useState<LearningStageId | null>(null)
  const [pendingSaveChoice, setPendingSaveChoice] = useState<PendingSaveChoice | null>(null)
  const [closeChoiceOpen, setCloseChoiceOpen] = useState(false)
  const [backgroundSaving, setBackgroundSaving] = useState(false)
  const [agentError, setAgentError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const learningChatRef = useRef<LearningAiChatHandle | null>(null)
  const resultRef = useRef<LearningResult>(result)
  const backgroundRunningRef = useRef(false)
  const directExitRef = useRef(false)
  const lastAgentRunningRef = useRef(false)
  const saveStageResultRef = useRef<(
    stageId: LearningStageId,
    mode: LearningPersistMode,
    source?: LearningResult,
    options?: SaveStageOptions,
  ) => Promise<void>>(async () => undefined)

  const validDocumentCount =
    documents.length >= MIN_DOCUMENTS && documents.length <= MAX_DOCUMENTS

  const materialTargetsByKind = useMemo(
    () =>
      Object.fromEntries(
        LEARNING_MATERIAL_TARGET_KINDS.map((kind) => [
          kind,
          materials.find((item) => item.id === selectedMaterialIdsByKind[kind]) ?? null,
        ]),
      ) as Record<LearningMaterialTargetKind, MaterialSummary | null>,
    [materials, selectedMaterialIdsByKind],
  )
  const selectedMaterialTargetCount = LEARNING_MATERIAL_TARGET_KINDS.reduce(
    (sum, kind) => sum + (selectedMaterialIdsByKind[kind] ? 1 : 0),
    0,
  )
  const selectedMaterialTargetNames = LEARNING_MATERIAL_TARGET_KINDS
    .map((kind) => materialTargetsByKind[kind]?.title)
    .filter(Boolean)
  const materialTargetTitle =
    selectedMaterialTargetNames.length > 0
      ? selectedMaterialTargetNames.length === 1
        ? selectedMaterialTargetNames[0] ?? '已选素材库'
        : `${selectedMaterialTargetNames.length} 个部门素材库`
      : selectedMaterialTargetCount > 0
        ? `${selectedMaterialTargetCount} 个部门素材库`
        : '新建部门素材库'
  const materialTargetDisplay = selectedMaterialTargetNames.length === 1
    ? `「${materialTargetTitle}」`
    : materialTargetTitle
  const activeSkillKind = learningSkillKind(activeStage)
  const skillOptions = useMemo(
    () =>
      skills.filter(
        (item) =>
          item.skill_type === newLibraryType &&
          skillMatchesKind(item, activeSkillKind),
      ),
    [activeSkillKind, newLibraryType, skills],
  )
  const activeSelectedSkillId = skillOptions.some((item) => item.id === selectedSkillId)
    ? selectedSkillId
    : ''
  const skillTarget = useMemo(
    () => skillOptions.find((item) => item.id === activeSelectedSkillId) ?? null,
    [activeSelectedSkillId, skillOptions],
  )

  useEffect(() => {
    resultRef.current = result
  }, [result])

  const agentBusy = agentRunning || runningPresetStage != null
  const closeDisabled = savingStage != null || backgroundSaving

  const clearLearningDraft = useCallback(() => {
    const empty = cloneEmptyLearningResult()
    resultRef.current = empty
    backgroundRunningRef.current = false
    setDocuments([])
    setActiveStage('material_split')
    setResult(empty)
    setError(null)
    setMessage(null)
    setPromptEditorStage(null)
    setPendingSaveChoice(null)
    setCloseChoiceOpen(false)
    setRunningPresetStage(null)
    setAgentRunning(false)
    setSelectedMaterialIdsByKind(emptyLearningMaterialTargetIds())
    setSelectedSkillId('')
    setNewLibraryType('short')
    setNewMaterialGenre(
      getMaterialParentGenres('short')[0] ?? SHORT_GENRE_OPTIONS[0] ?? '',
    )
    setCustomInputMode(false)
    setLearningModelLabel('')
    setAgentError(null)
  }, [])

  const handleAgentError = useCallback((message: string) => {
    if (directExitRef.current || backgroundRunningRef.current) return
    setAgentError(message)
  }, [])

  const requestClose = useCallback(() => {
    if (closeDisabled) return
    if (pendingSaveChoice) {
      setPendingSaveChoice(null)
      return
    }
    if (promptEditorStage) {
      setPromptEditorStage(null)
      return
    }
    if (agentBusy) {
      setCloseChoiceOpen(true)
      return
    }
    onClose()
  }, [
    closeDisabled,
    onClose,
    pendingSaveChoice,
    promptEditorStage,
    agentBusy,
  ])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!visible) return
      if (event.key === 'Escape' && !promptSaving && !closeDisabled) {
        event.preventDefault()
        if (closeChoiceOpen) {
          setCloseChoiceOpen(false)
        } else if (pendingSaveChoice) {
          setPendingSaveChoice(null)
        } else if (promptEditorStage) {
          setPromptEditorStage(null)
        } else {
          requestClose()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [
    closeChoiceOpen,
    closeDisabled,
    pendingSaveChoice,
    promptEditorStage,
    promptSaving,
    requestClose,
    visible,
  ])

  const applyResult = useCallback((stageId: LearningStageId, payload: LearningWritePayload) => {
    setResult((current) => {
      const next = updateLearningResult(current, stageId, payload)
      resultRef.current = next
      return next
    })
    setMessage(`已更新「${LEARNING_STAGE_LABELS[stageId]}」预览`)
    window.setTimeout(() => setMessage(null), 2200)
  }, [])

  const handleFiles = async (files: File[]) => {
    if (!files.length) return
    setError(null)
    setAgentError(null)
    setMessage(null)
    if (documents.length + files.length > MAX_DOCUMENTS) {
      setError(`最多上传 ${MAX_DOCUMENTS} 个文档`)
      return
    }
    setProcessingFiles(true)
    try {
      const nextDocs: LearningDocument[] = []
      for (const file of files) {
        if (!isLearningDocumentFile(file)) {
          setError(`不支持 ${file.name}，当前支持 ${LEARNING_DOCUMENT_SUPPORTED_LABEL}`)
          continue
        }
        const text = await extractTextDocumentFile(file)
        if (!text.trim()) {
          setError(`${file.name} 没有提取到可读正文`)
          continue
        }
        const chunks = splitTextIntoChunks(text)
        nextDocs.push({
          id: newId('doc'),
          name: file.name,
          extension: fileExtensionOf(file.name),
          size: file.size,
          text,
          charCount: countReadableChars(text),
          chunks,
        })
      }
      if (nextDocs.length > 0) {
        setDocuments((current) => [...current, ...nextDocs])
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '处理文档失败')
    } finally {
      setProcessingFiles(false)
    }
  }

  const removeDocument = (docId: string) => {
    setDocuments((current) => current.filter((doc) => doc.id !== docId))
    setAgentError(null)
  }

  const handleNewLibraryTypeChange = (nextType: MaterialType) => {
    setNewLibraryType(nextType)
    setNewMaterialGenre(
      nextType === 'long' ? '' : getMaterialParentGenres(nextType)[0] ?? '',
    )
    setSelectedMaterialIdsByKind(emptyLearningMaterialTargetIds())
  }

  const openPromptEditor = async (stageId: LearningStageId) => {
    setError(null)
    setPromptEditorStage(stageId)
    try {
      setPromptDraft(await readLearningImitationPromptTemplate(stageId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取提示词失败')
      setPromptDraft('')
    }
  }

  const savePrompt = async () => {
    if (!promptEditorStage) return
    setPromptSaving(true)
    setError(null)
    try {
      await saveLearningImitationPromptOverride(promptEditorStage, promptDraft)
      setPromptRevision((revision) => revision + 1)
      setMessage('提示词已保存')
      setPromptEditorStage(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存提示词失败')
    } finally {
      setPromptSaving(false)
    }
  }

  const resetPrompt = async () => {
    if (!promptEditorStage) return
    setPromptSaving(true)
    setError(null)
    try {
      await resetLearningImitationPromptOverride(promptEditorStage)
      const next = await readLearningImitationPromptTemplate(promptEditorStage)
      setPromptDraft(next)
      setPromptRevision((revision) => revision + 1)
      setMessage('提示词已重置')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '重置提示词失败')
    } finally {
      setPromptSaving(false)
    }
  }

  const ensureMaterialTarget = async (
    kind: LearningMaterialTargetKind,
    titleOverride?: string,
  ): Promise<Material> => {
    const selectedId = selectedMaterialIdsByKind[kind]
    if (selectedId) {
      const existing = await getMaterial(selectedId)
      if (existing) return existing
    }
    const ws = workspaceRoot?.trim()
    if (!ws) throw new Error('请先在首页选择工作文件夹，再新建目标素材库')
    const title = titleOverride?.trim() || defaultLearningMaterialTitle(kind)
    const created = await createMaterial(
      title,
      newLibraryType,
      newLibraryType === 'long' ? null : newMaterialGenre,
      null,
      ws,
      kind,
    )
    setSelectedMaterialIdsByKind((current) => ({
      ...current,
      [kind]: created.id,
    }))
    return created
  }

  const ensureSkillTarget = async (
    stageId: LearningStageId,
    titleOverride?: string,
  ): Promise<Skill> => {
    const targetSkillKind = learningSkillKind(stageId)
    if (activeSelectedSkillId) {
      const existing = await getSkill(activeSelectedSkillId)
      if (
        existing &&
        existing.skill_type === newLibraryType &&
        skillMatchesKind(existing, targetSkillKind)
      ) return existing
    }
    const ws = workspaceRoot?.trim()
    if (!ws) throw new Error('请先在首页选择工作文件夹，再新建目标技能库')
    const title = titleOverride?.trim() || defaultLearningSkillTitle()
    const created = await createSkill(
      title,
      newLibraryType as SkillType,
      ws,
      false,
      targetSkillKind,
    )
    setSelectedSkillId(created.id)
    await onRefreshSkills()
    return created
  }

  const saveMaterialSplit = async (
    mode: LearningPersistMode,
    source: LearningResult = resultRef.current,
    options: SaveStageOptions = {},
  ) => {
    const draftsByKind = collectMaterialDrafts(source)
    if (draftsByKind.size === 0) throw new Error('素材拆分预览为空，无法落盘')

    for (const [kind, drafts] of draftsByKind) {
      const material = await ensureMaterialTarget(kind, options.materialTitlesByKind?.[kind])
      const stageItems = normalizeMaterialStageItems(
        material.stage_items ?? null,
        material.stages,
      )
      for (const draft of drafts) {
        const entry = newMaterialEntry(draft.stage, draft.body)
        stageItems[draft.stage] = mergeMaterialEntries(
          stageItems[draft.stage] ?? [],
          draft.stage,
          entry,
          mode,
        )
      }
      await saveMaterial(material.id, { stage_items: stageItems })
    }
    await onRefreshMaterials()
  }

  const savePlotLearning = async (
    mode: LearningPersistMode,
    source: LearningResult = resultRef.current,
    options: SaveStageOptions = {},
  ) => {
    const skill = await ensureSkillTarget('plot_learning', options.skillTitle)
    const stages = normalizeSkillStages(skill.stages)
    const { stages: nextStages, changed } = applySkillDraftsByTitle(
      stages,
      buildSkillDraftList('plot_learning', source),
      mode,
    )
    if (!changed) {
      throw new Error('剧情设计学习预览为空，无法落盘')
    }
    await saveSkill(skill.id, {
      stages: nextStages,
    })
    await onRefreshSkills()
  }

  const saveStyleLearning = async (
    mode: LearningPersistMode,
    source: LearningResult = resultRef.current,
    options: SaveStageOptions = {},
  ) => {
    const skill = await ensureSkillTarget('style_learning', options.skillTitle)
    const stages = normalizeSkillStages(skill.stages)
    const body = source.style_learning.body.trim()
    if (!body) throw new Error('文风学习预览为空，无法落盘')
    const { stages: nextStages } = applySkillDraftsByTitle(
      stages,
      buildSkillDraftList('style_learning', source),
      mode,
    )
    await saveSkill(skill.id, {
      stages: nextStages,
    })
    await onRefreshSkills()
  }

  const saveStageResult = async (
    stageId: LearningStageId,
    mode: LearningPersistMode,
    source: LearningResult = resultRef.current,
    options: SaveStageOptions = {},
  ) => {
    if (stageId === 'material_split') {
      await saveMaterialSplit(mode, source, options)
    } else if (stageId === 'plot_learning') {
      await savePlotLearning(mode, source, options)
    } else {
      await saveStyleLearning(mode, source, options)
    }
  }

  useEffect(() => {
    saveStageResultRef.current = saveStageResult
  })

  const saveStage = async (
    stageId: LearningStageId,
    mode: LearningPersistMode,
    options: SaveStageOptions = {},
  ) => {
    setSavingStage(stageId)
    setError(null)
    setMessage(null)
    try {
      if (stageId === 'material_split') {
        await saveMaterialSplit(mode, resultRef.current, options)
      } else if (stageId === 'plot_learning') {
        await savePlotLearning(mode, resultRef.current, options)
      } else {
        await saveStyleLearning(mode, resultRef.current, options)
      }
      setMessage(`「${LEARNING_STAGE_LABELS[stageId]}」已落盘`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '落盘失败')
    } finally {
      setSavingStage(null)
    }
  }

  const buildPendingSaveChoice = (
    stageId: LearningStageId,
    source: LearningResult,
  ): PendingSaveChoice => {
    if (stageId === 'material_split') {
      const draftsByKind = collectMaterialDrafts(source)
      if (draftsByKind.size === 0) throw new Error('素材拆分预览为空，无法落盘')
      const materialTargets = Array.from(draftsByKind.entries()).map(([kind, drafts]) => {
        const selectedId = selectedMaterialIdsByKind[kind]
        const existing = materialTargetsByKind[kind]
        const action: LearningSaveAction = selectedId ? 'update' : 'create'
        const title = existing?.title ?? (selectedId ? '已选素材库' : defaultLearningMaterialTitle(kind))
        return {
          action,
          kind,
          targetId: selectedId || undefined,
          title,
          newTitle: action === 'create' ? title : '',
          stageIds: drafts.map((draft) => draft.stage),
        }
      })
      if (
        materialTargets.some((target) => target.action === 'create') &&
        !workspaceRoot?.trim()
      ) {
        throw new Error('请先在首页选择工作文件夹，再新建目标素材库')
      }
      return {
        stageId,
        targetKind: 'material',
        materialTargets,
        skillTarget: null,
      }
    }

    const skillEntries = buildSkillDraftList(stageId, source).filter((draft) => draft.body.trim())
    if (skillEntries.length === 0) {
      throw new Error(
        stageId === 'style_learning'
          ? '文风学习预览为空，无法落盘'
          : '剧情设计学习预览为空，无法落盘',
      )
    }
    const action: LearningSaveAction = activeSelectedSkillId ? 'update' : 'create'
    if (action === 'create' && !workspaceRoot?.trim()) {
      throw new Error('请先在首页选择工作文件夹，再新建目标技能库')
    }
    const title = skillTarget?.title ?? (activeSelectedSkillId ? '已选技能库' : defaultLearningSkillTitle())
    return {
      stageId,
      targetKind: 'skill',
      materialTargets: [],
      skillTarget: {
        action,
        targetId: activeSelectedSkillId || undefined,
        title,
        newTitle: action === 'create' ? title : '',
        entries: skillEntries.map((entry) => ({
          stageId: entry.stageId,
          title: entry.title,
        })),
      },
    }
  }

  const saveActiveStage = async () => {
    try {
      const choice = buildPendingSaveChoice(activeStage, resultRef.current)
      setError(null)
      setMessage(null)
      setPendingSaveChoice(choice)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法准备落盘')
    }
  }

  const confirmPendingSave = (mode: LearningPersistMode) => {
    if (!pendingSaveChoice) return
    const stageId = pendingSaveChoice.stageId
    const materialTitlesByKind = pendingSaveChoice.materialTargets.reduce(
      (acc, target) => {
        if (target.action === 'create') {
          acc[target.kind] = target.newTitle.trim()
        }
        return acc
      },
      {} as Partial<Record<LearningMaterialTargetKind, string>>,
    )
    const skillTitle = pendingSaveChoice.skillTarget?.action === 'create'
      ? pendingSaveChoice.skillTarget.newTitle.trim()
      : undefined
    if (
      pendingSaveChoice.materialTargets.some(
        (target) => target.action === 'create' && !target.newTitle.trim(),
      ) ||
      (pendingSaveChoice.skillTarget?.action === 'create' &&
        !pendingSaveChoice.skillTarget.newTitle.trim())
    ) {
      setError('请先填写新建库名称')
      return
    }
    setPendingSaveChoice(null)
    void saveStage(stageId, mode, {
      materialTitlesByKind,
      skillTitle,
    })
  }

  const updatePendingMaterialTitle = (
    kind: LearningMaterialTargetKind,
    value: string,
  ) => {
    setPendingSaveChoice((current) => current
      ? {
          ...current,
          materialTargets: current.materialTargets.map((target) =>
            target.kind === kind ? { ...target, newTitle: value } : target,
          ),
        }
      : current)
  }

  const updatePendingSkillTitle = (value: string) => {
    setPendingSaveChoice((current) => current?.skillTarget
      ? {
          ...current,
          skillTarget: {
            ...current.skillTarget,
            newTitle: value,
          },
        }
      : current)
  }

  const updateMaterialResult = (stage: LearningMaterialStageId, value: string) => {
    setResult((current) => ({
      ...current,
      material_split: {
        ...current.material_split,
        [stage]: value,
      },
    }))
  }

  const runPresetAction = async (action: LearningPresetAction) => {
    if (!validDocumentCount) {
      setError(`请先上传 ${MIN_DOCUMENTS}-${MAX_DOCUMENTS} 个正文文档`)
      return
    }
    directExitRef.current = false
    setError(null)
    setAgentError(null)
    setMessage(null)
    setActiveStage(action.stageId)
    setRunningPresetStage(action.stageId)
    try {
      if (!learningChatRef.current) throw new Error('学习仿写智能体尚未就绪')
      await learningChatRef.current.runPreset(action.stageId, action.prompt)
      if (directExitRef.current) return
      if (backgroundRunningRef.current) {
        // 后台模式下，保存逻辑由 agentRunning 状态监听的 useEffect 统一处理
        return
      }
      setMessage(`「${action.label}」已完成，可检查预览并确认落盘`)
    } catch (cause) {
      if (directExitRef.current) return
      setError(cause instanceof Error ? cause.message : `${action.label}失败`)
      if (backgroundRunningRef.current) {
        backgroundRunningRef.current = false
        onBackgroundFinished?.()
      }
    } finally {
      if (!directExitRef.current) {
        setRunningPresetStage(null)
      }
    }
  }

  useEffect(() => {
    const wasRunning = lastAgentRunningRef.current
    lastAgentRunningRef.current = agentRunning
    if (
      !wasRunning
      || agentRunning
      || !backgroundRunningRef.current
      || backgroundSaving
    ) {
      return
    }

    void (async () => {
      setBackgroundSaving(true)
      try {
        await saveStageResultRef.current(activeStage, 'overwrite', resultRef.current)
        if (!directExitRef.current) {
          setMessage(`「${LEARNING_STAGE_LABELS[activeStage]}」已在后台完成并自动落盘。`)
        }
      } catch (cause) {
        if (!directExitRef.current) {
          setError(cause instanceof Error ? cause.message : '后台落盘失败')
        }
      } finally {
        setBackgroundSaving(false)
        backgroundRunningRef.current = false
        onBackgroundFinished?.()
      }
    })()
  }, [
    activeStage,
    agentRunning,
    backgroundSaving,
    onBackgroundFinished,
  ])

  const openLearningModelSelector = async () => {
    setError(null)
    setAgentError(null)
    setMessage(null)
    try {
      if (!learningChatRef.current) throw new Error('学习仿写智能体尚未就绪')
      await learningChatRef.current.openModelSelector()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '打开模型选择失败')
    }
  }

  const activeResultReady = stageHasResult(activeStage, result)
  const pendingCreateMaterialTargets =
    pendingSaveChoice?.materialTargets.filter((target) => target.action === 'create') ?? []
  const pendingUpdateMaterialTargets =
    pendingSaveChoice?.materialTargets.filter((target) => target.action === 'update') ?? []
  const pendingSaveNameInvalid = Boolean(
    pendingSaveChoice &&
    (
      pendingCreateMaterialTargets.some((target) => !target.newTitle.trim()) ||
      (pendingSaveChoice.skillTarget?.action === 'create' &&
        !pendingSaveChoice.skillTarget.newTitle.trim())
    ),
  )
  const materialOptionsForKind = (kind: LearningMaterialTargetKind) =>
    materials.filter(
      (item) =>
        item.material_type === newLibraryType &&
        materialMatchesKind(item, kind),
    )

  return (
    <div
      className={visible
        ? 'learning-dialog-backdrop'
        : 'learning-dialog-backdrop learning-dialog-backdrop--hidden'}
      role="presentation"
      aria-hidden={!visible}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose()
      }}
    >
      <section
        className="learning-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="learning-dialog-title"
      >
        <header className="learning-dialog-head">
          <div>
            <h2 id="learning-dialog-title">学习仿写</h2>
            <p>上传 1-5 篇小说正文样本，拆素材、学剧情、沉淀文风技能。</p>
          </div>
          <button
            type="button"
            className="model-config-close"
            aria-label="关闭学习仿写"
            disabled={closeDisabled}
            onClick={requestClose}
          >
            ×
          </button>
        </header>

        <div className="learning-dialog-toolbar">
          <section className="learning-upload-zone">
            <input
              ref={fileInputRef}
              className="learning-file-input"
              type="file"
              multiple
              accept={LEARNING_DOCUMENT_ACCEPTED_TYPES}
              onChange={(event) => {
                void handleFiles(Array.from(event.currentTarget.files ?? []))
                event.currentTarget.value = ''
              }}
            />
            <button
              type="button"
              className="btn-secondary"
              disabled={processingFiles || documents.length >= MAX_DOCUMENTS}
              onClick={() => fileInputRef.current?.click()}
            >
              {processingFiles ? '解析中…' : '上传正文'}
            </button>
            <span className={validDocumentCount ? 'learning-count learning-count--ok' : 'learning-count'}>
              {documents.length}/{MAX_DOCUMENTS} 个文档
            </span>
            <span className="learning-supported muted">{LEARNING_DOCUMENT_SUPPORTED_LABEL}</span>
          </section>

          <section className="learning-targets" aria-label="落盘目标">
            {LEARNING_MATERIAL_TARGET_KINDS.map((kind) => (
              <label key={kind}>
                <span>{LEARNING_MATERIAL_KIND_SHORT_LABELS[kind]}</span>
                <select
                  value={selectedMaterialIdsByKind[kind]}
                  onChange={(event) =>
                    setSelectedMaterialIdsByKind((current) => ({
                      ...current,
                      [kind]: event.target.value,
                    }))
                  }
                >
                  <option value="">未选择，落盘时新建</option>
                  {materialOptionsForKind(kind).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title} · {materialMetaLabel(item)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label>
              <span>技能库（{SKILL_KIND_LABELS[activeSkillKind]}）</span>
              <select
                value={activeSelectedSkillId}
                onChange={(event) => setSelectedSkillId(event.target.value)}
              >
                <option value="">未选择，落盘时新建</option>
                {skillOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} · {skillTypeLabel(item.skill_type)} · {SKILL_KIND_LABELS[item.skill_kind]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>新建类型</span>
              <select
                value={newLibraryType}
                onChange={(event) =>
                  handleNewLibraryTypeChange(event.target.value as MaterialType)
                }
              >
                <option value="short">短篇</option>
                <option value="script">剧本</option>
                <option value="long">长篇</option>
              </select>
            </label>
            {newLibraryType !== 'long' ? (
              <label>
                <span>新建分类</span>
                <select
                  value={newMaterialGenre}
                  onChange={(event) => setNewMaterialGenre(event.target.value)}
                >
                  {getMaterialParentGenres(newLibraryType).map((genre) => (
                    <option key={genre} value={genre}>{genre}</option>
                  ))}
                </select>
              </label>
            ) : null}
          </section>
        </div>

        <ul className="learning-doc-list" aria-label="已上传文档">
          {documents.length === 0 ? (
            <li className="learning-doc-empty">尚未上传文档</li>
          ) : documents.map((doc) => (
            <li key={doc.id}>
              <span>{doc.name}</span>
              <em>{doc.charCount} 字 · {doc.chunks.length} 块</em>
              <button type="button" onClick={() => removeDocument(doc.id)}>移除</button>
            </li>
          ))}
        </ul>

        <nav className="learning-tabs" aria-label="学习仿写阶段">
          {LEARNING_STAGE_IDS.map((stageId, index) => (
            <button
              key={stageId}
              type="button"
              className={stageId === activeStage ? 'learning-tab learning-tab--active' : 'learning-tab'}
              onClick={() => {
                setActiveStage(stageId)
                setAgentError(null)
              }}
            >
              <span>{index + 1}</span>
              {LEARNING_STAGE_LABELS[stageId]}
            </button>
          ))}
        </nav>

        <div className="learning-dialog-body">
          <main className="learning-result-pane">
            <div className="learning-result-head">
              <div>
                <h3>{LEARNING_STAGE_LABELS[activeStage]}</h3>
                <p>
                  {activeStage === 'material_split'
                    ? `落盘到${materialTargetDisplay}`
                    : `落盘到${skillTarget ? `「${skillTarget.title}」` : '新建技能库'}`}
                </p>
              </div>
              <div className="learning-result-actions">
                <button
                  type="button"
                  className="btn-secondary btn-small"
                  onClick={() => void openPromptEditor(activeStage)}
                >
                  编辑提示词
                </button>
                <button
                  type="button"
                  className="btn-primary btn-small"
                  disabled={!activeResultReady || savingStage != null}
                  onClick={() => void saveActiveStage()}
                >
                  {savingStage === activeStage ? '落盘中…' : '确认落盘'}
                </button>
              </div>
            </div>

            {activeStage === 'material_split' ? (
              <div className="learning-material-grid">
                {MATERIAL_STAGE_KEYS.map((stage) => (
                  <label key={stage} className="learning-result-field">
                    <span>{MATERIAL_STAGE_LABELS[stage]}</span>
                    <textarea
                      value={result.material_split[stage]}
                      onChange={(event) => updateMaterialResult(stage, event.target.value)}
                      placeholder="等待 AI 写入，或手动编辑后落盘"
                    />
                  </label>
                ))}
              </div>
            ) : activeStage === 'plot_learning' ? (
              <div className="learning-result-stack">
                <label className="learning-result-field">
                  <span>剧情设计技能</span>
                  <textarea
                    value={result.plot_learning.plotDesignSkill}
                    onChange={(event) =>
                      setResult((current) => ({
                        ...current,
                        plot_learning: {
                          ...current.plot_learning,
                          plotDesignSkill: event.target.value,
                        },
                      }))}
                  />
                </label>
                <label className="learning-result-field">
                  <span>剧情细化技能</span>
                  <textarea
                    value={result.plot_learning.plotRefineSkill}
                    onChange={(event) =>
                      setResult((current) => ({
                        ...current,
                        plot_learning: {
                          ...current.plot_learning,
                          plotRefineSkill: event.target.value,
                        },
                      }))}
                  />
                </label>
              </div>
            ) : (
              <div className="learning-result-stack learning-result-stack--style">
                <label className="learning-result-field learning-result-field--title">
                  <span>技能标题</span>
                  <input
                    type="text"
                    value={result.style_learning.title}
                    onChange={(event) =>
                      setResult((current) => ({
                        ...current,
                        style_learning: {
                          ...current.style_learning,
                          title: event.target.value,
                        },
                      }))}
                  />
                </label>
                <label className="learning-result-field">
                  <span>分节写手技能</span>
                  <textarea
                    value={result.style_learning.body}
                    onChange={(event) =>
                      setResult((current) => ({
                        ...current,
                        style_learning: {
                          ...current.style_learning,
                          body: event.target.value,
                        },
                      }))}
                  />
                </label>
              </div>
            )}
          </main>

          <aside className="learning-ai-pane" aria-label="学习仿写智能体">
            <div className="learning-ai-head">
              <div>
                <strong>共享智能体</strong>
                <span>{LEARNING_STAGE_LABELS[activeStage]}</span>
              </div>
              <div className="learning-ai-head-actions">
                {!customInputMode ? (
                  <button
                    type="button"
                    className="learning-model-select"
                    aria-label="选择按钮输入使用的模型"
                    title="选择按钮输入使用的模型"
                    disabled={!validDocumentCount || agentRunning || runningPresetStage != null}
                    onClick={() => void openLearningModelSelector()}
                  >
                    <LearningIcon icon={Brain} />
                    <span>模型</span>
                    <strong>{learningModelLabel || '默认'}</strong>
                  </button>
                ) : null}
                <button
                  type="button"
                  className={customInputMode
                    ? 'learning-input-toggle learning-input-toggle--active'
                    : 'learning-input-toggle'}
                  aria-pressed={customInputMode}
                  disabled={!validDocumentCount}
                  onClick={() => setCustomInputMode((enabled) => !enabled)}
                >
                  <LearningIcon icon={customInputMode ? Sparkles : Keyboard} />
                  {customInputMode ? '按钮模式' : '自己输入'}
                </button>
              </div>
            </div>
            <div className="learning-quick-actions" aria-label="一键学习任务">
              {LEARNING_PRESET_ACTIONS.map((action) => {
                const isRunning = runningPresetStage === action.stageId
                const disabled = !validDocumentCount || agentRunning || runningPresetStage != null
                return (
                  <button
                    key={action.stageId}
                    type="button"
                    className={action.stageId === activeStage
                      ? 'learning-action learning-action--active'
                      : 'learning-action'}
                    disabled={disabled}
                    onClick={() => void runPresetAction(action)}
                  >
                    <LearningIcon icon={isRunning ? Sparkles : action.icon} />
                    <span>
                      <strong>{isRunning ? '运行中…' : action.label}</strong>
                      <em>{action.detail}</em>
                    </span>
                  </button>
                )
              })}
            </div>
            {validDocumentCount ? (
              <LearningAiChat
                ref={learningChatRef}
                activeStage={activeStage}
                documents={documents}
                result={result}
                promptRevision={promptRevision}
                showCustomInput={customInputMode}
                onApplyResult={applyResult}
                onModelLabelChange={setLearningModelLabel}
                onRunStateChange={setAgentRunning}
                onError={handleAgentError}
              />
            ) : (
              <div className="learning-ai-disabled">
                请先上传 {MIN_DOCUMENTS}-{MAX_DOCUMENTS} 个正文文档。
              </div>
            )}
          </aside>
        </div>

        {(error || agentError || message) ? (
          <p className={(error || agentError)
            ? 'learning-status learning-status--error'
            : 'learning-status'}>
            {error ?? agentError ?? message}
          </p>
        ) : null}

        {closeChoiceOpen ? (
          <div className="learning-close-backdrop" role="presentation">
            <section
              className="learning-close-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="学习仿写关闭方式"
            >
              <h3>学习仿写正在运行</h3>
              <p>
                直接退出会终止本次学习仿写并清空所有样本与预览；后台继续执行会隐藏弹窗，完成后自动落盘到对应素材库/技能库。
              </p>
              <footer>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    directExitRef.current = true
                    learningChatRef.current?.abort()
                    clearLearningDraft()
                    onClose()
                  }}
                >
                  直接退出
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    const stageId = runningPresetStage ?? activeStage
                    const needsMaterial = stageId === 'material_split'
                    const needsSkill = stageId === 'plot_learning' || stageId === 'style_learning'
                    const canSave = needsMaterial
                      ? Boolean(selectedMaterialTargetCount > 0 || workspaceRoot?.trim())
                      : needsSkill
                        ? Boolean(activeSelectedSkillId || workspaceRoot?.trim())
                        : false
                    if (!canSave) {
                      setCloseChoiceOpen(false)
                      setError('请先选择落盘目标，或在首页选择工作文件夹后再后台继续。')
                      return
                    }
                    backgroundRunningRef.current = true
                    setCloseChoiceOpen(false)
                    setMessage('学习仿写将在后台继续，完成后自动落盘。')
                    onRunInBackground?.()
                  }}
                >
                  后台继续执行
                </button>
              </footer>
            </section>
          </div>
        ) : null}

        {pendingSaveChoice ? (
          <div className="learning-prompt-backdrop" role="presentation">
            <section
              className="learning-prompt-dialog learning-save-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="确认落盘"
            >
              <header>
                <h3>确认落盘</h3>
                <button
                  type="button"
                  className="model-config-close"
                  disabled={savingStage != null}
                  onClick={() => setPendingSaveChoice(null)}
                >
                  ×
                </button>
              </header>
              <div className="learning-save-body">
                <p>
                  将「{LEARNING_STAGE_LABELS[pendingSaveChoice.stageId]}」落盘到
                  {pendingSaveChoice.targetKind === 'material' ? '素材库' : '技能库'}。
                </p>
                {pendingSaveChoice.targetKind === 'material' ? (
                  <>
                    {pendingCreateMaterialTargets.length > 0 ? (
                      <section className="learning-save-section">
                        <h4>即将新建素材库</h4>
                        <div className="learning-save-list">
                          {pendingCreateMaterialTargets.map((target) => (
                            <article key={`create-${target.kind}`} className="learning-save-row">
                              <div>
                                <strong>{LEARNING_MATERIAL_KIND_SHORT_LABELS[target.kind]}</strong>
                                <span>
                                  {MATERIAL_KIND_LABELS[target.kind]} · 写入：
                                  {target.stageIds.map((stage) => MATERIAL_STAGE_LABELS[stage]).join('、')}
                                </span>
                              </div>
                              <input
                                value={target.newTitle}
                                aria-label={`${LEARNING_MATERIAL_KIND_SHORT_LABELS[target.kind]}新建名称`}
                                onChange={(event) =>
                                  updatePendingMaterialTitle(target.kind, event.target.value)
                                }
                              />
                            </article>
                          ))}
                        </div>
                      </section>
                    ) : null}
                    {pendingUpdateMaterialTargets.length > 0 ? (
                      <section className="learning-save-section">
                        <h4>即将追加/覆盖到已有素材库</h4>
                        <div className="learning-save-list">
                          {pendingUpdateMaterialTargets.map((target) => (
                            <article key={`update-${target.kind}`} className="learning-save-row">
                              <div>
                                <strong>{target.title}</strong>
                                <span>
                                  {LEARNING_MATERIAL_KIND_SHORT_LABELS[target.kind]} · 写入：
                                  {target.stageIds.map((stage) => MATERIAL_STAGE_LABELS[stage]).join('、')}
                                </span>
                              </div>
                            </article>
                          ))}
                        </div>
                      </section>
                    ) : null}
                  </>
                ) : pendingSaveChoice.skillTarget ? (
                  <section className="learning-save-section">
                    <h4>
                      {pendingSaveChoice.skillTarget.action === 'create'
                        ? '即将新建技能库'
                        : '即将追加/覆盖到已有技能库'}
                    </h4>
                    <div className="learning-save-list">
                      <article className="learning-save-row">
                        <div>
                          <strong>
                            {pendingSaveChoice.skillTarget.action === 'create'
                              ? pendingSaveChoice.skillTarget.newTitle || '新建技能库'
                              : pendingSaveChoice.skillTarget.title}
                          </strong>
                          <span>
                            写入：
                            {pendingSaveChoice.skillTarget.entries
                              .map((entry) => `${SKILL_STAGE_LABELS[entry.stageId]}：${entry.title}`)
                              .join('、')}
                          </span>
                        </div>
                        {pendingSaveChoice.skillTarget.action === 'create' ? (
                          <input
                            value={pendingSaveChoice.skillTarget.newTitle}
                            aria-label="新建技能库名称"
                            onChange={(event) => updatePendingSkillTitle(event.target.value)}
                          />
                        ) : null}
                      </article>
                    </div>
                  </section>
                ) : null}
                {pendingSaveNameInvalid ? (
                  <p className="learning-save-warning">请填写新建库名称。</p>
                ) : null}
                <p className="learning-save-note">
                  选择覆盖会替换同栏目的旧学习仿写条目；选择追加会新增条目。技能库会按同阶段、同技能名称匹配条目。
                </p>
              </div>
              <footer>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={savingStage != null}
                  onClick={() => setPendingSaveChoice(null)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={savingStage != null || pendingSaveNameInvalid}
                  onClick={() => confirmPendingSave('append')}
                >
                  追加落盘
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={savingStage != null || pendingSaveNameInvalid}
                  onClick={() => confirmPendingSave('overwrite')}
                >
                  覆盖落盘
                </button>
              </footer>
            </section>
          </div>
        ) : null}

        {promptEditorStage ? (
          <div className="learning-prompt-backdrop" role="presentation">
            <section
              className="learning-prompt-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={`${LEARNING_STAGE_LABELS[promptEditorStage]}提示词`}
            >
              <header>
                <h3>{LEARNING_STAGE_LABELS[promptEditorStage]}提示词</h3>
                <button
                  type="button"
                  className="model-config-close"
                  disabled={promptSaving}
                  onClick={() => setPromptEditorStage(null)}
                >
                  ×
                </button>
              </header>
              <textarea
                value={promptDraft}
                disabled={promptSaving}
                onChange={(event) => setPromptDraft(event.target.value)}
              />
              <footer>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={promptSaving}
                  onClick={() => void resetPrompt()}
                >
                  重置默认
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={promptSaving}
                  onClick={() => void savePrompt()}
                >
                  {promptSaving ? '保存中…' : '保存提示词'}
                </button>
              </footer>
            </section>
          </div>
        ) : null}
      </section>
    </div>
  )
}
