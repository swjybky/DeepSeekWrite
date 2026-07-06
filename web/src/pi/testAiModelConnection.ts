import { getModel } from '@earendil-works/pi-ai'
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
} from '@earendil-works/pi-ai'

import type { AiModelConfig } from '../bridge'
import { ensurePiAppStorage } from './setupPiWorkspace'
import { createWorkspaceStreamFn } from './workspaceStreamFn'

type TestResult = {
  ok: boolean
  message: string
}

const TEST_TIMEOUT_MS = 20_000

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function inferReasoningSupport(modelId: string, api: string): boolean {
  if (api !== 'openai-responses') return false
  return /^(gpt-5|o[134]|gpt-oss|codex)/.test(modelId.trim().toLowerCase())
}

function isZaiProvider(provider: string): boolean {
  const normalized = provider.trim().toLowerCase()
  return normalized === 'zai' || normalized === 'zai-coding-cn'
}

function inferZaiToolStream(modelId: string): boolean {
  return !/glm-4\.5(?:-|$|\/)/.test(modelId.trim().toLowerCase())
}

function buildOwnerModel(config: AiModelConfig): Model<Api> {
  const baseUrl = config.base_url
  if (!baseUrl) {
    throw new Error('请填写 API 地址')
  }
  const builtin = getModel(config.provider as never, config.model_id as never)
  const api = (config.api || builtin?.api || 'openai-completions') as Api
  const model: Model<Api> = {
    id: config.model_id,
    name: config.label || config.model_id,
    api,
    provider: config.id,
    baseUrl,
    reasoning:
      config.reasoning ??
      builtin?.reasoning ??
      inferReasoningSupport(config.model_id, api),
    input: builtin?.input ?? ['text'],
    cost: builtin?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: builtin?.contextWindow ?? 128000,
    maxTokens: builtin?.maxTokens ?? 8192,
  }
  if (builtin?.thinkingLevelMap) model.thinkingLevelMap = builtin.thinkingLevelMap
  if (builtin?.headers) model.headers = builtin.headers
  if (builtin?.compat) {
    model.compat = builtin.compat
  } else if (isZaiProvider(config.provider) && api === 'openai-completions') {
    model.compat = {
      supportsDeveloperRole: false,
      thinkingFormat: 'zai',
      zaiToolStream: inferZaiToolStream(config.model_id),
    }
  }
  return model
}

function buildRegisteredModel(config: AiModelConfig): Model<Api> {
  const model = getModel(config.provider as never, config.model_id as never)
  if (!model) {
    throw new Error('未找到该模型来源和模型名称，请填写 API 地址或检查配置')
  }
  const display = { ...model }
  const label = config.label.trim()
  if (label) display.name = label
  return display as Model<Api>
}

function normalizeModelForTest(model: AiModelConfig): AiModelConfig {
  return {
    ...model,
    id: trimString(model.id),
    label: trimString(model.label),
    provider: trimString(model.provider).toLowerCase(),
    model_id: trimString(model.model_id),
    api_key: trimString(model.api_key),
    base_url: trimString(model.base_url) || undefined,
    api: trimString(model.api) || undefined,
  }
}

function buildTestModel(config: AiModelConfig): Model<Api> {
  return config.base_url ? buildOwnerModel(config) : buildRegisteredModel(config)
}

function messageText(message: AssistantMessage): string {
  return message.content
    .map((item) => (item.type === 'text' ? item.text.trim() : ''))
    .filter(Boolean)
    .join('\n')
}

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return '测试超时，请检查网络、API 地址或模型服务状态'
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }
  if (typeof error === 'string' && error.trim()) return error.trim()
  return '联通测试失败'
}

export async function testAiTextModelConnection(
  model: AiModelConfig,
): Promise<TestResult> {
  const config = normalizeModelForTest(model)
  if (!config.id) return { ok: false, message: '请填写配置 ID' }
  if (!config.provider) return { ok: false, message: '请填写模型来源' }
  if (!config.model_id) return { ok: false, message: '请填写模型名称' }
  if (!config.api_key) return { ok: false, message: '请填写 API Key' }

  let requestModel: Model<Api>
  try {
    requestModel = buildTestModel(config)
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
  const context: Context = {
    messages: [
      {
        role: 'user',
        content: '请只回复 OK，用于联通测试。',
        timestamp: Date.now(),
      },
    ],
  }
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), TEST_TIMEOUT_MS)
  try {
    await ensurePiAppStorage()
    const streamFn = createWorkspaceStreamFn()
    const stream = await streamFn(requestModel, context, {
      apiKey: config.api_key,
      maxTokens: 16,
      temperature: 0,
      signal: controller.signal,
      timeoutMs: TEST_TIMEOUT_MS,
      maxRetries: 0,
    })
    const response = await stream.result()
    if (response.stopReason === 'error' || response.errorMessage) {
      return {
        ok: false,
        message: response.errorMessage || '模型返回错误',
      }
    }
    return { ok: true, message: messageText(response) || '成功' }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  } finally {
    window.clearTimeout(timer)
  }
}
