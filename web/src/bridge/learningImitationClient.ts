import { getEmbeddedPromptTemplate } from '../prompt/embeddedDefaults'
import { getBridgeApi } from './runtime'
import { localPromptLsKey } from './promptLocalStorage'
import {
  MATERIAL_STAGE_LABELS,
  type MaterialStageId,
} from './libraryDomain'

export type LearningStageId =
  | 'material_split'
  | 'plot_learning'
  | 'style_learning'

export const LEARNING_STAGE_LABELS: Record<LearningStageId, string> = {
  material_split: '素材拆分',
  plot_learning: '剧情设计学习',
  style_learning: '文风学习',
}

export const LEARNING_STAGE_IDS = Object.keys(
  LEARNING_STAGE_LABELS,
) as LearningStageId[]

export type LearningDocument = {
  id: string
  name: string
  extension: string
  size: number
  text: string
  charCount: number
  chunks: string[]
}

export type LearningMaterialSplitResult = {
  gimmick: string
  character: string
  pacing: string
  intro: string
  plot_refine: string
  draft_excerpt: string
}

export const LEARNING_MATERIAL_STAGE_IDS: MaterialStageId[] = [
  'gimmick',
  'character',
  'pacing',
  'intro',
  'plot_refine',
  'draft_excerpt',
]

export type LearningPlotResult = {
  plotDesignSkill: string
  plotRefineSkill: string
}

export type LearningStyleResult = {
  title: string
  body: string
}

export type LearningResult = {
  material_split: LearningMaterialSplitResult
  plot_learning: LearningPlotResult
  style_learning: LearningStyleResult
}

export const EMPTY_LEARNING_RESULT: LearningResult = {
  material_split: {
    gimmick: '',
    character: '',
    pacing: '',
    intro: '',
    plot_refine: '',
    draft_excerpt: '',
  },
  plot_learning: {
    plotDesignSkill: '',
    plotRefineSkill: '',
  },
  style_learning: {
    title: '分节写手技能',
    body: '',
  },
}

export function cloneEmptyLearningResult(): LearningResult {
  return {
    material_split: { ...EMPTY_LEARNING_RESULT.material_split },
    plot_learning: { ...EMPTY_LEARNING_RESULT.plot_learning },
    style_learning: { ...EMPTY_LEARNING_RESULT.style_learning },
  }
}

function stringifyCurrentResult(
  stageId: LearningStageId,
  result: LearningResult,
): string {
  if (stageId === 'material_split') {
    return LEARNING_MATERIAL_STAGE_IDS
      .map((key) => {
        const value = result.material_split[key].trim()
        return value ? `## ${MATERIAL_STAGE_LABELS[key]}\n\n${value}` : ''
      })
      .filter(Boolean)
      .join('\n\n')
  }
  if (stageId === 'plot_learning') {
    return [
      ['剧情设计技能', result.plot_learning.plotDesignSkill],
      ['剧情细化技能', result.plot_learning.plotRefineSkill],
    ]
      .filter(([, value]) => value.trim())
      .map(([label, value]) => `## ${label}\n\n${value.trim()}`)
      .join('\n\n')
  }
  return [
    `## ${result.style_learning.title || '分节写手技能'}`,
    result.style_learning.body,
  ].join('\n\n').trim()
}

export function summarizeLearningDocuments(documents: LearningDocument[]): string {
  if (documents.length === 0) return ''
  return documents
    .map((doc, index) => {
      const firstLine = doc.text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean)
      const preview = firstLine ? `；开头：${firstLine.slice(0, 80)}` : ''
      return `${index + 1}. ${doc.name}（${doc.extension}，${doc.charCount} 字，${doc.chunks.length} 段）${preview}`
    })
    .join('\n')
}

export async function getLearningImitationSystemPrompt(
  stageId: LearningStageId,
  input: {
    documents: LearningDocument[]
    result: LearningResult
  },
): Promise<string> {
  const context = {
    document_count: input.documents.length,
    documents_summary: summarizeLearningDocuments(input.documents),
    current_result: stringifyCurrentResult(stageId, input.result),
  }
  const api = await getBridgeApi()
  if (api?.get_learning_imitation_system_prompt) {
    return api.get_learning_imitation_system_prompt(
      stageId,
      JSON.stringify(context),
    )
  }
  const raw = await readLearningImitationPromptTemplate(stageId)
  return raw
    .replaceAll('{{STAGE_ID}}', stageId)
    .replaceAll('{{STAGE_LABEL}}', LEARNING_STAGE_LABELS[stageId])
    .replaceAll('{{DOCUMENT_COUNT}}', String(context.document_count))
    .replaceAll(
      '{{DOCUMENTS_SUMMARY}}',
      context.documents_summary || '（尚未上传可分析文档）',
    )
    .replaceAll(
      '{{CURRENT_RESULT}}',
      context.current_result || '（当前阶段暂未生成结果）',
    )
}

export async function readLearningImitationPromptTemplate(
  stageId: LearningStageId,
): Promise<string> {
  const api = await getBridgeApi()
  if (api?.read_learning_imitation_prompt_template) {
    const t = await api.read_learning_imitation_prompt_template(stageId)
    return t.endsWith('\n') ? t.slice(0, -1) : t
  }
  try {
    const local = localStorage.getItem(
      localPromptLsKey('learning_imitation', stageId),
    )
    if (local != null) return local.endsWith('\n') ? local.slice(0, -1) : local
  } catch {
    /* ignore */
  }
  return getEmbeddedPromptTemplate('learning_imitation', stageId)
}

export async function saveLearningImitationPromptOverride(
  stageId: LearningStageId,
  body: string,
): Promise<void> {
  const api = await getBridgeApi()
  if (api?.save_learning_imitation_prompt_override) {
    await api.save_learning_imitation_prompt_override(stageId, body)
    return
  }
  try {
    localStorage.setItem(localPromptLsKey('learning_imitation', stageId), body)
  } catch {
    console.warn('[DeepSeekWrite] 无法保存学习仿写提示词覆盖')
  }
}

export async function resetLearningImitationPromptOverride(
  stageId: LearningStageId,
): Promise<boolean> {
  const api = await getBridgeApi()
  if (api?.reset_learning_imitation_prompt_override) {
    return api.reset_learning_imitation_prompt_override(stageId)
  }
  try {
    const key = localPromptLsKey('learning_imitation', stageId)
    const had = localStorage.getItem(key) != null
    localStorage.removeItem(key)
    return had
  } catch {
    return false
  }
}
