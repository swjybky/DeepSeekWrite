import { getModel } from '@mariozechner/pi-ai'
import type { KnownProvider, Model } from '@mariozechner/pi-ai'
import { getAppStorage } from '@mariozechner/pi-web-ui'

import type { AiModelDefaults } from '../bridge'
import { getBridgeApi } from '../bridge'

function coerceDefaults(raw: unknown): AiModelDefaults | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const provider = typeof o.provider === 'string' ? o.provider.trim() : ''
  const model_id = typeof o.model_id === 'string' ? o.model_id.trim() : ''
  const api_key = typeof o.api_key === 'string' ? o.api_key.trim() : ''
  const flashRaw = o.model_id_flash ?? o.model_idFlash
  const model_id_flash =
    typeof flashRaw === 'string' ? flashRaw.trim() : undefined
  if (!provider || !model_id || !api_key) return null
  const out: AiModelDefaults = { provider, model_id, api_key }
  if (model_id_flash) out.model_id_flash = model_id_flash
  return out
}

/**
 * 与会话侧边栏一致的密钥：`ProviderKeysStore`（Pi IndexedDB）；缺省时再接 `app/.env`。
 * pi-ai `stream(...)` 不会走 AgentLoop 里的 `getApiKey`，需在调用旁路时必须显式传入 `apiKey`。
 */
export async function resolveWorkspaceProviderApiKey(provider: string): Promise<string | undefined> {
  const p = provider.trim()
  const fromStore = await getAppStorage().providerKeys.get(p)
  if (fromStore?.trim()) return fromStore.trim()
  try {
    const api = await getBridgeApi()
    if (!api?.get_ai_defaults) return undefined
    const raw = await api.get_ai_defaults()
    const d = coerceDefaults(raw)
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
 * 桌面端：从 Python 读取 app/.env，写入 Pi 的 provider API Key，并解析初始 Model。
 * 浏览器开发或未配置时回退 openai / gpt-4o-mini。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- pi-ai Model 泛型与各 provider Api 绑定
export async function resolveWorkspaceChatModel(): Promise<Model<any>> {
  const fallback = getModel('openai', 'gpt-4o-mini')
  const api = await getBridgeApi()
  if (!api?.get_ai_defaults) return fallback
  try {
    const raw = await api.get_ai_defaults()
    const d = coerceDefaults(raw)
    if (!d) return fallback
    await getAppStorage().providerKeys.set(d.provider, d.api_key)
    const m = getModel(d.provider as KnownProvider, d.model_id as never)
    return m ?? fallback
  } catch {
    return fallback
  }
}

/**
 * 旁路「抽取 / 流式写入编辑区」使用的快速模型；与主模型共用 provider 与同一条 api_key。
 * 未配置 model_id_flash 时与主模型相同。
 *
 * `app/.env` 不完整时传入侧栏 `Agent.state.model`，避免用到无 IndexedDB 密钥的回退厂商。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- pi-ai Model 与 provider 绑定
export async function resolveWorkspaceFlashModel(reuseAuthFromModel?: Model<any>): Promise<Model<any>> {
  const fallback = getModel('openai', 'gpt-4o-mini')
  const api = await getBridgeApi()
  if (!api?.get_ai_defaults) return reuseAuthFromModel ?? fallback
  try {
    const raw = await api.get_ai_defaults()
    const d = coerceDefaults(raw)
    if (!d) return reuseAuthFromModel ?? fallback
    await getAppStorage().providerKeys.set(d.provider, d.api_key)
    const flashId = (d.model_id_flash?.trim() || d.model_id) as never
    const m = getModel(d.provider as KnownProvider, flashId)
    return m ?? (reuseAuthFromModel ?? fallback)
  } catch {
    return reuseAuthFromModel ?? fallback
  }
}
