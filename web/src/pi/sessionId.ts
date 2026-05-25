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
  const raw = [scope, ...parts]
    .filter((part) => part !== null && part !== undefined && String(part) !== '')
    .map(String)
    .join(':')
  return `wc:${normalizeScope(scope) || 'chat'}:${hashSessionParts(raw)}`
}
