export type WorkspaceLayoutCollapsed = {
  left: boolean
  top: boolean
  right: boolean
}

type Props = {
  collapsed: WorkspaceLayoutCollapsed
  onToggleLeft: () => void
  onToggleTop: () => void
  onToggleRight: () => void
  compact?: boolean
}

type LayoutControlButtonProps = {
  panel: 'left' | 'top' | 'right'
  pressed: boolean
  label: string
  onClick: () => void
}

function LayoutControlButton({
  panel,
  pressed,
  label,
  onClick,
}: LayoutControlButtonProps) {
  return (
    <button
      type="button"
      className="workspace-layout-control"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
    >
      <span
        className={`workspace-layout-control-icon workspace-layout-control-icon--${panel}`}
        aria-hidden
      />
    </button>
  )
}

export function WorkspaceLayoutControls({
  collapsed,
  onToggleLeft,
  onToggleTop,
  onToggleRight,
  compact = false,
}: Props) {
  return (
    <div
      className={
        compact
          ? 'workspace-layout-controls workspace-layout-controls--compact'
          : 'workspace-layout-controls'
      }
      aria-label="创作空间布局控制"
    >
      <LayoutControlButton
        panel="left"
        pressed={collapsed.left}
        label={collapsed.left ? '展开左侧阶段树' : '收起左侧阶段树'}
        onClick={onToggleLeft}
      />
      <LayoutControlButton
        panel="top"
        pressed={collapsed.top}
        label={collapsed.top ? '展开顶部工具栏' : '收起顶部工具栏'}
        onClick={onToggleTop}
      />
      <LayoutControlButton
        panel="right"
        pressed={collapsed.right}
        label={collapsed.right ? '展开右侧编辑区' : '收起右侧编辑区'}
        onClick={onToggleRight}
      />
    </div>
  )
}
