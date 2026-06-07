import './process-polyfill'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@earendil-works/pi-web-ui/app.css'
import './index.css'
import App from './App.tsx'
import './bridge'

const rootEl = document.getElementById('root')

function showBootFatalError(message: string) {
  if (!rootEl) return
  rootEl.innerHTML = `
    <div class="boot-splash" role="alert">
      <p class="boot-splash-title">DeepseekWrite</p>
      <p class="boot-splash-hint" style="max-width: 28rem; text-align: center; white-space: pre-wrap;">
        ${message.replace(/</g, '&lt;')}
      </p>
      <p class="boot-splash-hint">可在终端设置 WRITECLAW_DEBUG=1 后重启，用开发者工具查看详细错误。</p>
    </div>
  `
}

function mount() {
  if (!rootEl) return
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

/**
 * pywebview 桌面壳：首轮脚本执行时 `window.pywebview` 可能尚未注入。
 * 数据请求由 bridge.getBridgeApi() 统一等待，不必阻塞 React 挂载（否则会长时间白屏）。
 * index.html 内 boot-splash 在挂载前提供可见反馈。
 */
function boot() {
  window.addEventListener('error', (event) => {
    const detail =
      event.error instanceof Error
        ? `${event.error.message}\n${event.error.stack ?? ''}`
        : String(event.message || '未知脚本错误')
    showBootFatalError(`界面脚本加载失败：\n${detail}`)
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const msg = reason instanceof Error ? reason.message : String(reason ?? '')
    if (
      msg.includes('object store') ||
      msg.includes('key range') ||
      msg.includes('IndexedDB')
    ) {
      event.preventDefault()
      console.warn('[DeepseekWrite] IndexedDB 瞬态错误（多窗口并发），已忽略:', msg)
      return
    }
    const detail =
      reason instanceof Error
        ? `${reason.message}\n${reason.stack ?? ''}`
        : String(reason ?? '未知 Promise 错误')
    showBootFatalError(`界面初始化失败：\n${detail}`)
  })

  // 立即挂载；桌面端 API 由 bridge.getBridgeApi() 单例等待，勿在此阻塞。
  mount()
}

boot()
