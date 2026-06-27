export type BridgeApi = NonNullable<Window['pywebview']>['api']

type WindowWithPywebview = Window & {
  pywebview?: {
    api?: BridgeApi
  }
}

/** 已成功拿到的 Python API，避免重复等待 */
let memoApi: BridgeApi | null = null
/** 已确认是纯浏览器（无 pywebview），避免每次列表都轮询 */
let memoBrowserOnly = false

const PYWEBVIEW_READY = 'pywebviewready'

/** 等待 pywebviewready / 首轮超时；桌面生产包给足冷启动时间 */
const BRIDGE_WAIT_MS = import.meta.env.DEV ? 2_000 : 15_000

/** pywebview 对象已出现但 api 仍晚几帧注入时，继续轮询 */
const API_ATTACH_POLL_MS = import.meta.env.DEV ? 3_000 : 15_000
const API_ATTACH_POLL_STEP_MS = 50

/** 单次桥接解析（并发调用共享同一 Promise，避免抢先返回 mock） */
let bridgeWaitSingleton: Promise<BridgeApi | undefined> | null = null

/** 与 main.tsx boot 一致：桌面壳加载的打包页（含本机 HTTP + `?pywebview=1`） */
export function isPywebviewDesktopBundle(): boolean {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return window.location.protocol === 'file:' || params.get('pywebview') === '1'
}

function pywebviewWindow(): WindowWithPywebview {
  return window as WindowWithPywebview
}

function readBridgeApi(): BridgeApi | undefined {
  return pywebviewWindow().pywebview?.api
}

/**
 * 校验 pywebview.api 是否已完整注入。
 *
 * pywebview 在窗口冷启动 / reload / 渲染进程重置时，可能先暴露一个不完整的占位 api 对象
 * （`window.pywebview.api` 为 truthy 但缺少方法），此时直接调用会抛 `xxx is not a function`。
 * 以 `list_books` 作为关键方法探针：缺失即视为未就绪，继续等待而非缓存坏对象。
 */
function isApiUsable(api: BridgeApi | undefined): api is BridgeApi {
  return !!api && typeof api.list_books === 'function'
}

async function resolveBridgeApiOnce(): Promise<BridgeApi | undefined> {
  const read = readBridgeApi

  const initial = read()
  if (isApiUsable(initial)) {
    memoApi = initial
    return memoApi
  }

  if (typeof pywebviewWindow().pywebview === 'undefined') {
    for (let i = 0; i < 60; i++) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
      if (typeof pywebviewWindow().pywebview !== 'undefined') break
    }
  }

  const afterFrame = read()
  if (isApiUsable(afterFrame)) {
    memoApi = afterFrame
    return memoApi
  }

  await new Promise<void>((resolve) => {
    const done = () => resolve()
    window.addEventListener(PYWEBVIEW_READY, () => queueMicrotask(done), { once: true })
    queueMicrotask(() => isApiUsable(read()) && done())
    setTimeout(() => isApiUsable(read()) && done(), 0)
    setTimeout(done, BRIDGE_WAIT_MS)
  })

  const pollUntil = Date.now() + API_ATTACH_POLL_MS
  while (Date.now() < pollUntil) {
    const api = read()
    if (isApiUsable(api)) {
      memoApi = api
      return api
    }
    await new Promise<void>((r) => setTimeout(r, API_ATTACH_POLL_STEP_MS))
  }

  const api = read()
  if (isApiUsable(api)) {
    memoApi = api
    return api
  }

  if (!isPywebviewDesktopBundle() && typeof pywebviewWindow().pywebview === 'undefined') {
    memoBrowserOnly = true
  }
  return undefined
}

/**
 * 获取 pywebview 注入的 Python API。
 * 桌面壳里注入时机不定：此处单例等待 + 就绪后轮询，避免 listBooks / 工作目录等并发调用抢先误走 mock。
 */
export async function getBridgeApi(): Promise<BridgeApi | undefined> {
  if (memoApi) return memoApi
  if (memoBrowserOnly) return undefined

  if (!bridgeWaitSingleton) {
    bridgeWaitSingleton = resolveBridgeApiOnce()
  }

  try {
    const resolved = await bridgeWaitSingleton
    if (memoApi) return memoApi
    if (memoBrowserOnly) return undefined
    if (!resolved && isPywebviewDesktopBundle()) {
      throw new Error(
        '桌面桥接不可用：pywebview.api 未在限定时间内注入。请重启应用；若仍复现，请设置 WRITECLAW_DEBUG=1 查看控制台。',
      )
    }
    return resolved
  } finally {
    bridgeWaitSingleton = null
  }
}

/**
 * 重置桥接缓存，供客户端在检测到 api 不完整（如抛出 `xxx is not a function`）时自愈重试。
 * 清除后再次调用 `getBridgeApi()` 会重新等待并解析 `pywebview.api`，避免被锁死在坏对象上。
 */
export function resetBridgeApiCache(): void {
  memoApi = null
  memoBrowserOnly = false
  bridgeWaitSingleton = null
}
