import { useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { clampWorkspaceRailWidth } from './railPanelLayout'

type Props = {
  railWidth: number
  setRailWidth: Dispatch<SetStateAction<number>>
}

export function WorkspaceRailSplitter({ railWidth, setRailWidth }: Props) {
  const splitDragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const releasePointer = (node: HTMLDivElement, pointerId: number) => {
    try {
      node.releasePointerCapture(pointerId)
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className="workspace-splitter workspace-splitter--rail"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整左侧栏目宽度"
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        splitDragRef.current = {
          startX: e.clientX,
          startWidth: railWidth,
        }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const drag = splitDragRef.current
        if (!drag) return
        const delta = e.clientX - drag.startX
        const next = drag.startWidth + delta
        setRailWidth(clampWorkspaceRailWidth(next, window.innerWidth))
      }}
      onPointerUp={(e) => {
        splitDragRef.current = null
        releasePointer(e.currentTarget, e.pointerId)
      }}
      onPointerCancel={(e) => {
        splitDragRef.current = null
        releasePointer(e.currentTarget, e.pointerId)
      }}
      onKeyDown={(e) => {
        const step = 16
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          setRailWidth((width) =>
            clampWorkspaceRailWidth(width - step, window.innerWidth),
          )
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          setRailWidth((width) =>
            clampWorkspaceRailWidth(width + step, window.innerWidth),
          )
        }
      }}
    />
  )
}
