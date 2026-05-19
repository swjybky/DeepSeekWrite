type LMStudioClientOptions = {
  baseUrl?: string
}

type DownloadedModel = {
  type: string
  path: string
  displayName?: string
  maxContextLength?: number
  trainedForToolUse?: boolean
  vision?: boolean
}

type LMStudioApiModel = {
  type?: unknown
  path?: unknown
  id?: unknown
  modelKey?: unknown
  name?: unknown
  displayName?: unknown
  maxContextLength?: unknown
  contextLength?: unknown
  trainedForToolUse?: unknown
  toolUse?: unknown
  vision?: unknown
}

function toHttpBaseUrl(baseUrl: string | undefined): string {
  if (!baseUrl) return 'http://localhost:1234'
  try {
    const url = new URL(baseUrl)
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
    return url.toString().replace(/\/$/, '')
  } catch {
    return 'http://localhost:1234'
  }
}

function readString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export class LMStudioClient {
  readonly system: {
    listDownloadedModels: () => Promise<DownloadedModel[]>
  }

  constructor(options: LMStudioClientOptions = {}) {
    const httpBaseUrl = toHttpBaseUrl(options.baseUrl)
    this.system = {
      listDownloadedModels: async () => {
        const response = await fetch(`${httpBaseUrl}/api/v0/models`)
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const data = await response.json()
        const models = Array.isArray(data) ? data : Array.isArray(data.data) ? data.data : []

        return models.map((model: LMStudioApiModel): DownloadedModel => {
          const path =
            readString(model.path) ||
            readString(model.id) ||
            readString(model.modelKey) ||
            readString(model.name)

          return {
            type: readString(model.type, 'llm'),
            path,
            displayName: readString(model.displayName) || readString(model.name) || readString(model.id),
            maxContextLength: readNumber(model.maxContextLength, readNumber(model.contextLength, 8192)),
            trainedForToolUse: readBoolean(model.trainedForToolUse, readBoolean(model.toolUse)),
            vision: readBoolean(model.vision),
          }
        })
      },
    }
  }
}
