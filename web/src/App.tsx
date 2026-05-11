import { HashRouter, Route, Routes } from 'react-router-dom'
import './App.css'
import { BookEditor } from './pages/BookEditor'
import { Home } from './pages/Home'
import { MaterialEditor } from './pages/MaterialEditor'

function App() {
  return (
    <HashRouter>
      <div className="app-shell">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/book/:id" element={<BookEditor />} />
          <Route path="/material/:id" element={<MaterialEditor />} />
        </Routes>
      </div>
    </HashRouter>
  )
}

export default App
