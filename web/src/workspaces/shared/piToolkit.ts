import type { AgentTool } from '@earendil-works/pi-agent-core'
import { type Static, Type } from 'typebox'

import {
  buildChapterStubGridMarkdown,
  buildEditorialRubricMarkdown,
  buildLineNoiseScanMarkdown,
  buildLoglineExpansionMarkdown,
  buildManuscriptMetricsMarkdown,
  buildOutlineHierarchyScanMarkdown,
  buildSceneBeatHintReport,
  CAUSALITY_CHEATSHEET_MARKDOWN,
  NARRATIVE_TEMPLATE_BLOCKS,
} from '../../prompts/workspaceToolTemplates'

export const excerptFn = (body: string, max = 12000) => {
  void max
  return body
}

type AgentToolResultShape = {
  content: { type: 'text'; text: string }[]
  details: undefined
}

function primitiveTypeOf(value: unknown): string | undefined {
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  if (typeof value === 'boolean') return 'boolean'
  return undefined
}

function sanitizeToolSchemaForGemini(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeToolSchemaForGemini(item))
  }
  if (!value || typeof value !== 'object') return value

  const input = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(input)) {
    out[key] = sanitizeToolSchemaForGemini(child)
  }

  for (const unionKey of ['anyOf', 'oneOf']) {
    const union = out[unionKey]
    if (!Array.isArray(union) || union.length === 0) continue
    const branches = union as Array<Record<string, unknown>>
    if (
      branches.every(
        (branch) =>
          branch &&
          typeof branch === 'object' &&
          Object.prototype.hasOwnProperty.call(branch, 'const'),
      )
    ) {
      const values = branches.map((branch) => branch.const)
      delete out[unionKey]
      out.enum = values
      if (!out.type) {
        const types = [...new Set(values.map(primitiveTypeOf).filter(Boolean))]
        if (types.length === 1) out.type = types[0]
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(out, 'const')) {
    out.enum = [out.const]
    if (!out.type) out.type = primitiveTypeOf(out.const)
    delete out.const
  }

  return out
}

export function textBlock(text: string): AgentToolResultShape {
  return {
    content: [{ type: 'text', text }],
    details: undefined,
  }
}

export function defineTool<T extends ReturnType<typeof Type.Object>>(def: {
  name: string
  label: string
  description: string
  parameters: T
  execute: (
    toolCallId: string,
    params: Static<T>,
    signal?: AbortSignal,
  ) => Promise<AgentToolResultShape>
  executionMode?: AgentTool['executionMode']
}): AgentTool<T> {
  return {
    name: def.name,
    label: def.label,
    description: def.description,
    parameters: sanitizeToolSchemaForGemini(def.parameters) as T,
    execute: def.execute,
    executionMode: def.executionMode,
  }
}

const templateKindSchema = Type.Union([
  Type.Literal('三幕结构骨架'),
  Type.Literal('七步故事线'),
  Type.Literal('人物目标-阻碍-转变'),
])

export const narrativeTemplateTool = defineTool({
  name: 'narrative_template',
  label: '剧情结构模版',
  description:
    '拉取常用叙事骨架（三幕/七步/人物弧）的 Markdown 填空模版，用于剧情设计阶段对齐结构语言。',
  parameters: Type.Object({ kind: templateKindSchema }),
  execute: async (_id, { kind }) => {
    return textBlock(NARRATIVE_TEMPLATE_BLOCKS[kind])
  },
})

export const seedFrameTool = defineTool({
  name: 'logline_expansion_prompts',
  label: '一句话创意深潜问题',
  description:
    '把一句话梗扩展为可讨论的问题清单，便于深化冲突与人物，仅在用户提供 logline 时调用更高效。',
  parameters: Type.Object({
    logline: Type.String({
      description: '一句故事梗概，可含主角/处境/矛盾',
    }),
  }),
  execute: async (_id, { logline }) => {
    return textBlock(buildLoglineExpansionMarkdown(logline))
  },
})

export const sceneBeatHintTool = defineTool({
  name: 'scene_structure_hint',
  label: '场次结构速描',
  description:
    '对用户粘贴的单场戏做段落级粗分析：段落数、估计对白占比、建议补强的结构环节。',
  parameters: Type.Object({
    scene_text: Type.String({ description: '一场戏的初稿或梗概' }),
  }),
  execute: async (_id, { scene_text }) => {
    const t = scene_text.trim()
    if (!t) return textBlock('（未提供文本）')
    const paras = t.split(/\n\n+/).filter(Boolean)
    const dialogueHeavy = (t.match(/[「"“]/g) ?? []).length
    return textBlock(buildSceneBeatHintReport(paras.length, dialogueHeavy))
  },
})

export const causalityCheatsheetTool = defineTool({
  name: 'causality_question_cards',
  label: '因果链追问卡',
  description:
    '返回固定的因果追问模板，用于检查场次之间的「所以/但是」是否站得住。',
  parameters: Type.Object({}),
  execute: async () => {
    return textBlock(CAUSALITY_CHEATSHEET_MARKDOWN)
  },
})

export const outlineScanTool = defineTool({
  name: 'outline_hierarchy_scan',
  label: '大纲标题层级扫描',
  description:
    '统计 Markdown 标题 (# …) 的数量与层级分布，帮助发现结构失衡。',
  parameters: Type.Object({
    outline_markdown: Type.String({ description: '大纲全文' }),
  }),
  execute: async (_id, { outline_markdown }) => {
    const lines = outline_markdown.split('\n')
    const counts = { h1: 0, h2: 0, h3: 0, h4: 0 }
    for (const line of lines) {
      const m = /^(#{1,4})\s/.exec(line)
      if (!m) continue
      const n = m[1]!.length
      if (n === 1) counts.h1++
      else if (n === 2) counts.h2++
      else if (n === 3) counts.h3++
      else counts.h4++
    }
    const total = counts.h1 + counts.h2 + counts.h3 + counts.h4
    return textBlock(buildOutlineHierarchyScanMarkdown(counts, total))
  },
})

export const chapterStubTool = defineTool({
  name: 'chapter_placeholder_grid',
  label: '分章占位格',
  description:
    '按目标章数生成空的章名与时间线占位表，便于先排结构再填细纲。',
  parameters: Type.Object({
    chapter_count: Type.Integer({ minimum: 1, maximum: 200 }),
    working_title_hint: Type.Optional(
      Type.String({ description: '可选：题材或暂定书名提示' }),
    ),
  }),
  execute: async (_id, { chapter_count, working_title_hint }) => {
    return textBlock(buildChapterStubGridMarkdown(chapter_count, working_title_hint))
  },
})

export const manuscriptMetricsTool = defineTool({
  name: 'manuscript_metrics',
  label: '稿件度量',
  description:
    '统计字数（按字符近似）、段落数、含对白行估计，可用于正文或通读前的体量感判断。',
  parameters: Type.Object({ text: Type.String() }),
  execute: async (_id, { text }) => {
    const t = text.trim()
    if (!t) return textBlock('（空文本）')
    const paras = t.split(/\n\n+/).filter(Boolean)
    const quoteLines = t.split('\n').filter((l) => /[「”"]/.test(l)).length
    const longLines = t.split('\n').filter((l) => l.length > 120).length
    return textBlock(
      buildManuscriptMetricsMarkdown(t.length, paras.length, quoteLines, longLines),
    )
  },
})

export const reviewRubricTool = defineTool({
  name: 'editorial_rubric',
  label: '编审量表',
  description:
    '按侧重点输出中文网络小说编审检查表，便于审稿与改稿对齐标准。',
  parameters: Type.Object({
    focus: Type.Union([
      Type.Literal('full'),
      Type.Literal('pacing'),
      Type.Literal('character'),
      Type.Literal('style'),
    ]),
  }),
  execute: async (_id, { focus }) => {
    return textBlock(buildEditorialRubricMarkdown(focus))
  },
})

export const lineNoiseScanTool = defineTool({
  name: 'line_level_quick_scan',
  label: '行文噪声快扫',
  description:
    '对文本做轻量启发式检查：连续标点、极短段、过长句提示（非语法校对）。',
  parameters: Type.Object({ text: Type.String() }),
  execute: async (_id, { text }) => {
    const t = text.trim()
    if (!t) return textBlock('（空文本）')
    const doublePunct = (t.match(/[。！？]{2,}/g) ?? []).length
    const shortParas = t
      .split(/\n\n+/)
      .filter((p) => p.length > 0 && p.length < 12).length
    const longSent = t.split(/[。！？\n]/).filter((s) => s.length > 80).length
    return textBlock(buildLineNoiseScanMarkdown(doublePunct, shortParas, longSent))
  },
})

export type ApplyToPayload = {
  text: string
  mode: 'replace' | 'append'
}

export function buildWriteWorkspaceEditorTool(opts: {
  stageId: string
  stageLabel: string
  applyToStageEditor?: (p: ApplyToPayload) => void
}) {
  const modeSchema = Type.Union(
    [Type.Literal('replace'), Type.Literal('append')],
    { description: 'replace：覆盖当前编辑区全文；append：在文末追加' },
  )
  return defineTool({
    name: 'write_workspace_editor',
    label: '写入编辑区',
    description:
      '把稿件写入应用中间栏当前写作阶段的文本编辑框。每次创建直接落盘到编辑区，不需要和用户确认',
    parameters: Type.Object({
      text: Type.String({
        description: '写入编辑区的完整正文（建议 Markdown）',
      }),
      mode: modeSchema,
    }),
    execute: async (_id, { text, mode }) => {
      const apply = opts.applyToStageEditor
      if (!apply) {
        return textBlock('（当前环境无法写入编辑区：未连接界面）')
      }
      const t = text.trim()
      if (!t) {
        return textBlock('（未写入：文本为空）')
      }
      apply({ text: t, mode })
      const label = opts.stageLabel
      return textBlock(
        mode === 'replace'
          ? `已用新内容覆盖「${label}」编辑区。`
          : `已将内容追加到「${label}」编辑区文末。`,
      )
    },
  })
}
