import { useEffect, useState } from 'react'
import {
  clampWorkspaceRailWidth,
  persistWorkspaceRailWidth,
  readStoredWorkspaceRailWidth,
} from './railPanelLayout'

export function useWorkspaceRailWidth() {
  const [workspaceRailWidth, setWorkspaceRailWidth] = useState(
    readStoredWorkspaceRailWidth,
  )

  useEffect(() => {
    persistWorkspaceRailWidth(workspaceRailWidth)
  }, [workspaceRailWidth])

  useEffect(() => {
    const onResize = () => {
      setWorkspaceRailWidth((width) =>
        clampWorkspaceRailWidth(width, window.innerWidth),
      )
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return [workspaceRailWidth, setWorkspaceRailWidth] as const
}
