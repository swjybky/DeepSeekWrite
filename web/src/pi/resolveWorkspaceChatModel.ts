import { getModel } from '@earendil-works/pi-ai'
import type { Api, KnownProvider, Model } from '@earendil-works/pi-ai'
import { getAppStorage } from '@earendil-works/pi-web-ui'

import type { AiModelConfig, AiModelDefaults } from '../bridge'
import { getAiModelDefaults } from '../bridge'
import '../components/WorkspaceModelDialog.css'
import {
  withIndexedDbRetry,
  withPiStorageLock,
} from './piStorageLock'

type ResolvedModelConfig = AiModelConfig & {
  model: Model<Api>
}

const WORKSPACE_MODEL_REAL_ID_KEY = '__writeClawRealModelId'
const WORKSPACE_MODEL_CONFIG_ID_KEY = '__writeClawConfigId'

type LegacyWorkspaceDisplayModel = Model<Api> & {
  [WORKSPACE_MODEL_REAL_ID_KEY]?: string
  [WORKSPACE_MODEL_CONFIG_ID_KEY]?: string
}

const workspaceModelButtonLabels = new WeakMap<ParentNode, string>()

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
  if (!id || !provider || !model_id) return null
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

function isZaiProvider(provider: string): boolean {
  const normalized = provider.trim().toLowerCase()
  return normalized === 'zai' || normalized === 'zai-coding-cn'
}

/** 与 pi-ai 内置 zai 注册表一致：glm-4.5-air 不支持 tool_stream，4.7+/5.x 支持。 */
function inferZaiToolStream(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase()
  if (/glm-4\.5(?:-|$|\/)/.test(normalized)) return false
  return true
}

function buildZaiOwnerCompat(
  modelId: string,
): NonNullable<Model<'openai-completions'>['compat']> {
  return {
    supportsDeveloperRole: false,
    thinkingFormat: 'zai',
    zaiToolStream: inferZaiToolStream(modelId),
  }
}

function createOwnerModel(config: AiModelConfig): Model<Api> {
  const builtin = resolveModel(config.provider, config.model_id)
  const api = (config.api || builtin?.api || 'openai-completions') as Api
  const model: Model<Api> = {
    id: config.model_id,
    name: config.label || config.model_id,
    api,
    provider: config.id,
    baseUrl: config.base_url!,
    reasoning:
      config.reasoning ??
      builtin?.reasoning ??
      inferReasoningSupport(config.model_id, api),
    input: builtin?.input ?? ['text'],
    cost: builtin?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: builtin?.contextWindow ?? 128000,
    maxTokens: builtin?.maxTokens ?? 8192,
  }
  if (builtin?.thinkingLevelMap) {
    model.thinkingLevelMap = builtin.thinkingLevelMap
  }
  if (builtin?.headers) {
    model.headers = builtin.headers
  }
  if (builtin?.compat) {
    model.compat = builtin.compat
  } else if (isZaiProvider(config.provider) && api === 'openai-completions') {
    model.compat = buildZaiOwnerCompat(config.model_id)
  }
  return model
}

function applyConfiguredModelLabel(
  config: AiModelConfig,
  model: Model<Api>,
): Model<Api> {
  const displayModel = {
    ...model,
    [WORKSPACE_MODEL_CONFIG_ID_KEY]: config.id,
  } as LegacyWorkspaceDisplayModel
  const label = config.label.trim()
  if (label) displayModel.name = label
  return displayModel
}

export function toWorkspaceRequestModel(model: Model<Api>): Model<Api> {
  const displayModel = model as LegacyWorkspaceDisplayModel
  const realId = displayModel[WORKSPACE_MODEL_REAL_ID_KEY]
  if (!realId || realId === model.id) return model

  const requestModel = { ...displayModel }
  delete requestModel[WORKSPACE_MODEL_REAL_ID_KEY]
  delete requestModel[WORKSPACE_MODEL_CONFIG_ID_KEY]
  return { ...requestModel, id: realId } as Model<Api>
}

function sameConfiguredModel(
  config: ResolvedModelConfig,
  currentModel: Model<Api> | null,
): boolean {
  const current = currentModel as LegacyWorkspaceDisplayModel | null
  if (current?.[WORKSPACE_MODEL_CONFIG_ID_KEY]) {
    return config.id === current[WORKSPACE_MODEL_CONFIG_ID_KEY]
  }
  const requestModel = currentModel ? toWorkspaceRequestModel(currentModel) : null
  return (
    config.model.provider === requestModel?.provider &&
    config.model.id === requestModel?.id
  )
}

export function workspaceModelIdentity(
  model: Model<Api> | null | undefined,
): string {
  if (!model) return ''
  const current = model as LegacyWorkspaceDisplayModel
  if (current[WORKSPACE_MODEL_CONFIG_ID_KEY]) {
    return `config:${current[WORKSPACE_MODEL_CONFIG_ID_KEY]}`
  }
  const requestModel = toWorkspaceRequestModel(model)
  return `${requestModel.provider}:${requestModel.id}`
}

export function workspaceModelDisplayName(
  model: Model<Api> | null | undefined,
): string {
  return trimString(model?.name) || trimString(model?.id)
}

export function syncWorkspaceModelButtonLabel(
  root: ParentNode | null | undefined,
  model: Model<Api> | null | undefined,
): void {
  if (!root || typeof window === 'undefined' || !model) return
  const label = workspaceModelDisplayName(model)
  if (!label) return

  const requestModel = toWorkspaceRequestModel(model)
  const candidates = new Set(
    [trimString(model.id), trimString(requestModel.id)].filter(Boolean),
  )
  const previousLabel = workspaceModelButtonLabels.get(root)
  if (previousLabel && previousLabel !== label) {
    candidates.add(previousLabel)
  }
  configuredModelsCache?.configs.forEach((config) => {
    const configuredLabel = workspaceModelDisplayName(config.model)
    if (configuredLabel) candidates.add(configuredLabel)
    if (config.model.id) candidates.add(config.model.id)
    const configuredRequestModel = toWorkspaceRequestModel(config.model)
    if (configuredRequestModel.id) candidates.add(configuredRequestModel.id)
  })

  if (!candidates.size) return

  const apply = () => {
    root
      .querySelectorAll<HTMLSpanElement>('message-editor button span.ml-1')
      .forEach((span) => {
        const current = span.textContent?.trim() ?? ''
        if (candidates.has(current) && current !== label) {
          span.textContent = label
        }
      })
  }

  apply()
  window.requestAnimationFrame(apply)
  window.setTimeout(apply, 50)
  workspaceModelButtonLabels.set(root, label)
}

type ConfiguredModelsPayload = {
  defaults: AiModelDefaults
  configs: ResolvedModelConfig[]
}

let configuredModelsCache: ConfiguredModelsPayload | null | undefined
let configuredModelsInflight: Promise<ConfiguredModelsPayload | null> | null =
  null
let syncedModelConfigFingerprint = ''

function fingerprintModelDefaults(defaults: AiModelDefaults): string {
  return JSON.stringify({
    default_model_id: defaults.default_model_id ?? '',
    models: (defaults.models ?? []).map((config) => ({
      id: config.id,
      provider: config.provider,
      model_id: config.model_id,
      api_key: config.api_key,
      base_url: config.base_url ?? '',
      api: config.api ?? '',
    })),
  })
}

async function syncOwnerModelsToCustomProvidersStore(
  configs: AiModelConfig[],
): Promise<void> {
  await withIndexedDbRetry(async () => {
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
  })
}

async function writeConfiguredKeys(configs: AiModelConfig[]): Promise<void> {
  await withIndexedDbRetry(async () => {
    for (const config of configs) {
      if (!config.api_key.trim()) continue
      const keyProvider = config.base_url ? config.id : config.provider
      await getAppStorage().providerKeys.set(keyProvider, config.api_key)
    }
  })
}

async function syncConfiguredModelsToPiStorage(
  defaults: AiModelDefaults,
): Promise<void> {
  const fingerprint = fingerprintModelDefaults(defaults)
  if (fingerprint === syncedModelConfigFingerprint) return

  await withPiStorageLock(async () => {
    if (fingerprint === syncedModelConfigFingerprint) return

    const ownerConfigs = (defaults.models ?? []).filter((c) => c.base_url)
    if (ownerConfigs.length) {
      await syncOwnerModelsToCustomProvidersStore(ownerConfigs)
    }
    await writeConfiguredKeys(defaults.models ?? [])
    syncedModelConfigFingerprint = fingerprint
  })
}

async function buildConfiguredModels(
  defaults: AiModelDefaults,
): Promise<ConfiguredModelsPayload | null> {
  if (!defaults.models?.length) return null

  await syncConfiguredModelsToPiStorage(defaults)

  const configs: ResolvedModelConfig[] = []
  for (const config of defaults.models) {
    if (config.base_url) {
      configs.push({
        ...config,
        model: applyConfiguredModelLabel(config, createOwnerModel(config)),
      })
    } else {
      const model = resolveModel(config.provider, config.model_id)
      if (!model) continue
      configs.push({ ...config, model: applyConfiguredModelLabel(config, model) })
    }
  }
  if (!configs.length) return null
  return { defaults, configs }
}

async function loadConfiguredModels(): Promise<ConfiguredModelsPayload | null> {
  if (configuredModelsCache !== undefined) {
    return configuredModelsCache
  }
  if (!configuredModelsInflight) {
    configuredModelsInflight = (async () => {
      const defaults = await loadDefaults()
      if (!defaults?.models?.length) {
        configuredModelsCache = null
        return null
      }
      const payload = await buildConfiguredModels(defaults)
      configuredModelsCache = payload
      return payload
    })().finally(() => {
      configuredModelsInflight = null
    })
  }
  return configuredModelsInflight
}

/** 清空模型配置缓存，使下次重新从后端/Pi 存储加载最新配置（含 API Key）。 */
export function clearWorkspaceModelConfigCache(): void {
  configuredModelsCache = undefined
  configuredModelsInflight = null
}

/** 在首个 ChatPanel 挂载前预热模型配置，避免多面板并发写 IndexedDB。 */
export async function warmupWorkspaceModelStorage(): Promise<void> {
  await loadConfiguredModels()
}

function pickDefaultConfig(
  configs: ResolvedModelConfig[],
  defaultModelId?: string,
): ResolvedModelConfig {
  const hasKey = (config: ResolvedModelConfig) => Boolean(config.api_key.trim())
  if (defaultModelId) {
    const preferred = configs.find((config) => config.id === defaultModelId)
    if (preferred && hasKey(preferred)) return preferred
  }
  return configs.find(hasKey) ?? configs[0]
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
    await withPiStorageLock(() =>
      withIndexedDbRetry(() =>
        getAppStorage().providerKeys.set(d.provider, d.api_key.trim()),
      ),
    )
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
    await withPiStorageLock(() =>
      withIndexedDbRetry(() =>
        getAppStorage().providerKeys.set(d.provider, d.api_key),
      ),
    )
    return resolveModel(d.provider, d.model_id) ?? fallback
  } catch {
    return fallback
  }
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
  meta.textContent = `${config.provider} / ${config.model_id}`

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
    (config) => sameConfiguredModel(config, currentModel),
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

    const list = document.createElement('div')
    list.className = 'wc-model-dialog-list'

    configured.configs.forEach((config, index) => {
      list.appendChild(
        createModelDialogItem(config, index, currentIndex, selectModel),
      )
    })
    body.appendChild(list)

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
