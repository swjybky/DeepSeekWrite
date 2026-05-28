import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from 'typebox'

import type { Material, MaterialStageId } from '../../bridge'
import { MATERIAL_STAGE_LABELS, normalizeMaterialStages } from '../../bridge'
import type { ShortStageId } from './stages'
import { SHORT_STAGE_LABELS } from './stages'
import {
  defineTool,
  excerptFn as excerpt,
  textBlock,
} from '../shared/piToolkit'

export type ShortWorkspaceStageAgentContext = {
  bookTitle: string
  stageId: ShortStageId
  stageBody: string
  getCurrentStageBody?: () => string
  allStages: Partial<Record<ShortStageId, string>>
  linkedMaterial?: Material | null
  applyToStageEditor?: (payload: { mode: 'replace' | 'append'; text: string }) => void
  isToolCallStreamed?: (toolCallId: string) => boolean
  /** 请求上层保存当前书籍；用于复制工具写入后自动落盘 */
  onRequestSave?: () => void | Promise<void>
}

export function buildReadWorkspaceContentTool(
  ctx: ShortWorkspaceStageAgentContext,
): AgentTool {
  return defineTool({
    name: 'read_workspace_content',
    label: '读取工作区内容',
    description:
      '读取本书创作空间某一阶段已保存的内容，每次调用只返回一个 stage_id。不含编辑栏未写入的未保存内容。'
      +'\n此工具不要随便使用，仅在使用者明确要求或智能体提示明确标记为使用时使用，默认读取当前阶段的内容',
    parameters: Type.Object({
      stage_id: Type.Union(
        [
          Type.Literal('character_design'),
          Type.Literal('intro_design'),
          Type.Literal('plot_design'),
          Type.Literal('plot_refine'),
          Type.Literal('outline'),
          Type.Literal('draft'),
          Type.Literal('draft_review'),
          Type.Literal('format_conversion'),
        ],
        {
            description:
              '工作台阶段键名，描述下各个阶段的中文描述，例如：\n' +
              '人物设计（character_design）、导语设计（intro_design）、剧情设计（plot_design）、剧情细化（plot_refine）、大纲纲要（outline）、正文编写（draft）、正文审阅（draft_review）、格式转换（format_conversion）；单次只读取该阶段内容',
        },
      ),
    }),
    execute: async (_toolCallId, params) => {
      const sid = params.stage_id as ShortStageId
      const label = SHORT_STAGE_LABELS[sid]
      const raw = (ctx.allStages[sid] ?? '').trim()
      const header = `书名：《${ctx.bookTitle}》\n【${label}】（${sid}）`
      if (!raw) {
        return textBlock(`${header}\n\n该阶段暂无已保存正文，请先保存书籍。`)
      }
      return textBlock(`${header}\n\n${excerpt(raw)}`)
    },
  })
}

export function buildReadLinkedMaterialContentTool(
  ctx: ShortWorkspaceStageAgentContext,
): AgentTool {
  return defineTool({
    name: 'read_linked_material_content',
    label: '读取关联素材库内容',
    description:
      '读取当前书籍在 AI 助手上方关联的素材库内容。每次调用只返回一个素材阶段：character、intro、gimmick 或 pacing。'
      +'\n此工具不要随便使用，仅在使用者明确要求或智能体提示明确标记使用时调用',
    parameters: Type.Object({
      stage_id: Type.Union(
        [
          Type.Literal('character'),
          Type.Literal('intro'),
          Type.Literal('gimmick'),
          Type.Literal('pacing'),
        ],
        {
          description:
            '素材库阶段键名：character=人设素材，intro=导语素材，gimmick=梗素材，pacing=节奏素材；单次只读取该阶段',
        },
      ),
    }),
    execute: async (_toolCallId, params) => {
      const stageId = params.stage_id as MaterialStageId
      const material = ctx.linkedMaterial
      if (!material) {
        return textBlock('当前书籍尚未关联素材库。请先在 AI 助手上方点击「素材库选择」并选择素材。')
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
      '将本书其他阶段已保存的内容复制到当前「格式转换」编辑区。'
      +'\n适用于格式转换阶段需要基于正文、大纲或其他阶段内容进行再加工的场景。',
    parameters: Type.Object({
      source_stage_id: Type.Union(
        [
          Type.Literal('character_design'),
          Type.Literal('intro_design'),
          Type.Literal('plot_design'),
          Type.Literal('plot_refine'),
          Type.Literal('outline'),
          Type.Literal('draft'),
          Type.Literal('draft_review'),
          Type.Literal('format_conversion'),
        ],
        {
          description:
            '源阶段键名：人物设计（character_design）、导语设计（intro_design）、剧情设计（plot_design）、剧情细化（plot_refine）、大纲纲要（outline）、正文编写（draft）、正文审阅（draft_review）、格式转换（format_conversion）',
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
      const raw = (ctx.allStages[sid] ?? '').trim()
      if (!raw) {
        return textBlock(`【${label}】（${sid}）暂无已保存正文，无法复制。`)
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
      const currentBody = ctx.getCurrentStageBody?.() ?? ctx.stageBody ?? ''
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

const MAX_DRAFT_TEXT_REPLACE_CHARS = 2400

type DraftTextReplacement = {
  original_text: string
  new_text: string
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function countExactOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let pos = 0
  while (pos <= haystack.length) {
    const found = haystack.indexOf(needle, pos)
    if (found === -1) break
    count += 1
    pos = found + needle.length
  }
  return count
}

function replaceDraftText(input: {
  currentBody: string
  replacements: DraftTextReplacement[]
}): { next: string; count: number } | { error: string } {
  if (input.replacements.length === 0) return { error: 'replacements 不能为空。' }

  let next = normalizeNewlines(input.currentBody)
  for (const [index, replacement] of input.replacements.entries()) {
    const itemName = `第 ${index + 1} 个片段`
    const originalText = normalizeNewlines(replacement.original_text)
    const newText = normalizeNewlines(replacement.new_text)
    if (!originalText.trim()) {
      return { error: `${itemName}的 original_text 不能为空。` }
    }
    if (originalText.length > MAX_DRAFT_TEXT_REPLACE_CHARS) {
      return {
        error:
          `${itemName}的 original_text 过长（${originalText.length} 字符）。请只传需要替换的小段原文。`,
      }
    }
    if (newText.length > MAX_DRAFT_TEXT_REPLACE_CHARS) {
      return {
        error:
          `${itemName}的 new_text 过长（${newText.length} 字符）。请拆成多个小段替换。`,
      }
    }

    const occurrenceCount = countExactOccurrences(next, originalText)
    if (occurrenceCount === 0) {
      return {
        error:
          `${itemName}的 original_text 未在当前正文中找到。请先读取当前正文，传入完全一致的原文片段。`,
      }
    }
    if (occurrenceCount > 1) {
      return {
        error:
          `${itemName}的 original_text 在当前正文中出现了 ${occurrenceCount} 次。请扩大原文片段，使其唯一后再替换。`,
      }
    }

    next = next.replace(originalText, newText)
  }

  return { next, count: input.replacements.length }
}

export function buildReplaceDraftTextTool(
  ctx: ShortWorkspaceStageAgentContext,
): AgentTool {
  return defineTool({
    name: 'replace_draft_editor_text',
    label: '替换正文原文',
    description:
      '正文编写普通模式专用：根据“当前正文中的精确原文片段”替换成新文本，不使用行号。'
      + '\n必须先读取当前正文，再把需要修改的小段原文完整放入 original_text，把改写后内容放入 new_text。'
      + '\noriginal_text 必须在当前正文中精确且唯一匹配；找不到或出现多次都会拒绝，避免误改。'
      + '\n需要多处修改时，传 replacements 数组；每个 replacement 只放一个小段，不要把整篇正文作为 original_text 或 new_text。',
    parameters: Type.Object({
      replacements: Type.Array(
        Type.Object({
          original_text: Type.String({
            maxLength: MAX_DRAFT_TEXT_REPLACE_CHARS,
            description:
              '当前正文中要被替换的精确原文片段。必须完整照抄，包含标点、空格和换行，并且在正文中只出现一次。',
          }),
          new_text: Type.String({
            maxLength: MAX_DRAFT_TEXT_REPLACE_CHARS,
            description:
              '替换后的新文本。只放这个片段的新内容，可包含换行；不要放整篇正文。',
          }),
        }),
        {
          minItems: 1,
          maxItems: 20,
          description:
            '需要替换的正文片段列表。每项都用 original_text 精确定位，再用 new_text 替换。',
        },
      ),
    }),
    execute: async (_toolCallId, params) => {
      if (ctx.stageId !== 'draft') {
        return textBlock('未替换：该工具仅用于「正文编写」普通模式。')
      }
      const apply = ctx.applyToStageEditor
      if (!apply) {
        return textBlock('（当前环境无法写入编辑区：未连接界面）')
      }

      const result = replaceDraftText({
        currentBody: ctx.getCurrentStageBody?.() ?? ctx.stageBody ?? '',
        replacements: params.replacements,
      })
      if ('error' in result) return textBlock(`未替换：${result.error}`)

      apply({ text: result.next, mode: 'replace' })
      if (ctx.onRequestSave) {
        await new Promise((r) => setTimeout(r, 50))
        await ctx.onRequestSave()
      }
      return textBlock(
        ctx.onRequestSave
          ? `已按原文精确替换正文编写编辑区 ${result.count} 个片段，并已自动保存。`
          : `已按原文精确替换正文编写编辑区 ${result.count} 个片段。`,
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


/**
 * 工作台系统提示词由后端磁盘模板提供；此处仅附加 Pi 工具。
 * 统一工具配置，世情和情感共用同一套工具集
 */
export function buildShortWorkspaceAdditionalTools(
  ctx: ShortWorkspaceStageAgentContext,
): AgentTool[] {
  const readSaved = buildReadWorkspaceContentTool(ctx)
  const readMaterial = buildReadLinkedMaterialContentTool(ctx)
  const writeWorkspace = buildWriteWorkspaceEditorTool(ctx)
  const replaceDraftText = buildReplaceDraftTextTool(ctx)
  switch (ctx.stageId) {
    case 'character_design':
    case 'intro_design':
    case 'plot_design':
      // 前期构思阶段：基础读取工具 + 关联素材读取工具
      return [readSaved, readMaterial, writeWorkspace]

    case 'plot_refine':
      // 剧情细化阶段：增加场景节拍和因果工具
      return [readSaved,readMaterial, writeWorkspace]

    case 'outline':
      // 大纲纲要阶段：增加大纲扫描和章节生成工具
      return [readSaved,readMaterial,writeWorkspace]

    case 'draft':
      // 正文编写普通模式：通过精确原文片段替换，不注册整段写入工具
      return [readSaved, readMaterial, replaceDraftText]

    case 'draft_review':
      // 正文审阅阶段：增加完整审阅工具集
      return [readSaved,writeWorkspace]

    case 'format_conversion':
      // 格式转换阶段：基础读取工具 + 阶段复制工具 + 全局替换工具
      return [readSaved, buildCopyStageToFormatTool(ctx), buildGlobalReplaceTool(ctx)]

    default:
      return [readSaved]
  }
}
