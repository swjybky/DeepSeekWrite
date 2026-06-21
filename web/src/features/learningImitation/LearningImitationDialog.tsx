import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { LearningAiChat } from './LearningAiChat'
import {
  appendText,
  MATERIAL_STAGE_KEYS,
  stageHasResult,
  updateLearningResult,
  type LearningWritePayload,
} from './learningAgentTools'
import './LearningImitationDialog.css'

const MIN_DOCUMENTS = 3
const MAX_DOCUMENTS = 5
const CHUNK_SIZE = 12000

type Props = {
  workspaceRoot: string | null | undefined
  materials: MaterialSummary[]
  skills: SkillSummary[]
  onClose: () => void
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

export function LearningImitationDialog({
  workspaceRoot,
  materials,
  skills,
  onClose,
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
  const fileInputRef = useRef<HTMLInputElement | null>(null)

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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !promptSaving && savingStage == null) {
        event.preventDefault()
        if (promptEditorStage) {
          setPromptEditorStage(null)
        } else {
          onClose()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, promptEditorStage, promptSaving, savingStage])

  const applyResult = useCallback((payload: LearningWritePayload) => {
    setResult((current) => updateLearningResult(current, activeStage, payload))
    setMessage(`已更新「${LEARNING_STAGE_LABELS[activeStage]}」预览`)
    window.setTimeout(() => setMessage(null), 2200)
  }, [activeStage])

  const handleFiles = async (files: File[]) => {
    if (!files.length) return
    setError(null)
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

  const saveMaterialSplit = async () => {
    const material = await ensureMaterialTarget()
    const stages = normalizeMaterialStages(material.stages)
    let changed = false
    for (const stage of MATERIAL_STAGE_KEYS) {
      const body = result.material_split[stage].trim()
      if (!body) continue
      stages[stage] = appendText(stages[stage], body)
      changed = true
    }
    if (!changed) throw new Error('素材拆分预览为空，无法落盘')
    await saveMaterial(material.id, { stages })
    await onRefreshMaterials()
  }

  const savePlotLearning = async () => {
    const skill = await ensureSkillTarget()
    const stages = normalizeSkillStages(skill.stages)
    const entries = [...stages.plot_design]
    const { plotDesignSkill, plotRefineSkill } = result.plot_learning
    if (plotDesignSkill.trim()) {
      entries.push(newSkillEntry('剧情设计学习', plotDesignSkill.trim()))
    }
    if (plotRefineSkill.trim()) {
      entries.push(newSkillEntry('剧情细化学习', plotRefineSkill.trim()))
    }
    if (entries.length === stages.plot_design.length) {
      throw new Error('剧情设计学习预览为空，无法落盘')
    }
    await saveSkill(skill.id, {
      stages: {
        ...stages,
        plot_design: entries,
      },
    })
    await onRefreshSkills()
  }

  const saveStyleLearning = async () => {
    const skill = await ensureSkillTarget()
    const stages = normalizeSkillStages(skill.stages)
    const body = result.style_learning.body.trim()
    if (!body) throw new Error('文风学习预览为空，无法落盘')
    await saveSkill(skill.id, {
      stages: {
        ...stages,
        expert_section_writer: [
          ...stages.expert_section_writer,
          newSkillEntry(
            result.style_learning.title.trim() || '文风学习 - 分节写手技能',
            body,
          ),
        ],
      },
    })
    await onRefreshSkills()
  }

  const saveActiveStage = async () => {
    setSavingStage(activeStage)
    setError(null)
    setMessage(null)
    try {
      if (activeStage === 'material_split') {
        await saveMaterialSplit()
      } else if (activeStage === 'plot_learning') {
        await savePlotLearning()
      } else {
        await saveStyleLearning()
      }
      setMessage(`「${LEARNING_STAGE_LABELS[activeStage]}」已落盘`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '落盘失败')
    } finally {
      setSavingStage(null)
    }
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

  const activeResultReady = stageHasResult(activeStage, result)

  return (
    <div
      className="learning-dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && savingStage == null) onClose()
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
            <p>上传 3-5 篇小说正文样本，拆素材、学剧情、沉淀文风技能。</p>
          </div>
          <button
            type="button"
            className="model-config-close"
            aria-label="关闭学习仿写"
            disabled={savingStage != null}
            onClick={onClose}
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
              onClick={() => setActiveStage(stageId)}
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
              <div className="learning-result-stack">
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
              <strong>共享智能体</strong>
              <span>{LEARNING_STAGE_LABELS[activeStage]}</span>
            </div>
            {validDocumentCount ? (
              <LearningAiChat
                activeStage={activeStage}
                documents={documents}
                result={result}
                promptRevision={promptRevision}
                onApplyResult={applyResult}
              />
            ) : (
              <div className="learning-ai-disabled">
                请先上传 {MIN_DOCUMENTS}-{MAX_DOCUMENTS} 个正文文档。
              </div>
            )}
          </aside>
        </div>

        {(error || message) ? (
          <p className={error ? 'learning-status learning-status--error' : 'learning-status'}>
            {error ?? message}
          </p>
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
