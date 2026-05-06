import type { AgentTool } from '@mariozechner/pi-agent-core'
import { type Static, Type } from 'typebox'

import type { StageId } from '../bridge'
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
} from '../prompts/workspaceToolTemplates'
import {
  PEEK_OTHER_STAGES_EMPTY,
  WORKSPACE_STAGE_LABELS,
  buildDraftStagePrompt,
  buildOutlineStagePrompt,
  buildPlotDesignStagePrompt,
  buildPlotRefineStagePrompt,
  buildReviewStagePrompt,
} from '../prompts/workspaceStages'

export type ApplyToStageEditorPayload = {
  text: string
  mode: 'replace' | 'append'
}

export type WorkspaceStageAgentContext = {
  bookTitle: string
  stageId: StageId
  stageBody: string
  /** 各阶段当前文本，供需要跨阶段参照的工具使用 */
  allStages: Partial<Record<StageId, string>>
  /**
   * 由 BookEditor 注入：将正文写入中间栏当前阶段文本框（剧情设计 / 剧情细化等）。
   * 未注入时「写入编辑区」工具返回提示，不修改界面。
   */
  applyToStageEditor?: (payload: ApplyToStageEditorPayload) => void
}

const excerpt = (body: string, max = 12000) =>
  body.length > max ? `${body.slice(0, max)}\n\n…（内容过长已截断）` : body

function textBlock(text: string): AgentToolResultShape {
  return {
    content: [{ type: 'text', text }],
    details: undefined,
  }
}

type AgentToolResultShape = {
  content: { type: 'text'; text: string }[]
  details: undefined
}

function tool<T extends ReturnType<typeof Type.Object>>(
  def: {
    name: string
    label: string
    description: string
    parameters: T
    execute: (
      toolCallId: string,
      params: Static<T>,
      signal?: AbortSignal,
    ) => Promise<AgentToolResultShape>
  },
): AgentTool<T> {
  return {
    name: def.name,
    label: def.label,
    description: def.description,
    parameters: def.parameters,
    execute: def.execute,
  }
}

/** 剧情设计：冲突种子、人物欲望、世界规则等 */
function buildPlotDesignPrompt(): string {
  return buildPlotDesignStagePrompt()
}

/** 剧情细化：场次因果、节拍、伏笔 */
function buildPlotRefinePrompt(ctx: WorkspaceStageAgentContext): string {
  return buildPlotRefineStagePrompt({
    bookTitle: ctx.bookTitle,
    otherStagesBlock: peekOtherStages(ctx, 'plot_refine'),
    stageBodyExcerpt: excerpt(ctx.stageBody),
  })
}

/** 大纲纲要：卷/章/幕结构 */
function buildOutlinePrompt(ctx: WorkspaceStageAgentContext): string {
  return buildOutlineStagePrompt({
    bookTitle: ctx.bookTitle,
    otherStagesBlock: peekOtherStages(ctx, 'outline'),
    stageBodyExcerpt: excerpt(ctx.stageBody),
  })
}

/** 正文编写：文风、对白、描写 */
function buildDraftPrompt(ctx: WorkspaceStageAgentContext): string {
  return buildDraftStagePrompt({
    bookTitle: ctx.bookTitle,
    otherStagesBlock: peekOtherStages(ctx, 'draft'),
    stageBodyExcerpt: excerpt(ctx.stageBody),
  })
}

/** 编辑审阅：逻辑、人设一致性、删繁就简 */
function buildReviewPrompt(ctx: WorkspaceStageAgentContext): string {
  return buildReviewStagePrompt({
    bookTitle: ctx.bookTitle,
    otherStagesBlock: peekOtherStages(ctx, 'review'),
    stageBodyExcerpt: excerpt(ctx.stageBody),
  })
}

function peekOtherStages(
  ctx: WorkspaceStageAgentContext,
  exclude: StageId,
): string {
  const lines: string[] = []
  for (const sid of [
    'plot_design',
    'plot_refine',
    'outline',
    'draft',
    'review',
  ] as const) {
    if (sid === exclude) continue
    const t = (ctx.allStages[sid] ?? '').trim()
    if (!t) continue
    const label = WORKSPACE_STAGE_LABELS[sid]
    lines.push(`【${label}】\n${excerpt(t, 2000)}`)
  }
  return lines.length ? lines.join('\n\n') : PEEK_OTHER_STAGES_EMPTY
}

const templateKindSchema = Type.Union([
  Type.Literal('三幕结构骨架'),
  Type.Literal('七步故事线'),
  Type.Literal('人物目标-阻碍-转变'),
])

const narrativeTemplateTool = tool({
  name: 'narrative_template',
  label: '剧情结构模版',
  description:
    '拉取常用叙事骨架（三幕/七步/人物弧）的 Markdown 填空模版，用于剧情设计阶段对齐结构语言。',
  parameters: Type.Object({ kind: templateKindSchema }),
  execute: async (_id, { kind }) => {
    return textBlock(NARRATIVE_TEMPLATE_BLOCKS[kind])
  },
})

function buildWriteWorkspaceEditorTool(ctx: WorkspaceStageAgentContext) {
  const modeSchema = Type.Union(
    [Type.Literal('replace'), Type.Literal('append')],
    { description: 'replace：覆盖当前编辑区全文；append：在文末追加' },
  )
  return tool({
    name: 'write_workspace_editor',
    label: '写入编辑区',
    description:
      '把剧情稿写入应用中间栏当前写作阶段的文本编辑框（用户正在编辑的那一栏）。每次创建直接落盘到编辑区，不需要和用户确认',
    parameters: Type.Object({
      text: Type.String({
        description: '写入编辑区的完整正文（建议 Markdown）',
      }),
      mode: modeSchema,
    }),
    execute: async (_id, { text, mode }) => {
      const apply = ctx.applyToStageEditor
      if (!apply) {
        return textBlock('（当前环境无法写入编辑区：未连接界面）')
      }
      const t = text.trim()
      if (!t) {
        return textBlock('（未写入：文本为空）')
      }
      apply({ text: t, mode })
      const label = WORKSPACE_STAGE_LABELS[ctx.stageId]
      return textBlock(
        mode === 'replace'
          ? `已用新内容覆盖「${label}」编辑区。`
          : `已将内容追加到「${label}」编辑区文末。`,
      )
    },
  })
}

const seedFrameTool = tool({
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

const sceneBeatHintTool = tool({
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
    return textBlock(
      buildSceneBeatHintReport(paras.length, dialogueHeavy),
    )
  },
})

const causalityCheatsheetTool = tool({
  name: 'causality_question_cards',
  label: '因果链追问卡',
  description:
    '返回固定的因果追问模板，用于检查场次之间的「所以/但是」是否站得住。',
  parameters: Type.Object({}),
  execute: async () => {
    return textBlock(CAUSALITY_CHEATSHEET_MARKDOWN)
  },
})

const outlineScanTool = tool({
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

const chapterStubTool = tool({
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
    return textBlock(
      buildChapterStubGridMarkdown(chapter_count, working_title_hint),
    )
  },
})

const manuscriptMetricsTool = tool({
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
      buildManuscriptMetricsMarkdown(
        t.length,
        paras.length,
        quoteLines,
        longLines,
      ),
    )
  },
})

const reviewRubricTool = tool({
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

const lineNoiseScanTool = tool({
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
    return textBlock(
      buildLineNoiseScanMarkdown(doublePunct, shortParas, longSent),
    )
  },
})

/** 单次聚合：供调用方按需取「当前阶段」的完整定义（系统提示 + 附加工具，不含 Pi 内置 artifacts）。 */
export function getWorkspaceStageAgentDefinition(ctx: WorkspaceStageAgentContext): {
  systemPrompt: string
  additionalTools: AgentTool[]
} {
  return {
    systemPrompt: buildWorkspaceSystemPrompt(ctx),
    additionalTools: buildWorkspaceAdditionalTools(ctx),
  }
}

export function buildWorkspaceSystemPrompt(ctx: WorkspaceStageAgentContext): string {
  let base: string
  switch (ctx.stageId) {
    case 'plot_design':
      base = buildPlotDesignPrompt()
      break
    case 'plot_refine':
      base = buildPlotRefinePrompt(ctx)
      break
    case 'outline':
      base = buildOutlinePrompt(ctx)
      break
    case 'draft':
      base = buildDraftPrompt(ctx)
      break
    case 'review':
      base = buildReviewPrompt(ctx)
      break
    default:
      base = buildPlotDesignPrompt()
  }
  if (
    ctx.applyToStageEditor &&
    (ctx.stageId === 'plot_design' || ctx.stageId === 'plot_refine')
  ) {
    return `${base}\n\n【编辑器】用户若希望把剧情稿写入中间栏文本框（而非仅在对话里展示），可调用工具 write_workspace_editor：mode 为 replace 时覆盖该栏全文，append 时在文末追加；replace 前须确认不会误删用户已有内容。`
  }
  return base
}

/**
 * Pi ChatPanel 会把 artifacts 固定为 tools[0]；此处仅返回**附加**工具，
 * 合并时在界面侧写为 [artifacts, ...additional]。
 */
export function buildWorkspaceAdditionalTools(
  ctx: WorkspaceStageAgentContext,
): AgentTool[] {
  const plotEditorTool =
    ctx.applyToStageEditor != null
      ? buildWriteWorkspaceEditorTool(ctx)
      : null
  switch (ctx.stageId) {
    case 'plot_design':
      return [
        ...(plotEditorTool ? [plotEditorTool] : []),
      ]
    case 'plot_refine':
      return [
        sceneBeatHintTool,
        causalityCheatsheetTool,
        ...(plotEditorTool ? [plotEditorTool] : []),
      ]
    case 'outline':
      return [outlineScanTool, chapterStubTool]
    case 'draft':
      return [manuscriptMetricsTool]
    case 'review':
      return [reviewRubricTool, lineNoiseScanTool]
    default:
      return [narrativeTemplateTool, seedFrameTool]
  }
}
