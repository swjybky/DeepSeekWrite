import { useCallback, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

export type TextHistoryChangeKind = 'typing' | 'atomic' | 'external' | 'stream'

type TextHistoryShortcutOptions = {
  redoKey?: string
  standardRedo?: boolean
}

type HistoryEntry = {
  undo: string[]
  redo: string[]
  current: string
  groupKind: TextHistoryChangeKind | null
  lastChangedAt: number
}

const MAX_HISTORY = 50
const TYPING_GROUP_MS = 700
const EXTERNAL_GROUP_MS = 10_000

function trimHistory(values: string[]): string[] {
  return values.length <= MAX_HISTORY ? values : values.slice(-MAX_HISTORY)
}

export function useTextHistory() {
  const entriesRef = useRef<Record<string, HistoryEntry>>({})
  const [, setRevision] = useState(0)

  const bump = useCallback(() => setRevision((value) => value + 1), [])

  const entryFor = useCallback((key: string, value: string): HistoryEntry => {
    const existing = entriesRef.current[key]
    if (existing) return existing
    const created: HistoryEntry = {
      undo: [],
      redo: [],
      current: value,
      groupKind: null,
      lastChangedAt: 0,
    }
    entriesRef.current[key] = created
    return created
  }, [])

  const record = useCallback(
    (
      key: string,
      previous: string,
      next: string,
      kind: TextHistoryChangeKind = 'typing',
    ) => {
      if (previous === next) return
      const entry = entryFor(key, previous)
      const now = Date.now()
      const groupWindow = kind === 'typing' ? TYPING_GROUP_MS : EXTERNAL_GROUP_MS
      const grouped =
        kind !== 'atomic' &&
        entry.groupKind === kind &&
        now - entry.lastChangedAt <= groupWindow
      if (!grouped) entry.undo = trimHistory([...entry.undo, previous])
      entry.redo = []
      entry.current = next
      entry.groupKind = kind
      entry.lastChangedAt = now
      bump()
    },
    [bump, entryFor],
  )

  const observe = useCallback(
    (key: string, value: string) => {
      const entry = entryFor(key, value)
      if (entry.current === value) return
      record(key, entry.current, value, 'external')
    },
    [entryFor, record],
  )

  const endGroup = useCallback((key: string) => {
    const entry = entriesRef.current[key]
    if (!entry) return
    entry.groupKind = null
    entry.lastChangedAt = 0
  }, [])

  const clear = useCallback(
    (key: string, value = '') => {
      entriesRef.current[key] = {
        undo: [],
        redo: [],
        current: value,
        groupKind: null,
        lastChangedAt: 0,
      }
      bump()
    },
    [bump],
  )

  const undo = useCallback(
    (key: string, current: string, apply: (value: string) => void) => {
      const entry = entryFor(key, current)
      const previous = entry.undo.pop()
      if (previous === undefined) return
      entry.redo = trimHistory([...entry.redo, current])
      entry.current = previous
      entry.groupKind = null
      apply(previous)
      bump()
    },
    [bump, entryFor],
  )

  const redo = useCallback(
    (key: string, current: string, apply: (value: string) => void) => {
      const entry = entryFor(key, current)
      const next = entry.redo.pop()
      if (next === undefined) return
      entry.undo = trimHistory([...entry.undo, current])
      entry.current = next
      entry.groupKind = null
      apply(next)
      bump()
    },
    [bump, entryFor],
  )

  const change = useCallback(
    (
      key: string,
      previous: string,
      next: string,
      apply: (value: string) => void,
      kind: TextHistoryChangeKind = 'typing',
    ) => {
      record(key, previous, next, kind)
      apply(next)
    },
    [record],
  )

  const handleKeyDown = useCallback(
    (
      event: KeyboardEvent<HTMLElement>,
      key: string,
      current: string,
      apply: (value: string) => void,
      options?: TextHistoryShortcutOptions,
    ) => {
      if (!(event.ctrlKey || event.metaKey)) return
      const pressed = event.key.toLowerCase()
      const standardRedoPressed =
        (pressed === 'z' && event.shiftKey) || pressed === 'y'
      if (pressed === 'z' && !event.shiftKey) {
        event.preventDefault()
        undo(key, current, apply)
      } else if (options?.redoKey && pressed === options.redoKey.toLowerCase()) {
        event.preventDefault()
        redo(key, current, apply)
      } else if (standardRedoPressed) {
        event.preventDefault()
        if (options?.standardRedo !== false) redo(key, current, apply)
      }
    },
    [redo, undo],
  )

  const canRedo = useCallback(
    (key: string) => (entriesRef.current[key]?.redo.length ?? 0) > 0,
    [],
  )
  const canUndo = useCallback(
    (key: string) => (entriesRef.current[key]?.undo.length ?? 0) > 0,
    [],
  )

  return useMemo(
    () => ({
      canRedo,
      canUndo,
      change,
      clear,
      endGroup,
      handleKeyDown,
      observe,
      record,
      redo,
      undo,
    }),
    [
      canRedo,
      canUndo,
      change,
      clear,
      endGroup,
      handleKeyDown,
      observe,
      record,
      redo,
      undo,
    ],
  )
}

export type TextHistoryController = ReturnType<typeof useTextHistory>
