import { HashRouter, Route, Routes } from 'react-router-dom'
import './App.css'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { BookEditor } from './pages/BookEditor'
import { Home } from './pages/Home'
import { MaterialEditor } from './pages/MaterialEditor'
import { MaterialSettings } from './pages/MaterialSettings'
import { SkillEditor } from './pages/SkillEditor'
import { SkillSettings } from './pages/SkillSettings'
import { WorkspaceSettings } from './pages/WorkspaceSettings'

function App() {
  return (
    <HashRouter>
      <AppErrorBoundary>
        <div className="app-shell">
          <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/workspace-settings" element={<WorkspaceSettings />} />
          <Route path="/material-settings" element={<MaterialSettings />} />
          <Route path="/skill-settings" element={<SkillSettings />} />
          <Route path="/book/:id" element={<BookEditor />} />
          <Route path="/material/:id" element={<MaterialEditor />} />
          <Route path="/skill/:id" element={<SkillEditor />} />
          </Routes>
        </div>
      </AppErrorBoundary>
    </HashRouter>
  )
}

export default App
