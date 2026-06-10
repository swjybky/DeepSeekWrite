import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import type {
  ExpertDraft,
  ExpertDraftCharacterState,
  ExpertDraftSection,
  Material,
  Skill,
  StageId,
} from '../../../bridge'
import { defineTool, textBlock } from '../../shared/piToolkit'
import {
  buildReadLinkedMaterialContentTool,
  buildReadWorkspaceContentTool,
} from '../stageAgents'
import { buildLoadSkillTool } from '../loadSkill'
import type { WorkspaceAgentReadAccessEntry } from '../stageReadAccess'

type ExpertDraftUpdater = (updater: (draft: ExpertDraft) => ExpertDraft) => void

export type ExpertDraftCoordinatorToolContext = {
  bookTitle: string
  allStages: Partial<Record<StageId, string>>
  linkedMaterial?: Material | null
  linkedSkill?: Skill | null
  readAccess: WorkspaceAgentReadAccessEntry
  getDraft: () => ExpertDraft
  updateDraft: ExpertDraftUpdater
  startWriting: (input: {
    sectionIds: string[]
    userWritingPrompt?: string
  }) => boolean
}

function defaultStateTitle(sectionTitle: string): string {
  return `${sectionTitle.trim() || '小节'}人物状态`
}

function normalizeWordCountRequirement(raw: unknown): string {
  return String(raw ?? '').trim()
}

function sectionIdForIndex(index: number): string {
  return index === 0 ? 'intro' : `section-${index}`
}

function normalizeSectionId(
  rawId: string | undefined,
  index: number,
  used: Set<string>,
): string {
  const preferred = rawId?.trim() || sectionIdForIndex(index)
  if (!used.has(preferred)) return preferred
  let suffix = 1
  while (used.has(`${preferred}-${suffix}`)) suffix += 1
  return `${preferred}-${suffix}`
}

function mergeStatesForSections(
  sections: ExpertDraftSection[],
  previous: ExpertDraftCharacterState[],
): ExpertDraftCharacterState[] {
  const previousById = new Map(previous.map((s) => [s.section_id, s]))
  return sections.map((section) => {
    const old = previousById.get(section.id)
    return {
      section_id: section.id,
      title: old?.title || defaultStateTitle(section.title),
      body: old?.body ?? '',
    }
  })
}

export function buildExpertDraftCoordinatorTools(
  ctx: ExpertDraftCoordinatorToolContext,
): AgentTool[] {
  const readTools: AgentTool[] = []
  const toolCtx = {
    bookTitle: ctx.bookTitle,
    stageId: 'draft' as const,
    stageBody: '',
    allStages: ctx.allStages,
    linkedMaterial: ctx.linkedMaterial ?? null,
  }
  if (ctx.readAccess.workspace.length > 0) {
    readTools.push(
      buildReadWorkspaceContentTool(toolCtx, ctx.readAccess.workspace),
    )
  }
  if (ctx.readAccess.material.length > 0) {
    readTools.push(
      buildReadLinkedMaterialContentTool(toolCtx, ctx.readAccess.material),
    )
  }
  readTools.push(
    buildLoadSkillTool({
      linkedSkill: ctx.linkedSkill,
      currentStageId: 'expert_draft_coordinator',
    }),
  )

  return [
    ...readTools,
    defineTool({
      name: 'create_draft_sections',
      label: '创建正文列表',
      description:
        '根据大纲要求创建或重建专家模式左侧正文列表。每个条目会变成一个独立正文文本框；可直接填入导语正文。',
      parameters: Type.Object({
        sections: Type.Array(
          Type.Object({
            id: Type.Optional(
              Type.String({
                description: '可选小节 id；导语建议 intro，第一节建议 section-1',
              }),
            ),
            title: Type.String({ description: '小节标题，如 导语、第一节' }),
            word_count_requirement: Type.Optional(
              Type.String({
                description:
                  '本小节字数要求，优先从大纲「预估字数」「字数规划」读取；可填 800、800-1000、约1000字等。',
              }),
            ),
            body: Type.Optional(
              Type.String({ description: '可选：该小节正文；未知时留空' }),
            ),
          }),
          { minItems: 1 },
        ),
      }),
      execute: async (_id, params) => {
        ctx.updateDraft((draft) => {
          const previousById = new Map(draft.sections.map((s) => [s.id, s]))
          const used = new Set<string>()
          const sections = params.sections.map((item, index) => {
            const id = normalizeSectionId(item.id, index, used)
            used.add(id)
            const previous = previousById.get(id)
            return {
              id,
              title: item.title.trim() || previous?.title || (index === 0 ? '导语' : `第${index}节`),
              word_count_requirement: normalizeWordCountRequirement(
                item.word_count_requirement ?? previous?.word_count_requirement,
              ),
              body:
                typeof item.body === 'string'
                  ? item.body
                  : previous?.body ?? '',
            }
          })
          return {
            ...draft,
            sections,
            character_states: mergeStatesForSections(
              sections,
              draft.character_states,
            ),
            active_section_id: sections.some((s) => s.id === draft.active_section_id)
              ? draft.active_section_id
              : '',
          }
        })
        return textBlock(`已创建 ${params.sections.length} 个正文文本框。`)
      },
      executionMode: 'sequential',
    }),
    defineTool({
      name: 'create_character_state_sections',
      label: '创建人物状态列表',
      description:
        '创建或重建专家模式左侧人物状态编辑框列表。条目应与正文小节一一对应；可直接填入导语人物状态。',
      parameters: Type.Object({
        items: Type.Array(
          Type.Object({
            section_id: Type.Optional(
              Type.String({
                description: '对应正文小节 id；优先使用正文列表中已有 id',
              }),
            ),
            section_title: Type.String({
              description: '对应正文小节标题，如 导语、第一节',
            }),
            title: Type.Optional(Type.String({ description: '人物状态框标题' })),
            body: Type.Optional(
              Type.String({ description: '可选：该小节结束时的人物状态' }),
            ),
          }),
          { minItems: 1 },
        ),
      }),
      execute: async (_id, params) => {
        ctx.updateDraft((draft) => {
          const sectionByTitle = new Map(
            draft.sections.map((s) => [s.title.trim(), s]),
          )
          const sectionById = new Map(draft.sections.map((s) => [s.id, s]))
          const previousById = new Map(
            draft.character_states.map((s) => [s.section_id, s]),
          )
          const seen = new Set<string>()
          const next: ExpertDraftCharacterState[] = []

          for (const item of params.items) {
            const section =
              sectionById.get(String(item.section_id ?? '').trim()) ??
              sectionByTitle.get(item.section_title.trim())
            if (!section || seen.has(section.id)) continue
            seen.add(section.id)
            const previous = previousById.get(section.id)
            next.push({
              section_id: section.id,
              title:
                item.title?.trim() ||
                previous?.title ||
                defaultStateTitle(section.title),
              body:
                typeof item.body === 'string'
                  ? item.body
                  : previous?.body ?? '',
            })
          }

          for (const section of draft.sections) {
            if (seen.has(section.id)) continue
            const previous = previousById.get(section.id)
            next.push({
              section_id: section.id,
              title: previous?.title || defaultStateTitle(section.title),
              body: previous?.body ?? '',
            })
          }

          return { ...draft, character_states: next }
        })
        return textBlock(`已创建 ${params.items.length} 个人物状态编辑框。`)
      },
      executionMode: 'sequential',
    }),
    defineTool({
      name: 'start_expert_writing',
      label: '开始写书',
      description:
        '异步启动专家模式后台小节编写智能体。工具会立即返回，后台会按传入 section_ids 串行写入正文和人物状态。',
      parameters: Type.Object({
        section_ids: Type.Optional(
          Type.Array(
            Type.String({
              description: '要串行编写的小节 id 列表；不传时默认写全部正文列表',
            }),
          ),
        ),
        user_writing_prompt: Type.Optional(
          Type.String({
            description:
              '用户写作提示：用户希望全文偏向的文风、情绪、爽点、节奏、人设表达或其它写作倾向；没有明确要求可留空。',
          }),
        ),
      }),
      execute: async (_id, params) => {
        const draft = ctx.getDraft()
        const ids = (params.section_ids?.length
          ? params.section_ids
          : draft.sections
              .filter((s) => s.id !== 'intro')
              .map((s) => s.id)
        )
          .map((id) => String(id).trim())
          .filter(Boolean)
        const valid = ids.filter((id) => draft.sections.some((s) => s.id === id))
        if (valid.length === 0) {
          return textBlock('未启动：没有可写的小节。')
        }
        const started = ctx.startWriting({
          sectionIds: valid,
          userWritingPrompt: String(params.user_writing_prompt ?? '').trim(),
        })
        return textBlock(
          started
            ? '调用成功，正在写书中。后台小节智能体会按顺序串行编写。'
            : '未启动：当前已经有专家模式后台写作任务在运行。',
        )
      },
      executionMode: 'sequential',
    }),
  ]
}
