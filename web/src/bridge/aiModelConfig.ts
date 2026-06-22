/** 本地模型配置，由桌面壳 preferences.json 或浏览器 localStorage 提供。 */
export interface AiModelConfig {
  /** 配置项 ID，如 deepseekflash / kimi */
  id: string
  /** 显示名称，未配置时等于 id */
  label: string
  /** pi-ai provider，如 deepseek / moonshotai-cn；owner 模式下作为标识 */
  provider: string
  /** pi-ai model id，如 deepseek-v4-flash */
  model_id: string
  /** 该模型配置对应的 API Key */
  api_key: string
  /** 自定义 API 地址（owner 模式） */
  base_url?: string
  /** 底层 API 类型：openai-completions / openai-responses / anthropic-messages / google-generative-ai */
  api?: string
  /** 是否支持 Pi 的思考/推理等级选择器 */
  reasoning?: boolean
  /** 兼容旧 `.env` 的流式开关；当前 Pi 调用链暂不消费。 */
  stream?: boolean
}

export interface AiModelDefaults {
  provider: string
  model_id: string
  api_key: string
  /** 固定模型配置列表；存在时 AI 侧栏模型选择器只展示这些模型 */
  models?: AiModelConfig[]
  /** 默认选中的配置项 ID；未设置时使用 models[0] */
  default_model_id?: string
}

export interface ImageModelConfig {
  /** 图像模型 ID，如 dall-e-3 或服务商自定义名称 */
  model: string
  /** 图像模型 API Key */
  api_key: string
  /** 自定义图像 API 地址；未设置时后端使用默认地址 */
  base_url?: string
}

export interface AiModelSettings {
  text: {
    models: AiModelConfig[]
    default_model_id: string
  }
  image: ImageModelConfig | null
}

/** 项目内置图像模型（与 app/ai_env.py 保持一致） */
const BUILTIN_IMAGE_MODEL_DEFAULTS: ImageModelConfig = {
  model: 'gpt-image-2',
  api_key: 'sk-Q8qafUnyk8v31PR1sBYz1UEcK696foGAF4Jut4exAfTnVOEG',
  base_url: 'https://sucloud.vip',
}

/** 项目内置文字模型（与 app/ai_env.py 保持一致） */
export const BUILTIN_FREE_TEXT_MODEL_ID = 'deppseekwrite-free'

const BUILTIN_FREE_TEXT_MODEL: AiModelConfig = {
  id: BUILTIN_FREE_TEXT_MODEL_ID,
  label: 'Deepseek V4 Flash Free',
  provider: 'deepseek',
  model_id: 'deepseek-v4-flash',
  api_key: 'sk-5852a9a14b0a47af9e23a1b86c561a84',
  base_url: 'https://api.deepseek.com',
  api: 'openai-completions',
  reasoning: true,
}

const BUILTIN_TEXT_MODEL_DEFAULTS: AiModelSettings['text'] = {
  models: [BUILTIN_FREE_TEXT_MODEL],
  default_model_id: BUILTIN_FREE_TEXT_MODEL.id,
}

/** 文字模型 API Key 输入框占位提示 */
export const TEXT_MODEL_API_KEY_PLACEHOLDER =
  'deepseek官方key无需配置此项；内置免费模型已自动配置；自定义模型请填写对应 Key'
const AI_MODEL_CONFIG_STORAGE_KEY = 'write-claw:ai_model_config'

function mergeBuiltinTextDefaults(
  text: AiModelSettings['text'],
): AiModelSettings['text'] {
  const models = text.models.map((model) => ({ ...model }))
  for (const builtin of [...BUILTIN_TEXT_MODEL_DEFAULTS.models].reverse()) {
    const existingIndex = models.findIndex((model) => model.id === builtin.id)
    if (existingIndex >= 0) {
      models[existingIndex] = { ...models[existingIndex], ...builtin }
    } else {
      models.unshift({ ...builtin })
    }
  }

  const modelIds = new Set(models.map((model) => model.id))
  const selected = models.find((model) => model.id === text.default_model_id)
  const default_model_id =
    !text.default_model_id || !modelIds.has(text.default_model_id) || !selected?.api_key.trim()
      ? modelIds.has(BUILTIN_TEXT_MODEL_DEFAULTS.default_model_id)
        ? BUILTIN_TEXT_MODEL_DEFAULTS.default_model_id
        : models[0]?.id ?? ''
      : text.default_model_id

  return { models, default_model_id }
}

function applyBuiltinDefaults(settings: AiModelSettings): AiModelSettings {
  let result = {
    ...settings,
    text: mergeBuiltinTextDefaults(settings.text),
  }
  if (!result.image) {
    result = { ...result, image: { ...BUILTIN_IMAGE_MODEL_DEFAULTS } }
  }
  return result
}

export type AppearanceStyle = 'classic' | 'modern'

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeConfigId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '_')
    .replace(/^[-_]+|[-_]+$/g, '')
}

export function isBuiltinFreeTextModel(model: Pick<AiModelConfig, 'id'>): boolean {
  return normalizeConfigId(model.id) === BUILTIN_FREE_TEXT_MODEL_ID
}

function coerceAiBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'y', 'on', '支持', '开启'].includes(normalized)) {
    return true
  }
  if (['0', 'false', 'no', 'n', 'off', '不支持', '关闭'].includes(normalized)) {
    return false
  }
  return undefined
}

function normalizeAiModelEntry(raw: unknown): AiModelConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const provider = trimString(o.provider ?? o.model_source).toLowerCase()
  const model_id = trimString(o.model_id ?? o.modelId ?? o.model_name)
  const api_key = trimString(o.api_key ?? o.apiKey ?? o.model_key)
  const rawId = trimString(o.id) || model_id || provider
  const id = normalizeConfigId(rawId)
  if (!id || !provider || !model_id) return null

  const out: AiModelConfig = {
    id,
    label: trimString(o.label ?? o.display_name ?? o.title) || rawId || model_id,
    provider,
    model_id,
    api_key,
  }
  const base_url = trimString(o.base_url ?? o.baseUrl ?? o.model_url)
  const api = trimString(o.api ?? o.model_like ?? o.modelLike)
  const reasoning = coerceAiBoolean(o.reasoning ?? o.model_reasoning)
  const stream = coerceAiBoolean(o.stream ?? o.model_stream)
  if (base_url) out.base_url = base_url
  if (api) out.api = api
  if (reasoning !== undefined) out.reasoning = reasoning
  if (stream !== undefined) out.stream = stream
  return out
}

function normalizeImageModelConfig(raw: unknown): ImageModelConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const model = trimString(o.model ?? o.image_model)
  const api_key = trimString(o.api_key ?? o.apiKey ?? o.image_model_key)
  if (!model || !api_key) return null
  const out: ImageModelConfig = { model, api_key }
  const base_url = trimString(
    o.base_url ?? o.baseUrl ?? o.image_model_url ?? o.image_url ?? o.image_base_url,
  )
  if (base_url) out.base_url = base_url
  return out
}

export function normalizeAiModelSettings(raw: unknown): AiModelSettings {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const text =
    source.text && typeof source.text === 'object'
      ? (source.text as Record<string, unknown>)
      : source
  const modelsRaw = Array.isArray(text.models) ? text.models : []
  const models: AiModelConfig[] = []
  const seen = new Set<string>()
  for (const item of modelsRaw) {
    const normalized = normalizeAiModelEntry(item)
    if (!normalized) continue
    const baseId = normalized.id
    let id = baseId
    let suffix = 2
    while (seen.has(id)) {
      id = `${baseId}_${suffix}`
      suffix += 1
    }
    seen.add(id)
    models.push({ ...normalized, id })
  }
  let default_model_id = normalizeConfigId(
    trimString(
      text.default_model_id ??
        text.defaultModelId ??
        source.default_model_id ??
        source.default_model,
    ),
  )
  if (!seen.has(default_model_id)) {
    default_model_id = models[0]?.id ?? ''
  }

  return {
    text: { models, default_model_id },
    image: normalizeImageModelConfig(source.image),
  }
}

function storedAiModelConfig(): AiModelSettings {
  try {
    const raw = localStorage.getItem(AI_MODEL_CONFIG_STORAGE_KEY)
    if (!raw?.trim()) {
      return applyBuiltinDefaults(normalizeAiModelSettings(null))
    }
    return applyBuiltinDefaults(
      normalizeAiModelSettings(JSON.parse(raw) as unknown),
    )
  } catch {
    return applyBuiltinDefaults(normalizeAiModelSettings(null))
  }
}

function setStoredAiModelConfig(config: AiModelSettings): void {
  try {
    localStorage.setItem(AI_MODEL_CONFIG_STORAGE_KEY, JSON.stringify(config))
  } catch {
    /* ignore */
  }
}

import { getBridgeApi } from './runtime'

export async function getAiModelConfig(): Promise<AiModelSettings> {
  const api = await getBridgeApi()
  if (api?.get_ai_model_config) {
    try {
      const normalized = applyBuiltinDefaults(
        normalizeAiModelSettings(await api.get_ai_model_config()),
      )
      setStoredAiModelConfig(normalized)
      return normalized
    } catch {
      /* fall through */
    }
  }
  return storedAiModelConfig()
}

export async function saveAiModelConfig(
  config: AiModelSettings,
): Promise<AiModelSettings> {
  const normalized = normalizeAiModelSettings(config)
  const api = await getBridgeApi()
  if (api?.save_ai_model_config) {
    const saved = applyBuiltinDefaults(
      normalizeAiModelSettings(await api.save_ai_model_config(normalized)),
    )
    setStoredAiModelConfig(saved)
    return saved
  }
  const saved = applyBuiltinDefaults(normalized)
  setStoredAiModelConfig(saved)
  return saved
}

export async function getAiModelDefaults(): Promise<AiModelDefaults | null> {
  const settings = await getAiModelConfig()
  const models = settings.text.models
  if (!models.length) return null
  const first = models[0]
  return {
    provider: first.provider,
    model_id: first.model_id,
    api_key: first.api_key,
    models,
    default_model_id: settings.text.default_model_id,
  }
}
