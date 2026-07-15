import { useMemo, useState } from 'react'
import type { BookSummary } from '../domain/workspaceCore'
import { bookTypeLabel } from '../domain/workspaceCore'
import './BookMemoryImportDialog.css'

type Props = {
  currentBookId: string
  books: BookSummary[]
  importing?: boolean
  onClose: () => void
  onImport: (sourceBook: BookSummary) => void | Promise<void>
}

export function BookMemoryImportDialog({
  currentBookId,
  books,
  importing = false,
  onClose,
  onImport,
}: Props) {
  const candidates = useMemo(
    () => books.filter((item) => item.id !== currentBookId),
    [books, currentBookId],
  )
  const [selectedId, setSelectedId] = useState('')
  const selectedBook = candidates.find((item) => item.id === selectedId) ?? null

  return (
    <div className="memory-import-backdrop" role="dialog" aria-modal="true" aria-labelledby="memory-import-title">
      <section className="memory-import-dialog">
        <header className="memory-import-head">
          <h2 id="memory-import-title">加载其他书籍记忆</h2>
          <button
            type="button"
            className="memory-import-close"
            aria-label="关闭"
            disabled={importing}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="memory-import-body">
          <p className="memory-import-warning">
            加载后会删除当前书籍的全部记忆，并完整同步所选书籍的记忆。
          </p>
          {candidates.length === 0 ? (
            <p className="memory-import-empty">暂无其他书籍可加载。</p>
          ) : (
            <label className="memory-import-field">
              <span>来源书籍</span>
              <select
                value={selectedId}
                disabled={importing}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                <option value="">请选择书籍</option>
                {candidates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title || '未命名书籍'}（{bookTypeLabel(item.book_type)}）
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <footer className="memory-import-foot">
          <button
            type="button"
            className="memory-secondary-button"
            disabled={importing}
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="memory-primary-button"
            disabled={!selectedBook || importing}
            onClick={() => selectedBook && void onImport(selectedBook)}
          >
            {importing ? '加载中' : '继续'}
          </button>
        </footer>
      </section>
    </div>
  )
}
