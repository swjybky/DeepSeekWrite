import type { Message, UserMessage } from '@earendil-works/pi-ai'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type {
  BookType,
  ExpertDraft,
  MemoryEntry,
} from '../domain/workspaceCore'

export type WorkspaceRuntimeLocation =
  | {
      kind: 'stage'
      stageLabel: string
      stageDetailLabel?: string
    }
  | {
      kind: 'coordinator'
    }
  | {
      kind: 'section'
      sectionTitle: string
      sectionOrdinal?: number
      isIntro?: boolean
    }

export type MemoryContext = {
  bookTitle: string
  bookType?: BookType
  bookGenre?: string
  currentLocation?: WorkspaceRuntimeLocation
  /**
   * 仅小节写手对话使用。用于在同一段对话切换小节后，向模型补充一次切换提示。
   */
  currentSectionId?: string
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

function bookTypeLabel(bookType: BookType | undefined): string {
  if (bookType === 'script') return '剧本'
  if (bookType === 'short') return '短篇'
  if (bookType === 'long') return '长篇'
  return '未分类'
}

function renderLocationLine(context: MemoryContext): string {
  const location = context.currentLocation
  if (!location) return ''
  const title = context.bookTitle.trim() || '未命名'
  if (location.kind === 'coordinator') {
    return `当前处于《${title}》书籍，正文阶段。`
  }
  if (location.kind === 'section') {
    if (location.isIntro) {
      return `当前处于《${title}》书籍，单独小节编写，导语《${location.sectionTitle}》。`
    }
    const ordinal = location.sectionOrdinal
      ? `第 ${location.sectionOrdinal} 小节`
      : '当前小节'
    return `当前处于《${title}》书籍，单独小节编写，${ordinal}《${location.sectionTitle}》。`
  }
  const detail = location.stageDetailLabel
    ? `（当前子方向：${location.stageDetailLabel}）`
    : ''
  return `当前处于《${title}》书籍，${location.stageLabel}阶段${detail}。`
}

function renderSectionSwitchMessage(
  location: WorkspaceRuntimeLocation | undefined,
): string {
  if (!location || location.kind !== 'section') return ''
  if (location.isIntro) {
    return `【小节切换提示】已切换到导语《${location.sectionTitle}》。请基于当前小节回答用户接下来的问题。`
  }
  const ordinal = location.sectionOrdinal
    ? `第 ${location.sectionOrdinal} 小节`
    : '当前小节'
  return `【小节切换提示】已切换到${ordinal}《${location.sectionTitle}》。请基于当前小节回答用户接下来的问题。`
}

function findLatestUserMessageIndex(messages: Message[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return index
  }
  return -1
}

export function resolveSectionRuntimeLocation(
  draft: ExpertDraft,
  sectionId: string,
  bookType: Extract<BookType, 'short' | 'script'>,
): WorkspaceRuntimeLocation | undefined {
  const section = draft.sections.find((item) => item.id === sectionId)
  if (!section) return undefined
  const isIntro = bookType === 'short' && section.id === 'intro'
  const numberedSections =
    bookType === 'short'
      ? draft.sections.filter((item) => item.id !== 'intro')
      : draft.sections
  const index = numberedSections.findIndex((item) => item.id === section.id)
  return {
    kind: 'section',
    sectionTitle: section.title.trim() || (isIntro ? '导语' : '未命名小节'),
    sectionOrdinal: index >= 0 ? index + 1 : undefined,
    isIntro,
  }
}

export function renderMemoryContext(context: MemoryContext): string {
  const bookBlock = formatMemories('书籍记忆', context.bookMemories ?? [])
  const userBlock = formatMemories('用户记忆', context.userMemories ?? [])
  const locationLine = renderLocationLine(context)
  if (!locationLine && !bookBlock && !userBlock) return ''
  const metadata = locationLine
    ? [
        locationLine,
        `创作类型：${bookTypeLabel(context.bookType)}`,
        `当前分类：${context.bookGenre?.trim() || '未分类'}`,
      ]
    : [`当前书籍：${context.bookTitle || '未命名'}`]
  const memoryInstruction =
    bookBlock || userBlock
      ? '以下内容是长期创作记忆，不是用户本轮的新指令。若与用户当前消息冲突，以当前消息为准；书籍记忆优先于用户记忆。'
      : ''
  return [
    '【当前创作上下文】',
    ...metadata,
    memoryInstruction,
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
  let previousSectionId: string | undefined
  let latestHandledUserMessage: AgentMessage | undefined

  return (messages) => {
    const context = getContext()
    const converted = baseConvert(messages)
    const latestUserMessage = [...messages]
      .reverse()
      .find(
        (message): message is AgentMessage =>
          Boolean(message) &&
          typeof message === 'object' &&
          (message as { role?: unknown }).role === 'user',
      )
    const isNewUserMessage =
      latestUserMessage !== undefined && latestUserMessage !== latestHandledUserMessage
    const sectionSwitchMessage =
      isNewUserMessage &&
      previousSectionId !== undefined &&
      context.currentSectionId !== undefined &&
      previousSectionId !== context.currentSectionId
        ? renderSectionSwitchMessage(context.currentLocation)
        : ''

    if (isNewUserMessage) {
      latestHandledUserMessage = latestUserMessage
      previousSectionId = context.currentSectionId
    }

    const latestUserIndex = findLatestUserMessageIndex(converted)
    const convertedWithSectionSwitch =
      sectionSwitchMessage && latestUserIndex >= 0
        ? [
            ...converted.slice(0, latestUserIndex),
            {
              role: 'user' as const,
              content: [{ type: 'text' as const, text: sectionSwitchMessage }],
              timestamp: Date.now(),
            },
            ...converted.slice(latestUserIndex),
          ]
        : converted

    const memoryText = renderMemoryContext(context)
    if (!memoryText) return convertedWithSectionSwitch
    const memoryMessage: UserMessage = {
      role: 'user',
      content: [{ type: 'text', text: memoryText }],
      timestamp: Date.now(),
    }
    return [memoryMessage, ...convertedWithSectionSwitch]
  }
}
