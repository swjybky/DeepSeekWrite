import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import type { AiChatHistoryMetadata } from '../bridge/aiChatHistoryClient'
import './AiChatHistoryMenu.css'

type Props = {
  sessions: AiChatHistoryMetadata[]
  activeSessionId?: string
  loading?: boolean
  disabled?: boolean
  portalTargetId?: string
  onSelect: (sessionId: string) => void | Promise<void>
  onDelete: (sessionId: string) => void
}

function formatUpdatedAt(value: string): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function AiChatHistoryMenu({
  sessions,
  activeSessionId = '',
  loading = false,
  disabled = false,
  portalTargetId,
  onSelect,
  onDelete,
}: Props) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)

  useEffect(() => {
    let cancelled = false
    const updatePortalTarget = () => {
      if (cancelled) return
      setPortalTarget(portalTargetId ? document.getElementById(portalTargetId) : null)
    }
    queueMicrotask(updatePortalTarget)
    return () => {
      cancelled = true
    }
  }, [portalTargetId])

  const closeMenu = () => {
    const details = detailsRef.current
    details?.removeAttribute('open')
    const active = document.activeElement
    if (active instanceof HTMLElement && details?.contains(active)) {
      active.blur()
    }
  }

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const details = detailsRef.current
      if (!details?.open) return
      if (event.target instanceof Node && details.contains(event.target)) return
      closeMenu()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      closeMenu()
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [])

  const menu = (
    <details ref={detailsRef} className="ai-chat-history">
      <summary className="ai-chat-history-trigger">
        历史对话
        {loading ? <span className="ai-chat-history-dot" /> : null}
      </summary>
      <div className="ai-chat-history-menu">
        <div className="ai-chat-history-list">
          {sessions.length === 0 ? (
            <div className="ai-chat-history-empty">暂无历史</div>
          ) : (
            sessions.map((session) => {
              const active = session.id === activeSessionId
              return (
                <div
                  key={session.id}
                  className={
                    active
                      ? 'ai-chat-history-item ai-chat-history-item--active'
                      : 'ai-chat-history-item'
                  }
                >
                  <button
                    type="button"
                    className="ai-chat-history-select"
                    disabled={disabled}
                    title={session.title}
                    onClick={(event) => {
                      event.preventDefault()
                      void Promise.resolve(onSelect(session.id)).finally(closeMenu)
                    }}
                  >
                    <span className="ai-chat-history-title">{session.title}</span>
                    <span className="ai-chat-history-meta">
                      {formatUpdatedAt(session.updated_at)}
                      {session.message_count ? ` · ${session.message_count}` : ''}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ai-chat-history-delete"
                    aria-label={`删除历史：${session.title}`}
                    disabled={disabled}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      onDelete(session.id)
                    }}
                  >
                    删除
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>
    </details>
  )

  if (portalTarget) return createPortal(menu, portalTarget)
  if (portalTargetId) return null
  return menu
}
