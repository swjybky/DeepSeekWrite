import type { AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import { getBridgeApi } from './runtime'

const AI_CHAT_HISTORY_MOCK_KEY = 'write_claw_dev_ai_chat_history'
const MAX_SESSIONS_PER_SCOPE = 20

export type AiChatOwnerType = 'book' | 'material' | 'skill'

export type AiChatHistoryScope = {
  owner_type: AiChatOwnerType
  owner_id: string
  category_id: string
}

export type AiChatHistoryMetadata = {
  id: string
  scope: AiChatHistoryScope
  title: string
  created_at: string
  updated_at: string
  message_count: number
}

export type AiChatHistorySession = AiChatHistoryMetadata & {
  messages: AgentMessage[]
  model?: Model<Api> | null
  thinking_level?: ThinkingLevel | string
}

type RawHistoryPayload = {
  version?: unknown
  sessions?: unknown
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function normalizeAiChatHistoryScope(
  raw: Partial<AiChatHistoryScope> | null | undefined,
): AiChatHistoryScope | null {
  const ownerType = String(raw?.owner_type ?? '').trim() as AiChatOwnerType
  const ownerId = String(raw?.owner_id ?? '').trim()
  const categoryId = String(raw?.category_id ?? '').trim()
  if (!['book', 'material', 'skill'].includes(ownerType)) return null
  if (!ownerId || !categoryId) return null
  return {
    owner_type: ownerType,
    owner_id: ownerId,
    category_id: categoryId,
  }
}

function sameScope(a: AiChatHistoryScope, b: AiChatHistoryScope): boolean {
  return (
    a.owner_type === b.owner_type &&
    a.owner_id === b.owner_id &&
    a.category_id === b.category_id
  )
}

function normalizeMetadata(raw: unknown): AiChatHistoryMetadata | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>
  const scope = normalizeAiChatHistoryScope(
    data.scope as Partial<AiChatHistoryScope> | null | undefined,
  )
  const id = String(data.id ?? '').trim()
  if (!id || !scope) return null
  return {
    id,
    scope,
    title: String(data.title ?? '未命名对话'),
    created_at: String(data.created_at ?? data.createdAt ?? ''),
    updated_at: String(data.updated_at ?? data.updatedAt ?? ''),
    message_count: Number(data.message_count ?? data.messageCount ?? 0) || 0,
  }
}

function normalizeSession(raw: unknown): AiChatHistorySession | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>
  const meta = normalizeMetadata(data)
  if (!meta) return null
  const messages = Array.isArray(data.messages)
    ? (data.messages as AgentMessage[])
    : []
  return {
    ...meta,
    messages,
    model: (data.model as Model<Api> | null | undefined) ?? null,
    thinking_level: String(data.thinking_level ?? data.thinkingLevel ?? 'off'),
  }
}

function sessionMetadata(session: AiChatHistorySession): AiChatHistoryMetadata {
  return {
    id: session.id,
    scope: session.scope,
    title: session.title,
    created_at: session.created_at,
    updated_at: session.updated_at,
    message_count: session.message_count,
  }
}

function sortSessions<T extends { updated_at: string; created_at: string }>(
  sessions: T[],
): T[] {
  return sessions
    .map((session, index) => ({ session, index }))
    .sort((a, b) => {
      const byTime = (b.session.updated_at || b.session.created_at).localeCompare(
        a.session.updated_at || a.session.created_at,
      )
      return byTime || b.index - a.index
    })
    .map((item) => item.session)
}

function loadMockSessions(): AiChatHistorySession[] {
  try {
    const raw = localStorage.getItem(AI_CHAT_HISTORY_MOCK_KEY)
    if (!raw) return []
    const payload = JSON.parse(raw) as RawHistoryPayload
    const list = Array.isArray(payload.sessions) ? payload.sessions : []
    return list
      .map((item) => normalizeSession(item))
      .filter((item): item is AiChatHistorySession => Boolean(item))
  } catch {
    return []
  }
}

function saveMockSessions(sessions: AiChatHistorySession[]) {
  localStorage.setItem(
    AI_CHAT_HISTORY_MOCK_KEY,
    JSON.stringify({ version: 1, sessions }),
  )
}

function userMessageText(message: AgentMessage): string {
  if (!message || typeof message !== 'object') return ''
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return ''
      const data = block as { type?: unknown; text?: unknown }
      return data.type === 'text' ? String(data.text ?? '') : ''
    })
    .join(' ')
    .trim()
}

function titleFromMessages(messages: AgentMessage[]): string {
  for (const message of messages) {
    if (
      message &&
      typeof message === 'object' &&
      (message as { role?: unknown }).role === 'user'
    ) {
      const text = userMessageText(message)
      if (text) return text
    }
  }
  return '未命名对话'
}

function hasUserMessage(messages: AgentMessage[]): boolean {
  return messages.some(
    (message) =>
      message &&
      typeof message === 'object' &&
      (message as { role?: unknown }).role === 'user',
  )
}

function createId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export async function listAiChatSessions(
  scopeInput: AiChatHistoryScope,
): Promise<AiChatHistoryMetadata[]> {
  const scope = normalizeAiChatHistoryScope(scopeInput)
  if (!scope) return []
  const api = await getBridgeApi()
  if (api?.list_ai_chat_sessions) {
    const raw = await api.list_ai_chat_sessions(scope)
    return raw
      .map((item) => normalizeMetadata(item))
      .filter((item): item is AiChatHistoryMetadata => Boolean(item))
  }
  return sortSessions(loadMockSessions().filter((item) => sameScope(item.scope, scope)))
    .slice(0, MAX_SESSIONS_PER_SCOPE)
    .map(sessionMetadata)
}

export async function getAiChatSession(
  sessionId: string,
): Promise<AiChatHistorySession | null> {
  const id = sessionId.trim()
  if (!id) return null
  const api = await getBridgeApi()
  if (api?.get_ai_chat_session) {
    return normalizeSession(await api.get_ai_chat_session(id))
  }
  return loadMockSessions().find((item) => item.id === id) ?? null
}

export async function saveAiChatSession(
  input: {
    id?: string | null
    scope: AiChatHistoryScope
    messages: AgentMessage[]
    model?: Model<Api> | null
    thinking_level?: ThinkingLevel | string
  },
): Promise<AiChatHistorySession | null> {
  const scope = normalizeAiChatHistoryScope(input.scope)
  if (!scope || !hasUserMessage(input.messages)) return null
  const api = await getBridgeApi()
  const payload = {
    id: input.id ?? '',
    scope,
    title: titleFromMessages(input.messages),
    messages: input.messages,
    model: input.model ?? null,
    thinking_level: input.thinking_level ?? 'off',
  }
  if (api?.save_ai_chat_session) {
    return normalizeSession(await api.save_ai_chat_session(payload))
  }

  const now = nowIso()
  const sessions = loadMockSessions()
  const existing = sessions.find((item) => item.id === payload.id)
  const session: AiChatHistorySession = {
    id: existing?.id || payload.id || createId(),
    scope,
    title: payload.title,
    messages: input.messages,
    model: input.model ?? existing?.model ?? null,
    thinking_level: input.thinking_level ?? existing?.thinking_level ?? 'off',
    created_at: existing?.created_at || now,
    updated_at: now,
    message_count: input.messages.length,
  }
  const next = sessions.filter((item) => item.id !== session.id)
  next.push(session)
  const scopedKeepIds = new Set(
    sortSessions(next.filter((item) => sameScope(item.scope, scope)))
      .slice(0, MAX_SESSIONS_PER_SCOPE)
      .map((item) => item.id),
  )
  saveMockSessions(
    next.filter(
      (item) => !sameScope(item.scope, scope) || scopedKeepIds.has(item.id),
    ),
  )
  return session
}

export async function deleteAiChatSession(sessionId: string): Promise<boolean> {
  const id = sessionId.trim()
  if (!id) return false
  const api = await getBridgeApi()
  if (api?.delete_ai_chat_session) return api.delete_ai_chat_session(id)
  const sessions = loadMockSessions()
  const next = sessions.filter((item) => item.id !== id)
  saveMockSessions(next)
  return next.length !== sessions.length
}

export async function deleteAiChatSessionsForOwner(
  ownerType: AiChatOwnerType,
  ownerId: string,
): Promise<number> {
  const id = ownerId.trim()
  if (!id) return 0
  const api = await getBridgeApi()
  if (api?.delete_ai_chat_sessions_for_owner) {
    return api.delete_ai_chat_sessions_for_owner(ownerType, id)
  }
  const sessions = loadMockSessions()
  const next = sessions.filter(
    (item) => !(item.scope.owner_type === ownerType && item.scope.owner_id === id),
  )
  saveMockSessions(next)
  return sessions.length - next.length
}
