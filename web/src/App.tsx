import { useEffect, useRef } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import './App.css'
import { AppearanceProvider } from './AppearanceProvider'
import { TextDisplayProvider } from './TextDisplayProvider'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import {
  dismissBackgroundUpdateNotice,
  useBackgroundUpdate,
} from './features/update/backgroundUpdate'
import { BookEditor } from './pages/BookEditor'
import { Home } from './pages/Home'
import { MaterialEditor } from './pages/MaterialEditor'
import { MaterialGroupEditor } from './pages/MaterialGroupEditor'
import { MaterialSettings } from './pages/MaterialSettings'
import { SkillEditor } from './pages/SkillEditor'
import { SkillGroupEditor } from './pages/SkillGroupEditor'
import { SkillSettings } from './pages/SkillSettings'
import { WorkspaceSettings } from './pages/WorkspaceSettings'
import { TextDisplaySettings } from './pages/TextDisplaySettings'

function BackgroundUpdateNotice() {
  const update = useBackgroundUpdate()
  const notifiedKeyRef = useRef('')

  useEffect(() => {
    if (!update.noticeVisible) return
    const timer = window.setTimeout(dismissBackgroundUpdateNotice, 8000)
    return () => window.clearTimeout(timer)
  }, [update.noticeVisible, update.status])

  useEffect(() => {
    if (!update.noticeVisible) {
      notifiedKeyRef.current = ''
      return
    }
    if (
      document.visibilityState === 'visible' ||
      !('Notification' in window) ||
      Notification.permission !== 'granted'
    ) {
      return
    }
    const notificationKey = `${update.status}\n${update.title}\n${update.detail}`
    if (notifiedKeyRef.current === notificationKey) return
    notifiedKeyRef.current = notificationKey
    try {
      new Notification(update.title, { body: update.detail })
    } catch {
      // WKWebView 等环境可能声明 Notification 但不允许创建，应用内通知仍会显示。
    }
  }, [update.detail, update.noticeVisible, update.status, update.title])

  if (!update.noticeVisible) return null

  return (
    <aside
      className={
        update.status === 'error'
          ? 'app-update-notice app-update-notice--error'
          : 'app-update-notice app-update-notice--success'
      }
      role={update.status === 'error' ? 'alert' : 'status'}
    >
      <div>
        <strong>{update.title}</strong>
        <span title={update.detail}>{update.detail}</span>
      </div>
      <button
        type="button"
        aria-label="关闭下载通知"
        onClick={dismissBackgroundUpdateNotice}
      >
        ×
      </button>
    </aside>
  )
}

function App() {
  return (
    <AppearanceProvider>
      <TextDisplayProvider>
        <HashRouter>
          <AppErrorBoundary>
            <div className="app-shell">
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/workspace-settings" element={<WorkspaceSettings />} />
                <Route path="/material-settings" element={<MaterialSettings />} />
                <Route path="/skill-settings" element={<SkillSettings />} />
                <Route path="/text-display-settings" element={<TextDisplaySettings />} />
                <Route path="/book/:id" element={<BookEditor />} />
                <Route path="/material-group/:groupId" element={<MaterialGroupEditor />} />
                <Route path="/skill-group/:groupId" element={<SkillGroupEditor />} />
                <Route path="/material/:id" element={<MaterialEditor />} />
                <Route path="/skill/:id" element={<SkillEditor />} />
              </Routes>
              <BackgroundUpdateNotice />
            </div>
          </AppErrorBoundary>
        </HashRouter>
      </TextDisplayProvider>
    </AppearanceProvider>
  )
}

export default App
