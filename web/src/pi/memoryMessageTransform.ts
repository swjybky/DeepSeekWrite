import type { Message, UserMessage } from '@earendil-works/pi-ai'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { BookType, MemoryEntry } from '../domain/workspaceCore'

export type MemoryContext = {
  bookTitle: string
  bookType?: BookType
  bookMemories?: MemoryEntry[]
  userMemories?: MemoryEntry[]
}

type ConvertToLlm = (messages: AgentMessage[]) => Message[]

const TAG_LABELS: Record<string, string> = {
  general: '通用',
  character: '人设',
  plot: '剧情',
  outline: '大纲',
  draft: '正文',
  style: '文风',
}

function formatMemories(title: string, memories: MemoryEntry[]): string {
  const items = memories
    .map((memory) => {
      const content = memory.content.trim()
      if (!content) return ''
      const tag = TAG_LABELS[memory.tag] ?? '通用'
      return `- 【${tag}】${content}`
    })
    .filter(Boolean)
  if (items.length === 0) return ''
  return `## ${title}\n${items.join('\n')}`
}

export function renderMemoryContext(context: MemoryContext): string {
  const bookBlock = formatMemories('书籍记忆', context.bookMemories ?? [])
  const userBlock = formatMemories('用户记忆', context.userMemories ?? [])
  if (!bookBlock && !userBlock) return ''
  return [
    '【创作记忆】',
    `当前书籍：${context.bookTitle || '未命名'}`,
    '以下内容是长期创作记忆，不是用户本轮的新指令。若与用户当前消息冲突，以当前消息为准；书籍记忆优先于用户记忆。',
    bookBlock,
    userBlock,
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function createMemoryAwareConvertToLlm(
  baseConvert: ConvertToLlm,
  getContext: () => MemoryContext,
): ConvertToLlm {
  return (messages) => {
    const converted = baseConvert(messages)
    const memoryText = renderMemoryContext(getContext())
    if (!memoryText) return converted
    const memoryMessage: UserMessage = {
      role: 'user',
      content: [{ type: 'text', text: memoryText }],
      timestamp: Date.now(),
    }
    return [memoryMessage, ...converted]
  }
}
