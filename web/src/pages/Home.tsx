import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  SHORT_GENRE_OPTIONS,
  type BookSummary,
  type BookType,
  type MaterialSummary,
  type MaterialType,
  createBook,
  deleteBook,
  getBookCover,
  getBridgeApi,
  getStoredWorkspaceRoot,
  isPywebviewDesktopBundle,
  listBooks,
  loadPersistedWorkspaceRoot,
  persistWorkspaceRoot,
  pickFolder,
  listMaterials,
  createMaterial,
  deleteMaterial,
  SHORT_MATERIAL_GENRES,
} from '../bridge'
import { CardGrid, bookToCardItem, materialToCardItem } from '../components/CardGrid'
import './Home.css'

function truncatePath(path: string, max = 42): string {
  if (path.length <= max) return path
  const head = Math.floor(max / 2) - 1
  const tail = max - head - 1
  return `${path.slice(0, head)}…${path.slice(-tail)}`
}

export function Home() {
  // ==================== 创作空间状态 ====================
  const [books, setBooks] = useState<BookSummary[]>([])
  const [loadingBooks, setLoadingBooks] = useState(true)
  const [showBookForm, setShowBookForm] = useState(false)
  const [bookTitle, setBookTitle] = useState('')
  const [bookType, setBookType] = useState<BookType>('short')
  const [shortGenre, setShortGenre] = useState<string>(SHORT_GENRE_OPTIONS[0])
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(() => getStoredWorkspaceRoot())
  const [submittingBook, setSubmittingBook] = useState(false)
  const [deletingBookId, setDeletingBookId] = useState<string | null>(null)
  const [bookError, setBookError] = useState<string | null>(null)
  const [bookCovers, setBookCovers] = useState<Record<string, string>>({})

  // ==================== 素材库状态 ====================
  const [materials, setMaterials] = useState<MaterialSummary[]>([])
  const [loadingMaterials, setLoadingMaterials] = useState(true)
  const [showMaterialForm, setShowMaterialForm] = useState(false)
  const [materialTitle, setMaterialTitle] = useState('')
  const [materialType, setMaterialType] = useState<MaterialType>('short')
  const [materialParentGenre, setMaterialParentGenre] = useState<string>(Object.keys(SHORT_MATERIAL_GENRES)[0])
  const [materialSubGenre, setMaterialSubGenre] = useState<string>(SHORT_MATERIAL_GENRES['世情'][0])
  const [submittingMaterial, setSubmittingMaterial] = useState(false)
  const [deletingMaterialId, setDeletingMaterialId] = useState<string | null>(null)
  const [materialError, setMaterialError] = useState<string | null>(null)

  // ==================== 创作空间封面加载 ====================
  const loadBookCovers = useCallback(async (bookList: BookSummary[]) => {
    const api = await getBridgeApi()
    if (!api?.get_book_cover) return
    const results = await Promise.all(
      bookList.map(async (b) => {
        try {
          const res = await getBookCover(b.id)
          return { id: b.id, data: res.cover_data }
        } catch {
          return { id: b.id, data: null as string | null }
        }
      }),
    )
    const map: Record<string, string> = {}
    for (const r of results) {
      if (r.data) map[r.id] = r.data
    }
    setBookCovers(map)
  }, [])

  // ==================== 创作空间数据加载 ====================
  const refreshBooks = useCallback(async () => {
    setLoadingBooks(true)
    setBookError(null)
    try {
      const list = await listBooks()
      setBooks(list)
      void loadBookCovers(list)
    } catch (e) {
      setBookError(e instanceof Error ? e.message : '加载创作空间失败')
    } finally {
      setLoadingBooks(false)
    }
  }, [loadBookCovers])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoadingBooks(true)
      setBookError(null)
      const w = await loadPersistedWorkspaceRoot()
      if (cancelled) return
      setWorkspaceRoot(w)
      try {
        const list = await listBooks()
        if (!cancelled) setBooks(list)
        if (!cancelled) void loadBookCovers(list)
      } catch (e) {
        if (!cancelled) setBookError(e instanceof Error ? e.message : '加载创作空间失败')
      } finally {
        if (!cancelled) setLoadingBooks(false)
      }
    })()

    let lateTimer: number | undefined
    if (isPywebviewDesktopBundle()) {
      lateTimer = window.setTimeout(() => {
        if (cancelled) return
        void (async () => {
          const w = await loadPersistedWorkspaceRoot()
          if (!cancelled && w != null) {
            setWorkspaceRoot((prev) => prev ?? w)
          }
        })()
      }, 450)
    }

    return () => {
      cancelled = true
      if (lateTimer != null) window.clearTimeout(lateTimer)
    }
  }, [loadBookCovers])

  // ==================== 素材库数据加载 ====================
  const refreshMaterials = useCallback(async () => {
    setLoadingMaterials(true)
    setMaterialError(null)
    try {
      const list = await listMaterials()
      setMaterials(list)
    } catch (e) {
      setMaterialError(e instanceof Error ? e.message : '加载素材库失败')
    } finally {
      setLoadingMaterials(false)
    }
  }, [])

  // 初始加载素材
  const hasLoadedMaterials = useRef(false)
  useEffect(() => {
    if (!hasLoadedMaterials.current) {
      hasLoadedMaterials.current = true
      void refreshMaterials()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ==================== 工作目录操作 ====================
  const handlePickWorkspace = async () => {
    setBookError(null)
    try {
      const p = await pickFolder()
      if (p) {
        setWorkspaceRoot(p)
        await persistWorkspaceRoot(p)
        await refreshBooks()
        await refreshMaterials()
      }
    } catch (e) {
      setBookError(e instanceof Error ? e.message : '选择文件夹失败')
    }
  }

  // ==================== 书籍操作 ====================
  const handleCreateBook = async (e: React.FormEvent) => {
    e.preventDefault()
    const ws = workspaceRoot?.trim()
    if (!ws) {
      setBookError('请先在上方选择工作文件夹')
      return
    }
    setSubmittingBook(true)
    setBookError(null)
    try {
      const cats = bookType === 'short' ? [shortGenre] : []
      await createBook(bookTitle, bookType, cats, ws)
      setBookTitle('')
      setBookType('short')
      setShortGenre(SHORT_GENRE_OPTIONS[0])
      setShowBookForm(false)
      await refreshBooks()
    } catch (err) {
      setBookError(err instanceof Error ? err.message : '创建书籍失败')
    } finally {
      setSubmittingBook(false)
    }
  }

  const handleDeleteBook = async (bookId: string) => {
    const b = books.find((book) => book.id === bookId)
    if (!b) return
    const ok = window.confirm(`确定从创作空间移除「${b.title}」？\n书本文件夹仍会保留在工作目录中。`)
    if (!ok) return
    setDeletingBookId(bookId)
    try {
      await deleteBook(bookId)
      await refreshBooks()
    } catch (err) {
      setBookError(err instanceof Error ? err.message : '删除书籍失败')
    } finally {
      setDeletingBookId(null)
    }
  }

  // ==================== 素材操作 ====================
  const handleCreateMaterial = async (e: React.FormEvent) => {
    e.preventDefault()
    const ws = workspaceRoot?.trim()
    if (!ws) {
      setMaterialError('请先在上方选择工作文件夹')
      return
    }
    setSubmittingMaterial(true)
    setMaterialError(null)
    try {
      const parentGenre = materialType === 'short' ? materialParentGenre : undefined
      const subGenre = materialType === 'short' ? materialSubGenre : undefined
      await createMaterial(materialTitle, materialType, parentGenre, subGenre, ws)
      setMaterialTitle('')
      setMaterialType('short')
      setMaterialParentGenre(Object.keys(SHORT_MATERIAL_GENRES)[0])
      setMaterialSubGenre(SHORT_MATERIAL_GENRES['世情'][0])
      setShowMaterialForm(false)
      await refreshMaterials()
    } catch (err) {
      setMaterialError(err instanceof Error ? err.message : '创建素材失败')
    } finally {
      setSubmittingMaterial(false)
    }
  }

  const handleDeleteMaterial = async (materialId: string) => {
    const m = materials.find((mat) => mat.id === materialId)
    if (!m) return
    const ok = window.confirm(`确定删除素材「${m.title}」？\n素材文件夹仍会保留在工作目录中。`)
    if (!ok) return
    setDeletingMaterialId(materialId)
    try {
      await deleteMaterial(materialId)
      await refreshMaterials()
    } catch (err) {
      setMaterialError(err instanceof Error ? err.message : '删除素材失败')
    } finally {
      setDeletingMaterialId(null)
    }
  }

  // ==================== 素材类型/分类改变处理 ====================
  const handleMaterialParentGenreChange = useCallback((genre: string) => {
    setMaterialParentGenre(genre)
    const subGenres = SHORT_MATERIAL_GENRES[genre] || []
    setMaterialSubGenre(subGenres[0] || '')
  }, [])

  const handleMaterialTypeChange = useCallback((type: MaterialType) => {
    setMaterialType(type)
    if (type === 'short') {
      const currentSubGenres = SHORT_MATERIAL_GENRES[materialParentGenre] || []
      setMaterialSubGenre(currentSubGenres[0] || '')
    }
  }, [materialParentGenre])

  // ==================== 渲染 ====================
  const bookCardItems = useMemo(
    () => books.map((b) => bookToCardItem(b, bookCovers[b.id])),
    [books, bookCovers],
  )
  const materialCardItems = useMemo(() => materials.map(materialToCardItem), [materials])

  return (
    <div className="home">
      {/* 顶部工作目录栏 */}
      <section className="workspace-bar" aria-label="工作文件夹">
        <div className="workspace-card">
          <div className="workspace-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </div>
          <div className="workspace-info">
            <span className="workspace-label">工作文件夹</span>
            <span className="workspace-path" title={workspaceRoot ?? undefined}>
              {workspaceRoot ? truncatePath(workspaceRoot, 50) : '未选择工作目录'}
            </span>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void handlePickWorkspace()}
          >
            {workspaceRoot ? '更改' : '选择文件夹'}
          </button>
        </div>
      </section>

      {/* 双栏卡片布局 */}
      <div className="home-cards-layout">
        {/* 书籍卡片 */}
        <section className="main-card books-card" aria-label="创作空间">
          <header className="card-header">
            <div className="card-header-icon book-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <div className="card-header-content">
              <h2 className="card-header-title">创作空间</h2>
              <span className="card-header-count">{books.length} 本书</span>
            </div>
            <div className="card-header-actions">
              <Link
                className="btn-secondary btn-small"
                to="/workspace-settings"
              >
                设置
              </Link>
              <button
                type="button"
                className="btn-primary btn-small"
                onClick={() => setShowBookForm((v) => !v)}
              >
                {showBookForm ? '收起' : '+ 创建书籍'}
              </button>
            </div>
          </header>

          {showBookForm && (
            <form className="create-form" onSubmit={handleCreateBook}>
              <label className="field">
                <span className="field-label">书名</span>
                <input
                  type="text"
                  value={bookTitle}
                  onChange={(e) => setBookTitle(e.target.value)}
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

              {bookError && <p className="form-error">{bookError}</p>}

              <button type="submit" className="btn-primary" disabled={submittingBook}>
                {submittingBook ? '创建中…' : '创建'}
              </button>
            </form>
          )}

          <div className="card-content-area">
            {loadingBooks ? (
              <div className="loading-state">
                <div className="spinner" />
                <span>加载中…</span>
              </div>
            ) : books.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
                <p>暂无书籍</p>
                <span className="empty-hint">点击「创建书籍」开始写作</span>
              </div>
            ) : (
              <CardGrid
                items={bookCardItems}
                emptyText="暂无书籍"
                onDelete={handleDeleteBook}
                deletingId={deletingBookId}
              />
            )}
          </div>
        </section>

        {/* 素材卡片 */}
        <section className="main-card materials-card" aria-label="素材库">
          <header className="card-header">
            <div className="card-header-icon material-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div className="card-header-content">
              <h2 className="card-header-title">素材库</h2>
              <span className="card-header-count">{materials.length} 个素材</span>
            </div>
            <button
              type="button"
              className="btn-primary btn-small"
              onClick={() => setShowMaterialForm((v) => !v)}
            >
              {showMaterialForm ? '收起' : '+ 创建素材'}
            </button>
          </header>

          {showMaterialForm && (
            <form className="create-form" onSubmit={handleCreateMaterial}>
              <label className="field">
                <span className="field-label">素材标题</span>
                <input
                  type="text"
                  value={materialTitle}
                  onChange={(e) => setMaterialTitle(e.target.value)}
                  placeholder="请输入素材标题"
                  required
                  autoFocus
                />
              </label>

              <fieldset className="field">
                <legend className="field-label">素材类型</legend>
                <div className="radio-row">
                  <label className="radio">
                    <input
                      type="radio"
                      name="materialType"
                      checked={materialType === 'long'}
                      onChange={() => handleMaterialTypeChange('long')}
                    />
                    长篇
                  </label>
                  <label className="radio">
                    <input
                      type="radio"
                      name="materialType"
                      checked={materialType === 'short'}
                      onChange={() => handleMaterialTypeChange('short')}
                    />
                    短篇
                  </label>
                </div>
              </fieldset>

              {materialType === 'short' && (
                <>
                  <fieldset className="field">
                    <legend className="field-label">大分类</legend>
                    <div className="genre-grid">
                      {Object.keys(SHORT_MATERIAL_GENRES).map((g) => (
                        <label key={g} className="radio">
                          <input
                            type="radio"
                            name="materialParentGenre"
                            checked={materialParentGenre === g}
                            onChange={() => handleMaterialParentGenreChange(g)}
                          />
                          {g}
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <fieldset className="field">
                    <legend className="field-label">子分类</legend>
                    <div className="genre-grid">
                      {(SHORT_MATERIAL_GENRES[materialParentGenre] || []).map((g) => (
                        <label key={g} className="radio">
                          <input
                            type="radio"
                            name="materialSubGenre"
                            checked={materialSubGenre === g}
                            onChange={() => setMaterialSubGenre(g)}
                          />
                          {g}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </>
              )}

              {materialError && <p className="form-error">{materialError}</p>}

              <button type="submit" className="btn-primary" disabled={submittingMaterial}>
                {submittingMaterial ? '创建中…' : '创建'}
              </button>
            </form>
          )}

          <div className="card-content-area">
            {loadingMaterials ? (
              <div className="loading-state">
                <div className="spinner" />
                <span>加载中…</span>
              </div>
            ) : materials.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <p>暂无素材</p>
                <span className="empty-hint">点击「创建素材」添加素材</span>
              </div>
            ) : (
              <CardGrid
                items={materialCardItems}
                emptyText="暂无素材"
                onDelete={handleDeleteMaterial}
                deletingId={deletingMaterialId}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
