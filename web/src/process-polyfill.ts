/**
 * pi-ai 的 env-api-keys 会在密钥解析时读取 process.env；浏览器无全局 process。
 * 在调用 stream() 等 API 前提供空壳，避免 ReferenceError: process is not defined。
 */
if (typeof globalThis.process === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 仅提供 pi-ai 在浏览器里读取的最小字段
  ;(globalThis as any).process = { env: {}, versions: {} }
}
