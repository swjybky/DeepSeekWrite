import { type ReactNode, useEffect } from 'react'
import './AppDialog.css'

export type AppDialogVariant = 'default' | 'warning' | 'danger'

export type AppDialogOptions = {
  title: string
  message?: ReactNode
  details?: ReactNode
  confirmText?: string
  cancelText?: string
  variant?: AppDialogVariant
  hideCancel?: boolean
}

export type PendingDialog = {
  id: number
  options: AppDialogOptions
}

type AppDialogProps = {
  pending: PendingDialog
  onCancel: () => void
  onConfirm: () => void
}

function renderDialogBody(message: ReactNode) {
  return typeof message === 'string' ? <p>{message}</p> : message
}

export function AppDialog({ pending, onCancel, onConfirm }: AppDialogProps) {
  const {
    title,
    message,
    details,
    confirmText = '确认',
    cancelText = '取消',
    variant = 'default',
    hideCancel = false,
  } = pending.options
  const titleId = `app-dialog-title-${pending.id}`

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !hideCancel) onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hideCancel, onCancel])

  return (
    <div
      className="app-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !hideCancel) onCancel()
      }}
    >
      <section
        className={`app-dialog app-dialog--${variant}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="app-dialog-head">
          <span className="app-dialog-mark" aria-hidden="true">
            {variant === 'danger' || variant === 'warning' ? '!' : hideCancel ? 'i' : '?'}
          </span>
          <h2 id={titleId}>{title}</h2>
        </header>
        <div className="app-dialog-body">
          {message ? renderDialogBody(message) : null}
          {details ? <div className="app-dialog-details">{details}</div> : null}
        </div>
        <footer className="app-dialog-foot">
          {hideCancel ? null : (
            <button
              type="button"
              className="app-dialog-btn app-dialog-btn--secondary"
              onClick={onCancel}
            >
              {cancelText}
            </button>
          )}
          <button
            type="button"
            className={`app-dialog-btn app-dialog-btn--primary app-dialog-btn--${variant}`}
            autoFocus
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </footer>
      </section>
    </div>
  )
}
