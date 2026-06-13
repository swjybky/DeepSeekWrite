import { useState } from 'react'

export type WorkspaceTreeStage = {
  id: string
  label: string
  children?: WorkspaceTreeStageChild[]
  createChildLabel?: string
  createChildDisabled?: boolean
}

export type WorkspaceTreeStageChild = {
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
  activeStageChildId?: string
  onStageSelect: (stageId: string) => void
  onStageChildSelect?: (stageId: string, childId: string) => void
  onStageChildCreate?: (stageId: string) => void
  onBookSelect?: (bookId: string) => void
  onBookStageSelect?: (bookId: string, stageId: string) => void
  onBookStageChildSelect?: (
    bookId: string,
    stageId: string,
    childId: string,
  ) => void
  onBookStageChildCreate?: (bookId: string, stageId: string) => void
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
  activeStageChildId,
  onStageSelect,
  onStageChildSelect,
  onStageChildCreate,
  onBookSelect,
  onBookStageSelect,
  onBookStageChildSelect,
  onBookStageChildCreate,
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
  const [expandedStageIds, setExpandedStageIds] = useState<Record<string, boolean>>({})

  const hasBookTree = books != null

  const hasStageChildren = (stage: WorkspaceTreeStage) =>
    (stage.children?.length ?? 0) > 0 || Boolean(stage.createChildLabel)

  const isStageExpanded = (stageId: string, stage: WorkspaceTreeStage) => {
    if (!hasStageChildren(stage)) return false
    if (expandedStageIds[stageId] != null) return expandedStageIds[stageId]
    if (activeStageId === stageId && activeStageChildId) return true
    return activeStageId === stageId
  }

  const toggleStage = (stageId: string) => {
    setExpandedStageIds((prev) => ({
      ...prev,
      [stageId]: !(prev[stageId] ?? activeStageId === stageId),
    }))
  }
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

  const renderStageChildren = (
    stage: WorkspaceTreeStage,
    options: {
      bookId?: string
      isActiveStage: boolean
      onSelectStage: () => void
    },
  ) => {
    const children = stage.children ?? []
    if (children.length === 0 && !stage.createChildLabel) return null

    return (
      <ul className="workspace-tree-stage-children">
        {children.map((child, index) => {
          const isActive =
            options.isActiveStage && activeStageChildId === child.id
          return (
            <li key={child.id}>
              <button
                type="button"
                className={
                  isActive
                    ? 'workspace-tree-stage-child workspace-tree-stage-child--active'
                    : 'workspace-tree-stage-child'
                }
                onClick={() => {
                  if (options.bookId && onBookStageChildSelect) {
                    onBookStageChildSelect?.(options.bookId, stage.id, child.id)
                  } else if (onStageChildSelect) {
                    onStageChildSelect?.(stage.id, child.id)
                  } else {
                    options.onSelectStage()
                  }
                }}
                title={child.label}
                aria-label={`第 ${index + 1} 节：${child.label}`}
              >
                {child.label}
              </button>
            </li>
          )
        })}
        {stage.createChildLabel ? (
          <li>
            <button
              type="button"
              className="workspace-tree-stage-child workspace-tree-stage-child--create"
              disabled={stage.createChildDisabled}
              onClick={() => {
                if (options.bookId && onBookStageChildCreate) {
                  onBookStageChildCreate?.(options.bookId, stage.id)
                } else if (onStageChildCreate) {
                  onStageChildCreate?.(stage.id)
                } else {
                  options.onSelectStage()
                }
              }}
            >
              {stage.createChildLabel}
            </button>
          </li>
        ) : null}
      </ul>
    )
  }

  const renderStageItem = (
    stage: WorkspaceTreeStage,
    options: {
      bookId?: string
      isActive: boolean
      onSelectStage: () => void
    },
  ) => {
    const stageHasChildren = hasStageChildren(stage)
    const stageExpanded = isStageExpanded(stage.id, stage)

    if (!stageHasChildren) {
      return (
        <button
          type="button"
          className={
            options.isActive
              ? 'workspace-tree-stage workspace-tree-stage--active'
              : 'workspace-tree-stage'
          }
          onClick={options.onSelectStage}
        >
          <span className="workspace-tree-stage-dot" aria-hidden />
          {stage.label}
        </button>
      )
    }

    return (
      <>
        <div className="workspace-tree-stage-row">
          <button
            type="button"
            className={
              options.isActive
                ? 'workspace-tree-stage workspace-tree-stage--active workspace-tree-stage--branch'
                : 'workspace-tree-stage workspace-tree-stage--branch'
            }
            onClick={options.onSelectStage}
          >
            <span className="workspace-tree-stage-dot" aria-hidden />
            {stage.label}
          </button>
          <button
            type="button"
            className="workspace-tree-toggle workspace-tree-stage-toggle"
            aria-expanded={stageExpanded}
            aria-label={stageExpanded ? `收起${stage.label}小节` : `展开${stage.label}小节`}
            onClick={() => toggleStage(stage.id)}
          >
            <span className="workspace-tree-chevron" aria-hidden>
              {stageExpanded ? '▾' : '▸'}
            </span>
          </button>
        </div>
        {stageExpanded
          ? renderStageChildren(stage, {
              bookId: options.bookId,
              isActiveStage: options.isActive,
              onSelectStage: options.onSelectStage,
            })
          : null}
      </>
    )
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
                          if (!isActiveBook) {
                            if (onBookSelect) {
                              onBookSelect(treeBook.id)
                            } else if (firstStageId) {
                              onBookStageSelect?.(treeBook.id, firstStageId)
                            }
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
                          <li key={stage.id} className="workspace-tree-stage-item">
                            {renderStageItem(stage, {
                              bookId: treeBook.id,
                              isActive,
                              onSelectStage: () => {
                                if (isActiveBook) {
                                  onStageSelect(stage.id)
                                } else {
                                  onBookStageSelect?.(treeBook.id, stage.id)
                                }
                              },
                            })}
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
            <li key={stage.id} className="workspace-tree-stage-item">
              {renderStageItem(stage, {
                isActive: activeStageId === stage.id,
                onSelectStage: () => onStageSelect(stage.id),
              })}
            </li>
          ))}
        </ul>
      ) : null}
    </nav>
  )
}
