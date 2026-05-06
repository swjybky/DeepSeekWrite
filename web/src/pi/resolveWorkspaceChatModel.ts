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
  if (!provider || !model_id || !api_key) return null
  return { provider, model_id, api_key }
}

/**
 * 桌面端：从 Python 读取 app/.env，写入 Pi 的 provider API Key，并解析初始 Model。
 * 浏览器开发或未配置时回退 openai / gpt-4o-mini。
 */
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
