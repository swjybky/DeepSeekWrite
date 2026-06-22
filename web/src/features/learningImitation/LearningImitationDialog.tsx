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
  SHORT_GENRE_OPTIONS,
  cloneEmptyLearningResult,
  createMaterial,
  createSkill,
  getMaterial,
  getSkill,
  getMaterialParentGenres,
  materialTypeLabel,
  normalizeMaterialStages,
  normalizeSkillStages,
  readLearningImitationPromptTemplate,
  resetLearningImitationPromptOverride,
  saveLearningImitationPromptOverride,
  saveMaterial,
  saveSkill,
  skillTypeLabel,
  type LearningDocument,
  type LearningResult,
  type LearningStageId,
  type Material,
  type MaterialStageId,
  type MaterialSummary,
  type MaterialType,
  type Skill,
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

type PendingSaveChoice = {
  stageId: LearningStageId
  targetKind: 'material' | 'skill'
  targetTitle: string
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
  const [selectedMaterialId, setSelectedMaterialId] = useState('')
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
  ) => Promise<void>>(async () => undefined)

  const validDocumentCount =
    documents.length >= MIN_DOCUMENTS && documents.length <= MAX_DOCUMENTS

  const materialTarget = useMemo(
    () => materials.find((item) => item.id === selectedMaterialId) ?? null,
    [materials, selectedMaterialId],
  )
  const skillTarget = useMemo(
    () => skills.find((item) => item.id === selectedSkillId) ?? null,
    [skills, selectedSkillId],
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
    setSelectedMaterialId('')
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

  const ensureMaterialTarget = async (): Promise<Material> => {
    if (selectedMaterialId) {
      const existing = await getMaterial(selectedMaterialId)
      if (existing) return existing
    }
    const ws = workspaceRoot?.trim()
    if (!ws) throw new Error('请先在首页选择工作文件夹，再新建目标素材库')
    const title = `学习仿写素材 ${new Date().toLocaleDateString()}`
    const created = await createMaterial(
      title,
      newLibraryType,
      newLibraryType === 'long' ? null : newMaterialGenre,
      null,
      ws,
    )
    setSelectedMaterialId(created.id)
    await onRefreshMaterials()
    return created
  }

  const ensureSkillTarget = async (): Promise<Skill> => {
    if (selectedSkillId) {
      const existing = await getSkill(selectedSkillId)
      if (existing) return existing
    }
    const ws = workspaceRoot?.trim()
    if (!ws) throw new Error('请先在首页选择工作文件夹，再新建目标技能库')
    const title = `学习仿写技能 ${new Date().toLocaleDateString()}`
    const created = await createSkill(title, newLibraryType as SkillType, ws, false)
    setSelectedSkillId(created.id)
    await onRefreshSkills()
    return created
  }

  const saveMaterialSplit = async (
    mode: LearningPersistMode,
    source: LearningResult = resultRef.current,
  ) => {
    const material = await ensureMaterialTarget()
    const stages = normalizeMaterialStages(material.stages)
    let changed = false
    for (const stage of MATERIAL_STAGE_KEYS) {
      const body = source.material_split[stage].trim()
      if (!body) continue
      stages[stage] = mergePersistedText(stages[stage], body, mode)
      changed = true
    }
    if (!changed) throw new Error('素材拆分预览为空，无法落盘')
    await saveMaterial(material.id, { stages })
    await onRefreshMaterials()
  }

  const savePlotLearning = async (
    mode: LearningPersistMode,
    source: LearningResult = resultRef.current,
  ) => {
    const skill = await ensureSkillTarget()
    const stages = normalizeSkillStages(skill.stages)
    const { plotDesignSkill, plotRefineSkill } = source.plot_learning
    const { stages: nextStages, changed } = applySkillDraftsByTitle(
      stages,
      [
        {
          stageId: 'plot_design',
          title: '剧情设计',
          body: wrapSkillBody(PLOT_DESIGN_SKILL_PREFIX, plotDesignSkill),
        },
        {
          stageId: 'plot_design',
          title: '剧情细化',
          body: wrapSkillBody(PLOT_REFINE_SKILL_PREFIX, plotRefineSkill),
        },
      ],
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
  ) => {
    const skill = await ensureSkillTarget()
    const stages = normalizeSkillStages(skill.stages)
    const body = source.style_learning.body.trim()
    if (!body) throw new Error('文风学习预览为空，无法落盘')
    const title = source.style_learning.title.trim() || '分节写手技能'
    const { stages: nextStages } = applySkillDraftsByTitle(
      stages,
      [
        {
          stageId: 'expert_section_writer',
          title,
          body: wrapSkillBody(SECTION_WRITER_SKILL_PREFIX, body),
        },
      ],
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
  ) => {
    if (stageId === 'material_split') {
      await saveMaterialSplit(mode, source)
    } else if (stageId === 'plot_learning') {
      await savePlotLearning(mode, source)
    } else {
      await saveStyleLearning(mode, source)
    }
  }

  useEffect(() => {
    saveStageResultRef.current = saveStageResult
  })

  const saveStage = async (
    stageId: LearningStageId,
    mode: LearningPersistMode,
  ) => {
    setSavingStage(stageId)
    setError(null)
    setMessage(null)
    try {
      if (stageId === 'material_split') {
        await saveMaterialSplit(mode)
      } else if (stageId === 'plot_learning') {
        await savePlotLearning(mode)
      } else {
        await saveStyleLearning(mode)
      }
      setMessage(`「${LEARNING_STAGE_LABELS[stageId]}」已落盘`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '落盘失败')
    } finally {
      setSavingStage(null)
    }
  }

  const saveActiveStage = async () => {
    const target =
      activeStage === 'material_split'
        ? materialTarget
        : skillTarget

    if (target) {
      setError(null)
      setMessage(null)
      setPendingSaveChoice({
        stageId: activeStage,
        targetKind: activeStage === 'material_split' ? 'material' : 'skill',
        targetTitle: target.title,
      })
      return
    }

    await saveStage(activeStage, 'overwrite')
  }

  const confirmPendingSave = (mode: LearningPersistMode) => {
    if (!pendingSaveChoice) return
    const stageId = pendingSaveChoice.stageId
    setPendingSaveChoice(null)
    void saveStage(stageId, mode)
  }

  const updateMaterialResult = (stage: MaterialStageId, value: string) => {
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
            <label>
              <span>素材库</span>
              <select
                value={selectedMaterialId}
                onChange={(event) => setSelectedMaterialId(event.target.value)}
              >
                <option value="">未选择，落盘时新建</option>
                {materials.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} · {materialTypeLabel(item.material_type)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>技能库</span>
              <select
                value={selectedSkillId}
                onChange={(event) => setSelectedSkillId(event.target.value)}
              >
                <option value="">未选择，落盘时新建</option>
                {skills.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} · {skillTypeLabel(item.skill_type)}
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
                    ? `落盘到${materialTarget ? `「${materialTarget.title}」` : '新建素材库'}`
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
                      ? Boolean(selectedMaterialId || workspaceRoot?.trim())
                      : needsSkill
                        ? Boolean(selectedSkillId || workspaceRoot?.trim())
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
              aria-label="选择落盘方式"
            >
              <header>
                <h3>选择落盘方式</h3>
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
                  {pendingSaveChoice.targetKind === 'material' ? '素材库' : '技能库'}
                  「{pendingSaveChoice.targetTitle}」。
                </p>
                <p>
                  选择覆盖会替换已有同位置内容；选择追加会接在已有内容后面。技能库会按同阶段、同技能名称匹配条目。
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
                  disabled={savingStage != null}
                  onClick={() => confirmPendingSave('append')}
                >
                  追加
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={savingStage != null}
                  onClick={() => confirmPendingSave('overwrite')}
                >
                  覆盖
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
