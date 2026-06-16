import { streamSimple } from '@earendil-works/pi-ai'
import type { Api, Context, Model, SimpleStreamOptions } from '@earendil-works/pi-ai'
import type { StreamFn } from '@earendil-works/pi-agent-core'
import { createStreamFn } from '@earendil-works/pi-web-ui'
import { toWorkspaceRequestModel } from './resolveWorkspaceChatModel'

/** 浏览器/WebView 内无法直连、需走桌面壳本地转发的 provider。 */
const CORS_PROXY_ALIASES = new Set([
  'kimi-coding',
  'moonshotai-cn',
  'moonshotai',
])

export function isWorkspaceHttpShell(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.protocol === 'http:' || window.location.protocol === 'https:'
}

function resolveCorsProxyAlias(model: Model<Api>): string | null {
  const provider = model.provider.trim().toLowerCase()
  if (CORS_PROXY_ALIASES.has(provider)) return provider
  return null
}

/** 将模型 baseUrl 改写为本地 ``/llm-proxy/{provider}``，由 Python 壳转发到上游。 */
export function applyWorkspaceCorsProxy(model: Model<Api>): Model<Api> {
  if (!isWorkspaceHttpShell()) return model
  const alias = resolveCorsProxyAlias(model)
  if (!alias || !model.baseUrl) return model
  const origin = window.location.origin.replace(/\/$/, '')
  return {
    ...model,
    baseUrl: `${origin}/llm-proxy/${alias}`,
  }
}

async function defaultPiProxyUrl(): Promise<string | undefined> {
  const { getAppStorage } = await import('@earendil-works/pi-web-ui')
  const enabled = await getAppStorage().settings.get('proxy.enabled')
  if (!enabled) return undefined
  return (await getAppStorage().settings.get('proxy.url')) || undefined
}

/** 工作台 Agent 统一 streamFn：优先本地 CORS 转发，其次 Pi 内置 CORS 代理（如 zai）。 */
export function createWorkspaceStreamFn(
  getProxyUrl: () => Promise<string | undefined> = defaultPiProxyUrl,
): StreamFn {
  const piStreamFn = createStreamFn(getProxyUrl)
  const fn = async (
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ) => {
    const requestModel = toWorkspaceRequestModel(model)
    const proxied = applyWorkspaceCorsProxy(requestModel)
    if (proxied !== requestModel) {
      return streamSimple(proxied, context, options)
    }
    return piStreamFn(requestModel, context, options)
  }
  return fn as StreamFn
}
