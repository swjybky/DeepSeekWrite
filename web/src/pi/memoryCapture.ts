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

const TAG_USAGE_LABELS: Record<MemoryTag, string> = {
  general: '本书整体创作时',
  character: '设计或修改人物设定时',
  plot: '设计或调整剧情时',
  outline: '整理或修改大纲时',
  draft: '撰写或改写正文时',
  style: '处理文风、语气、叙述方式时',
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

记忆不是复述用户原话。每条记忆必须整理成两部分：
作用时机：这条要求应在什么时候被使用。
要求：可执行、可复用的创作约束。

同一个 tag 分类只能保留一条书籍记忆。若本轮要求属于已有 tag，必须 update 该 tag 已有记忆，并把旧要求与新要求整理合并成一条完整记忆；不要为同一 tag create 第二条。
如果同一轮里出现多个同类要求，也要合并为同一个 action。

如果要记录，必须优先更新已有相关书籍记忆；只有没有可合并记忆时才创建。
只输出 JSON，不要输出解释。格式：
{"actions":[{"type":"noop"}]}
或
{"actions":[{"type":"update","id":"已有记忆 id","tag":"style","content":"作用时机：撰写或修改正文文风时\n要求：保持冷静克制、少用夸张比喻。"},{"type":"create","tag":"plot","content":"作用时机：设计或调整剧情时\n要求：每个反转都要提前埋线，避免无根据强行翻盘。"}]}

tag 只能是：${MEMORY_TAGS.join(', ')}。`
}

function parseStructuredContent(content: string): {
  timing: string
  requirement: string
} {
  const text = content.trim()
  const timingMatch = text.match(/作用时机[:：]\s*([\s\S]*?)(?:\n\s*要求[:：]|$)/)
  const requirementMatch = text.match(/要求[:：]\s*([\s\S]*)/)
  return {
    timing: timingMatch?.[1]?.trim() ?? '',
    requirement: requirementMatch?.[1]?.trim() ?? text,
  }
}

function mergeTextParts(parts: string[]): string {
  const seen = new Set<string>()
  return parts
    .map((part) => part.trim().replace(/[。；;]\s*$/, ''))
    .filter((part) => {
      if (!part || seen.has(part)) return false
      seen.add(part)
      return true
    })
    .join('；')
}

function formatStructuredContent(tag: MemoryTag, content: string): string {
  const parsed = parseStructuredContent(content)
  const timing = parsed.timing || TAG_USAGE_LABELS[tag]
  const requirement = parsed.requirement || content.trim()
  return `作用时机：${timing}\n要求：${requirement}`.trim()
}

function mergeStructuredContent(
  tag: MemoryTag,
  currentContent: string,
  incomingContent: string,
): string {
  const current = parseStructuredContent(formatStructuredContent(tag, currentContent))
  const incoming = parseStructuredContent(formatStructuredContent(tag, incomingContent))
  const timing = mergeTextParts([current.timing, incoming.timing]) || TAG_USAGE_LABELS[tag]
  const requirement = mergeTextParts([current.requirement, incoming.requirement])
  return `作用时机：${timing}\n要求：${requirement}`.trim()
}

function collapseMemoriesByTag(memories: MemoryEntry[]): MemoryEntry[] {
  const byTag = new Map<MemoryTag, MemoryEntry>()
  for (const memory of normalizeMemoryEntries(memories)) {
    const tag = normalizeMemoryTag(memory.tag)
    const content = formatStructuredContent(tag, memory.content)
    const previous = byTag.get(tag)
    if (!previous) {
      byTag.set(tag, { ...memory, tag, content })
      continue
    }
    byTag.set(tag, {
      ...previous,
      content: mergeStructuredContent(tag, previous.content, content),
      updated_at: memory.updated_at || previous.updated_at,
    })
  }
  return MEMORY_TAGS.flatMap((tag) => {
    const memory = byTag.get(tag)
    return memory ? [memory] : []
  })
}

function sameMemoryList(a: MemoryEntry[], b: MemoryEntry[]): boolean {
  if (a.length !== b.length) return false
  return a.every((item, index) => {
    const other = b[index]
    return (
      other &&
      item.id === other.id &&
      item.tag === other.tag &&
      item.content === other.content
    )
  })
}

function applyActions(
  memories: MemoryEntry[],
  actions: MemoryAction[],
): MemoryEntry[] | null {
  if (actions.length === 0 || actions.every((action) => action.type === 'noop')) {
    return null
  }
  let next = collapseMemoriesByTag(memories)
  const byId = new Map(next.map((memory) => [memory.id, memory]))
  let changed = false

  for (const action of actions) {
    if (action.type === 'noop') continue
    const content = String(action.content ?? '').trim()
    if (!content) continue
    const tag = normalizeMemoryTag(action.tag)
    const structuredContent = formatStructuredContent(tag, content)
    if (action.type === 'update') {
      const id = String(action.id ?? action.memory_id ?? '').trim()
      const previous = byId.get(id) ?? next.find((memory) => memory.tag === tag)
      if (!previous) continue
      next = next.map((memory) =>
        memory.id === previous.id
          ? {
              ...memory,
              tag,
              content: structuredContent,
            }
          : memory,
      )
      byId.set(id, { ...previous, tag, content: structuredContent })
      changed = true
      continue
    }
    if (action.type === 'create') {
      const sameTag = next.find((memory) => memory.tag === tag)
      if (sameTag) {
        const mergedContent = mergeStructuredContent(
          tag,
          sameTag.content,
          structuredContent,
        )
        if (sameTag.content.trim() === mergedContent.trim()) {
          continue
        }
        next = next.map((memory) =>
          memory.id === sameTag.id
            ? {
                ...memory,
                content: mergedContent,
              }
            : memory,
        )
        byId.set(sameTag.id, { ...sameTag, content: mergedContent })
        changed = true
        continue
      }
      next.push({
        id: crypto.randomUUID(),
        tag,
        content: structuredContent,
      })
      changed = true
    }
  }

  const collapsed = collapseMemoriesByTag(next)
  const normalizedOriginal = collapseMemoriesByTag(memories)
  if (!changed && sameMemoryList(collapsed, normalizedOriginal)) return null
  if (sameMemoryList(collapsed, normalizedOriginal)) return null
  return collapsed
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
        '你是 DeepWrite 的创作记忆整理器。你只维护当前书籍记忆，不维护用户记忆。你必须只输出合法 JSON。',
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
