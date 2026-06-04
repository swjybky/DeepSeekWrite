import './process-polyfill'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@mariozechner/pi-web-ui/app.css'
import './index.css'
import App from './App.tsx'
import './bridge'

const rootEl = document.getElementById('root')

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
  const params = new URLSearchParams(window.location.search)
  const fromPywebviewBundle =
    window.location.protocol === 'file:' || params.get('pywebview') === '1'

  if (!fromPywebviewBundle) {
    mount()
    return
  }

  let mounted = false
  const mountOnce = () => {
    if (mounted) return
    mounted = true
    mount()
  }

  if (window.pywebview?.api !== undefined) {
    mountOnce()
    return
  }

  window.addEventListener('pywebviewready', () => mountOnce(), { once: true })

  /** pywebview 对象或 api 就绪即挂载；上限 2.5s 避免壳异常时永久白屏 */
  const deadline = Date.now() + 2_500
  const poll = () => {
    if (
      window.pywebview?.api !== undefined ||
      typeof window.pywebview !== 'undefined'
    ) {
      mountOnce()
      return
    }
    if (Date.now() >= deadline) {
      mountOnce()
      return
    }
    requestAnimationFrame(poll)
  }
  requestAnimationFrame(poll)
}

boot()
