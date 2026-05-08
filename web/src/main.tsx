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
 * pywebview 桌面壳加载页面时，首轮脚本执行时刻 `window.pywebview` 可能仍为 undefined。
 * 若此时立即 mount，首屏 listBooks 会在 API 未就绪时超时并误走 localStorage mock。
 *
 * - file:// 或带 `?pywebview=1`（本机 HTTP 提供 dist）：等到 pywebviewready / api 就绪。
 * - 其它 http(s)（如 Vite dev、普通浏览器）：立即挂载。
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

  const deadline = Date.now() + 15_000
  const poll = () => {
    if (window.pywebview?.api !== undefined) {
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
