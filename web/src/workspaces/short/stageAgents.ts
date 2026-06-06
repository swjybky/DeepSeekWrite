import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import type { Material, MaterialStageId, Skill } from '../../bridge'
import { MATERIAL_STAGE_LABELS, normalizeMaterialStages } from '../../bridge'
import type { ShortStageId } from './stages'
import { SHORT_STAGE_LABELS } from './stages'
import { buildLoadSkillTool } from './loadSkill'
import {
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
  normalizeNewlines,
  resolveReplacementSpan,
} from '../shared/textReplaceMatch'

export type ShortWorkspaceStageAgentContext = {
  bookTitle: string
  stageId: ShortStageId
  stageBody: string
  getCurrentStageBody?: (stageId: ShortStageId) => string | undefined
  allStages: Partial<Record<ShortStageId, string>>
  linkedMaterial?: Material | null
  linkedSkill?: Skill | null
  /** 全局配置解析后：当前阶段允许读取的创作空间阶段 */
  allowedWorkspaceStages?: readonly ShortStageId[]
  /** 全局配置解析后：当前阶段允许读取的素材库阶段 */
  allowedMaterialStages?: readonly MaterialStageId[]
  workspaceAgentReadAccess?: WorkspaceAgentReadAccessConfig | null
  applyToStageEditor?: (payload: { mode: 'replace' | 'append'; text: string }) => void
  isToolCallStreamed?: (toolCallId: string) => boolean
  /** 请求上层保存当前书籍；用于复制工具写入后自动落盘 */
  onRequestSave?: () => void | Promise<void>
}

function shortStageIdParameterSchema(allowedStageIds: readonly ShortStageId[]) {
  const description = allowedStageIds
    .map((id) => `${SHORT_STAGE_LABELS[id]}（${id}）`)
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
  ctx: ShortWorkspaceStageAgentContext,
  stageId: ShortStageId,
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

export function buildReadWorkspaceContentTool(
  ctx: ShortWorkspaceStageAgentContext,
  allowedStageIds: readonly ShortStageId[],
): AgentTool {
  const allowedSet = new Set(allowedStageIds)
  const { schema: stageIdSchema, description: allowedDescription } =
    shortStageIdParameterSchema(allowedStageIds)

  return defineTool({
    name: 'read_workspace_content',
    label: '读取工作区内容',
    description:
      `读取本书创作空间某一阶段的当前内容。优先读取前端编辑器中正在渲染的文本；读不到前端文本时，才回退到已加载/已保存内容。当前仅允许读取：${allowedDescription || '（无）'}。每次调用只返回一个 stage_id。`
      + '\n此工具不要随便使用，仅在使用者明确要求或智能体提示明确标记为使用时使用',
    parameters: Type.Object({
      stage_id: stageIdSchema,
    }),
    execute: async (_toolCallId, params) => {
      const sid = params.stage_id as ShortStageId
      if (!allowedSet.has(sid)) {
        return textBlock(
          `当前不允许读取「${SHORT_STAGE_LABELS[sid]}」。仅可读取：${allowedDescription}。`,
        )
      }
      const label = SHORT_STAGE_LABELS[sid]
      const raw = readWorkspaceStageBody(ctx, sid).trim()
      const header = `书名：《${ctx.bookTitle}》\n【${label}】（${sid}）`
      if (!raw) {
        return textBlock(`${header}\n\n该阶段当前文本为空。`)
      }
      return textBlock(`${header}\n\n${excerpt(raw)}`)
    },
  })
}

function resolveAllowedStagesFromContext(
  ctx: ShortWorkspaceStageAgentContext,
): {
  workspace: readonly ShortStageId[]
  material: readonly MaterialStageId[]
} {
  if (ctx.allowedWorkspaceStages !== undefined || ctx.allowedMaterialStages !== undefined) {
    return {
      workspace: ctx.allowedWorkspaceStages ?? [],
      material: ctx.allowedMaterialStages ?? [],
    }
  }
  const resolved = resolveWorkspaceAgentReadAccess(
    ctx.workspaceAgentReadAccess,
    ctx.stageId,
  )
  return { workspace: resolved.workspace, material: resolved.material }
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
  ctx: ShortWorkspaceStageAgentContext,
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
        return textBlock('当前书籍尚未关联素材库。请先在页面顶部「生成封面」右侧点击「素材库选择」并选择素材。')
      }

      const stages = normalizeMaterialStages(material.stages)
      const raw = stages[stageId].trim()
      const label = MATERIAL_STAGE_LABELS[stageId]
      const genre = [
        material.material_type === 'short' ? '短篇素材' : '长篇素材',
        material.parent_genre,
        material.sub_genre,
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
  ctx: ShortWorkspaceStageAgentContext,
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
          Type.Literal('intro_design'),
          Type.Literal('plot_refine'),
          Type.Literal('outline'),
          Type.Literal('draft'),
          Type.Literal('draft_review'),
          Type.Literal('format_conversion'),
        ],
        {
          description:
            '源阶段键名：人物设计（character_design）、剧情设计（plot_design）、导语设计（intro_design）、剧情细化（plot_refine）、大纲纲要（outline）、正文编写（draft）、正文审阅（draft_review）、格式转换（format_conversion）',
        },
      ),
      mode: Type.Union(
        [Type.Literal('replace'), Type.Literal('append')],
        { description: 'replace：覆盖格式转换编辑区全文；append：在格式转换编辑区文末追加' },
      ),
    }),
    execute: async (_toolCallId, params) => {
      const sid = params.source_stage_id as ShortStageId
      const label = SHORT_STAGE_LABELS[sid]
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
      const targetLabel = SHORT_STAGE_LABELS[ctx.stageId]
      return textBlock(
        params.mode === 'replace'
          ? `已将【${label}】内容覆盖到「${targetLabel}」编辑区，并已自动保存。`
          : `已将【${label}】内容追加到「${targetLabel}」编辑区文末，并已自动保存。`,
      )
    },
  })
}

export function buildGlobalReplaceTool(
  ctx: ShortWorkspaceStageAgentContext,
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
        return textBlock(`未在内容中找到「${find}」，未执行任何替换。`)
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
  ctx: ShortWorkspaceStageAgentContext,
): AgentTool {
  return defineTool({
    name: 'replace_current_stage_text',
    label: '替换当前阶段文本',
    description:
      '根据当前阶段编辑区中的原文片段替换成新文本，不使用行号。'
      + '\n【必做】先调用 read_workspace_content 读取当前阶段，从工具返回正文中原样复制待改片段到 original_text；不要从对话摘要、系统提示词或旧回复中抄写。'
      + '\noriginal_text 须在正文中唯一匹配；系统会自动容忍直引号"与弯引号“”、全角/半角逗号分号、破折号等常见差异，但语义内容必须一致。'
      + '\n匹配失败时会返回编辑区中最接近的片段与可能差异；请据此修正后重试。'
      + '\n需要多处修改时传 replacements 数组；每项只替换一个小段，不要把整篇作为 original_text 或 new_text。',
    parameters: Type.Object({
      replacements: Type.Array(
        Type.Object({
          original_text: Type.String({
            maxLength: MAX_CURRENT_STAGE_TEXT_REPLACE_CHARS,
            description:
              '要被替换的原文片段。须来自 read_workspace_content 的返回正文；包含足够上下文以唯一定位。引号/常见标点可与编辑区略有差异，但字词须一致且只出现一次。',
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

      const label = SHORT_STAGE_LABELS[ctx.stageId]
      const currentBody = readWorkspaceStageBody(ctx, ctx.stageId)
      if (!currentBody.trim()) {
        return textBlock(`当前「${label}」阶段文本为空，无法执行替换。`)
      }
      const result = replaceCurrentStageText({
        currentBody,
        replacements: params.replacements,
      })
      if ('error' in result) return textBlock(`未替换：${result.error}`)

      apply({ text: result.next, mode: 'replace' })
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
  ctx: ShortWorkspaceStageAgentContext,
): AgentTool {
  const modeSchema = Type.Union(
    [Type.Literal('replace'), Type.Literal('append')],
    { description: 'replace：覆盖当前编辑区全文；append：在文末追加' },
  )
  return defineTool({
    name: 'write_workspace_editor',
    label: '写入编辑区',
    description:
      '把内容写入应用中间栏当前写作阶段的文本编辑框。每次调用直接落盘到编辑区，不需要和用户确认。',
    parameters: Type.Object({
      text: Type.String({
        description: '写入编辑区的完整正文（建议 Markdown）',
      }),
      mode: modeSchema,
    }),
    execute: async (toolCallId, { text, mode }) => {
      const apply = ctx.applyToStageEditor
      if (!apply) {
        return textBlock('（当前环境无法写入编辑区：未连接界面）')
      }
      // 若该 tool call 已在流式生成阶段同步到编辑器，避免重复写入
      if (ctx.isToolCallStreamed?.(toolCallId)) {
        const label = SHORT_STAGE_LABELS[ctx.stageId]
        return textBlock(
          mode === 'replace'
            ? `已用新内容覆盖「${label}」编辑区。`
            : `已将内容追加到「${label}」编辑区文末。`,
        )
      }
      const t = text.trim()
      if (!t) {
        return textBlock('（未写入：文本为空）')
      }
      apply({ text: t, mode })
      const label = SHORT_STAGE_LABELS[ctx.stageId]
      return textBlock(
        mode === 'replace'
          ? `已用新内容覆盖「${label}」编辑区。`
          : `已将内容追加到「${label}」编辑区文末。`,
      )
    },
  })
}


function readWorkspaceTools(
  ctx: ShortWorkspaceStageAgentContext,
  allowedWorkspace: readonly ShortStageId[],
): AgentTool[] {
  if (!allowedWorkspace.length) return []
  return [buildReadWorkspaceContentTool(ctx, allowedWorkspace)]
}

function readMaterialTools(
  ctx: ShortWorkspaceStageAgentContext,
  allowedMaterial: readonly MaterialStageId[],
): AgentTool[] {
  if (!allowedMaterial.length) return []
  return [buildReadLinkedMaterialContentTool(ctx, allowedMaterial)]
}

/**
 * 工作台系统提示词由后端磁盘模板提供；此处仅附加 Pi 工具。
 * 所有短篇分类共用同一套工具配置。
 */
export function buildShortWorkspaceAdditionalTools(
  ctx: ShortWorkspaceStageAgentContext,
): AgentTool[] {
  const { workspace: allowedWorkspace, material: allowedMaterial } =
    resolveAllowedStagesFromContext(ctx)

  const readSaved = readWorkspaceTools(ctx, allowedWorkspace)
  const readMaterial = readMaterialTools(ctx, allowedMaterial)
  const loadSkill = buildLoadSkillTool({
    linkedSkill: ctx.linkedSkill,
    currentStageId: ctx.stageId,
  })

  const writeWorkspace = buildWriteWorkspaceEditorTool(ctx)
  const replaceCurrentStageText = buildReplaceCurrentStageTextTool(ctx)
  switch (ctx.stageId) {
    case 'character_design':
    case 'plot_design':
    case 'intro_design':
      return [...readSaved, ...readMaterial, loadSkill, writeWorkspace, replaceCurrentStageText]

    case 'plot_refine':
      return [...readSaved, ...readMaterial, loadSkill, writeWorkspace, replaceCurrentStageText]

    case 'outline':
    case 'draft_review':
      return [...readSaved, ...readMaterial, loadSkill, writeWorkspace, replaceCurrentStageText]

    case 'draft':
      return [...readSaved, ...readMaterial, loadSkill, replaceCurrentStageText]

    case 'format_conversion':
      return [
        ...readSaved,
        ...readMaterial,
        loadSkill,
        buildCopyStageToFormatTool(ctx),
        buildGlobalReplaceTool(ctx),
        replaceCurrentStageText,
      ]

    default:
      return [...readSaved, loadSkill, replaceCurrentStageText]
  }
}
