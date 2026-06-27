import { Agent } from '@earendil-works/pi-agent-core'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { BookType, MemoryEntry, MemoryTag } from '../domain/workspaceCore'
import {
  MEMORY_TAGS,
  normalizeMemoryEntries,
  normalizeMemoryTag,
} from '../domain/workspaceCore'
import {
  createWorkspaceModelApiKeyResolver,
} from './resolveWorkspaceChatModel'
import { createWorkspaceStreamFn } from './workspaceStreamFn'
import { ensurePiAppStorage } from './setupPiWorkspace'
import {
  getPreferredWorkspaceThinkingLevel,
  resolvePreferredWorkspaceChatModel,
} from './workspaceChatPreferences'

type MemoryAction =
  | { type: 'noop' }
  | { type: 'create'; tag?: MemoryTag | string; content?: string }
  | { type: 'update'; id?: string; memory_id?: string; tag?: MemoryTag | string; content?: string }

type CaptureInput = {
  bookId: string
  bookTitle: string
  bookType?: BookType
  messages: AgentMessage[]
  bookMemories: MemoryEntry[]
  userMemories: MemoryEntry[]
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((item) => {
      if (!item || typeof item !== 'object') return ''
      const maybe = item as { type?: unknown; text?: unknown }
      return maybe.type === 'text' && typeof maybe.text === 'string'
        ? maybe.text
        : ''
    })
    .filter(Boolean)
    .join('\n')
}

function latestUserText(messages: AgentMessage[]): string {
  for (const message of [...messages].reverse()) {
    if (!message || typeof message !== 'object') continue
    if ((message as { role?: unknown }).role !== 'user') continue
    const text = textFromContent((message as { content?: unknown }).content).trim()
    if (text) return text
  }
  return ''
}

function assistantText(messages: AgentMessage[]): string {
  for (const message of [...messages].reverse()) {
    if (!message || typeof message !== 'object') continue
    if ((message as { role?: unknown }).role !== 'assistant') continue
    const text = textFromContent((message as { content?: unknown }).content).trim()
    if (text) return text
  }
  return ''
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return (fenced?.[1] ?? trimmed).trim()
}

function parseActions(text: string): MemoryAction[] {
  try {
    const parsed = JSON.parse(stripJsonFence(text)) as unknown
    if (!parsed || typeof parsed !== 'object') return []
    const rawActions = Array.isArray((parsed as { actions?: unknown }).actions)
      ? (parsed as { actions: unknown[] }).actions
      : []
    return rawActions.filter(
      (item): item is MemoryAction =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as { type?: unknown }).type === 'string',
    )
  } catch {
    return []
  }
}

function formatExistingMemories(memories: MemoryEntry[]): string {
  if (memories.length === 0) return '[]'
  return JSON.stringify(
    memories.map((memory) => ({
      id: memory.id,
      tag: memory.tag,
      content: memory.content,
    })),
    null,
    2,
  )
}

function buildCapturePrompt(input: CaptureInput, userText: string): string {
  return `当前书籍：${input.bookTitle || '未命名'}
书籍类型：${input.bookType === 'script' ? '剧本' : '短篇'}

用户本轮消息：
${userText}

已有书籍记忆：
${formatExistingMemories(input.bookMemories)}

对应类型用户记忆（仅供判断，不允许写入）：
${formatExistingMemories(input.userMemories)}

请判断用户本轮消息是否包含应长期作用于本书创作的要求。只处理人设、剧情、大纲、正文、文风、禁忌、长期偏好等创作要求。
临时试写、一次性修改、纯提问、普通寒暄、仅要求执行当前任务的内容不要记录。

如果要记录，必须优先更新已有相关书籍记忆；只有没有可合并记忆时才创建。
只输出 JSON，不要输出解释。格式：
{"actions":[{"type":"noop"}]}
或
{"actions":[{"type":"update","id":"已有记忆 id","tag":"style","content":"更新后的完整记忆"},{"type":"create","tag":"plot","content":"新增记忆"}]}

tag 只能是：${MEMORY_TAGS.join(', ')}。`
}

function applyActions(
  memories: MemoryEntry[],
  actions: MemoryAction[],
): MemoryEntry[] | null {
  if (actions.length === 0 || actions.every((action) => action.type === 'noop')) {
    return null
  }
  const byId = new Map(memories.map((memory) => [memory.id, memory]))
  let next = [...memories]
  let changed = false

  for (const action of actions) {
    if (action.type === 'noop') continue
    const content = String(action.content ?? '').trim()
    if (!content) continue
    const tag = normalizeMemoryTag(action.tag)
    if (action.type === 'update') {
      const id = String(action.id ?? action.memory_id ?? '').trim()
      const previous = byId.get(id)
      if (!previous) continue
      next = next.map((memory) =>
        memory.id === id
          ? {
              ...memory,
              tag,
              content,
            }
          : memory,
      )
      byId.set(id, { ...previous, tag, content })
      changed = true
      continue
    }
    if (action.type === 'create') {
      if (
        next.some(
          (memory) =>
            memory.tag === tag && memory.content.trim() === content.trim(),
        )
      ) {
        continue
      }
      next.push({
        id: crypto.randomUUID(),
        tag,
        content,
      })
      changed = true
    }
  }

  return changed ? normalizeMemoryEntries(next) : null
}

export async function captureBookMemoryFromMessages(
  input: CaptureInput,
): Promise<MemoryEntry[] | null> {
  const userText = latestUserText(input.messages)
  if (!userText) return null
  await ensurePiAppStorage()
  const model = await resolvePreferredWorkspaceChatModel()
  let agent: Agent | null = null
  agent = new Agent({
    sessionId: `memory-capture-${input.bookId}-${Date.now()}`,
    getApiKey: createWorkspaceModelApiKeyResolver(() => agent?.state.model ?? model),
    streamFn: createWorkspaceStreamFn(),
    initialState: {
      systemPrompt:
        '你是 Write Claw 的创作记忆整理器。你只维护当前书籍记忆，不维护用户记忆。你必须只输出合法 JSON。',
      model,
      thinkingLevel: getPreferredWorkspaceThinkingLevel(),
      messages: [],
      tools: [],
    },
  })
  await agent.prompt(buildCapturePrompt(input, userText))
  const actions = parseActions(assistantText(agent.state.messages))
  return applyActions(input.bookMemories, actions)
}
