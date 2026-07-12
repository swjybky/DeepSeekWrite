import type { Agent } from '@earendil-works/pi-agent-core'

const agents = new Map<string, Agent>()

function registryKey(bookId: string, stageId: string): string {
  return `${bookId}::${stageId}`
}

export function registerLongLedgerChatAgent(
  bookId: string,
  stageId: string,
  agent: Agent,
): () => void {
  const key = registryKey(bookId, stageId)
  agents.set(key, agent)
  return () => {
    if (agents.get(key) === agent) agents.delete(key)
  }
}

export async function waitForLongLedgerChatAgent(
  bookId: string,
  stageId: string,
  timeoutMs = 5000,
): Promise<Agent | null> {
  const key = registryKey(bookId, stageId)
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const agent = agents.get(key)
    if (agent) return agent
    await new Promise<void>((resolve) => window.setTimeout(resolve, 25))
  }
  return null
}
