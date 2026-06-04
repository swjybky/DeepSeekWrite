import { useState } from 'react'

export type WorkspaceTreeStage = {
  id: string
  label: string
}

type WorkspaceTreeNavProps = {
  rootLabel: string
  stages: WorkspaceTreeStage[]
  activeStageId: string
  onStageSelect: (stageId: string) => void
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
  stages,
  activeStageId,
  onStageSelect,
  defaultExpanded = true,
  ariaLabel = '项目结构',
  editingTitle = false,
  titleDraft = '',
  onTitleDraftChange,
  onTitleEditStart,
  onTitleEditEnd,
  onTitleEditCancel,
}: WorkspaceTreeNavProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

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
