import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  getAppearanceStyle,
  getStoredAppearanceStyle,
  normalizeAppearanceStyle,
  saveAppearanceStyle,
  setStoredAppearanceStyle,
  type AppearanceStyle,
} from './bridge'
import {
  AppearanceContext,
  applyAppearanceStyle,
  type AppearanceContextValue,
} from './appearance'

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearanceStyle, setAppearanceStyleState] = useState<AppearanceStyle>(
    () => getStoredAppearanceStyle(),
  )
  const [savingAppearance, setSavingAppearance] = useState(false)
  const [appearanceError, setAppearanceError] = useState<string | null>(null)

  useLayoutEffect(() => {
    applyAppearanceStyle(appearanceStyle)
  }, [appearanceStyle])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const style = await getAppearanceStyle()
        if (cancelled) return
        setAppearanceStyleState(style)
        applyAppearanceStyle(style)
        setAppearanceError(null)
      } catch (cause) {
        if (!cancelled) {
          setAppearanceError(cause instanceof Error ? cause.message : '加载风格配置失败')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const setAppearanceStyle = useCallback(
    async (style: AppearanceStyle) => {
      const next = normalizeAppearanceStyle(style)
      const previous = appearanceStyle
      if (next === previous) return

      setAppearanceError(null)
      setSavingAppearance(true)
      setAppearanceStyleState(next)
      applyAppearanceStyle(next)

      try {
        const saved = await saveAppearanceStyle(next)
        setAppearanceStyleState(saved)
        applyAppearanceStyle(saved)
      } catch (cause) {
        setStoredAppearanceStyle(previous)
        setAppearanceStyleState(previous)
        applyAppearanceStyle(previous)
        const message = cause instanceof Error ? cause.message : '保存风格配置失败'
        setAppearanceError(message)
        throw new Error(message, { cause })
      } finally {
        setSavingAppearance(false)
      }
    },
    [appearanceStyle],
  )

  const value = useMemo<AppearanceContextValue>(
    () => ({
      appearanceStyle,
      savingAppearance,
      appearanceError,
      setAppearanceStyle,
    }),
    [appearanceError, appearanceStyle, savingAppearance, setAppearanceStyle],
  )

  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  )
}
