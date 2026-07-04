import type { BookType, MemoryEntry, MemoryTag } from '../domain/workspaceCore'
import {
  normalizeMemoryEntries,
  normalizeMemoryTag,
} from '../domain/workspaceCore'
import { getBridgeApi, resetBridgeApiCache } from './runtime'
import type { BridgeApi } from './runtime'
import {
  mockGetBookMemories,
  mockSetBookMemories,
} from './mockStore'

type BridgeApiRoot = NonNullable<BridgeApi>

const USER_MEMORY_STORAGE_KEY = 'deepseekwrite_dev_user_memories'

async function callApiMethod<T>(
  methodName: keyof BridgeApiRoot,
  invoke: (api: BridgeApiRoot) => Promise<T>,
): Promise<T | undefined> {
  const api = await getBridgeApi()
  if (api && typeof (api as Record<string, unknown>)[methodName] === 'function') {
    return await invoke(api)
  }
  if (api) {
    resetBridgeApiCache()
    const retryApi = await getBridgeApi()
    if (
      retryApi &&
      typeof (retryApi as Record<string, unknown>)[methodName] === 'function'
    ) {
      return await invoke(retryApi)
    }
  }
  return undefined
}

function normalizeMemoryType(
  raw: BookType | string | null | undefined,
): 'short' | 'long' | 'script' {
  if (raw === 'script') return 'script'
  if (raw === 'long') return 'long'
  return 'short'
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function stampMemoryEntries(
  entries: MemoryEntry[],
  previous: MemoryEntry[] = [],
): MemoryEntry[] {
  const previousById = new Map(previous.map((item) => [item.id, item]))
  const seenIds = new Set<string>()
  const seenContent = new Set<string>()
  const now = nowIso()
  const out: MemoryEntry[] = []
  for (const entry of normalizeMemoryEntries(entries)) {
    let id = entry.id
    if (seenIds.has(id)) id = crypto.randomUUID()
    const tag = normalizeMemoryTag(entry.tag)
    const content = entry.content.trim()
    const contentKey = `${tag}\n${content}`
    if (seenContent.has(contentKey)) continue
    const prev = previousById.get(id)
    const changed = !prev || prev.tag !== tag || prev.content !== content
    out.push({
      id,
      tag,
      content,
      created_at: entry.created_at || prev?.created_at || now,
      updated_at: changed ? now : entry.updated_at || prev?.updated_at || now,
    })
    seenIds.add(id)
    seenContent.add(contentKey)
  }
  return out
}

function readMockUserMemoryPayload(): Record<'short' | 'long' | 'script', MemoryEntry[]> {
  try {
    const raw = localStorage.getItem(USER_MEMORY_STORAGE_KEY)
    if (!raw) return { short: [], long: [], script: [] }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      short: normalizeMemoryEntries(parsed.short),
      long: normalizeMemoryEntries(parsed.long),
      script: normalizeMemoryEntries(parsed.script),
    }
  } catch {
    return { short: [], long: [], script: [] }
  }
}

function writeMockUserMemoryPayload(
  payload: Record<'short' | 'long' | 'script', MemoryEntry[]>,
) {
  localStorage.setItem(USER_MEMORY_STORAGE_KEY, JSON.stringify(payload))
}

export async function getUserMemories(
  workspaceType: BookType | string,
): Promise<MemoryEntry[]> {
  const type = normalizeMemoryType(workspaceType)
  const raw = await callApiMethod('get_user_memories', (api) =>
    api.get_user_memories(type),
  )
  if (raw !== undefined) return normalizeMemoryEntries(raw)
  return readMockUserMemoryPayload()[type]
}

export async function saveUserMemories(
  workspaceType: BookType | string,
  memories: MemoryEntry[],
): Promise<MemoryEntry[]> {
  const type = normalizeMemoryType(workspaceType)
  const previous = await getUserMemories(type)
  const stamped = stampMemoryEntries(memories, previous)
  const raw = await callApiMethod('set_user_memories', (api) =>
    api.set_user_memories(type, stamped),
  )
  if (raw !== undefined) return normalizeMemoryEntries(raw)
  const payload = readMockUserMemoryPayload()
  payload[type] = stamped
  writeMockUserMemoryPayload(payload)
  return stamped
}

export async function getBookMemories(bookId: string): Promise<MemoryEntry[]> {
  const raw = await callApiMethod('get_book_memories', (api) =>
    api.get_book_memories(bookId),
  )
  if (raw !== undefined) return normalizeMemoryEntries(raw)
  return normalizeMemoryEntries(await mockGetBookMemories(bookId))
}

export async function saveBookMemories(
  bookId: string,
  memories: MemoryEntry[],
): Promise<MemoryEntry[]> {
  const previous = await getBookMemories(bookId)
  const stamped = stampMemoryEntries(memories, previous)
  const raw = await callApiMethod('set_book_memories', (api) =>
    api.set_book_memories(bookId, stamped),
  )
  if (raw !== undefined) return normalizeMemoryEntries(raw)
  return mockSetBookMemories(bookId, stamped)
}

export function createEmptyMemory(tag: MemoryTag = 'general'): MemoryEntry {
  const now = nowIso()
  return {
    id: crypto.randomUUID(),
    tag,
    content: '',
    created_at: now,
    updated_at: now,
  }
}

export function mergeUniqueMemories(
  base: MemoryEntry[],
  additions: MemoryEntry[],
): MemoryEntry[] {
  const normalizedBase = normalizeMemoryEntries(base)
  const normalizedAdditions = normalizeMemoryEntries(additions)
  const byId = new Map(normalizedBase.map((item, index) => [item.id, index]))
  const merged = [...normalizedBase]

  for (const addition of normalizedAdditions) {
    const existingIndex = byId.get(addition.id)
    if (existingIndex !== undefined) {
      merged[existingIndex] = {
        ...merged[existingIndex],
        tag: addition.tag,
        content: addition.content,
        updated_at: addition.updated_at,
      }
      continue
    }
    const contentKey = `${addition.tag}\n${addition.content.trim()}`
    const hasSameContent = merged.some(
      (item) => `${item.tag}\n${item.content.trim()}` === contentKey,
    )
    if (!hasSameContent) merged.push(addition)
  }

  return stampMemoryEntries(merged, normalizedBase)
}
