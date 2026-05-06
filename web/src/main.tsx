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
 * pywebview 桌面壳加载 `web/dist/index.html`（file://）时，首轮脚本执行时刻
 * `window.pywebview` 可能仍为 undefined（注入略晚于脚本）。若此时立即 mount，
 * 首屏 listBooks 会在 API 未就绪时超时并误走 localStorage mock，而不是 .data/books.json。
 *
 * - file://：等到 `pywebview.api` 可用或收到 pywebviewready，最多等待一轮冷启动时间后再兜底挂载。
 * - http(s)（如 Vite dev）：立即挂载。
 */
function boot() {
  const fromPywebviewBundle = window.location.protocol === 'file:'

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
