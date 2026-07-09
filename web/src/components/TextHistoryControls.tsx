import { useEffect } from 'react'
import type { TextHistoryController } from '../hooks/useTextHistory'
import './TextHistoryControls.css'

type Props = {
  history: TextHistoryController
  historyKey: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  compact?: boolean
}

export function TextHistoryControls({
  history,
  historyKey,
  value,
  onChange,
  disabled = false,
  compact = false,
}: Props) {
  useEffect(() => {
    history.observe(historyKey, value)
  }, [history, historyKey, value])

  return (
    <div
      className={compact ? 'text-history-controls text-history-controls--compact' : 'text-history-controls'}
      aria-label="文本撤销与重做"
    >
      <button
        type="button"
        disabled={disabled || !history.canUndo(historyKey)}
        aria-label="撤销"
        title="撤销（Ctrl/Cmd+Z）"
        onMouseDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onClick={(event) => {
          event.stopPropagation()
          history.undo(historyKey, value, onChange)
        }}
      >
        <span aria-hidden>←</span>
        <span>撤销</span>
      </button>
      <button
        type="button"
        disabled={disabled || !history.canRedo(historyKey)}
        aria-label="重做"
        title="重做（Ctrl/Cmd+Shift+Z 或 Ctrl/Cmd+Y）"
        onMouseDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onClick={(event) => {
          event.stopPropagation()
          history.redo(historyKey, value, onChange)
        }}
      >
        <span aria-hidden>→</span>
        <span>重做</span>
      </button>
    </div>
  )
}
