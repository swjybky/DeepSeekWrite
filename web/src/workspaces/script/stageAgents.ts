import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import type { Material, MaterialStageId, Skill } from '../../bridge'
import {
  MATERIAL_STAGE_LABELS,
  materialTypeLabel,
  normalizeMaterialStages,
} from '../../bridge'
import type { PlotChildStageId, ScriptStageId } from './stages'
import { PLOT_CHILD_STAGES, PLOT_STAGE_ID } from './stages'
import { SCRIPT_STAGE_LABELS } from './stages'
import { buildLoadSkillTool } from './loadSkill'
import {
  resolveWorkspaceAgentIdForStage,
  resolveWorkspaceAgentReadAccess,
  type WorkspaceAgentReadAccessConfig,
} from './stageReadAccess'
import {
  defineTool,
  excerptFn as excerpt,
  textBlock,
} from '../shared/piToolkit'
import {
  applyTextSpanReplacement,
  findFlexibleOccurrences,
  normalizeNewlines,
  resolveReplacementSpan,
  suggestClosestFragment,
  type TextSpan,
} from '../shared/textReplaceMatch'

export type ScriptWorkspaceStageAgentContext = {
  bookTitle: string
  stageId: ScriptStageId
  defaultWriteStageId?: ScriptStageId
  getDefaultWriteStageId?: () => ScriptStageId
  stageBody: string
  getCurrentStageBody?: (stageId: ScriptStageId) => string | undefined
  allStages: Partial<Record<ScriptStageId, string>>
  linkedMaterial?: Material | null
  linkedSkill?: Skill | null
  /** 全局配置解析后：当前阶段允许读取的创作空间阶段 */
  allowedWorkspaceStages?: readonly ScriptStageId[]
  /** 全局配置解析后：当前阶段允许读取的素材库阶段 */
  allowedMaterialStages?: readonly MaterialStageId[]
  workspaceAgentReadAccess?: WorkspaceAgentReadAccessConfig | null
  applyToStageEditor?: (payload: {
    mode: 'replace' | 'append' | 'append_token' | 'streaming_end'
    text: string
    targetStageId?: ScriptStageId
  }) => void
  /** 剧情父阶段：切换左侧树选中的剧情子方向。 */
  selectPlotChildStage?: (stageId: PlotChildStageId) => void
  isToolCallStreamed?: (toolCallId: string) => boolean
  /** 请求上层保存当前书籍；用于复制工具写入后自动落盘 */
  onRequestSave?: () => void | Promise<void>
}

function scriptStageIdParameterSchema(allowedStageIds: readonly ScriptStageId[]) {
  const description = allowedStageIds
    .map((id) => `${SCRIPT_STAGE_LABELS[id]}（${id}）`)
    .join('、')
  const literals = allowedStageIds.map((id) => Type.Literal(id))
  if (literals.length === 0) {
    return {
      schema: Type.String({ description: '当前未配置任何可读创作阶段' }),
      description: '',
    }
  }
  if (literals.length === 1) {
    return { schema: literals[0]!, description }
  }
  return {
    schema: Type.Union(literals, {
      description: `允许读取的创作阶段：${description}`,
    }),
    description,
  }
}

function readWorkspaceStageBody(
  ctx: ScriptWorkspaceStageAgentContext,
  stageId: ScriptStageId,
): string {
  try {
    const current = ctx.getCurrentStageBody?.(stageId)
    if (current !== undefined) {
      return current
    }
  } catch {
    /* fallback below */
  }
  return ctx.allStages[stageId] ?? ''
}

function scriptStageLabel(stageId: ScriptStageId | string): string {
  return (SCRIPT_STAGE_LABELS as Record<string, string>)[stageId] ?? stageId
}

function isPlotChildStageId(id: string): id is PlotChildStageId {
  return PLOT_CHILD_STAGES.some((stage) => stage.id === id)
}

function defaultWriteStageId(ctx: ScriptWorkspaceStageAgentContext): ScriptStageId {
  if (ctx.stageId === PLOT_STAGE_ID) {
    const resolved = ctx.getDefaultWriteStageId?.() ?? ctx.defaultWriteStageId
    if (resolved) return resolved
  }
  return ctx.stageId
}

function resolveWritableTargetStageId(
  ctx: ScriptWorkspaceStageAgentContext,
  raw: unknown,
): ScriptStageId {
  if (ctx.stageId !== PLOT_STAGE_ID) return ctx.stageId
  const requested = String(raw ?? '').trim()
  if (isPlotChildStageId(requested)) return requested
  return defaultWriteStageId(ctx)
}

const TARGET_STAGE_ID_NOTE =
  'target_stage_id 仅供剧情智能体选择剧情子方向；人物、大纲等阶段请省略该参数，自动操作当前阶段。'

const WRITE_TOOL_SCOPE_NOTE =
  `本工具仅挂载于人物设计、剧情、大纲阶段；正文编写阶段不挂载。${TARGET_STAGE_ID_NOTE}`

const REPLACE_TOOL_SCOPE_NOTE =
  `本工具挂载于所有可编辑阶段（含正文编写、正文审阅、格式转换等）。${TARGET_STAGE_ID_NOTE}`

function targetStageIdSchema() {
  return Type.Optional(
    Type.Union(
      PLOT_CHILD_STAGES.map((stage) => Type.Literal(stage.id)),
      {
        description:
          `${TARGET_STAGE_ID_NOTE}剧情子方向：plot_design=剧情设计，plot_refine=剧情细化。`,
      },
    ),
  )
}

function plotChildStageIdSchema() {
  return Type.Union(
    PLOT_CHILD_STAGES.map((stage) => Type.Literal(stage.id)),
    {
      description:
        '剧情子方向：plot_design=剧情设计，plot_refine=剧情细化。',
    },
  )
}

export function buildSelectPlotChildStageTool(
  ctx: ScriptWorkspaceStageAgentContext,
): AgentTool {
  return defineTool({
    name: 'switch_storyline_stage',
    label: '切换剧情方向',
    description:
      '切换左侧树中「剧情」下的选中子方向，并同步右侧正文编辑框。'
      + '当用户在剧情智能体里要求处理剧情设计或剧情细化中的另一个方向时，先调用本工具。'
      + '本工具只负责页面跳转/选中态切换，不写入内容；切换后，未传 target_stage_id 的写入工具会默认写入新选中的剧情方向。',
    parameters: Type.Object({
      target_stage_id: plotChildStageIdSchema(),
    }),
    execute: async (_toolCallId, params) => {
      if (ctx.stageId !== PLOT_STAGE_ID) {
        return textBlock('当前不是剧情智能体，无法切换剧情子方向。')
      }
      const targetStageId = params.target_stage_id as PlotChildStageId
      if (!isPlotChildStageId(targetStageId)) {
        return textBlock('目标剧情方向不存在。')
      }
      if (!ctx.selectPlotChildStage) {
        return textBlock('（当前环境无法切换左侧选中：未连接界面）')
      }
      ctx.selectPlotChildStage(targetStageId)
      return textBlock(
        `已切换左侧选中到「${SCRIPT_STAGE_LABELS[targetStageId]}」。`,
      )
    },
  })
}

export function buildReadWorkspaceContentTool(
  ctx: ScriptWorkspaceStageAgentContext,
  allowedStageIds: readonly ScriptStageId[],
): AgentTool {
  const allowedSet = new Set(allowedStageIds)
  const { schema: stageIdSchema, description: allowedDescription } =
    scriptStageIdParameterSchema(allowedStageIds)

  return defineTool({
    name: 'read_workspace_content',
    label: '读取工作区内容',
    description:
      `读取本书创作空间某一阶段的当前内容。优先读取当前文本编辑框中正在显示的内容；读不到时再回退到已加载/已保存内容。当前仅允许读取：${allowedDescription || '（无）'}。每次调用只返回一个 stage_id。`
      + '\n此工具不要随便使用，仅在使用者明确要求或智能体提示明确标记为使用时使用',
    parameters: Type.Object({
      stage_id: stageIdSchema,
    }),
    execute: async (_toolCallId, params) => {
      const sid = params.stage_id as ScriptStageId
      if (!allowedSet.has(sid)) {
        return textBlock(
          `当前不允许读取「${SCRIPT_STAGE_LABELS[sid]}」。仅可读取：${allowedDescription}。`,
        )
      }
      const label = SCRIPT_STAGE_LABELS[sid]
      const raw = readWorkspaceStageBody(ctx, sid).trim()
      const header = `书名：《${ctx.bookTitle}》\n【${label}】（${sid}）`
      if (!raw) {
        return textBlock(`${header}\n\n该阶段当前文本为空。`)
      }
      return textBlock(`${header}\n\n${excerpt(raw)}`)
    },
  })
}

const MAX_WORKSPACE_SEARCH_QUERY_CHARS = 600
const DEFAULT_WORKSPACE_SEARCH_CONTEXT_CHARS = 80
const MAX_WORKSPACE_SEARCH_CONTEXT_CHARS = 500
const DEFAULT_WORKSPACE_SEARCH_MATCHES = 10
const MAX_WORKSPACE_SEARCH_MATCHES = 30

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function findLiteralOccurrences(haystack: string, needle: string): TextSpan[] {
  if (!needle) return []
  const results: TextSpan[] = []
  let pos = 0
  while (pos <= haystack.length) {
    const found = haystack.indexOf(needle, pos)
    if (found === -1) break
    results.push({
      start: found,
      end: found + needle.length,
      matched: haystack.slice(found, found + needle.length),
    })
    pos = found + needle.length
  }
  return results
}

function lineColumnAt(text: string, index: number): { line: number; column: number } {
  let line = 1
  let lastBreak = -1
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1
      lastBreak = i
    }
  }
  return { line, column: index - lastBreak }
}

function snippetAroundMatch(
  text: string,
  span: TextSpan,
  contextChars: number,
): string {
  const start = Math.max(0, span.start - contextChars)
  const end = Math.min(text.length, span.end + contextChars)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < text.length ? '...' : ''
  return `${prefix}${text.slice(start, span.start)}<<${span.matched}>>${text.slice(span.end, end)}${suffix}`
}

export function buildSearchWorkspaceTextTool(
  ctx: ScriptWorkspaceStageAgentContext,
  allowedStageIds: readonly ScriptStageId[],
): AgentTool {
  const allowedSet = new Set(allowedStageIds)
  const { schema: stageIdSchema, description: allowedDescription } =
    scriptStageIdParameterSchema(allowedStageIds)

  return defineTool({
    name: 'search_workspace_text',
    label: '搜索工作区文本',
    description:
      '在本书创作空间里按 grep 风格搜索文本，只返回命中的行列位置和前后少量上下文，不返回全文。'
      + `\n当前仅允许搜索：${allowedDescription || '（无）'}。不传 stage_id 时会搜索所有允许阶段。`
      + '\n适用于 replace_current_stage_text 或全局替换失败后，先定位当前文本编辑框里真实存在的原文片段，再用搜索结果中的原样文本重试替换。',
    parameters: Type.Object({
      query: Type.String({
        maxLength: MAX_WORKSPACE_SEARCH_QUERY_CHARS,
        description:
          '要搜索的原文片段或关键词。建议传替换失败片段中的 8-80 个连续字符，不要传整篇正文。',
      }),
      stage_id: Type.Optional(stageIdSchema),
      max_matches: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: MAX_WORKSPACE_SEARCH_MATCHES,
          description: '最多返回多少处匹配，默认 10，最高 30。',
        }),
      ),
      context_chars: Type.Optional(
        Type.Integer({
          minimum: 20,
          maximum: MAX_WORKSPACE_SEARCH_CONTEXT_CHARS,
          description: '每处匹配前后返回多少字符上下文，默认 80，最高 500。',
        }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      const query = normalizeNewlines(params.query).trim()
      if (!query) return textBlock('搜索文本不能为空。')
      if (query.length > MAX_WORKSPACE_SEARCH_QUERY_CHARS) {
        return textBlock(
          `搜索文本过长（${query.length} 字符）。请截取需要定位的小段原文，最多 ${MAX_WORKSPACE_SEARCH_QUERY_CHARS} 字符。`,
        )
      }

      const requestedStageId = params.stage_id as ScriptStageId | undefined
      const stageIds = requestedStageId ? [requestedStageId] : [...allowedStageIds]
      if (requestedStageId && !allowedSet.has(requestedStageId)) {
        return textBlock(
          `当前不允许搜索「${scriptStageLabel(requestedStageId)}」。仅可搜索：${allowedDescription || '（无）'}。`,
        )
      }
      if (stageIds.length === 0) {
        return textBlock('当前智能体未配置可搜索的创作阶段。')
      }

      const maxMatches = clampInteger(
        params.max_matches,
        DEFAULT_WORKSPACE_SEARCH_MATCHES,
        1,
        MAX_WORKSPACE_SEARCH_MATCHES,
      )
      const contextChars = clampInteger(
        params.context_chars,
        DEFAULT_WORKSPACE_SEARCH_CONTEXT_CHARS,
        20,
        MAX_WORKSPACE_SEARCH_CONTEXT_CHARS,
      )

      const output: string[] = [
        `书名：《${ctx.bookTitle}》`,
        `搜索：${query}`,
        `范围：${stageIds.map((id) => `【${scriptStageLabel(id)}】（${id}）`).join('、')}`,
      ]
      let total = 0
      const emptyStages: string[] = []
      const closestHints: string[] = []

      for (const stageId of stageIds) {
        const label = scriptStageLabel(stageId)
        const body = normalizeNewlines(readWorkspaceStageBody(ctx, stageId))
        if (!body.trim()) {
          emptyStages.push(`【${label}】`)
          continue
        }

        let matchKind = '精确匹配'
        let matches = findLiteralOccurrences(body, query)
        if (matches.length === 0) {
          matches = findFlexibleOccurrences(body, query)
          if (matches.length > 0) {
            matchKind = '引号/标点容错匹配'
          }
        }

        if (matches.length === 0) {
          const hint = suggestClosestFragment(body, query, 220)
          if (hint) {
            closestHints.push(`【${label}】中接近片段：${hint}`)
          }
          continue
        }

        output.push('', `【${label}】（${stageId}）${matchKind} ${matches.length} 处：`)
        for (const [index, match] of matches.entries()) {
          if (total >= maxMatches) break
          const loc = lineColumnAt(body, match.start)
          output.push(
            `${index + 1}. L${loc.line}:C${loc.column} chars ${match.start}-${match.end}`,
            snippetAroundMatch(body, match, contextChars),
          )
          total += 1
        }
        if (total >= maxMatches) break
      }

      if (total > 0) {
        output.push('', `已返回 ${total} 处匹配；如需替换，请从 << >> 中或其上下文里原样复制真实片段。`)
        return textBlock(output.join('\n'))
      }

      const searched = stageIds
        .map((id) => `【${scriptStageLabel(id)}】`)
        .join('、')
      const notFound = [`未在 ${searched} 中找到「${query}」。`]
      if (emptyStages.length > 0) {
        notFound.push(`空阶段：${emptyStages.join('、')}。`)
      }
      if (closestHints.length > 0) {
        notFound.push(...closestHints)
      }
      return textBlock(notFound.join('\n'))
    },
  })
}

function resolveAllowedStagesFromContext(
  ctx: ScriptWorkspaceStageAgentContext,
): {
  workspace: readonly ScriptStageId[]
  material: readonly MaterialStageId[]
} {
  if (ctx.allowedWorkspaceStages !== undefined || ctx.allowedMaterialStages !== undefined) {
    return {
      workspace: ctx.allowedWorkspaceStages ?? [],
      material: ctx.allowedMaterialStages ?? [],
    }
  }
  const agentId = resolveWorkspaceAgentIdForStage(ctx.stageId)
  const resolved = resolveWorkspaceAgentReadAccess(
    ctx.workspaceAgentReadAccess,
    agentId,
  )
  return {
    workspace: resolved.workspace as readonly ScriptStageId[],
    material: resolved.material as readonly MaterialStageId[],
  }
}

function materialStageIdParameterSchema(
  allowedStageIds: readonly MaterialStageId[],
) {
  const description = allowedStageIds
    .map((id) => `${MATERIAL_STAGE_LABELS[id]}（${id}）`)
    .join('、')
  const literals = allowedStageIds.map((id) => Type.Literal(id))
  if (literals.length === 1) {
    return { schema: literals[0]!, description }
  }
  return {
    schema: Type.Union(literals, { description: `允许读取的素材阶段：${description}` }),
    description,
  }
}

export function buildReadLinkedMaterialContentTool(
  ctx: ScriptWorkspaceStageAgentContext,
  allowedStageIds: readonly MaterialStageId[],
): AgentTool {
  const allowedSet = new Set(allowedStageIds)
  const { schema: stageIdSchema, description: allowedDescription } =
    materialStageIdParameterSchema(allowedStageIds)

  return defineTool({
    name: 'read_linked_material_content',
    label: '读取关联素材库内容',
    description:
      `读取当前书籍在页面顶部关联的素材库内容。当前仅允许读取：${allowedDescription}。每次调用只返回一个素材阶段。`
      + '\n此工具不要随便使用，仅在使用者明确要求或智能体提示明确标记使用时调用',
    parameters: Type.Object({
      stage_id: stageIdSchema,
    }),
    execute: async (_toolCallId, params) => {
      const stageId = params.stage_id as MaterialStageId
      if (!allowedSet.has(stageId)) {
        return textBlock(
          `当前不允许读取「${MATERIAL_STAGE_LABELS[stageId]}」。仅可读取：${allowedDescription}。`,
        )
      }
      const material = ctx.linkedMaterial
      if (!material) {
        return textBlock('当前书籍尚未关联素材库。请先在页面顶部点击「素材库选择」并选择素材。')
      }

      const stages = normalizeMaterialStages(material.stages)
      const raw = stages[stageId].trim()
      const label = MATERIAL_STAGE_LABELS[stageId]
      const genre = [
        materialTypeLabel(material.material_type),
        material.parent_genre,
      ].filter(Boolean).join(' · ')
      const location = material.output_dir?.trim()
        ? `\n素材库地址：${material.output_dir}`
        : ''
      const header = [
        `关联素材：《${material.title}》`,
        genre ? `类型：${genre}` : '',
        `【${label}】（${stageId}）`,
      ].filter(Boolean).join('\n')

      if (!raw) {
        return textBlock(`${header}${location}\n\n该素材阶段暂无内容。`)
      }
      return textBlock(`${header}${location}\n\n${excerpt(raw)}`)
    },
  })
}



export function buildCopyStageToFormatTool(
  ctx: ScriptWorkspaceStageAgentContext,
): AgentTool {
  return defineTool({
    name: 'copy_stage_to_format_conversion',
    label: '复制阶段内容到格式转换',
    description:
      '将本书其他阶段当前可读取的内容复制到当前「格式转换」编辑区。'
      +'\n适用于格式转换阶段需要基于正文、大纲或其他阶段内容进行再加工的场景。',
    parameters: Type.Object({
      source_stage_id: Type.Union(
        [
          Type.Literal('character_design'),
          Type.Literal('plot_design'),
          Type.Literal('plot_refine'),
          Type.Literal('outline'),
          Type.Literal('draft'),
          Type.Literal('draft_review'),
          Type.Literal('format_conversion'),
        ],
        {
          description:
            '源阶段键名：人物（character_design）、剧情设计（plot_design）、剧情细化（plot_refine）、大纲（outline）、正文编写（draft）、正文审阅（draft_review）、格式转换（format_conversion）',
        },
      ),
      mode: Type.Literal('replace', {
        description: '只能填写 replace：覆盖格式转换编辑区全文；不支持追加。',
      }),
    }),
    execute: async (_toolCallId, params) => {
      const sid = params.source_stage_id as ScriptStageId
      const label = SCRIPT_STAGE_LABELS[sid]
      const raw = readWorkspaceStageBody(ctx, sid).trim()
      if (!raw) {
        return textBlock(`【${label}】（${sid}）当前文本为空，无法复制。`)
      }
      const apply = ctx.applyToStageEditor
      if (!apply) {
        return textBlock('（当前环境无法写入编辑区：未连接界面）')
      }
      apply({ text: raw, mode: params.mode })
      // 延迟一小段时间后触发保存，让 React state 更新完毕
      if (ctx.onRequestSave) {
        await new Promise((r) => setTimeout(r, 50))
        await ctx.onRequestSave()
      }
      const targetLabel = SCRIPT_STAGE_LABELS[ctx.stageId]
      return textBlock(
        `已将【${label}】内容覆盖到「${targetLabel}」编辑区，并已自动保存。`,
      )
    },
  })
}

export function buildGlobalReplaceTool(
  ctx: ScriptWorkspaceStageAgentContext,
): AgentTool {
  return defineTool({
    name: 'global_text_replace',
    label: '全局字符替换',
    description:
      '对当前「格式转换」阶段编辑区内容进行全局字符替换。'
      +'\n将当前编辑区最新内容中所有匹配查找文本的片段替换为指定文本，然后写回编辑区。'
      +'\n适用于批量修改人名、地名、标点规范化或格式清洗等场景。',
    parameters: Type.Object({
      find: Type.String({
        description: '要查找的文本（区分大小写）',
      }),
      replace: Type.String({
        description: '用于替换的文本',
      }),
    }),
    execute: async (_toolCallId, params) => {
      const find = params.find
      const replace = params.replace
      const currentBody = readWorkspaceStageBody(ctx, ctx.stageId)
      if (!currentBody.trim()) {
        return textBlock('当前「格式转换」阶段暂无内容，无法执行替换。')
      }
      if (!find) {
        return textBlock('查找文本不能为空。')
      }
      if (!currentBody.includes(find)) {
        return textBlock(
          `未在内容中找到「${find}」，未执行任何替换。请先调用 search_workspace_text 搜索关键词或短句，确认当前文本编辑框真实文本后再重试。`,
        )
      }
      const newText = currentBody.split(find).join(replace)
      const apply = ctx.applyToStageEditor
      if (!apply) {
        return textBlock('（当前环境无法写入编辑区：未连接界面）')
      }
      apply({ text: newText, mode: 'replace' })
      const count = currentBody.split(find).length - 1
      return textBlock(
        `已完成全局替换：将 ${count} 处「${find}」替换为「${replace}」，已更新「格式转换」编辑区。`,
      )
    },
  })
}

const MAX_CURRENT_STAGE_TEXT_REPLACE_CHARS = 2400

type CurrentStageTextReplacement = {
  original_text: string
  new_text: string
}

function replaceCurrentStageText(input: {
  currentBody: string
  replacements: CurrentStageTextReplacement[]
}): { next: string; count: number; flexibleCount: number } | { error: string } {
  if (input.replacements.length === 0) return { error: 'replacements 不能为空。' }

  let next = normalizeNewlines(input.currentBody)
  let flexibleCount = 0
  for (const [index, replacement] of input.replacements.entries()) {
    const itemName = `第 ${index + 1} 个片段`
    const originalText = normalizeNewlines(replacement.original_text)
    const newText = normalizeNewlines(replacement.new_text)
    if (!originalText.trim()) {
      return { error: `${itemName}的 original_text 不能为空。` }
    }
    if (originalText.length > MAX_CURRENT_STAGE_TEXT_REPLACE_CHARS) {
      return {
        error:
          `${itemName}的 original_text 过长（${originalText.length} 字符）。请只传需要替换的小段原文。`,
      }
    }
    if (newText.length > MAX_CURRENT_STAGE_TEXT_REPLACE_CHARS) {
      return {
        error:
          `${itemName}的 new_text 过长（${newText.length} 字符）。请拆成多个小段替换。`,
      }
    }

    const resolved = resolveReplacementSpan(next, originalText, itemName)
    if (resolved.kind === 'error') {
      return { error: resolved.message }
    }
    if (resolved.usedFlexibleMatch) {
      flexibleCount += 1
    }

    next = applyTextSpanReplacement(next, resolved.span, newText)
  }

  return { next, count: input.replacements.length, flexibleCount }
}

export function buildReplaceCurrentStageTextTool(
  ctx: ScriptWorkspaceStageAgentContext,
): AgentTool {
  return defineTool({
    name: 'replace_current_stage_text',
    label: '替换当前阶段文本',
    description:
      `${REPLACE_TOOL_SCOPE_NOTE}\n`
      + '编辑替换工具：目标阶段已有内容且只是局部修改时，必须优先使用本工具'
      + '，不要调用 write_workspace_editor 整段覆盖（正文阶段无该工具）。根据当前文本编辑框中的原文片段替换成新文本，不使用行号。'
      + '\n【必做】先调用 read_workspace_content 读取当前阶段，从工具返回正文中原样复制待改片段到 original_text；不要从对话摘要、系统提示词或旧回复中抄写。'
      + '\noriginal_text 须在正文中唯一匹配；系统会自动容忍直引号"与弯引号“”、全角/半角逗号分号、破折号等常见差异，但语义内容必须一致。'
      + '\n匹配失败时会返回当前文本编辑框中最接近的片段与可能差异；请据此修正后重试。'
      + '\n若替换失败，不要立刻重新读取全文；先调用 search_workspace_text 搜索失败片段中的关键词或短句，确认当前文本编辑框真实原文后再重试。'
      + '\n需要多处修改时传 replacements 数组；每项只替换一个小段，不要把整篇作为 original_text 或 new_text。',
    parameters: Type.Object({
      target_stage_id: targetStageIdSchema(),
      replacements: Type.Array(
        Type.Object({
          original_text: Type.String({
            maxLength: MAX_CURRENT_STAGE_TEXT_REPLACE_CHARS,
            description:
              '要被替换的原文片段。须来自 read_workspace_content 的返回正文；包含足够上下文以唯一定位。引号/常见标点可与当前文本编辑框略有差异，但字词须一致且只出现一次。',
          }),
          new_text: Type.String({
            maxLength: MAX_CURRENT_STAGE_TEXT_REPLACE_CHARS,
            description:
              '替换后的新文本。只放这个片段的新内容，可包含换行；不要放整篇内容。',
          }),
        }),
        {
          minItems: 1,
          maxItems: 20,
          description:
            '需要替换的当前阶段文本片段列表。每项都用 original_text 精确定位，再用 new_text 替换。',
        },
      ),
    }),
    execute: async (_toolCallId, params) => {
      const apply = ctx.applyToStageEditor
      if (!apply) {
        return textBlock('（当前环境无法写入编辑区：未连接界面）')
      }

      const targetStageId = resolveWritableTargetStageId(
        ctx,
        params.target_stage_id,
      )
      const label = SCRIPT_STAGE_LABELS[targetStageId]
      const currentBody = readWorkspaceStageBody(ctx, targetStageId)
      if (!currentBody.trim()) {
        return textBlock(`当前「${label}」阶段文本为空，无法执行替换。`)
      }
      const result = replaceCurrentStageText({
        currentBody,
        replacements: params.replacements,
      })
      if ('error' in result) return textBlock(`未替换：${result.error}`)

      apply({ text: result.next, mode: 'replace', targetStageId })
      const flexibleNote =
        result.flexibleCount > 0
          ? `（其中 ${result.flexibleCount} 处经引号/标点归一化后定位）`
          : ''
      return textBlock(
        `已替换「${label}」编辑区 ${result.count} 个片段${flexibleNote}。`,
      )
    },
  })
}

export function buildWriteWorkspaceEditorTool(
  ctx: ScriptWorkspaceStageAgentContext,
): AgentTool {
  const modeSchema = Type.Literal('replace', {
    description: '只能填写 replace：覆盖目标文本编辑框全文；不支持追加。',
  })
  return defineTool({
    name: 'write_workspace_editor',
    label: '写入当前文本编辑框',
    description:
      `${WRITE_TOOL_SCOPE_NOTE}\n`
      + '覆盖写入工具：只在目标文本编辑框为空白时，用它写入一份完整稿件。目标已有内容时，用户只是要求局部修改、润色、扩写某段或替换片段，必须使用 replace_current_stage_text，不能调用本工具整段覆盖。只有用户明确要求整体覆盖、重写、重新生成或替换全文时，才允许设置 allow_overwrite_existing=true 后覆盖写入。仅写入该阶段的创作正文（如人设、剧情、大纲等），不要写入分析报告、修改意见、过程说明或与阶段无关的内容；这些留在对话中回复用户即可。',
    parameters: Type.Object({
      target_stage_id: targetStageIdSchema(),
      text: Type.String({
        description: '当前阶段正文稿件（建议 Markdown）。不含分析报告、修改意见或过程说明。',
      }),
      allow_overwrite_existing: Type.Optional(
        Type.Boolean({
          description:
            '仅当用户明确要求整体覆盖、重写、重新生成或替换全文时设为 true。目标已有内容但只是局部修改时不能设 true，必须改用 replace_current_stage_text。',
        }),
      ),
      mode: modeSchema,
    }),
    execute: async (
      toolCallId,
      { text, mode, target_stage_id },
    ) => {
      const apply = ctx.applyToStageEditor
      if (!apply) {
        return textBlock('（当前环境无法写入编辑区：未连接界面）')
      }
      const targetStageId = resolveWritableTargetStageId(ctx, target_stage_id)
      const label = SCRIPT_STAGE_LABELS[targetStageId]
      // 若该 tool call 已在流式生成阶段同步到编辑器，避免重复写入
      if (ctx.isToolCallStreamed?.(toolCallId)) {
        return textBlock(`已用新内容覆盖「${label}」编辑区。`)
      }
      const t = text.trim()
      if (!t) {
        return textBlock('（未写入：文本为空）')
      }
      apply({ text: t, mode: mode === 'replace' ? mode : 'replace', targetStageId })
      return textBlock(
        `已用新内容覆盖「${label}」编辑区。`,
      )
    },
  })
}


function readWorkspaceTools(
  ctx: ScriptWorkspaceStageAgentContext,
  allowedWorkspace: readonly ScriptStageId[],
): AgentTool[] {
  if (!allowedWorkspace.length) return []
  return [buildReadWorkspaceContentTool(ctx, allowedWorkspace)]
}

function readMaterialTools(
  ctx: ScriptWorkspaceStageAgentContext,
  allowedMaterial: readonly MaterialStageId[],
): AgentTool[] {
  if (!allowedMaterial.length) return []
  return [buildReadLinkedMaterialContentTool(ctx, allowedMaterial)]
}

/**
 * 工作台系统提示词由后端磁盘模板提供；此处仅附加 Pi 工具。
 * 所有剧本分类共用同一套工具配置。
 */
export function buildScriptWorkspaceAdditionalTools(
  ctx: ScriptWorkspaceStageAgentContext,
): AgentTool[] {
  const { workspace: allowedWorkspace, material: allowedMaterial } =
    resolveAllowedStagesFromContext(ctx)

  const readSaved = readWorkspaceTools(ctx, allowedWorkspace)
  const readMaterial = readMaterialTools(ctx, allowedMaterial)
  const searchWorkspaceText = buildSearchWorkspaceTextTool(ctx, allowedWorkspace)
  const loadSkill = buildLoadSkillTool({
    linkedSkill: ctx.linkedSkill,
    currentStageId: ctx.stageId,
  })

  const writeWorkspace = buildWriteWorkspaceEditorTool(ctx)
  const replaceCurrentStageText = buildReplaceCurrentStageTextTool(ctx)
  const selectPlotChildStage =
    ctx.stageId === PLOT_STAGE_ID ? [buildSelectPlotChildStageTool(ctx)] : []
  switch (ctx.stageId) {
    case 'character_design':
    case 'plot_design':
      return [
        ...readSaved,
        searchWorkspaceText,
        ...readMaterial,
        loadSkill,
        ...selectPlotChildStage,
        writeWorkspace,
        replaceCurrentStageText,
      ]

    case 'plot_refine':
      return [
        ...readSaved,
        searchWorkspaceText,
        ...readMaterial,
        loadSkill,
        writeWorkspace,
        replaceCurrentStageText,
      ]

    case 'outline':
      return [
        ...readSaved,
        searchWorkspaceText,
        ...readMaterial,
        loadSkill,
        writeWorkspace,
        replaceCurrentStageText,
      ]

    case 'draft':
      return [
        ...readSaved,
        searchWorkspaceText,
        ...readMaterial,
        loadSkill,
        replaceCurrentStageText,
      ]

    default:
      return [...readSaved, searchWorkspaceText, loadSkill, replaceCurrentStageText]
  }
}
