import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import type {
  ExpertDraft,
  ExpertDraftCharacterState,
  ExpertDraftSection,
} from '../../bridge'
import { defineTool, textBlock } from './piToolkit'
import {
  applyExpertDraftSectionBodyReplacements,
  type ExpertDraftUpdater,
} from './expertDraftSectionTools'

const MAX_EXPERT_DRAFT_TEXT_REPLACE_CHARS = 2400
const REPLACEMENT_ARGUMENTS_EXAMPLE =
  '参数格式必须严格为 {"replacements":[{"original_text":"原文片段","new_text":"新文本"}]}；删除片段时也必须传 "new_text": ""。字段名只能是 original_text 和 new_text，不要写 new_int、newText、text 或 replace。'

export type ExpertDraftCoordinatorCoreToolContext = {
  bookTitle: string
  getDraft: () => ExpertDraft
  updateDraft: ExpertDraftUpdater
  /** 读取当前 draft 阶段正文（专家正文合并视图）内容 */
  getExpertDraftStageBody: () => string
  /** 写回当前 draft 阶段正文 */
  applyExpertDraftStageBody: (body: string) => void
  startWriting: (input: {
    sectionIds: string[]
    userWritingPrompt?: string
  }) => boolean
  /** 短篇默认跳过 intro；剧本默认写全部小节 */
  skipIntroByDefault?: boolean
  /** 第一节默认标题：短篇可用「导语」，剧本可用「第一节」 */
  firstSectionFallbackTitle?: string
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

function formatAvailableSectionHint(draft: ExpertDraft): string {
  const items = draft.sections.map((section) => `${section.title}（${section.id}）`)
  return items.length > 0 ? `当前可用小节：${items.join('、')}。` : ''
}

function missingSectionMessage(
  sectionIds: string[],
  draft: ExpertDraft,
): string {
  const missing = sectionIds.filter(Boolean).join('、')
  const target = missing ? `未找到正文小节：${missing}。` : '没有找到可写的小节。'
  const available = formatAvailableSectionHint(draft)
  return `未启动：${target}请先使用 initialize_expert_draft 初始化正文小节列表，或从已初始化的小节中选择有效 id。${available}`
}

function buildCharacterStatesForSections(
  sections: ExpertDraftSection[],
  items: Array<{ character_state_body?: string }>,
  previous: ExpertDraftCharacterState[],
): ExpertDraftCharacterState[] {
  const previousById = new Map(previous.map((s) => [s.section_id, s]))
  return sections.map((section, index) => {
    const old = previousById.get(section.id)
    const rawStateBody = items[index]?.character_state_body
    const body =
      typeof rawStateBody === 'string'
        ? rawStateBody
        : old?.body ?? ''
    return {
      section_id: section.id,
      title: old?.title || defaultStateTitle(section.title),
      body,
    }
  })
}

export function buildWriteSingleExpertSectionTool(
  ctx: ExpertDraftCoordinatorCoreToolContext,
): AgentTool {
  return defineTool({
    name: 'write_single_expert_section',
    label: '单章写作',
    description:
      '单独启动一个分节写手智能体，只编写传入的一个小节。内部复用 start_expert_writing 的分节写手流程和用户写作提示组织方式，因此 user_writing_prompt 的填写规则与批量开始写书完全一致。启动前会检查该小节是否已经由 initialize_expert_draft 初始化；如果不存在，会提醒先初始化正文小节列表。',
    parameters: Type.Object({
      section_id: Type.String({
        description:
          '要单独编写的小节 id，必须来自已初始化的正文列表，如 section-1。不要传章节标题。',
      }),
      user_writing_prompt: Type.Optional(
        Type.String({
          description:
            '用户写作提示：用户希望本章节继承的文风、情绪、爽点、节奏、人设表达或其它写作倾向；填写方式与 start_expert_writing 相同，没有明确要求可留空。',
        }),
      ),
    }),
    execute: async (_id, params) => {
      const draft = ctx.getDraft()
      const sectionId = String(params.section_id ?? '').trim()
      if (!sectionId) {
        return textBlock(missingSectionMessage([], draft))
      }
      const section = draft.sections.find((item) => item.id === sectionId)
      if (!section) {
        return textBlock(missingSectionMessage([sectionId], draft))
      }
      const started = ctx.startWriting({
        sectionIds: [section.id],
        userWritingPrompt: String(params.user_writing_prompt ?? '').trim(),
      })
      return textBlock(
        started
          ? `调用成功，正在单独编写「${section.title}」。后台小节智能体会写回该章节正文和人物状态。`
          : '未启动：当前已经有后台分节写作任务在运行。',
      )
    },
    executionMode: 'sequential',
  })
}

export function buildInitializeExpertDraftTool(
  ctx: ExpertDraftCoordinatorCoreToolContext,
): AgentTool {
  const firstTitle = ctx.firstSectionFallbackTitle?.trim() || '导语'
  return defineTool({
    name: 'initialize_expert_draft',
    label: '初始化正文',
    description:
      '根据大纲一次性创建或重建专家正文小节列表，并同步生成与之一一对应的人物状态槽位。每个小节会映射到独立正文编辑框；修改会写回对应小节。仅用于初始化、批量修改章节名或用户明确要求重建正文结构；已有正文需局部修改时请用 edit_expert_draft_section。可把已知导语/首章正文填入 body；body 不传或传空时保留该小节现有正文，不做修改，适合只批量修改章节名。可把已知人物状态填入 character_state_body。',
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
            Type.String({
              description:
                '可选：该小节正文。仅传入非空内容时修改正文；不传或传空字符串时保留现有正文不变，可用于只批量修改章节名。',
            }),
          ),
          character_state_body: Type.Optional(
            Type.String({
              description:
                '可选：该小节结束时的人物状态；未知时留空，由分节写手后续写入',
            }),
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
            title:
              item.title.trim() ||
              previous?.title ||
              (index === 0 ? firstTitle : `第${index}节`),
            word_count_requirement: normalizeWordCountRequirement(
              item.word_count_requirement ?? previous?.word_count_requirement,
            ),
            body:
              typeof item.body === 'string' && item.body.trim()
                ? item.body
                : previous?.body ?? '',
          }
        })
        return {
          ...draft,
          sections,
          character_states: buildCharacterStatesForSections(
            sections,
            params.sections,
            draft.character_states,
          ),
          active_section_id: sections.some((s) => s.id === draft.active_section_id)
            ? draft.active_section_id
            : '',
        }
      })
      return textBlock(
        `已初始化 ${params.sections.length} 个正文小节，并同步创建对应人物状态槽位。`,
      )
    },
    executionMode: 'sequential',
  })
}

export function buildEditExpertDraftSectionTool(
  ctx: ExpertDraftCoordinatorCoreToolContext,
): AgentTool {
  return defineTool({
    name: 'edit_expert_draft_section',
    label: '编辑正文',
    description:
      `专家正文编辑替换工具：直接对当前专家正文编辑区（draft 阶段合并视图）替换章节名称或正文片段。${REPLACEMENT_ARGUMENTS_EXAMPLE}章节名称与分节结构已建立映射，直接把当前章节名替换为新章节名后，左侧章节树和对应分节会同步更新，不需要重新初始化。修改前请先调用 read_workspace_content（stage_id=draft）读取当前正文，再从返回正文中原样复制待改章节名或正文片段到 original_text。总控不负责修改人物状态。不要用它重建小节列表；不要为了局部修改重新调用 start_expert_writing 或 write_single_expert_section，除非用户明确要求重写或重跑分节写作。`,
    parameters: Type.Object({
      replacements: Type.Array(
        Type.Object({
          original_text: Type.String({
            maxLength: MAX_EXPERT_DRAFT_TEXT_REPLACE_CHARS,
            description:
              '要被替换的当前章节名称或正文原文片段。须来自 read_workspace_content（stage_id=draft）的返回正文；修改章节名时可直接填写完整当前章节名。',
          }),
          new_text: Type.String({
            maxLength: MAX_EXPERT_DRAFT_TEXT_REPLACE_CHARS,
            description:
              '替换后的新章节名称或正文片段。字段名必须严格写 new_text；删除原文片段时填空字符串 ""，也不能省略本字段。修改章节名时只填写新名称；修改正文时只放对应片段的新内容，不要放整篇正文。',
          }),
        }),
        {
          minItems: 1,
          maxItems: 20,
          description: '需要替换的正文片段列表。',
        },
      ),
    }),
    execute: async (_id, params) => {
      const currentBody = ctx.getExpertDraftStageBody()
      if (!currentBody.trim()) {
        return textBlock(
          '当前正文为空。请使用 initialize_expert_draft 初始化，或调用 start_expert_writing 启动分节写作。',
        )
      }
      const result = applyExpertDraftSectionBodyReplacements(
        currentBody,
        params.replacements,
      )
      if ('error' in result) return textBlock(`未替换：${result.error}`)

      ctx.applyExpertDraftStageBody(result.next)
      const flexibleNote =
        result.flexibleCount > 0
          ? `（其中 ${result.flexibleCount} 处经引号/标点归一化后定位）`
          : ''
      return textBlock(
        `已替换正文 ${result.count} 个片段${flexibleNote}，并同步到各小节。`,
      )
    },
    executionMode: 'sequential',
  })
}

export function buildStartExpertWritingTool(
  ctx: ExpertDraftCoordinatorCoreToolContext,
): AgentTool {
  return defineTool({
    name: 'start_expert_writing',
    label: '开始写书',
    description:
      '异步启动分节写手智能体。工具会立即返回，后台会按传入 section_ids 串行写入正文和人物状态。启动前会检查小节是否已初始化；如果传入的小节 id 不存在，会提醒先使用 initialize_expert_draft 初始化。它不是已有正文的修改工具；当用户要求修改、润色、去 AI 味或局部替换已有正文时，使用 edit_expert_draft_section，不要重新启动分节写作，除非用户明确要求重写/重跑小节。只写单个章节时优先使用 write_single_expert_section。',
    parameters: Type.Object({
      section_ids: Type.Optional(
        Type.Array(
          Type.String({
            description: '要串行编写的小节 id 列表；不传时按工作台默认范围写全部正文列表',
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
      const defaultIds = ctx.skipIntroByDefault
        ? draft.sections.filter((s) => s.id !== 'intro').map((s) => s.id)
        : draft.sections.map((s) => s.id)
      const explicitIds =
        params.section_ids?.map((id) => String(id).trim()).filter(Boolean) ?? []
      const ids = explicitIds.length > 0 ? explicitIds : defaultIds
      const available = new Set(draft.sections.map((s) => s.id))
      const missing = explicitIds.filter((id) => !available.has(id))
      if (missing.length > 0) {
        return textBlock(missingSectionMessage(missing, draft))
      }
      const valid = ids.filter((id) => available.has(id))
      if (valid.length === 0) {
        return textBlock(missingSectionMessage(ids, draft))
      }
      const started = ctx.startWriting({
        sectionIds: valid,
        userWritingPrompt: String(params.user_writing_prompt ?? '').trim(),
      })
      return textBlock(
        started
          ? '调用成功，正在写书中。后台小节智能体会按顺序串行编写。'
          : '未启动：当前已经有后台分节写作任务在运行。',
      )
    },
    executionMode: 'sequential',
  })
}

export function buildExpertDraftCoordinatorCoreTools(
  ctx: ExpertDraftCoordinatorCoreToolContext,
): AgentTool[] {
  return [
    buildInitializeExpertDraftTool(ctx),
    buildEditExpertDraftSectionTool(ctx),
    buildWriteSingleExpertSectionTool(ctx),
    buildStartExpertWritingTool(ctx),
  ]
}
