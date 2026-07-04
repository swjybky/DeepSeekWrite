const LOCK_NAME = 'deepseekwrite_pi_storage'

let inProcessChain: Promise<void> = Promise.resolve()

function withInProcessLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = inProcessChain.then(() => fn())
  inProcessChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/**
 * 串行化对 Pi IndexedDB 的写入，避免多聊天面板或多窗口同时读写同一 object store。
 * 优先使用 navigator.locks（同源多标签页/多 WebView 共享时有效），否则退化为进程内队列。
 */
export function withPiStorageLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = navigator.locks
  if (locks?.request) {
    return locks.request(LOCK_NAME, fn)
  }
  return withInProcessLock(fn)
}

function isTransientIndexedDbError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  return (
    msg.includes('object store') ||
    msg.includes('key range') ||
    msg.includes('InvalidStateError') ||
    msg.includes('TransactionInactiveError')
  )
}

/** 对偶发的 IndexedDB 并发冲突做有限次重试。 */
export async function withIndexedDbRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 4,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (!isTransientIndexedDbError(error) || attempt >= maxAttempts - 1) {
        throw error
      }
      await new Promise((resolve) => {
        window.setTimeout(resolve, 40 * (attempt + 1))
      })
    }
  }
  throw lastError
}
