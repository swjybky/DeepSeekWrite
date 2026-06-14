import { Agent } from '@earendil-works/pi-agent-core'
import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core'
import { ApiKeyPromptDialog } from '@earendil-works/pi-web-ui'
import { Type } from 'typebox'

import {
  readWorkspaceAgentPromptTemplate,
  type ExpertDraft,
  type ExpertDraftSection,
  type Material,
  type MaterialStageId,
  type Skill,
  type StageId,
} from '../../../bridge'
import {
  buildReadLinkedMaterialContentTool,
  buildReadWorkspaceContentTool,
  buildSearchWorkspaceTextTool,
} from '../stageAgents'
import { buildLoadSkillTool } from '../loadSkill'
import {
  EXPERT_SECTION_WRITER_AGENT_ID,
  type WorkspaceAgentReadAccessEntry,
} from '../stageReadAccess'
import type { ScriptStageId } from '../stages'
import {
  resolveWorkspaceProviderApiKey,
} from '../../../pi/resolveWorkspaceChatModel'
import { convertToLlmWithSkillAsUser } from '../../../pi/skillMessageTransform'
import { createPiSessionId } from '../../../pi/sessionId'
import { ensurePiAppStorage } from '../../../pi/setupPiWorkspace'
import {
  getPreferredWorkspaceThinkingLevel,
  resolvePreferredWorkspaceChatModel,
} from '../../../pi/workspaceChatPreferences'
import { createWorkspaceStreamFn } from '../../../pi/workspaceStreamFn'
import { defineTool, textBlock } from '../../shared/piToolkit'
import {
  buildSectionWriterSystemPrompt,
  buildSectionWriterUserPrompt,
} from './prompts'

type ExpertDraftUpdater = (updater: (draft: ExpertDraft) => ExpertDraft) => void

export type ExpertDraftSectionContentField = 'body' | 'character_state'

/** 优先读当前文本编辑框；读不到时由工具内部回退到 getDraft 已保存内容。 */
export type GetExpertDraftSectionContent = (
  sectionId: string,
  field: ExpertDraftSectionContentField,
) => string | undefined

export type RunExpertDraftSectionWriterOptions = {
  bookId: string
  bookTitle: string
  bookGenre: string
  sectionIds: string[]
  getDraft: () => ExpertDraft
  getWorkspaceStages: () => Partial<Record<StageId, string>>
  /** 书籍关联的素材库 */
  linkedMaterial?: Material | null
  /** 书籍绑定的技能库 */
  linkedSkill?: Skill | null
  /** 用户在启动分节写作时补充的整体写作倾向 */
  userWritingPrompt?: string
  /** 分节写手智能体的全局可读配置 */
  readAccess: WorkspaceAgentReadAccessEntry
  getRenderedExpertDraftSectionContent?: GetExpertDraftSectionContent
  updateDraft: ExpertDraftUpdater
  signal?: AbortSignal
  onError?: (message: string) => void
  onSectionAgentStart?: (info: {
    agent: Agent
    sectionId: string
    sectionTitle: string
    sectionIndex: number
    sectionCount: number
    userPrompt: string
  }) => void | Promise<void>
  onRunFinish?: (info: { aborted: boolean }) => void | Promise<void>
}

function replaceSectionBody(
  draft: ExpertDraft,
  sectionId: string,
  body: string,
): ExpertDraft {
  return {
    ...draft,
    sections: draft.sections.map((section) =>
      section.id === sectionId ? { ...section, body } : section,
    ),
  }
}

function replaceCharacterState(
  draft: ExpertDraft,
  sectionId: string,
  body: string,
): ExpertDraft {
  const title =
    draft.character_states.find((s) => s.section_id === sectionId)?.title ||
    `${draft.sections.find((s) => s.id === sectionId)?.title || '小节'}人物状态`
  const exists = draft.character_states.some((s) => s.section_id === sectionId)
  return {
    ...draft,
    character_states: exists
      ? draft.character_states.map((state) =>
          state.section_id === sectionId ? { ...state, body } : state,
        )
      : [...draft.character_states, { section_id: sectionId, title, body }],
  }
}

function messageText(message: AgentMessage): string {
  if (
    !message ||
    typeof message !== 'object' ||
    !('role' in message) ||
    message.role !== 'assistant'
  ) {
    return ''
  }
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (
        block &&
        typeof block === 'object' &&
        'type' in block &&
        block.type === 'text' &&
        'text' in block
      ) {
        return String(block.text ?? '')
      }
      return ''
    })
    .filter(Boolean)
    .join('\n\n')
}

function cleanFallbackBody(raw: string): string {
  let text = raw.trim()
  const fence = text.match(/```(?:text|markdown|md)?\s*([\s\S]*?)```/i)
  if (fence?.[1]?.trim()) text = fence[1].trim()
  const marker = text.match(/(?:正文|小说正文)[:：]\s*([\s\S]+)/)
  if (marker?.[1]?.trim() && marker[1].trim().length > 80) {
    text = marker[1].trim()
  }
  return text
    .replace(/^\s*#+\s*.*$/gm, '')
    .replace(/^\s*(?:以下是|下面是).*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractFallbackSectionBody(messages: AgentMessage[]): string {
  for (const message of [...messages].reverse()) {
    const text = cleanFallbackBody(messageText(message))
    if (
      text.length >= 120 &&
      !text.includes('write_section_body') &&
      !text.includes('write_character_state')
    ) {
      return text
    }
  }
  return ''
}

/** 将模型常见变体（section_1、section1）归一化为 section-1 等标准 id */
function canonicalizeSectionId(raw: string): string {
  const trimmed = String(raw ?? '').trim()
  const numbered = trimmed.match(/^section[_-]?(\d+)$/i)
  if (numbered) return `section-${numbered[1]}`
  return trimmed
}

function sectionIdMatchesExpected(raw: string, expectedSectionId: string): boolean {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return false
  if (trimmed === expectedSectionId) return true
  return canonicalizeSectionId(trimmed) === canonicalizeSectionId(expectedSectionId)
}

function resolveExpertDraftSection(
  draft: ExpertDraft,
  rawSectionId: string,
): ExpertDraftSection | undefined {
  const trimmed = String(rawSectionId ?? '').trim()
  if (!trimmed) return undefined
  const direct = draft.sections.find((section) => section.id === trimmed)
  if (direct) return direct
  const canonical = canonicalizeSectionId(trimmed)
  return draft.sections.find(
    (section) =>
      section.id === canonical ||
      canonicalizeSectionId(section.id) === canonical,
  )
}

function readExpertDraftSectionField(
  sectionId: string,
  field: ExpertDraftSectionContentField,
  getDraft: () => ExpertDraft,
  getRendered?: GetExpertDraftSectionContent,
): { text: string; source: 'editor' | 'saved' } {
  const section = resolveExpertDraftSection(getDraft(), sectionId)
  if (!section) return { text: '', source: 'saved' }
  const resolvedId = section.id

  try {
    const rendered = getRendered?.(resolvedId, field)
    if (rendered !== undefined) {
      return { text: rendered, source: 'editor' }
    }
  } catch {
    /* fallback below */
  }

  const draft = getDraft()
  if (field === 'body') {
    const saved =
      draft.sections.find((item) => item.id === resolvedId)?.body ?? ''
    return { text: saved, source: 'saved' }
  }
  const saved =
    draft.character_states.find((item) => item.section_id === resolvedId)
      ?.body ?? ''
  return { text: saved, source: 'saved' }
}

export function buildReadExpertDraftSectionTool(input: {
  bookTitle: string
  getDraft: () => ExpertDraft
  getRenderedSectionContent?: GetExpertDraftSectionContent
}): AgentTool {
  const { bookTitle, getDraft, getRenderedSectionContent } = input

  return defineTool({
    name: 'read_expert_draft_section',
    label: '读取其它小节',
    description:
      '读取正文编写专家模式中指定小节的正文和人物状态。优先读取当前文本编辑框中的内容；该小节未在当前文本编辑框中打开时，回退到已加载/已保存的小节内容。每次只读一个小节。',
    parameters: Type.Object({
      section_id: Type.String({
        description: '目标小节 id，如 intro、section-1、section-2',
      }),
      include_character_state: Type.Optional(
        Type.Boolean({
          description: '是否同时返回人物状态，默认 true',
        }),
      ),
    }),
    execute: async (_id, params) => {
      const section = resolveExpertDraftSection(getDraft(), params.section_id)
      if (!section) {
        const available = getDraft()
          .sections.map((item) => `${item.title}（${item.id}）`)
          .join('、')
        return textBlock(
          `未找到小节「${params.section_id}」。当前列表：${available || '（空）'}`,
        )
      }

      const includeState = params.include_character_state !== false
      const bodyResult = readExpertDraftSectionField(
        section.id,
        'body',
        getDraft,
        getRenderedSectionContent,
      )
      const body = bodyResult.text.trim()
      const bodySource =
        bodyResult.source === 'editor' ? '当前文本编辑框' : '已保存内容'
      const header = `书名：《${bookTitle}》\n【${section.title}】（${section.id}）\n正文来源：${bodySource}`

      if (!includeState) {
        if (!body) {
          return textBlock(`${header}\n\n该小节正文当前为空。`)
        }
        return textBlock(`${header}\n\n${body}`)
      }

      const stateResult = readExpertDraftSectionField(
        section.id,
        'character_state',
        getDraft,
        getRenderedSectionContent,
      )
      const stateBody = stateResult.text.trim()
      const stateTitle =
        getDraft().character_states.find(
          (item) => item.section_id === section.id,
        )?.title || `${section.title}人物状态`
      const stateSource =
        stateResult.source === 'editor' ? '当前文本编辑框' : '已保存内容'

      const parts = [header]
      parts.push(`\n## 正文\n${body || '（空）'}`)
      parts.push(
        `\n## ${stateTitle}\n人物状态来源：${stateSource}\n${stateBody || '（空）'}`,
      )
      const wordRequirement = String(section.word_count_requirement ?? '').trim()
      if (wordRequirement) {
        parts.push(`\n## 字数要求\n${wordRequirement}`)
      }
      return textBlock(parts.join('\n'))
    },
  })
}

export function buildSectionWriterTools(input: {
  bookTitle: string
  sectionId: string
  sectionTitle: string
  allStages: Partial<Record<StageId, string>>
  linkedMaterial?: Material | null
  linkedSkill?: Skill | null
  readAccess: WorkspaceAgentReadAccessEntry
  getDraft: () => ExpertDraft
  getRenderedSectionContent?: GetExpertDraftSectionContent
  updateDraft: ExpertDraftUpdater
  onSectionBodyWritten?: (text: string) => void
  onCharacterStateWritten?: (text: string) => void
}): AgentTool[] {
  const {
    bookTitle,
    sectionId,
    sectionTitle,
    allStages,
    linkedMaterial,
    readAccess,
    getDraft,
    getRenderedSectionContent,
    updateDraft,
    onSectionBodyWritten,
    onCharacterStateWritten,
  } = input
  const toolCtx = {
    bookTitle,
    stageId: 'draft' as const,
    stageBody: '',
    allStages,
    linkedMaterial: linkedMaterial ?? null,
  }
  const readTools: AgentTool[] = []
  if (readAccess.workspace.length > 0) {
    readTools.push(
      buildReadWorkspaceContentTool(
        toolCtx,
        readAccess.workspace as readonly ScriptStageId[],
      ),
    )
  }
  readTools.push(
    buildSearchWorkspaceTextTool(
      toolCtx,
      readAccess.workspace as readonly ScriptStageId[],
    ),
  )
  if (readAccess.material.length > 0) {
    readTools.push(
      buildReadLinkedMaterialContentTool(
        toolCtx,
        readAccess.material as readonly MaterialStageId[],
      ),
    )
  }
  readTools.push(
    buildLoadSkillTool({
      linkedSkill: input.linkedSkill,
      currentStageId: EXPERT_SECTION_WRITER_AGENT_ID,
    }),
  )

  return [
    ...readTools,
    buildReadExpertDraftSectionTool({
      bookTitle,
      getDraft,
      getRenderedSectionContent,
    }),
    defineTool({
      name: 'write_section_body',
      label: '写入正文',
      description:
        '删除当前节正文文本框中的内容，并写入干净正文。只能用于当前正在编写的小节。',
      parameters: Type.Object({
        section_id: Type.String({ description: '当前小节 id' }),
        text: Type.String({ description: '当前小节干净正文，不含思考过程' }),
      }),
      execute: async (_id, params) => {
        if (!sectionIdMatchesExpected(params.section_id, sectionId)) {
          return textBlock(`未写入：当前只能写入 ${sectionTitle}（${sectionId}）。`)
        }
        const text = params.text.trim()
        if (!text) return textBlock('未写入：正文为空。')
        onSectionBodyWritten?.(text)
        updateDraft((draft) => replaceSectionBody(draft, sectionId, text))
        return textBlock(`已覆盖写入「${sectionTitle}」正文。`)
      },
      executionMode: 'sequential',
    }),
    defineTool({
      name: 'write_character_state',
      label: '写入人物状态',
      description:
        '覆盖当前小节对应的人物状态编辑框。只能用于当前正在编写的小节。',
      parameters: Type.Object({
        section_id: Type.String({ description: '当前小节 id' }),
        text: Type.String({
          description: '当前小节结束时的人物状态、关系变化、冲突推进与接续点',
        }),
      }),
      execute: async (_id, params) => {
        if (!sectionIdMatchesExpected(params.section_id, sectionId)) {
          return textBlock(`未写入：当前只能写入 ${sectionTitle}（${sectionId}）。`)
        }
        const text = params.text.trim()
        if (!text) return textBlock('未写入：人物状态为空。')
        onCharacterStateWritten?.(text)
        updateDraft((draft) => replaceCharacterState(draft, sectionId, text))
        return textBlock(`已覆盖写入「${sectionTitle}」人物状态。`)
      },
      executionMode: 'sequential',
    }),
  ]
}

async function ensureModelApiKey(provider: string): Promise<boolean> {
  const existing = await resolveWorkspaceProviderApiKey(provider)
  if (existing) return true
  const ok = await ApiKeyPromptDialog.prompt(provider)
  if (!ok) return false
  return Boolean(await resolveWorkspaceProviderApiKey(provider))
}

export async function runExpertDraftSectionWriter(
  opts: RunExpertDraftSectionWriterOptions,
): Promise<void> {
  try {
    await ensurePiAppStorage()
    const model = await resolvePreferredWorkspaceChatModel()
    const hasKey = await ensureModelApiKey(model.provider)
    if (!hasKey) {
      opts.onError?.('分节写作未启动：缺少当前模型 API Key。')
      return
    }

    const ids = opts.sectionIds.filter((id) =>
      opts.getDraft().sections.some((section) => section.id === id),
    )

    for (const [sectionIndex, sectionId] of ids.entries()) {
      if (opts.signal?.aborted) return
      const draftBefore = opts.getDraft()
      const section = draftBefore.sections.find((s) => s.id === sectionId)
      if (!section) continue
      const systemPromptTemplate = await readWorkspaceAgentPromptTemplate(
        EXPERT_SECTION_WRITER_AGENT_ID,
        'script',
      )

      opts.updateDraft((draft) => ({
        ...draft,
        running: true,
        active_section_id: sectionId,
      }))

      let sectionBodyWritten = ''
      let characterStateWritten = ''

      const agent = new Agent({
        sessionId: createPiSessionId(
          'expert-draft-writer',
          opts.bookId,
          'script_shared',
          sectionId,
          Date.now(),
        ),
        convertToLlm: convertToLlmWithSkillAsUser,
        getApiKey: resolveWorkspaceProviderApiKey,
        streamFn: createWorkspaceStreamFn(),
        toolExecution: 'sequential',
        initialState: {
          systemPrompt: buildSectionWriterSystemPrompt({
            bookTitle: opts.bookTitle,
            bookGenre: opts.bookGenre,
            stageBody: section.body,
            workspaceStages: opts.getWorkspaceStages(),
            allowedWorkspaceStages: opts.readAccess.workspace as readonly StageId[],
            template: systemPromptTemplate,
            linkedSkill: opts.linkedSkill,
          }),
          model,
          thinkingLevel: getPreferredWorkspaceThinkingLevel(),
          messages: [],
          tools: buildSectionWriterTools({
            bookTitle: opts.bookTitle,
            sectionId,
            sectionTitle: section.title,
            allStages: opts.getWorkspaceStages(),
            linkedMaterial: opts.linkedMaterial,
            linkedSkill: opts.linkedSkill,
            readAccess: opts.readAccess,
            getDraft: opts.getDraft,
            getRenderedSectionContent: opts.getRenderedExpertDraftSectionContent,
            updateDraft: opts.updateDraft,
            onSectionBodyWritten: (text) => {
              sectionBodyWritten = text
            },
            onCharacterStateWritten: (text) => {
              characterStateWritten = text
            },
          }),
        },
      })

      const abortCurrentAgent = () => agent.abort()
      opts.signal?.addEventListener('abort', abortCurrentAgent, { once: true })

      try {
        const userPrompt = buildSectionWriterUserPrompt({
          sectionId,
          sectionTitle: section.title,
          sectionIndex,
          sectionCount: ids.length,
          draft: draftBefore,
          userWritingPrompt: opts.userWritingPrompt,
        })
        try {
          await opts.onSectionAgentStart?.({
            agent,
            sectionId,
            sectionTitle: section.title,
            sectionIndex,
            sectionCount: ids.length,
            userPrompt,
          })
        } catch (e) {
          opts.onError?.(
            e instanceof Error
              ? `分节写手展示失败：${e.message}`
              : '分节写手展示失败',
          )
        }
        if (opts.signal?.aborted) return
        await agent.prompt(userPrompt)
        if (opts.signal?.aborted) return

        if (!sectionBodyWritten || !characterStateWritten) {
          await agent.prompt(
            `上一轮没有完整写回编辑器。请不要解释，立即补齐缺失的工具调用：
- 当前小节 id：${sectionId}
- 当前小节标题：${section.title}
- ${sectionBodyWritten ? '正文已经写回，不要再次调用 write_section_body。' : '必须调用 write_section_body，text 填入当前小节完整干净正文。'}
- ${characterStateWritten ? '人物状态已经写回，不要再次调用 write_character_state。' : '必须调用 write_character_state，text 填入当前小节结束时的人物状态。'}`,
          )
        }
        if (opts.signal?.aborted) return

        if (!sectionBodyWritten) {
          const fallback = extractFallbackSectionBody(agent.state.messages)
          if (fallback) {
            sectionBodyWritten = fallback
            opts.updateDraft((draft) =>
              replaceSectionBody(draft, sectionId, fallback),
            )
          }
        }

        if (!sectionBodyWritten) {
          opts.onError?.(`分节写作未写入「${section.title}」正文，已停止。`)
          return
        }

        if (!characterStateWritten) {
          opts.onError?.(`「${section.title}」人物状态未写入，可稍后手动补充。`)
        }
      } catch (e) {
        if (opts.signal?.aborted) return
        opts.onError?.(
          e instanceof Error
            ? `分节写作失败：${e.message}`
            : '分节写作失败',
        )
        return
      } finally {
        opts.signal?.removeEventListener('abort', abortCurrentAgent)
        agent.abort()
      }
    }
  } finally {
    try {
      await opts.onRunFinish?.({ aborted: Boolean(opts.signal?.aborted) })
    } catch {
      /* ignore display cleanup failures */
    }
  }
}
