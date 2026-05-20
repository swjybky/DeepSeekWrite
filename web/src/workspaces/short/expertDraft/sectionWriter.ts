import { Agent } from '@mariozechner/pi-agent-core'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { ApiKeyPromptDialog } from '@mariozechner/pi-web-ui'
import { Type } from 'typebox'

import type { ExpertDraft, PromptKind, StageId } from '../../../bridge'
import {
  resolveWorkspaceChatModel,
  resolveWorkspaceProviderApiKey,
} from '../../../pi/resolveWorkspaceChatModel'
import { ensurePiAppStorage } from '../../../pi/setupPiWorkspace'
import { defineTool, textBlock } from '../../shared/piToolkit'
import {
  buildSectionWriterSystemPrompt,
  buildSectionWriterUserPrompt,
} from './prompts'

type ExpertDraftUpdater = (updater: (draft: ExpertDraft) => ExpertDraft) => void

export type RunExpertDraftSectionWriterOptions = {
  bookId: string
  bookTitle: string
  promptKind: PromptKind
  sectionIds: string[]
  getDraft: () => ExpertDraft
  getWorkspaceStages: () => Partial<Record<StageId, string>>
  updateDraft: ExpertDraftUpdater
  signal?: AbortSignal
  onError?: (message: string) => void
  onSectionAgentStart?: (info: {
    agent: Agent
    sectionId: string
    sectionTitle: string
    sectionIndex: number
    sectionCount: number
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

function buildSectionWriterTools(input: {
  sectionId: string
  sectionTitle: string
  updateDraft: ExpertDraftUpdater
}): AgentTool[] {
  const { sectionId, sectionTitle, updateDraft } = input
  return [
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
        if (params.section_id !== sectionId) {
          return textBlock(`未写入：当前只能写入 ${sectionTitle}（${sectionId}）。`)
        }
        const text = params.text.trim()
        if (!text) return textBlock('未写入：正文为空。')
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
        if (params.section_id !== sectionId) {
          return textBlock(`未写入：当前只能写入 ${sectionTitle}（${sectionId}）。`)
        }
        const text = params.text.trim()
        if (!text) return textBlock('未写入：人物状态为空。')
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
    const model = await resolveWorkspaceChatModel()
    const hasKey = await ensureModelApiKey(model.provider)
    if (!hasKey) {
      opts.onError?.('专家模式后台写作未启动：缺少当前模型 API Key。')
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

      opts.updateDraft((draft) => ({
        ...replaceSectionBody(draft, sectionId, ''),
        running: true,
        active_section_id: sectionId,
      }))

      const agent = new Agent({
        sessionId: `write-claw:${opts.bookId}:expert-draft:writer:${sectionId}:${Date.now()}`,
        getApiKey: resolveWorkspaceProviderApiKey,
        toolExecution: 'sequential',
        initialState: {
          systemPrompt: buildSectionWriterSystemPrompt({
            bookTitle: opts.bookTitle,
            promptKind: opts.promptKind,
          }),
          model,
          thinkingLevel: 'high',
          messages: [],
          tools: buildSectionWriterTools({
            sectionId,
            sectionTitle: section.title,
            updateDraft: opts.updateDraft,
          }),
        },
      })

      agent.subscribe((event) => {
        if (event.type === 'message_end' || event.type === 'agent_end') {
          agent.state.messages = agent.state.messages.slice()
        }
      })

      const abortCurrentAgent = () => agent.abort()
      opts.signal?.addEventListener('abort', abortCurrentAgent, { once: true })

      try {
        try {
          await opts.onSectionAgentStart?.({
            agent,
            sectionId,
            sectionTitle: section.title,
            sectionIndex,
            sectionCount: ids.length,
          })
        } catch (e) {
          opts.onError?.(
            e instanceof Error
              ? `专家模式右侧子智能体展示失败：${e.message}`
              : '专家模式右侧子智能体展示失败',
          )
        }
        if (opts.signal?.aborted) return
        await agent.prompt(
          buildSectionWriterUserPrompt({
            sectionId,
            sectionTitle: section.title,
            sectionIndex,
            sectionCount: ids.length,
            stages: opts.getWorkspaceStages(),
            draft: draftBefore,
          }),
        )
      } catch (e) {
        if (opts.signal?.aborted) return
        opts.onError?.(
          e instanceof Error
            ? `专家模式后台写作失败：${e.message}`
            : '专家模式后台写作失败',
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
