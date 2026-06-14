import { useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { clampAiPanelWidth } from './aiPanelLayout'

type Props = {
  aiPanelWidth: number
  setAiPanelWidth: Dispatch<SetStateAction<number>>
}

export function WorkspaceSplitter({ aiPanelWidth, setAiPanelWidth }: Props) {
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
      className="workspace-splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整对话区宽度"
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        splitDragRef.current = {
          startX: e.clientX,
          startWidth: aiPanelWidth,
        }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const drag = splitDragRef.current
        if (!drag) return
        const delta = e.clientX - drag.startX
        const next = drag.startWidth + delta
        setAiPanelWidth(clampAiPanelWidth(next, window.innerWidth))
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
          setAiPanelWidth((width) =>
            clampAiPanelWidth(width - step, window.innerWidth),
          )
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          setAiPanelWidth((width) =>
            clampAiPanelWidth(width + step, window.innerWidth),
          )
        }
      }}
    />
  )
}
