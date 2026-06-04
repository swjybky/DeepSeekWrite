import { useState } from 'react'

export type WorkspaceTreeStage = {
  id: string
  label: string
}

export type WorkspaceTreeBook = {
  id: string
  title: string
  meta?: string
  stages: WorkspaceTreeStage[]
}

type WorkspaceTreeNavProps = {
  rootLabel?: string
  stages?: WorkspaceTreeStage[]
  books?: WorkspaceTreeBook[]
  activeBookId?: string
  activeStageId: string
  onStageSelect: (stageId: string) => void
  onBookStageSelect?: (bookId: string, stageId: string) => void
  defaultExpanded?: boolean
  ariaLabel?: string
  editingTitle?: boolean
  titleDraft?: string
  onTitleDraftChange?: (value: string) => void
  onTitleEditStart?: () => void
  onTitleEditEnd?: () => void
  onTitleEditCancel?: () => void
}

export function WorkspaceTreeNav({
  rootLabel,
  stages = [],
  books,
  activeBookId,
  activeStageId,
  onStageSelect,
  onBookStageSelect,
  defaultExpanded = false,
  ariaLabel = '项目结构',
  editingTitle = false,
  titleDraft = '',
  onTitleDraftChange,
  onTitleEditStart,
  onTitleEditEnd,
  onTitleEditCancel,
}: WorkspaceTreeNavProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [expandedBookIds, setExpandedBookIds] = useState<Record<string, boolean>>({})

  const hasBookTree = books != null
  const isBookExpanded = (bookId: string) => {
    if (activeBookId && bookId !== activeBookId) return false
    if (activeBookId && bookId === activeBookId) {
      return expandedBookIds[bookId] ?? true
    }
    return expandedBookIds[bookId] ?? defaultExpanded
  }
  const toggleBook = (bookId: string) => {
    if (activeBookId && bookId !== activeBookId) return
    setExpandedBookIds((prev) => ({
      ...prev,
      [bookId]: !(prev[bookId] ?? bookId === activeBookId),
    }))
  }

  if (hasBookTree) {
    const treeBooks = books ?? []
    return (
      <nav className="workspace-tree" aria-label={ariaLabel}>
        {treeBooks.length === 0 ? (
          <p className="workspace-tree-empty muted">暂无编辑中的短篇书籍</p>
        ) : (
          <ul className="workspace-tree-books">
            {treeBooks.map((treeBook) => {
              const bookExpanded = isBookExpanded(treeBook.id)
              const isActiveBook = activeBookId === treeBook.id
              const firstStageId = treeBook.stages[0]?.id

              return (
                <li className="workspace-tree-book-node" key={treeBook.id}>
                  <div className="workspace-tree-book-row">
                    <button
                      type="button"
                      className="workspace-tree-toggle"
                      aria-expanded={bookExpanded}
                      aria-label={bookExpanded ? '收起阶段列表' : '展开阶段列表'}
                      onClick={() => toggleBook(treeBook.id)}
                    >
                      <span className="workspace-tree-chevron" aria-hidden>
                        {bookExpanded ? '▾' : '▸'}
                      </span>
                    </button>
                    {editingTitle && isActiveBook ? (
                      <input
                        className="workspace-tree-title-input"
                        value={titleDraft}
                        onChange={(e) => onTitleDraftChange?.(e.target.value)}
                        onBlur={() => onTitleEditEnd?.()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur()
                          } else if (e.key === 'Escape') {
                            onTitleEditCancel?.()
                          }
                        }}
                        autoFocus
                      />
                    ) : (
                      <button
                        type="button"
                        className={
                          isActiveBook
                            ? 'workspace-tree-book workspace-tree-book--active'
                            : 'workspace-tree-book'
                        }
                        title={isActiveBook ? '双击编辑名称' : '点击打开书籍'}
                        onClick={() => {
                          if (!isActiveBook && firstStageId) {
                            onBookStageSelect?.(treeBook.id, firstStageId)
                          }
                        }}
                        onDoubleClick={() => {
                          if (isActiveBook) onTitleEditStart?.()
                        }}
                      >
                        <span className="workspace-tree-book-title">
                          {treeBook.title || '未命名'}
                        </span>
                        {treeBook.meta ? (
                          <span className="workspace-tree-book-meta">
                            {treeBook.meta}
                          </span>
                        ) : null}
                      </button>
                    )}
                  </div>
                  {bookExpanded ? (
                    <ul className="workspace-tree-stages">
                      {treeBook.stages.map((stage) => {
                        const isActive =
                          isActiveBook && activeStageId === stage.id
                        return (
                          <li key={stage.id}>
                            <button
                              type="button"
                              className={
                                isActive
                                  ? 'workspace-tree-stage workspace-tree-stage--active'
                                  : 'workspace-tree-stage'
                              }
                              onClick={() => {
                                if (isActiveBook) {
                                  onStageSelect(stage.id)
                                } else {
                                  onBookStageSelect?.(treeBook.id, stage.id)
                                }
                              }}
                            >
                              <span className="workspace-tree-stage-dot" aria-hidden />
                              {stage.label}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </nav>
    )
  }

  return (
    <nav className="workspace-tree" aria-label={ariaLabel}>
      <div className="workspace-tree-root">
        <button
          type="button"
          className="workspace-tree-toggle"
          aria-expanded={expanded}
          aria-label={expanded ? '收起阶段列表' : '展开阶段列表'}
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="workspace-tree-chevron" aria-hidden>
            {expanded ? '▾' : '▸'}
          </span>
        </button>
        {editingTitle ? (
          <input
            className="workspace-tree-title-input"
            value={titleDraft}
            onChange={(e) => onTitleDraftChange?.(e.target.value)}
            onBlur={() => onTitleEditEnd?.()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur()
              } else if (e.key === 'Escape') {
                onTitleEditCancel?.()
              }
            }}
            autoFocus
          />
        ) : (
          <button
            type="button"
            className="workspace-tree-book"
            title="双击编辑名称"
            onDoubleClick={() => onTitleEditStart?.()}
          >
            {rootLabel || '未命名'}
          </button>
        )}
      </div>
      {expanded ? (
        <ul className="workspace-tree-stages">
          {stages.map((stage) => (
            <li key={stage.id}>
              <button
                type="button"
                className={
                  activeStageId === stage.id
                    ? 'workspace-tree-stage workspace-tree-stage--active'
                    : 'workspace-tree-stage'
                }
                onClick={() => onStageSelect(stage.id)}
              >
                <span className="workspace-tree-stage-dot" aria-hidden />
                {stage.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </nav>
  )
}
