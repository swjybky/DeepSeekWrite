const RUNTIME_INSTANCE_STORAGE_KEY = 'write_claw_pi_runtime_id'

let runtimeInstanceId: string | null = null

/**
 * 每个桌面窗口 / 浏览器标签页独立的运行时 id。
 * Pi 会把 Agent.sessionId 作为 API 的 session_id / prompt_cache_key 发送；
 * 若多窗口打开同一本书同一阶段，不含实例 id 时会撞 session，代理端可能中断先开的流。
 */
export function getPiRuntimeInstanceId(): string {
  if (runtimeInstanceId) return runtimeInstanceId
  try {
    const existing = sessionStorage.getItem(RUNTIME_INSTANCE_STORAGE_KEY)
    if (existing) {
      runtimeInstanceId = existing
      return runtimeInstanceId
    }
    const created =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    sessionStorage.setItem(RUNTIME_INSTANCE_STORAGE_KEY, created)
    runtimeInstanceId = created
    return runtimeInstanceId
  } catch {
    runtimeInstanceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    return runtimeInstanceId
  }
}

function hashSessionParts(parts: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57

  for (let i = 0; i < parts.length; i += 1) {
    const ch = parts.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }

  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909)

  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0)
  return n.toString(36)
}

function normalizeScope(scope: string): string {
  return scope
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
}

export function createPiSessionId(
  scope: string,
  ...parts: Array<number | string | null | undefined>
): string {
  const raw = [getPiRuntimeInstanceId(), scope, ...parts]
    .filter((part) => part !== null && part !== undefined && String(part) !== '')
    .map(String)
    .join(':')
  return `wc:${normalizeScope(scope) || 'chat'}:${hashSessionParts(raw)}`
}
