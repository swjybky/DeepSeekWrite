import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from 'typebox'

import {
  MATERIAL_STAGE_LABELS,
  type MaterialStageId,
  type MaterialPromptKind,
} from '../../bridge'
import {
  defineTool,
  excerptFn as excerpt,
  textBlock,
} from '../shared/piToolkit'

export type ApplyToStageEditorPayload = {
  text: string
  mode: 'replace' | 'append' | 'append_token' | 'streaming_end'
}

export type MaterialWorkspaceStageAgentContext = {
  materialTitle: string
  promptKind: MaterialPromptKind
  stageId: MaterialStageId
  stageBody: string
  allStages: Partial<Record<MaterialStageId, string>>
  applyToStageEditor?: (payload: ApplyToStageEditorPayload) => void
  isToolCallStreamed?: (toolCallId: string) => boolean
}

export function buildReadMaterialContentTool(
  ctx: MaterialWorkspaceStageAgentContext,
): AgentTool {
  return defineTool({
    name: 'read_material_content',
    label: '读取素材内容',
    description:
      '读取当前素材库其它阶段已保存的内容，每次调用只返回一个 stage_id（character/intro/gimmick/plot_refine/pacing/draft_excerpt）。不含编辑栏未写入的未保存草稿。',
    parameters: Type.Object({
      stage_id: Type.Union(
        [
          Type.Literal('character'),
          Type.Literal('intro'),
          Type.Literal('gimmick'),
          Type.Literal('plot_refine'),
          Type.Literal('pacing'),
          Type.Literal('draft_excerpt'),
        ],
        {
          description:
            '素材阶段键名：character=人设素材，intro=导语素材，gimmick=梗素材，plot_refine=剧情细化素材，pacing=节奏素材，draft_excerpt=正文片段；单次只读取该阶段',
        },
      ),
    }),
    execute: async (_toolCallId, params) => {
      const sid = params.stage_id as MaterialStageId
      const label = MATERIAL_STAGE_LABELS[sid]
      const raw = (ctx.allStages[sid] ?? '').trim()
      const header = `素材：《${ctx.materialTitle}》\n【${label}】（${sid}）`
      if (!raw) {
        return textBlock(`${header}\n\n该阶段暂无已保存内容，请先保存素材。`)
      }
      return textBlock(`${header}\n\n${excerpt(raw)}`)
    },
  })
}

export function buildWriteMaterialEditorTool(
  ctx: MaterialWorkspaceStageAgentContext,
): AgentTool {
  const modeSchema = Type.Union(
    [Type.Literal('replace'), Type.Literal('append')],
    { description: 'replace：覆盖当前编辑区全文；append：在文末追加' },
  )
  return defineTool({
    name: 'write_material_editor',
    label: '写入素材编辑区',
    description:
      '把内容写入应用中间栏当前素材阶段的文本编辑框。每次调用直接落盘到编辑区，不需要和用户确认。',
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
        const label = MATERIAL_STAGE_LABELS[ctx.stageId]
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
      const label = MATERIAL_STAGE_LABELS[ctx.stageId]
      return textBlock(
        mode === 'replace'
          ? `已用新内容覆盖「${label}」编辑区。`
          : `已将内容追加到「${label}」编辑区文末。`,
      )
    },
  })
}

/**
 * 素材库工作台系统提示词由后端磁盘模板提供；此处仅附加 Pi 工具。
 * 所有素材阶段（人设/导语/梗/剧情细化/节奏/正文片段）共用同一套工具：读取 + 写入。
 */
export function buildMaterialWorkspaceAdditionalTools(
  ctx: MaterialWorkspaceStageAgentContext,
): AgentTool[] {
  return [
    buildReadMaterialContentTool(ctx),
    buildWriteMaterialEditorTool(ctx),
  ]
}
