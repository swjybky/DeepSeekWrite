import { useMemo, useState, type ReactNode, type SetStateAction } from 'react'
import type { MemoryEntry, MemoryTag } from '../domain/workspaceCore'
import {
  MEMORY_TAGS,
  createEmptyMemory,
  normalizeMemoryEntries,
} from '../bridge'
import './MemoryManagerDialog.css'

const MEMORY_TAG_LABELS: Record<MemoryTag, string> = {
  general: '通用',
  character: '人设',
  plot: '剧情',
  outline: '大纲',
  draft: '正文',
  style: '文风',
}

type DraftState = {
  resetKey: string | number | null
  items: MemoryEntry[]
}

type Props = {
  title: string
  memories: MemoryEntry[]
  saving?: boolean
  loading?: boolean
  error?: string | null
  resetKey?: string | number
  titleActions?: ReactNode
  headerActions?: ReactNode
  onClose: () => void
  onSave: (memories: MemoryEntry[]) => void | Promise<void>
  onSyncMemory?: (memory: MemoryEntry) => void | Promise<void>
}

export function MemoryManagerDialog({
  title,
  memories,
  saving = false,
  loading = false,
  error = null,
  resetKey,
  titleActions,
  headerActions,
  onClose,
  onSave,
  onSyncMemory,
}: Props) {
  const normalizedMemories = useMemo(() => normalizeMemoryEntries(memories), [memories])
  const activeResetKey = resetKey ?? null
  const [draftState, setDraftState] = useState<DraftState>(() => ({
    resetKey: activeResetKey,
    items: normalizedMemories,
  }))
  const [syncingId, setSyncingId] = useState('')
  const busy = saving || loading

  const shouldResetDraft = activeResetKey != null && draftState.resetKey !== activeResetKey
  const draft = shouldResetDraft ? normalizedMemories : draftState.items
  if (shouldResetDraft) {
    setDraftState({
      resetKey: activeResetKey,
      items: normalizedMemories,
    })
  }

  const setDraft = (updater: SetStateAction<MemoryEntry[]>) => {
    setDraftState((state) => {
      const currentItems =
        activeResetKey != null && state.resetKey !== activeResetKey
          ? normalizedMemories
          : state.items
      const nextItems =
        typeof updater === 'function' ? updater(currentItems) : updater
      return {
        resetKey: activeResetKey,
        items: nextItems,
      }
    })
  }

  const hasContent = useMemo(
    () => draft.some((item) => item.content.trim()),
    [draft],
  )

  const updateMemory = (
    id: string,
    patch: Partial<Pick<MemoryEntry, 'tag' | 'content'>>,
  ) => {
    setDraft((items) =>
      items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    )
  }

  const addMemory = () => {
    setDraft((items) => [...items, createEmptyMemory()])
  }

  const removeMemory = (id: string) => {
    setDraft((items) => items.filter((item) => item.id !== id))
  }

  const save = async () => {
    await onSave(normalizeMemoryEntries(draft))
  }

  const syncMemory = async (memory: MemoryEntry) => {
    if (!onSyncMemory || !memory.content.trim()) return
    setSyncingId(memory.id)
    try {
      await onSyncMemory(memory)
    } finally {
      setSyncingId('')
    }
  }

  return (
    <div className="memory-dialog-backdrop" role="dialog" aria-modal="true">
      <div className="memory-dialog">
        <header className="memory-dialog-head">
          <div className="memory-dialog-title-row">
            <h2>{title}</h2>
            {titleActions}
          </div>
          <div className="memory-dialog-head-actions">
            {headerActions}
            <button
              type="button"
              className="memory-dialog-close"
              aria-label="关闭"
              onClick={onClose}
              disabled={busy}
            >
              ×
            </button>
          </div>
        </header>
        <div className="memory-dialog-body">
          {error ? (
            <p className="memory-dialog-error" role="alert">
              {error}
            </p>
          ) : null}
          {loading ? (
            <p className="memory-dialog-loading">记忆加载中</p>
          ) : draft.length === 0 ? (
            <p className="memory-dialog-empty">暂无记忆</p>
          ) : (
            <div className="memory-list">
              {draft.map((memory) => (
                <div className="memory-item" key={memory.id}>
                  <div className="memory-item-toolbar">
                    <select
                      className="memory-tag-select"
                      value={memory.tag}
                      onChange={(event) =>
                        updateMemory(memory.id, {
                          tag: event.target.value as MemoryTag,
                        })
                      }
                    >
                      {MEMORY_TAGS.map((tag) => (
                        <option key={tag} value={tag}>
                          {MEMORY_TAG_LABELS[tag]}
                        </option>
                      ))}
                    </select>
                    <div className="memory-item-actions">
                      {onSyncMemory ? (
                        <button
                          type="button"
                          className="memory-link-button"
                          disabled={busy || syncingId === memory.id || !memory.content.trim()}
                          onClick={() => void syncMemory(memory)}
                        >
                          {syncingId === memory.id ? '同步中' : '同步到用户记忆'}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="memory-delete-button"
                        disabled={busy}
                        onClick={() => removeMemory(memory.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                  <textarea
                    className="memory-textarea"
                    value={memory.content}
                    onChange={(event) =>
                      updateMemory(memory.id, { content: event.target.value })
                    }
                    rows={3}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
        <footer className="memory-dialog-foot">
          <button
            type="button"
            className="memory-secondary-button"
            onClick={addMemory}
            disabled={busy}
          >
            新增记忆
          </button>
          <div className="memory-dialog-foot-actions">
            <button
              type="button"
              className="memory-secondary-button"
              onClick={onClose}
              disabled={busy}
            >
              取消
            </button>
            <button
              type="button"
              className="memory-primary-button"
              onClick={() => void save()}
              disabled={busy || (!hasContent && draft.length > 0)}
            >
              {saving ? '保存中' : '保存'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
