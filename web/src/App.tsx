import { HashRouter, Route, Routes } from 'react-router-dom'
import './App.css'
import { BookEditor } from './pages/BookEditor'
import { Home } from './pages/Home'

function App() {
  return (
    <HashRouter>
      <div className="app-shell">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/book/:id" element={<BookEditor />} />
        </Routes>
      </div>
    </HashRouter>
  )
}

export default App
