import type { Api, Model } from '@mariozechner/pi-ai'
import type { Agent, ThinkingLevel } from '@mariozechner/pi-agent-core'

import { resolveWorkspaceChatModel } from './resolveWorkspaceChatModel'

type WorkspaceChatPreferences = {
  model: Model<Api> | null
  thinkingLevel: ThinkingLevel
}

type PreferenceListener = (prefs: WorkspaceChatPreferences) => void

const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'high'

let preferredModel: Model<Api> | null = null
let preferredThinkingLevel: ThinkingLevel = DEFAULT_THINKING_LEVEL
const listeners = new Set<PreferenceListener>()
const boundStates = new WeakSet<object>()

function sameModel(
  a: Model<Api> | null | undefined,
  b: Model<Api> | null | undefined,
) {
  return a?.provider === b?.provider && a?.id === b?.id
}

function snapshot(): WorkspaceChatPreferences {
  return {
    model: preferredModel,
    thinkingLevel: preferredThinkingLevel,
  }
}

function emitPreferenceChange() {
  const prefs = snapshot()
  listeners.forEach((listener) => listener(prefs))
}

function setPreferredModel(model: Model<Api>) {
  if (sameModel(preferredModel, model)) return
  preferredModel = model
  emitPreferenceChange()
}

function setPreferredThinkingLevel(level: ThinkingLevel) {
  if (preferredThinkingLevel === level) return
  preferredThinkingLevel = level
  emitPreferenceChange()
}

function installPreferenceAccessors(agent: Agent) {
  const state = agent.state
  if (boundStates.has(state)) return
  boundStates.add(state)

  let currentModel = state.model as Model<Api>
  let currentThinkingLevel = state.thinkingLevel

  Object.defineProperty(state, 'model', {
    configurable: true,
    enumerable: true,
    get: () => currentModel,
    set: (next: Model<Api>) => {
      currentModel = next
      setPreferredModel(next)
    },
  })

  Object.defineProperty(state, 'thinkingLevel', {
    configurable: true,
    enumerable: true,
    get: () => currentThinkingLevel,
    set: (next: ThinkingLevel) => {
      currentThinkingLevel = next
      setPreferredThinkingLevel(next)
    },
  })
}

export async function resolvePreferredWorkspaceChatModel(): Promise<Model<Api>> {
  if (preferredModel) return preferredModel
  const model = await resolveWorkspaceChatModel()
  preferredModel = model
  return model
}

export async function refreshPreferredWorkspaceChatModel(): Promise<void> {
  preferredModel = await resolveWorkspaceChatModel()
  emitPreferenceChange()
}

export function getPreferredWorkspaceThinkingLevel(): ThinkingLevel {
  return preferredThinkingLevel
}

export function bindWorkspaceChatPreferences(
  agent: Agent,
  onApplied?: () => void,
): () => void {
  installPreferenceAccessors(agent)

  if (!preferredModel) {
    preferredModel = agent.state.model as Model<Api>
  }

  const applyPreferences = (prefs: WorkspaceChatPreferences) => {
    if (prefs.model && !sameModel(agent.state.model, prefs.model)) {
      agent.state.model = prefs.model
    }
    if (agent.state.thinkingLevel !== prefs.thinkingLevel) {
      agent.state.thinkingLevel = prefs.thinkingLevel
    }
    onApplied?.()
  }

  applyPreferences(snapshot())
  listeners.add(applyPreferences)
  return () => listeners.delete(applyPreferences)
}
