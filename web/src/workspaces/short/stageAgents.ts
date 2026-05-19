import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from 'typebox'

import type { Material, MaterialStageId } from '../../bridge'
import { MATERIAL_STAGE_LABELS, normalizeMaterialStages } from '../../bridge'
import type { ShortStageId } from './stages'
import { SHORT_STAGE_LABELS } from './stages'
import {
  causalityCheatsheetTool,
  chapterStubTool,
  defineTool,
  excerptFn as excerpt,
  lineNoiseScanTool,
  manuscriptMetricsTool,
  outlineScanTool,
  reviewRubricTool,
  sceneBeatHintTool,
  textBlock,
} from '../shared/piToolkit'

export type ShortWorkspaceStageAgentContext = {
  bookTitle: string
  stageId: ShortStageId
  stageBody: string
  allStages: Partial<Record<ShortStageId, string>>
  linkedMaterial?: Material | null
  applyToStageEditor?: (payload: { mode: 'replace' | 'append'; text: string }) => void
}

export function buildReadWorkspaceContentTool(
  ctx: ShortWorkspaceStageAgentContext,
): AgentTool {
  return defineTool({
    name: 'read_workspace_content',
    label: '读取工作区内容',
    description:
      '读取本书工作区某一阶段已保存的正文，每次调用只返回一个 stage_id。不含编辑栏未写入的未保存草稿。',
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
            '工作台阶段键名，例如 character_design、intro_design 等；单次只读取该阶段',
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
      '读取当前书籍在 AI 助手上方关联的素材库内容。每次调用只返回一个素材阶段：character、gimmick 或 pacing。',
    parameters: Type.Object({
      stage_id: Type.Union(
        [
          Type.Literal('character'),
          Type.Literal('gimmick'),
          Type.Literal('pacing'),
        ],
        {
          description:
            '素材库阶段键名：character=人设素材，gimmick=梗素材，pacing=节奏素材；单次只读取该阶段',
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

/**
 * 工作台系统提示词由后端磁盘模板提供；此处仅附加 Pi 工具。
 * 统一工具配置，世情和情感共用同一套工具集
 */
export function buildShortWorkspaceAdditionalTools(
  ctx: ShortWorkspaceStageAgentContext,
): AgentTool[] {
  const readSaved = buildReadWorkspaceContentTool(ctx)
  const readMaterial = buildReadLinkedMaterialContentTool(ctx)

  switch (ctx.stageId) {
    case 'character_design':
    case 'intro_design':
    case 'plot_design':
      // 前期构思阶段：基础读取工具 + 关联素材读取工具
      return [readSaved, readMaterial]

    case 'plot_refine':
      // 剧情细化阶段：增加场景节拍和因果工具
      return [
        sceneBeatHintTool,
        causalityCheatsheetTool,
        readSaved,
      ]

    case 'outline':
      // 大纲纲要阶段：增加大纲扫描和章节生成工具
      return [
        outlineScanTool,
        chapterStubTool,
        reviewRubricTool,
        readSaved,
      ]

    case 'draft':
      // 正文编写阶段：增加字数统计工具
      return [
        manuscriptMetricsTool,
        readSaved,
      ]

    case 'draft_review':
      // 正文审阅阶段：增加完整审阅工具集
      return [
        reviewRubricTool,
        lineNoiseScanTool,
        manuscriptMetricsTool,
        readSaved,
      ]

    case 'format_conversion':
      // 格式转换阶段：基础读取工具
      return [readSaved]

    default:
      return [readSaved]
  }
}
