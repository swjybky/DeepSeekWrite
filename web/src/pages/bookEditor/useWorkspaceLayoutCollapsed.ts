import { useEffect, useState } from 'react'
import type { WorkspaceLayoutCollapsed } from '../../components/WorkspaceLayoutControls'

const WORKSPACE_LAYOUT_COLLAPSED_KEY =
  'deepseekwrite:workspace-layout-collapsed'

const DEFAULT_WORKSPACE_LAYOUT_COLLAPSED: WorkspaceLayoutCollapsed = {
  left: false,
  top: false,
  right: false,
}

function normalizeLayoutCollapsed(value: unknown): WorkspaceLayoutCollapsed {
  if (!value || typeof value !== 'object') {
    return DEFAULT_WORKSPACE_LAYOUT_COLLAPSED
  }
  const raw = value as Partial<Record<keyof WorkspaceLayoutCollapsed, unknown>>
  return {
    left: raw.left === true,
    top: raw.top === true,
    right: raw.right === true,
  }
}

function readStoredWorkspaceLayoutCollapsed(): WorkspaceLayoutCollapsed {
  try {
    const raw = localStorage.getItem(WORKSPACE_LAYOUT_COLLAPSED_KEY)
    if (!raw) return DEFAULT_WORKSPACE_LAYOUT_COLLAPSED
    return normalizeLayoutCollapsed(JSON.parse(raw))
  } catch {
    return DEFAULT_WORKSPACE_LAYOUT_COLLAPSED
  }
}

function persistWorkspaceLayoutCollapsed(value: WorkspaceLayoutCollapsed): void {
  try {
    localStorage.setItem(WORKSPACE_LAYOUT_COLLAPSED_KEY, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

export function useWorkspaceLayoutCollapsed() {
  const [layoutCollapsed, setLayoutCollapsed] = useState(
    readStoredWorkspaceLayoutCollapsed,
  )

  useEffect(() => {
    persistWorkspaceLayoutCollapsed(layoutCollapsed)
  }, [layoutCollapsed])

  return [layoutCollapsed, setLayoutCollapsed] as const
}
