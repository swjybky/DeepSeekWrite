import { useCallback, useEffect, useRef, useState } from 'react'

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'retrying'

type KeyState = {
  revision: number
  savedRevision: number
  retryIndex: number
  debounceTimer?: number
  maxWaitTimer?: number
  retryTimer?: number
  inFlight?: Promise<boolean>
}

type Options<TSnapshot> = {
  getSnapshot: (key: string) => TSnapshot | null
  saveSnapshot: (key: string, snapshot: TSnapshot) => Promise<void>
  delayMs?: number
  maxWaitMs?: number
  retryDelaysMs?: readonly number[]
}

const DEFAULT_RETRY_DELAYS = [3000, 10_000, 30_000] as const

function freshKeyState(): KeyState {
  return {
    revision: 0,
    savedRevision: 0,
    retryIndex: 0,
  }
}

export function autoSaveStatusLabel(status: AutoSaveStatus): string {
  if (status === 'saving') return '保存中…'
  if (status === 'saved') return '已保存'
  if (status === 'retrying') return '保存失败，正在重试'
  return '自动保存'
}

export function useKeyedAutoSave<TSnapshot>({
  getSnapshot,
  saveSnapshot,
  delayMs = 1000,
  maxWaitMs = 5000,
  retryDelaysMs = DEFAULT_RETRY_DELAYS,
}: Options<TSnapshot>) {
  const statesRef = useRef<Record<string, KeyState>>({})
  const mountedRef = useRef(true)
  const getSnapshotRef = useRef(getSnapshot)
  const saveSnapshotRef = useRef(saveSnapshot)
  const retryDelaysRef = useRef(retryDelaysMs)
  const [statuses, setStatuses] = useState<Record<string, AutoSaveStatus>>({})

  useEffect(() => {
    getSnapshotRef.current = getSnapshot
    saveSnapshotRef.current = saveSnapshot
    retryDelaysRef.current = retryDelaysMs
  })

  const setStatus = useCallback((key: string, status: AutoSaveStatus) => {
    if (!mountedRef.current) return
    setStatuses((current) =>
      current[key] === status ? current : { ...current, [key]: status },
    )
  }, [])

  const stateFor = useCallback((key: string): KeyState => {
    const existing = statesRef.current[key]
    if (existing) return existing
    const created = freshKeyState()
    statesRef.current[key] = created
    return created
  }, [])

  const clearSaveTimers = useCallback((state: KeyState) => {
    if (state.debounceTimer !== undefined) {
      window.clearTimeout(state.debounceTimer)
      state.debounceTimer = undefined
    }
    if (state.maxWaitTimer !== undefined) {
      window.clearTimeout(state.maxWaitTimer)
      state.maxWaitTimer = undefined
    }
  }, [])

  const runSaveRef = useRef<(key: string) => Promise<boolean>>(async () => true)

  const scheduleRetry = useCallback(
    (key: string, state: KeyState) => {
      if (state.retryTimer !== undefined) window.clearTimeout(state.retryTimer)
      const delays = retryDelaysRef.current
      const delay = delays[Math.min(state.retryIndex, delays.length - 1)] ?? 30_000
      state.retryIndex += 1
      state.retryTimer = window.setTimeout(() => {
        state.retryTimer = undefined
        void runSaveRef.current(key)
      }, delay)
    },
    [],
  )

  const runSave = useCallback(
    async (key: string): Promise<boolean> => {
      const state = stateFor(key)
      if (state.inFlight) return state.inFlight
      if (state.savedRevision >= state.revision) {
        setStatus(key, 'saved')
        return true
      }

      clearSaveTimers(state)
      if (state.retryTimer !== undefined) {
        window.clearTimeout(state.retryTimer)
        state.retryTimer = undefined
      }
      const snapshot = getSnapshotRef.current(key)
      if (snapshot == null) return false
      const targetRevision = state.revision
      setStatus(key, 'saving')

      const task = (async () => {
        try {
          await saveSnapshotRef.current(key, snapshot)
          state.savedRevision = Math.max(state.savedRevision, targetRevision)
          state.retryIndex = 0
          if (state.savedRevision >= state.revision) {
            setStatus(key, 'saved')
          }
          return true
        } catch {
          setStatus(key, 'retrying')
          scheduleRetry(key, state)
          return false
        } finally {
          state.inFlight = undefined
        }
      })()
      state.inFlight = task
      const ok = await task
      if (ok && state.savedRevision < state.revision) {
        void runSaveRef.current(key)
      }
      return ok
    },
    [clearSaveTimers, scheduleRetry, setStatus, stateFor],
  )

  useEffect(() => {
    runSaveRef.current = runSave
  }, [runSave])

  const schedule = useCallback(
    (key: string) => {
      if (!key) return
      const state = stateFor(key)
      state.revision += 1
      if (state.retryTimer !== undefined) {
        window.clearTimeout(state.retryTimer)
        state.retryTimer = undefined
        state.retryIndex = 0
      }
      if (state.debounceTimer !== undefined) {
        window.clearTimeout(state.debounceTimer)
      }
      state.debounceTimer = window.setTimeout(() => {
        state.debounceTimer = undefined
        void runSaveRef.current(key)
      }, delayMs)
      if (state.maxWaitTimer === undefined) {
        state.maxWaitTimer = window.setTimeout(() => {
          state.maxWaitTimer = undefined
          void runSaveRef.current(key)
        }, maxWaitMs)
      }
      setStatus(key, 'idle')
    },
    [delayMs, maxWaitMs, setStatus, stateFor],
  )

  const markSaved = useCallback(
    (key: string) => {
      if (!key) return
      const state = stateFor(key)
      clearSaveTimers(state)
      if (state.retryTimer !== undefined) {
        window.clearTimeout(state.retryTimer)
        state.retryTimer = undefined
      }
      state.savedRevision = state.revision
      state.retryIndex = 0
      setStatus(key, 'idle')
    },
    [clearSaveTimers, setStatus, stateFor],
  )

  const flush = useCallback(
    async (key: string): Promise<boolean> => {
      if (!key) return true
      const state = stateFor(key)
      clearSaveTimers(state)
      if (state.inFlight) await state.inFlight
      while (state.savedRevision < state.revision) {
        const ok = await runSaveRef.current(key)
        if (!ok) return false
        if (state.inFlight) await state.inFlight
      }
      return true
    },
    [clearSaveTimers, stateFor],
  )

  const flushAll = useCallback(async (): Promise<boolean> => {
    const keys = Object.keys(statesRef.current)
    const results = await Promise.all(keys.map((key) => flush(key)))
    return results.every(Boolean)
  }, [flush])

  const hasPending = useCallback((key?: string): boolean => {
    if (key) {
      const state = statesRef.current[key]
      return Boolean(state && state.savedRevision < state.revision)
    }
    return Object.values(statesRef.current).some(
      (state) => state.savedRevision < state.revision,
    )
  }, [])

  useEffect(() => {
    mountedRef.current = true
    const states = statesRef.current
    return () => {
      mountedRef.current = false
      for (const state of Object.values(states)) {
        clearSaveTimers(state)
        if (state.retryTimer !== undefined) window.clearTimeout(state.retryTimer)
      }
    }
  }, [clearSaveTimers])

  return {
    flush,
    flushAll,
    hasPending,
    markSaved,
    schedule,
    statuses,
    statusFor: (key: string | undefined): AutoSaveStatus =>
      key ? statuses[key] ?? 'idle' : 'idle',
  }
}
