import { Agent } from '@earendil-works/pi-agent-core'
import type {
  AgentMessage,
  AgentTool,
  ThinkingLevel,
} from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import { ApiKeyPromptDialog } from '@earendil-works/pi-web-ui'

import {
  readWorkspaceAgentPromptTemplate,
  type ExpertDraft,
  type MemoryEntry,
  type Material,
  type MaterialKind,
  type Skill,
  type SkillKind,
  type StageId,
} from '../../../bridge'
import {
  buildReadWorkspaceContentTool,
  buildSearchWorkspaceTextTool,
} from '../stageAgents'
import { buildQueryLinkedMaterialEntriesTool } from '../../shared/linkedMaterialQueryTools'
import { buildLoadSkillTool } from '../loadSkill'
import {
  EXPERT_SECTION_WRITER_AGENT_ID,
  type WorkspaceAgentReadAccessEntry,
} from '../stageReadAccess'
import type { ScriptStageId } from '../stages'
import {
  createWorkspaceModelApiKeyResolver,
  resolveWorkspaceModelApiKey,
} from '../../../pi/resolveWorkspaceChatModel'
import { convertToLlmWithSkillAsUser } from '../../../pi/skillMessageTransform'
import {
  createMemoryAwareConvertToLlm,
  resolveSectionRuntimeLocation,
} from '../../../pi/memoryMessageTransform'
import { createPiSessionId } from '../../../pi/sessionId'
import { ensurePiAppStorage } from '../../../pi/setupPiWorkspace'
import {
  getPreferredWorkspaceThinkingLevel,
  resolvePreferredWorkspaceChatModel,
} from '../../../pi/workspaceChatPreferences'
import { createWorkspaceStreamFn } from '../../../pi/workspaceStreamFn'
import {
  buildExpertDraftSectionEditTools,
  buildReadExpertDraftSectionTool,
  type ExpertDraftUpdater,
  type ExpertDraftSectionContentField,
  type GetExpertDraftSectionContent,
  updateExpertDraftSectionBody,
} from '../../shared/expertDraftSectionTools'
import {
  buildSectionWriterSystemPrompt,
  buildSectionWriterUserPrompt,
} from './prompts'

export type { ExpertDraftSectionContentField, GetExpertDraftSectionContent }

export type RunExpertDraftSectionWriterOptions = {
  bookId: string
  bookTitle: string
  bookGenre: string
  sectionIds: string[]
  getDraft: () => ExpertDraft
  getWorkspaceStages: () => Partial<Record<StageId, string>>
  getCurrentWorkspaceStageBody?: (stageId: StageId) => string | undefined
  syncExpertDraftSectionField?: (
    sectionId: string,
    field: ExpertDraftSectionContentField,
    body: string,
  ) => void
  /** 书籍关联的素材库 */
  linkedMaterial?: Material | null
  linkedMaterialsByKind?: Partial<Record<MaterialKind, Material[]>>
  /** 书籍绑定的技能库 */
  linkedSkill?: Skill | null
  linkedSkillsByKind?: Partial<Record<SkillKind, Skill[]>>
  bookMemories?: MemoryEntry[]
  userMemories?: MemoryEntry[]
  /** 用户在启动分节写作时补充的整体写作倾向 */
  userWritingPrompt?: string
  model?: Model<Api>
  thinkingLevel?: ThinkingLevel
  /** 分节写手智能体的全局可读配置 */
  readAccess: WorkspaceAgentReadAccessEntry
  getRenderedExpertDraftSectionContent?: GetExpertDraftSectionContent
  updateDraft: ExpertDraftUpdater
  signal?: AbortSignal
  onError?: (message: string) => void
  onAbortRequested?: () => void
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

function linkAgentAbortToRunAbort(agent: Agent, opts: RunExpertDraftSectionWriterOptions) {
  if (!opts.onAbortRequested) return
  const originalAbort = agent.abort.bind(agent)
  let notified = false
  agent.abort = () => {
    if (!notified && !opts.signal?.aborted) {
      notified = true
      opts.onAbortRequested?.()
    }
    originalAbort()
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

export { buildReadExpertDraftSectionTool }

export function buildSectionWriterTools(input: {
  bookTitle: string
  sectionId: string
  sectionTitle: string
  allStages: Partial<Record<StageId, string>>
  linkedMaterial?: Material | null
  linkedMaterialsByKind?: Partial<Record<MaterialKind, Material[]>>
  linkedSkill?: Skill | null
  linkedSkillsByKind?: Partial<Record<SkillKind, Skill[]>>
  readAccess: WorkspaceAgentReadAccessEntry
  getDraft: () => ExpertDraft
  getRenderedSectionContent?: GetExpertDraftSectionContent
  getCurrentWorkspaceStageBody?: (stageId: StageId) => string | undefined
  syncExpertDraftSectionField?: (
    sectionId: string,
    field: ExpertDraftSectionContentField,
    body: string,
  ) => void
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
    linkedMaterialsByKind,
    readAccess,
    getDraft,
    getRenderedSectionContent,
    getCurrentWorkspaceStageBody,
    syncExpertDraftSectionField,
    updateDraft,
    onSectionBodyWritten,
    onCharacterStateWritten,
  } = input
  const readLiveStageBody = (stageId: ScriptStageId): string => {
    const live = getCurrentWorkspaceStageBody?.(stageId)
    if (live !== undefined) return live
    return allStages[stageId] ?? ''
  }
  const toolCtx = {
    bookTitle,
    stageId: 'draft' as const,
    stageBody: '',
    allStages,
    linkedMaterial: linkedMaterial ?? null,
    linkedMaterialsByKind,
    getCurrentStageBody: readLiveStageBody,
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
      buildQueryLinkedMaterialEntriesTool(
        toolCtx,
        readAccess.material as readonly MaterialKind[],
      ),
    )
  }
  readTools.push(
    buildLoadSkillTool({
      linkedSkill: input.linkedSkill,
      linkedSkillsByKind: input.linkedSkillsByKind,
      allowedSkillKinds: readAccess.skill as readonly SkillKind[] | undefined,
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
    ...buildExpertDraftSectionEditTools({
      getDraft,
      getRenderedSectionContent,
      updateDraft,
      syncExpertDraftSectionField,
      scope: 'section_writer',
      restrictToSectionId: sectionId,
      restrictToSectionTitle: sectionTitle,
      onSectionBodyWritten,
      onCharacterStateWritten,
    }),
  ]
}

async function ensureModelApiKey(model: Model<Api>): Promise<boolean> {
  const existing = await resolveWorkspaceModelApiKey(model)
  if (existing) return true
  const provider = model.provider
  const ok = await ApiKeyPromptDialog.prompt(provider)
  if (!ok) return false
  return Boolean(await resolveWorkspaceModelApiKey(model, provider))
}

export async function runExpertDraftSectionWriter(
  opts: RunExpertDraftSectionWriterOptions,
): Promise<void> {
  try {
    await ensurePiAppStorage()
    const model = opts.model ?? await resolvePreferredWorkspaceChatModel()
    const hasKey = await ensureModelApiKey(model)
    if (!hasKey) {
      opts.onError?.('分节写作未启动：缺少当前模型 API Key。')
      return
    }

    const ids = opts.sectionIds.filter((id) =>
      opts.getDraft().sections.some((section) => section.id === id),
    )
    let currentAgent: Agent | null = null
    let currentSectionId = ''
    const runStartedAt = Date.now()

    for (const [sectionIndex, sectionId] of ids.entries()) {
      if (opts.signal?.aborted) return
      const draftBefore = opts.getDraft()
      const section = draftBefore.sections.find((s) => s.id === sectionId)
      if (!section) continue
      currentSectionId = sectionId
      const systemPromptTemplate = await readWorkspaceAgentPromptTemplate(
        EXPERT_SECTION_WRITER_AGENT_ID,
        'script',
      )

      opts.updateDraft((draft) => ({
        ...draft,
        running: true,
      }))

      let sectionBodyWritten = ''
      let characterStateWritten = ''

      const systemPrompt = buildSectionWriterSystemPrompt({
        stageBody: section.body,
        workspaceStages: opts.getWorkspaceStages(),
        allowedWorkspaceStages: opts.readAccess.workspace as readonly StageId[],
        allowedMaterialKinds: opts.readAccess.material as readonly MaterialKind[],
        allowedSkillKinds: opts.readAccess.skill as readonly SkillKind[] | undefined,
        linkedMaterialsByKind: opts.linkedMaterialsByKind,
        template: systemPromptTemplate,
        linkedSkill: opts.linkedSkill,
        linkedSkillsByKind: opts.linkedSkillsByKind,
      })
      const tools = buildSectionWriterTools({
        bookTitle: opts.bookTitle,
        sectionId,
        sectionTitle: section.title,
        allStages: opts.getWorkspaceStages(),
        linkedMaterial: opts.linkedMaterial,
        linkedMaterialsByKind: opts.linkedMaterialsByKind,
        linkedSkill: opts.linkedSkill,
        linkedSkillsByKind: opts.linkedSkillsByKind,
        readAccess: opts.readAccess,
        getDraft: opts.getDraft,
        getRenderedSectionContent: opts.getRenderedExpertDraftSectionContent,
        getCurrentWorkspaceStageBody: (stageId) => {
          const live = opts.getCurrentWorkspaceStageBody?.(stageId)
          if (live !== undefined) return live
          return opts.getWorkspaceStages()[stageId]
        },
        syncExpertDraftSectionField: opts.syncExpertDraftSectionField,
        updateDraft: opts.updateDraft,
        onSectionBodyWritten: (text) => {
          sectionBodyWritten = text
        },
        onCharacterStateWritten: (text) => {
          characterStateWritten = text
        },
      })
      let agent: Agent | null = currentAgent
      if (!agent) {
        agent = new Agent({
          sessionId: createPiSessionId(
            'expert-draft-writer',
            opts.bookId,
            'script_shared',
            runStartedAt,
          ),
          convertToLlm: createMemoryAwareConvertToLlm(
            convertToLlmWithSkillAsUser,
            () => ({
              bookTitle: opts.bookTitle,
              bookType: 'script',
              bookGenre: opts.bookGenre,
              currentLocation: resolveSectionRuntimeLocation(
                opts.getDraft(),
                currentSectionId,
                'script',
              ),
              bookMemories: opts.bookMemories,
              userMemories: opts.userMemories,
            }),
          ),
          getApiKey: createWorkspaceModelApiKeyResolver(
            () => currentAgent?.state.model ?? model,
          ),
          streamFn: createWorkspaceStreamFn(),
          toolExecution: 'sequential',
          initialState: {
            systemPrompt,
            model,
            thinkingLevel:
              opts.thinkingLevel ?? getPreferredWorkspaceThinkingLevel(),
            messages: [],
            tools,
          },
        })
        currentAgent = agent
        linkAgentAbortToRunAbort(agent, opts)
      } else {
        agent.state.systemPrompt = systemPrompt
        agent.state.tools = tools
      }

      const abortCurrentAgent = () => agent.abort()
      opts.signal?.addEventListener('abort', abortCurrentAgent, { once: true })

      try {
        const userPrompt = buildSectionWriterUserPrompt({
          sectionId,
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
              updateExpertDraftSectionBody(draft, sectionId, fallback),
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
