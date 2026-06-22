import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import {
  LEARNING_STAGE_LABELS,
  LEARNING_MATERIAL_STAGE_IDS,
  MATERIAL_STAGE_LABELS,
  type LearningDocument,
  type LearningResult,
  type LearningStageId,
  type MaterialStageId,
} from '../../bridge'
import { defineTool, textBlock } from '../../workspaces/shared/piToolkit'

export const MATERIAL_STAGE_KEYS: MaterialStageId[] = LEARNING_MATERIAL_STAGE_IDS

export type LearningWritePayload = {
  mode?: 'replace' | 'append'
  gimmick?: string
  character?: string
  pacing?: string
  intro?: string
  plot_refine?: string
  draft_excerpt?: string
  plot_design_skill?: string
  plot_refine_skill?: string
  style_skill_title?: string
  style_skill_body?: string
}

export function appendText(current: string, addition: string): string {
  const next = addition.trim()
  if (!next) return current
  const base = current.trim()
  if (!base) return next
  return `${base}\n\n${next}`
}

function mergeText(
  current: string,
  incoming: string | undefined,
  mode: 'replace' | 'append',
): string {
  const text = String(incoming ?? '').trim()
  if (!text) return current
  return mode === 'append' ? appendText(current, text) : text
}

function formatCurrentResult(stageId: LearningStageId, result: LearningResult): string {
  if (stageId === 'material_split') {
    return MATERIAL_STAGE_KEYS
      .map((stage) => {
        const body = result.material_split[stage].trim()
        return body ? `## ${MATERIAL_STAGE_LABELS[stage]}\n\n${body}` : ''
      })
      .filter(Boolean)
      .join('\n\n')
  }
  if (stageId === 'plot_learning') {
    return [
      ['剧情设计技能', result.plot_learning.plotDesignSkill],
      ['剧情细化技能', result.plot_learning.plotRefineSkill],
    ]
      .map(([label, body]) => (body.trim() ? `## ${label}\n\n${body.trim()}` : ''))
      .filter(Boolean)
      .join('\n\n')
  }
  return [
    `## ${result.style_learning.title || '分节写手技能'}`,
    result.style_learning.body,
  ].join('\n\n').trim()
}

export function stageHasResult(
  stageId: LearningStageId,
  result: LearningResult,
): boolean {
  return Boolean(formatCurrentResult(stageId, result).trim())
}

export function updateLearningResult(
  current: LearningResult,
  activeStage: LearningStageId,
  payload: LearningWritePayload,
): LearningResult {
  const mode = payload.mode === 'append' ? 'append' : 'replace'
  if (activeStage === 'material_split') {
    const material = { ...current.material_split }
    for (const stage of MATERIAL_STAGE_KEYS) {
      material[stage] = mergeText(material[stage], payload[stage], mode)
    }
    return { ...current, material_split: material }
  }
  if (activeStage === 'plot_learning') {
    return {
      ...current,
      plot_learning: {
        plotDesignSkill: mergeText(
          current.plot_learning.plotDesignSkill,
          payload.plot_design_skill,
          mode,
        ),
        plotRefineSkill: mergeText(
          current.plot_learning.plotRefineSkill,
          payload.plot_refine_skill,
          mode,
        ),
      },
    }
  }
  return {
    ...current,
    style_learning: {
      title: payload.style_skill_title?.trim() || current.style_learning.title,
      body: mergeText(current.style_learning.body, payload.style_skill_body, mode),
    },
  }
}

export function buildLearningTools(input: {
  activeStage: LearningStageId
  documents: LearningDocument[]
  applyResult: (payload: LearningWritePayload) => void
}): AgentTool[] {
  return [
    defineTool({
      name: 'list_learning_documents',
      label: '列出学习样本',
      description: '列出当前上传的小说正文样本，包括文档 id、文件名、字数和分块数量。',
      parameters: Type.Object({}),
      execute: async () =>
        textBlock(
          input.documents
            .map((doc, index) => (
              `${index + 1}. id=${doc.id}\n文件：${doc.name}\n格式：${doc.extension}\n字数：${doc.charCount}\n分块：${doc.chunks.length}`
            ))
            .join('\n\n') || '（暂无可用样本）',
        ),
    }),
    defineTool({
      name: 'read_learning_document',
      label: '读取学习样本',
      description:
        '读取指定小说样本文本。文档较长时请按 chunk_index 分块读取，chunk_index 从 1 开始。',
      parameters: Type.Object({
        document_id: Type.String({ description: '来自 list_learning_documents 的文档 id' }),
        chunk_index: Type.Optional(Type.Integer({
          minimum: 1,
          description: '可选，读取第几个文本分块；不填时读取第一块并提示总块数',
        })),
      }),
      execute: async (_id, params) => {
        const doc = input.documents.find((item) => item.id === params.document_id)
        if (!doc) return textBlock(`未找到文档：${params.document_id}`)
        const index = Math.max(1, Number(params.chunk_index ?? 1))
        const chunk = doc.chunks[index - 1]
        if (!chunk) return textBlock(`${doc.name} 没有第 ${index} 个分块`)
        const note = doc.chunks.length > 1
          ? `（${doc.name} 共 ${doc.chunks.length} 块，当前第 ${index} 块）`
          : `（${doc.name} 全文）`
        return textBlock(`${note}\n\n${chunk}`)
      },
    }),
    defineTool({
      name: 'search_learning_documents',
      label: '搜索学习样本',
      description: '在所有上传样本文本中搜索关键词，返回包含上下文的片段。',
      parameters: Type.Object({
        query: Type.String({ description: '要搜索的关键词、人物名、句式或桥段词' }),
        max_results: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
      }),
      execute: async (_id, params) => {
        const query = params.query.trim()
        if (!query) return textBlock('请提供搜索关键词')
        const maxResults = Number(params.max_results ?? 8)
        const rows: string[] = []
        const needle = query.toLowerCase()
        for (const doc of input.documents) {
          const haystack = doc.text.toLowerCase()
          let cursor = 0
          while (rows.length < maxResults) {
            const found = haystack.indexOf(needle, cursor)
            if (found < 0) break
            const start = Math.max(0, found - 120)
            const end = Math.min(doc.text.length, found + query.length + 160)
            rows.push(`【${doc.name}】\n...${doc.text.slice(start, end)}...`)
            cursor = found + query.length
          }
          if (rows.length >= maxResults) break
        }
        return textBlock(rows.length ? rows.join('\n\n---\n\n') : `未找到：${query}`)
      },
    }),
    defineTool({
      name: 'write_learning_result',
      label: '写入学习结果预览',
      description:
        '把当前阶段的学习结果写入界面预览区。只写预览，不会直接写入素材库或技能库。',
      parameters: Type.Object({
        mode: Type.Optional(Type.Union([Type.Literal('replace'), Type.Literal('append')], {
          description: 'replace 覆盖对应预览字段；append 追加到字段末尾。默认 replace。',
        })),
        gimmick: Type.Optional(Type.String({ description: '素材拆分：梗' })),
        character: Type.Optional(Type.String({ description: '素材拆分：人设' })),
        pacing: Type.Optional(Type.String({ description: '素材拆分：剧情设计' })),
        intro: Type.Optional(Type.String({ description: '素材拆分：导语设计' })),
        plot_refine: Type.Optional(Type.String({ description: '素材拆分：剧情细化' })),
        draft_excerpt: Type.Optional(Type.String({ description: '素材拆分：优秀正文片段' })),
        plot_design_skill: Type.Optional(Type.String({ description: '剧情设计学习：剧情设计技能' })),
        plot_refine_skill: Type.Optional(Type.String({ description: '剧情设计学习：剧情细化技能' })),
        style_skill_title: Type.Optional(Type.String({ description: '文风学习：分节写手技能标题' })),
        style_skill_body: Type.Optional(Type.String({ description: '文风学习：分节写手技能正文' })),
      }),
      execute: async (_id, params) => {
        const mode = params.mode === 'append' ? 'append' : 'replace'
        input.applyResult({ ...params, mode })
        return textBlock(`已写入「${LEARNING_STAGE_LABELS[input.activeStage]}」预览区，等待用户确认落盘。`)
      },
    }),
  ]
}
