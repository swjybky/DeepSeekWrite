import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from 'typebox'

import {
  SKILL_STAGE_LABELS,
  type SkillStageId,
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

export type SkillWorkspaceStageAgentContext = {
  skillTitle: string
  stageId: SkillStageId
  stageBody: string
  allStages: Partial<Record<SkillStageId, string>>
  applyToStageEditor?: (payload: ApplyToStageEditorPayload) => void
  isToolCallStreamed?: (toolCallId: string) => boolean
}

const skillStageIdSchema = Type.Union(
  [
    Type.Literal('character_design'),
    Type.Literal('plot_design'),
    Type.Literal('intro_design'),
    Type.Literal('plot_refine'),
    Type.Literal('outline'),
    Type.Literal('draft'),
    Type.Literal('draft_review'),
    Type.Literal('format_conversion'),
    Type.Literal('expert_draft_coordinator'),
    Type.Literal('expert_section_writer'),
  ],
  {
    description:
      '技能阶段键名：character_design=人物设计技能，plot_design=剧情设计技能，intro_design=导语设计技能，plot_refine=剧情细化技能，outline=大纲纲要技能，draft=正文技能，draft_review=正文审阅技能，format_conversion=格式转换技能，expert_draft_coordinator=专家总控技能，expert_section_writer=分节写手技能；单次只读取该阶段',
  },
)

export function buildReadSkillContentTool(
  ctx: SkillWorkspaceStageAgentContext,
): AgentTool {
  return defineTool({
    name: 'read_skill_content',
    label: '读取技能内容',
    description:
      '读取当前技能库其它阶段已保存的内容，每次调用只返回一个 stage_id。不含编辑栏未写入的未保存草稿。',
    parameters: Type.Object({
      stage_id: skillStageIdSchema,
    }),
    execute: async (_toolCallId, params) => {
      const sid = params.stage_id as SkillStageId
      const label = SKILL_STAGE_LABELS[sid]
      const raw = (ctx.allStages[sid] ?? '').trim()
      const header = `技能：《${ctx.skillTitle}》\n【${label}】（${sid}）`
      if (!raw) {
        return textBlock(`${header}\n\n该阶段暂无已保存内容，请先保存技能。`)
      }
      return textBlock(`${header}\n\n${excerpt(raw)}`)
    },
  })
}

export function buildWriteSkillEditorTool(
  ctx: SkillWorkspaceStageAgentContext,
): AgentTool {
  const modeSchema = Type.Union(
    [Type.Literal('replace'), Type.Literal('append')],
    { description: 'replace：覆盖当前编辑区全文；append：在文末追加' },
  )
  return defineTool({
    name: 'write_skill_editor',
    label: '写入技能编辑区',
    description:
      '把内容写入应用中间栏当前技能阶段的文本编辑框。每次调用直接落到编辑区，不需要和用户确认。',
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
      if (ctx.isToolCallStreamed?.(toolCallId)) {
        const label = SKILL_STAGE_LABELS[ctx.stageId]
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
      const label = SKILL_STAGE_LABELS[ctx.stageId]
      return textBlock(
        mode === 'replace'
          ? `已用新内容覆盖「${label}」编辑区。`
          : `已将内容追加到「${label}」编辑区文末。`,
      )
    },
  })
}

export function buildSkillWorkspaceAdditionalTools(
  ctx: SkillWorkspaceStageAgentContext,
): AgentTool[] {
  return [
    buildReadSkillContentTool(ctx),
    buildWriteSkillEditorTool(ctx),
  ]
}
