import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  getStoredTextDisplayMode,
  getTextDisplayMode,
  normalizeTextDisplayMode,
  saveTextDisplayMode,
  setStoredTextDisplayMode,
  type TextDisplayMode,
} from './bridge'
import { TextDisplayContext, type TextDisplayContextValue } from './textDisplay'

export function TextDisplayProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<TextDisplayMode>(getStoredTextDisplayMode)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getTextDisplayMode()
      .then((saved) => {
        if (!cancelled) setModeState(saved)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '加载文字显示设置失败')
      })
    return () => { cancelled = true }
  }, [])

  const setMode = useCallback(async (nextMode: TextDisplayMode) => {
    const next = normalizeTextDisplayMode(nextMode)
    const previous = mode
    if (next === previous) return
    setError(null)
    setSaving(true)
    setModeState(next)
    try {
      setModeState(await saveTextDisplayMode(next))
    } catch (cause) {
      setStoredTextDisplayMode(previous)
      setModeState(previous)
      const message = cause instanceof Error ? cause.message : '保存文字显示设置失败'
      setError(message)
      throw new Error(message, { cause })
    } finally {
      setSaving(false)
    }
  }, [mode])

  const value = useMemo<TextDisplayContextValue>(
    () => ({ mode, saving, error, setMode }),
    [error, mode, saving, setMode],
  )

  return <TextDisplayContext.Provider value={value}>{children}</TextDisplayContext.Provider>
}
