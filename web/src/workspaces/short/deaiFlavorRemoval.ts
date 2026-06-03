import { Agent } from '@mariozechner/pi-agent-core'
import type { AgentMessage, AgentTool } from '@mariozechner/pi-agent-core'
import { ApiKeyPromptDialog } from '@mariozechner/pi-web-ui'
import { Type } from 'typebox'

import {
  readDeaiFlavorRemovalPromptTemplate,
  type PromptKind,
  type StageId,
} from '../../bridge'
import type { ApplyToStageEditorPayload } from '../../pi/workspaceStageAgents'
import { resolveWorkspaceProviderApiKey } from '../../pi/resolveWorkspaceChatModel'
import { createPiSessionId } from '../../pi/sessionId'
import { ensurePiAppStorage } from '../../pi/setupPiWorkspace'
import {
  getPreferredWorkspaceThinkingLevel,
  resolvePreferredWorkspaceChatModel,
} from '../../pi/workspaceChatPreferences'
import { renderPromptFromTemplateRaw } from '../../prompt/renderTemplate'
import { defineTool, textBlock } from '../shared/piToolkit'

export const DEAI_WRITE_TOOL_NAME = 'write_deai_editor'

export type RunDeaiFlavorRemovalOptions = {
  bookId: string
  bookTitle: string
  promptKind: PromptKind
  /** 待去 AI 味的正文 */
  stageBody: string
  /** 用于 {{OTHER_STAGES_EXCERPT}} 等占位符（可选） */
  stageId?: StageId
  allStages?: Partial<Record<StageId, string>>
  /** 流式写入中间栏编辑区（与右侧 AI「写入编辑区」一致） */
  applyToEditor?: (payload: ApplyToStageEditorPayload) => void
  signal?: AbortSignal
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

function cleanDeaiOutput(raw: string): string {
  let text = raw.trim()
  const fence = text.match(/```(?:text|markdown|md)?\s*([\s\S]*?)```/i)
  if (fence?.[1]?.trim()) text = fence[1].trim()
  const marker = text.match(/(?:改写后|润色后|正文)[:：]\s*([\s\S]+)/)
  if (marker?.[1]?.trim() && marker[1].trim().length > 40) {
    text = marker[1].trim()
  }
  return text
    .replace(/^\s*#+\s*.*$/gm, '')
    .replace(/^\s*(?:以下是|下面是|改写如下).*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractDeaiResult(messages: AgentMessage[]): string {
  for (const message of [...messages].reverse()) {
    const text = cleanDeaiOutput(messageText(message))
    if (text.length >= 8) return text
  }
  return ''
}

function buildDeaiWriteTool(
  applyToEditor: (payload: ApplyToStageEditorPayload) => void,
  isToolCallStreamed: (toolCallId: string) => boolean,
): AgentTool {
  return defineTool({
    name: DEAI_WRITE_TOOL_NAME,
    label: '写入编辑区',
    description:
      '将去 AI 味后的完整正文写入当前编辑框。必须使用 mode=replace，text 为改写后的全文；不要向用户解释。',
    parameters: Type.Object({
      text: Type.String({ description: '改写后的完整正文' }),
      mode: Type.Union([Type.Literal('replace'), Type.Literal('append')], {
        description: '固定使用 replace',
      }),
    }),
    execute: async (toolCallId, { text, mode }) => {
      if (isToolCallStreamed(toolCallId)) {
        return textBlock('已写入编辑区。')
      }
      const t = text.trim()
      if (!t) return textBlock('未写入：正文为空。')
      applyToEditor({ text: t, mode: mode === 'append' ? 'append' : 'replace' })
      return textBlock('已写入编辑区。')
    },
  })
}

function subscribeDeaiStreamingWrite(
  agent: Agent,
  apply: (payload: ApplyToStageEditorPayload) => void,
): { unsubscribe: () => void; hadStreamedWrite: () => boolean } {
  const streamedToolCallIds = new Set<string>()
  let streamingWrite: {
    toolCallId: string
    accumulatedText: string
    hasCleared: boolean
  } | null = null

  const unsubscribe = agent.subscribe((ev) => {
    if (ev.type === 'message_start') {
      if (ev.message.role === 'assistant') {
        streamedToolCallIds.clear()
        streamingWrite = null
      }
    }

    if (ev.type === 'message_update') {
      const ame = ev.assistantMessageEvent

      if (ame.type === 'toolcall_start') {
        const block = ame.partial.content[ame.contentIndex]
        if (block?.type === 'toolCall' && block.name === DEAI_WRITE_TOOL_NAME) {
          streamingWrite = {
            toolCallId: block.id,
            accumulatedText: '',
            hasCleared: false,
          }
        }
      }

      if (ame.type === 'toolcall_delta') {
        const block = ame.partial.content[ame.contentIndex]
        if (
          block?.type === 'toolCall' &&
          streamingWrite &&
          block.id === streamingWrite.toolCallId
        ) {
          const args = (block.arguments || {}) as Record<string, unknown>
          const text = String(args.text ?? '')
          const mode = (args.mode as 'replace' | 'append') || 'replace'

          if (mode === 'replace' && !streamingWrite.hasCleared) {
            streamingWrite.hasCleared = true
            streamingWrite.accumulatedText = ''
            apply({ text: '', mode: 'replace' })
          }

          const prev = streamingWrite.accumulatedText
          if (text.length > prev.length && text.startsWith(prev)) {
            const delta = text.slice(prev.length)
            streamingWrite.accumulatedText = text
            apply({ text: delta, mode: 'append_token' })
          } else if (text !== prev) {
            streamingWrite.accumulatedText = text
            apply({ text, mode: 'replace' })
          }
        }
      }

      if (ame.type === 'toolcall_end') {
        const tc = ame.toolCall
        if (
          tc &&
          streamingWrite &&
          tc.id === streamingWrite.toolCallId
        ) {
          streamedToolCallIds.add(tc.id)
          streamingWrite = null
          apply({ text: '', mode: 'streaming_end' })
        }
      }
    }

    if (ev.type === 'message_end') {
      if (streamingWrite) {
        streamedToolCallIds.add(streamingWrite.toolCallId)
        streamingWrite = null
        apply({ text: '', mode: 'streaming_end' })
      }
    }
  })

  return {
    unsubscribe,
    hadStreamedWrite: () => streamedToolCallIds.size > 0,
  }
}

async function ensureModelApiKey(provider: string): Promise<boolean> {
  const existing = await resolveWorkspaceProviderApiKey(provider)
  if (existing) return true
  const ok = await ApiKeyPromptDialog.prompt(provider)
  if (!ok) return false
  return Boolean(await resolveWorkspaceProviderApiKey(provider))
}

export async function runDeaiFlavorRemoval(
  opts: RunDeaiFlavorRemovalOptions,
): Promise<
  | { ok: true; streamed: boolean; text?: string }
  | { ok: false; error: string }
> {
  const input = opts.stageBody.trim()
  if (!input) {
    return { ok: false, error: '当前编辑框为空，无需处理。' }
  }

  try {
    await ensurePiAppStorage()
    const model = await resolvePreferredWorkspaceChatModel()
    const hasKey = await ensureModelApiKey(model.provider)
    if (!hasKey) {
      return { ok: false, error: '去 AI 味未执行：缺少当前模型 API Key。' }
    }

    const template = await readDeaiFlavorRemovalPromptTemplate(opts.promptKind)
    const stageId = opts.stageId ?? 'draft'
    const systemPrompt = renderPromptFromTemplateRaw(template, {
      bookTitle: opts.bookTitle,
      stageBody: input,
      promptKind: opts.promptKind,
      stageId,
      allStages: opts.allStages ?? {},
    })

    const streamedToolCallIds = new Set<string>()
    const apply = opts.applyToEditor
    const tools: AgentTool[] = apply
      ? [
          buildDeaiWriteTool(apply, (id) => streamedToolCallIds.has(id)),
        ]
      : []

    const agent = new Agent({
      sessionId: createPiSessionId(
        'deai-flavor-removal',
        opts.bookId,
        stageId,
        Date.now(),
      ),
      getApiKey: resolveWorkspaceProviderApiKey,
      toolExecution: 'sequential',
      initialState: {
        systemPrompt,
        model,
        thinkingLevel: getPreferredWorkspaceThinkingLevel(),
        messages: [],
        tools,
      },
    })

    const streamSub = apply
      ? subscribeDeaiStreamingWrite(agent, apply)
      : null

    const abort = () => agent.abort()
    opts.signal?.addEventListener('abort', abort, { once: true })

    try {
      const userPrompt = apply
        ? '请严格按系统提示处理「待改写文本」。不要输出解释或闲聊；必须调用 write_deai_editor（mode 为 replace），在 text 中写入改写后的完整正文。'
        : '请严格按系统提示处理「待改写文本」，只输出改写后的全文，不要任何解释。'

      await agent.prompt(userPrompt)
      if (opts.signal?.aborted) {
        return { ok: false, error: '已取消去 AI 味。' }
      }

      const streamed = streamSub?.hadStreamedWrite() ?? false
      if (streamed) {
        return { ok: true, streamed: true }
      }

      const text = extractDeaiResult(agent.state.messages)
      if (!text) {
        return { ok: false, error: '模型未返回可用正文，请重试或检查提示词。' }
      }
      return { ok: true, streamed: false, text }
    } finally {
      opts.signal?.removeEventListener('abort', abort)
      streamSub?.unsubscribe()
      agent.abort()
    }
  } catch (e) {
    if (opts.signal?.aborted) {
      return { ok: false, error: '已取消去 AI 味。' }
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : '去 AI 味处理失败',
    }
  }
}
