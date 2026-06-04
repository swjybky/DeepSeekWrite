import { getModel } from '@mariozechner/pi-ai'
import type { Api, KnownProvider, Model } from '@mariozechner/pi-ai'
import { getAppStorage } from '@mariozechner/pi-web-ui'

import type { AiModelConfig, AiModelDefaults } from '../bridge'
import { getAiModelDefaults } from '../bridge'
import '../components/WorkspaceModelDialog.css'

type ResolvedModelConfig = AiModelConfig & {
  model: Model<Api>
}

type CustomProviderStoreApi =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function coerceBoolean(value: unknown): boolean | undefined {
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

function inferReasoningSupport(modelId: string, api: string): boolean {
  if (api !== 'openai-responses') return false
  const normalized = modelId.trim().toLowerCase()
  return /^(gpt-5|o[134]|gpt-oss|codex)/.test(normalized)
}

function canStoreCustomProvider(api: Api): api is CustomProviderStoreApi {
  return (
    api === 'openai-completions' ||
    api === 'openai-responses' ||
    api === 'anthropic-messages'
  )
}

function coerceModelConfig(raw: unknown): AiModelConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = trimString(o.id)
  const provider = trimString(o.provider)
  const model_id = trimString(o.model_id ?? o.modelId)
  const api_key = trimString(o.api_key ?? o.apiKey)
  const label = trimString(o.label) || id
  const base_url = trimString(o.base_url ?? o.baseUrl)
  const api = trimString(o.api ?? o.model_like ?? o.modelLike)
  const reasoning = coerceBoolean(o.reasoning ?? o.model_reasoning ?? o.modelReasoning)
  const stream = coerceBoolean(o.stream ?? o.model_stream ?? o.modelStream)
  if (!id || !provider || !model_id || !api_key) return null
  const out: AiModelConfig = { id, label, provider, model_id, api_key }
  if (base_url) out.base_url = base_url
  if (api) out.api = api
  if (reasoning !== undefined) out.reasoning = reasoning
  if (stream !== undefined) out.stream = stream
  return out
}

function coerceDefaults(raw: unknown): AiModelDefaults | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const provider = trimString(o.provider)
  const model_id = trimString(o.model_id ?? o.modelId)
  const api_key = trimString(o.api_key ?? o.apiKey)
  const default_model_id = trimString(o.default_model_id ?? o.defaultModelId)
  const modelsRaw = Array.isArray(o.models) ? o.models : []
  const models = modelsRaw
    .map((item) => coerceModelConfig(item))
    .filter((item): item is AiModelConfig => Boolean(item))

  if (models.length > 0) {
    const first = models[0]
    const out: AiModelDefaults = {
      provider: first.provider,
      model_id: first.model_id,
      api_key: first.api_key,
      models,
    }
    if (default_model_id) out.default_model_id = default_model_id
    return out
  }

  if (!provider || !model_id || !api_key) return null
  return { provider, model_id, api_key }
}

async function loadDefaults(): Promise<AiModelDefaults | null> {
  return coerceDefaults(await getAiModelDefaults())
}

function resolveModel(provider: string, modelId: string): Model<Api> | null {
  return getModel(provider as KnownProvider, modelId as never) ?? null
}

function createOwnerModel(config: AiModelConfig): Model<Api> {
  const api = (config.api || 'openai-completions') as Api
  return {
    id: config.model_id,
    name: config.label || config.model_id,
    api,
    provider: config.id,
    baseUrl: config.base_url!,
    reasoning: config.reasoning ?? inferReasoningSupport(config.model_id, api),
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
  }
}

async function syncOwnerModelsToCustomProvidersStore(
  configs: AiModelConfig[],
): Promise<void> {
  const storage = getAppStorage()
  try {
    const existing = await storage.customProviders.getAll()
    for (const p of existing) {
      if (p.id.startsWith('writeclaw-owner-')) {
        await storage.customProviders.delete(p.id)
      }
    }
  } catch {
    // ignore cleanup errors
  }
  for (const config of configs) {
    if (!config.base_url) continue
    const api = (config.api || 'openai-completions') as Api
    if (!canStoreCustomProvider(api)) continue
    const providerId = `writeclaw-owner-${config.id}`
    const model = createOwnerModel(config)
    await storage.customProviders.set({
      id: providerId,
      name: config.id,
      type: api,
      baseUrl: config.base_url,
      apiKey: config.api_key,
      models: [model],
    })
  }
}

async function writeConfiguredKeys(configs: AiModelConfig[]): Promise<void> {
  for (const config of configs) {
    const keyProvider = config.base_url ? config.id : config.provider
    await getAppStorage().providerKeys.set(keyProvider, config.api_key)
  }
}

async function loadConfiguredModels(): Promise<{
  defaults: AiModelDefaults
  configs: ResolvedModelConfig[]
} | null> {
  const defaults = await loadDefaults()
  if (!defaults?.models?.length) return null

  const ownerConfigs = defaults.models.filter((c) => c.base_url)
  if (ownerConfigs.length) {
    await syncOwnerModelsToCustomProvidersStore(ownerConfigs)
  }

  const configs: ResolvedModelConfig[] = []
  for (const config of defaults.models) {
    if (config.base_url) {
      configs.push({ ...config, model: createOwnerModel(config) })
    } else {
      const model = resolveModel(config.provider, config.model_id)
      if (!model) continue
      configs.push({ ...config, model })
    }
  }
  if (!configs.length) return null
  await writeConfiguredKeys(configs)
  return { defaults, configs }
}

function pickDefaultConfig(
  configs: ResolvedModelConfig[],
  defaultModelId?: string,
): ResolvedModelConfig {
  if (!defaultModelId) return configs[0]
  return configs.find((config) => config.id === defaultModelId) ?? configs[0]
}

/**
 * 获取 provider API Key。固定模型列表存在时只从本地模型配置注入；
 * 旧格式或浏览器开发模式下仍兼容 Pi IndexedDB 中的 provider key。
 */
export async function resolveWorkspaceProviderApiKey(
  provider: string,
): Promise<string | undefined> {
  const p = provider.trim()
  try {
    const configured = await loadConfiguredModels()
    const match = configured?.configs.find(
      (config) =>
        config.provider.toLowerCase() === p.toLowerCase() ||
        config.id.toLowerCase() === p.toLowerCase(),
    )
    if (match?.api_key.trim()) return match.api_key.trim()
  } catch {
    // fall through to the legacy store lookup
  }

  const fromStore = await getAppStorage().providerKeys.get(p)
  if (fromStore?.trim()) return fromStore.trim()
  try {
    const d = await loadDefaults()
    if (
      !d?.api_key?.trim() ||
      d.provider.trim().toLowerCase() !== p.toLowerCase()
    ) {
      return undefined
    }
    await getAppStorage().providerKeys.set(d.provider, d.api_key.trim())
    return d.api_key.trim()
  } catch {
    return undefined
  }
}

/**
 * 桌面端：从 Python 读取本地固定模型配置，写入 Pi 的 provider API Key，
 * 并解析默认 Model。浏览器开发或未配置时回退 openai / gpt-4o-mini。
 */
export async function resolveWorkspaceChatModel(): Promise<Model<Api>> {
  const fallback = getModel('openai', 'gpt-4o-mini')
  try {
    const configured = await loadConfiguredModels()
    if (configured) {
      return pickDefaultConfig(
        configured.configs,
        configured.defaults.default_model_id,
      ).model
    }

    const d = await loadDefaults()
    if (!d) return fallback
    await getAppStorage().providerKeys.set(d.provider, d.api_key)
    return resolveModel(d.provider, d.model_id) ?? fallback
  } catch {
    return fallback
  }
}

const PROVIDER_CATEGORY_LABELS: Record<string, string> = {
  deepseek: 'DeepSeek',
  xiaomi: '小米 MiMo',
  openai: 'OpenAI',
  google: 'Google Gemini',
  zai: '智谱 GLM',
  'moonshotai-cn': 'Kimi',
  moonshot: 'Kimi',
  anthropic: 'Anthropic',
}

const PROVIDER_GROUP_ORDER = [
  'deepseek',
  'xiaomi',
  'openai',
  'google',
  'zai',
  'moonshotai-cn',
  'moonshot',
  'anthropic',
]

function providerCategoryLabel(provider: string): string {
  const key = provider.trim().toLowerCase()
  if (PROVIDER_CATEGORY_LABELS[key]) return PROVIDER_CATEGORY_LABELS[key]
  if (!key) return '其他'
  return key.charAt(0).toUpperCase() + key.slice(1)
}

function groupConfigsByProvider(
  configs: ResolvedModelConfig[],
): { provider: string; label: string; items: { config: ResolvedModelConfig; index: number }[] }[] {
  const buckets = new Map<string, { config: ResolvedModelConfig; index: number }[]>()
  configs.forEach((config, index) => {
    const key = config.provider.trim().toLowerCase() || 'other'
    const list = buckets.get(key) ?? []
    list.push({ config, index })
    buckets.set(key, list)
  })

  const orderedKeys = [
    ...PROVIDER_GROUP_ORDER.filter((key) => buckets.has(key)),
    ...[...buckets.keys()]
      .filter((key) => !PROVIDER_GROUP_ORDER.includes(key))
      .sort((a, b) => providerCategoryLabel(a).localeCompare(providerCategoryLabel(b), 'zh')),
  ]

  return orderedKeys.map((provider) => ({
    provider,
    label: providerCategoryLabel(provider),
    items: buckets.get(provider) ?? [],
  }))
}

function createModelDialogItem(
  config: ResolvedModelConfig,
  index: number,
  currentIndex: number,
  onSelect: (config: ResolvedModelConfig) => void,
): HTMLButtonElement {
  const item = document.createElement('button')
  item.type = 'button'
  item.className = 'wc-model-dialog-item'
  if (index === currentIndex) {
    item.classList.add('wc-model-dialog-item--active')
    item.setAttribute('aria-current', 'true')
  }

  const name = document.createElement('span')
  name.className = 'wc-model-dialog-item-name'
  name.textContent = config.label

  const meta = document.createElement('span')
  meta.className = 'wc-model-dialog-item-meta'
  meta.textContent = config.model_id

  const badge = document.createElement('span')
  badge.className = 'wc-model-dialog-item-badge'
  badge.textContent = index === currentIndex ? '当前' : '选用'

  item.append(name, meta, badge)
  item.addEventListener('click', () => onSelect(config))
  return item
}

/**
 * 仅展示本地声明的固定模型配置。未配置固定列表时返回 false，
 * 调用方可继续使用 Pi 默认模型选择器。
 */
export async function openWorkspaceConfiguredModelSelector(
  currentModel: Model<Api> | null,
  onSelect: (model: Model<Api>) => void,
): Promise<boolean> {
  const configured = await loadConfiguredModels()
  if (!configured) return false

  const currentIndex = configured.configs.findIndex(
    (config) =>
      config.model.provider === currentModel?.provider &&
      config.model.id === currentModel?.id,
  )
  return new Promise<boolean>((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'wc-model-dialog-backdrop'
    overlay.setAttribute('role', 'presentation')

    const dialog = document.createElement('section')
    dialog.className = 'wc-model-dialog'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.setAttribute('aria-labelledby', 'wc-model-dialog-title')

    const header = document.createElement('header')
    header.className = 'wc-model-dialog-header'

    const title = document.createElement('h2')
    title.id = 'wc-model-dialog-title'
    title.textContent = '选择 AI 模型'

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'wc-model-dialog-close'
    close.setAttribute('aria-label', '关闭模型选择')
    close.textContent = '×'

    const body = document.createElement('div')
    body.className = 'wc-model-dialog-body'

    const cleanup = () => {
      document.removeEventListener('keydown', onKeyDown)
      overlay.remove()
      resolve(true)
    }

    const selectModel = (config: ResolvedModelConfig) => {
      onSelect(config.model)
      cleanup()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        cleanup()
      }
    }

    for (const group of groupConfigsByProvider(configured.configs)) {
      const section = document.createElement('section')
      section.className = 'wc-model-dialog-group'

      const groupTitle = document.createElement('h3')
      groupTitle.className = 'wc-model-dialog-group-title'
      groupTitle.textContent = group.label

      const list = document.createElement('div')
      list.className = 'wc-model-dialog-list'

      for (const { config, index } of group.items) {
        list.appendChild(
          createModelDialogItem(config, index, currentIndex, selectModel),
        )
      }

      section.append(groupTitle, list)
      body.appendChild(section)
    }

    close.addEventListener('click', cleanup)
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) cleanup()
    })
    document.addEventListener('keydown', onKeyDown)

    header.append(title, close)
    dialog.append(header, body)
    overlay.appendChild(dialog)
    document.body.appendChild(overlay)

    requestAnimationFrame(() => {
      const active =
        body.querySelector<HTMLElement>('.wc-model-dialog-item--active') ??
        body.querySelector<HTMLElement>('.wc-model-dialog-item')
      active?.focus()
    })
  })
}
