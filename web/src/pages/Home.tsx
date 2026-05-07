import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  SHORT_GENRE_OPTIONS,
  type BookSummary,
  type BookType,
  createBook,
  deleteBook,
  getStoredWorkspaceRoot,
  listBooks,
  loadPersistedWorkspaceRoot,
  persistWorkspaceRoot,
  pickFolder,
} from '../bridge'
import './Home.css'

function truncatePath(path: string, max = 42): string {
  if (path.length <= max) return path
  const head = Math.floor(max / 2) - 1
  const tail = max - head - 1
  return `${path.slice(0, head)}…${path.slice(-tail)}`
}

export function Home() {
  const [books, setBooks] = useState<BookSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [bookType, setBookType] = useState<BookType>('short')
  /** 短篇分类单选，默认取可选列表首项 */
  const [shortGenre, setShortGenre] = useState<string>(SHORT_GENRE_OPTIONS[0])
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(() => getStoredWorkspaceRoot())
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [shelfError, setShelfError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await listBooks()
      setBooks(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  /** 与桥接串行：先等工作目录从磁盘恢复，再拉书架，避免与 listBooks 并发抢跑误走 mock */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      const w = await loadPersistedWorkspaceRoot()
      if (cancelled) return
      setWorkspaceRoot(w)
      try {
        const list = await listBooks()
        if (!cancelled) setBooks(list)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handlePickWorkspace = async () => {
    setError(null)
    try {
      const p = await pickFolder()
      if (p) {
        setWorkspaceRoot(p)
        await persistWorkspaceRoot(p)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '选择文件夹失败')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const ws = workspaceRoot?.trim()
    if (!ws) {
      setError('请先在上方选择工作文件夹')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const cats = bookType === 'short' ? [shortGenre] : []
      await createBook(title, bookType, cats, ws)
      setTitle('')
      setBookType('short')
      setShortGenre(SHORT_GENRE_OPTIONS[0])
      setShowForm(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteBook = async (b: BookSummary, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const ok = window.confirm(`确定从书架移除「${b.title}」？\n书本文件夹仍会保留在工作目录中。`)
    if (!ok) return
    setDeletingId(b.id)
    setShelfError(null)
    try {
      const removed = await deleteBook(b.id)
      if (!removed) {
        setShelfError('该书已不存在或删除失败')
        return
      }
      await refresh()
    } catch (err) {
      setShelfError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="home">
      <header className="home-header">
        <h1 className="home-title">书架</h1>
        <button
          type="button"
          className="btn-primary"
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? '收起' : '创建书籍'}
        </button>
      </header>

      <section className="workspace-bar card" aria-label="工作文件夹">
        <span className="field-label">工作文件夹</span>
        <div className="folder-row">
          <span className="folder-path" title={workspaceRoot ?? undefined}>
            {workspaceRoot ? truncatePath(workspaceRoot) : '未选择'}
          </span>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void handlePickWorkspace()}
          >
            {workspaceRoot ? '更改' : '选择文件夹'}
          </button>
        </div>
        <p className="workspace-hint muted">
          新建书籍会在该目录下创建以书名为名的文件夹，正文与各阶段内容保存至其中。
        </p>
      </section>

      {showForm && (
        <form className="home-form card" onSubmit={handleSubmit}>
          <label className="field">
            <span className="field-label">书名</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="请输入书名"
              required
              autoFocus
            />
          </label>

          <fieldset className="field">
            <legend className="field-label">类型</legend>
            <div className="radio-row">
              <label className="radio">
                <input
                  type="radio"
                  name="bookType"
                  checked={bookType === 'short'}
                  onChange={() => setBookType('short')}
                />
                短篇
              </label>
              <label className="radio">
                <input
                  type="radio"
                  name="bookType"
                  checked={bookType === 'long'}
                  onChange={() => setBookType('long')}
                />
                长篇
              </label>
            </div>
          </fieldset>

          {bookType === 'short' && (
            <fieldset className="field">
              <legend className="field-label">短篇分类</legend>
              <div className="genre-grid">
                {SHORT_GENRE_OPTIONS.map((g) => (
                  <label key={g} className="radio">
                    <input
                      type="radio"
                      name="shortGenre"
                      checked={shortGenre === g}
                      onChange={() => setShortGenre(g)}
                    />
                    {g}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {error && <p className="form-error">{error}</p>}

          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? '创建中…' : '创建'}
          </button>
        </form>
      )}

      <main className="home-main">
        {shelfError && (
          <p className="form-error home-shelf-error" role="alert">
            {shelfError}
          </p>
        )}
        {loading ? (
          <p className="muted">加载中…</p>
        ) : books.length === 0 ? (
          <p className="muted empty-hint">暂无书籍，点击「创建书籍」开始</p>
        ) : (
          <ul className="book-list">
            {books.map((b) => (
              <li key={b.id} className="book-row card">
                <Link className="book-link" to={`/book/${b.id}`}>
                  <span className="book-name">{b.title}</span>
                  <span className="book-meta">
                    {b.book_type === 'short' ? '短篇' : '长篇'}
                    {b.book_type === 'short' && b.categories.length > 0
                      ? ` · ${b.categories.join('、')}`
                      : ''}
                  </span>
                  <span
                    className="book-path muted"
                    title={b.output_dir || undefined}
                  >
                    {b.output_dir
                      ? truncatePath(b.output_dir, 48)
                      : '未指定书本目录'}
                  </span>
                </Link>
                <button
                  type="button"
                  className="btn-delete"
                  aria-label={`从书架移除《${b.title}》`}
                  disabled={deletingId === b.id}
                  onClick={(e) => void handleDeleteBook(b, e)}
                >
                  {deletingId === b.id ? '移除中…' : '移除'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
