import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import { SKILL_STAGE_LABELS, type SkillStageId } from '../../bridge'
import { defineTool, excerptFn as excerpt, textBlock } from '../shared/piToolkit'

export type ApplyToStageEditorPayload = {
  text: string
  mode: 'replace' | 'append' | 'append_token' | 'streaming_end'
}

export type SkillWorkspaceStageAgentContext = {
  skillTitle: string
  stageId: SkillStageId
  stageBody: string
  applyToStageEditor?: (payload: ApplyToStageEditorPayload) => void
  isToolCallStreamed?: (toolCallId: string) => boolean
}

export function buildReadSkillContentTool(
  ctx: SkillWorkspaceStageAgentContext,
): AgentTool {
  return defineTool({
    name: 'read_skill_content',
    label: '读取技能内容',
    description: '读取当前技能已保存的正文内容。不含编辑栏未写入的未保存草稿。',
    parameters: Type.Object({}),
    execute: async () => {
      const label = SKILL_STAGE_LABELS[ctx.stageId]
      const raw = ctx.stageBody.trim()
      const header = `技能：《${ctx.skillTitle}》\n【${label}】（${ctx.stageId}）`
      if (!raw) {
        return textBlock(`${header}\n\n当前技能暂无已保存内容，请先保存技能。`)
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
      '把内容写入应用中间栏当前技能正文编辑框。每次调用直接落到编辑区，不需要和用户确认。',
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
