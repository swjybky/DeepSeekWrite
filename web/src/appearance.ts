import { createContext, useContext } from 'react'
import {
  getStoredAppearanceStyle,
  normalizeAppearanceStyle,
  type AppearanceStyle,
} from './bridge'

export type AppearanceContextValue = {
  appearanceStyle: AppearanceStyle
  savingAppearance: boolean
  appearanceError: string | null
  setAppearanceStyle: (style: AppearanceStyle) => Promise<void>
}

export const AppearanceContext = createContext<AppearanceContextValue | null>(null)

export const APPEARANCE_STYLE_LABELS: Record<AppearanceStyle, string> = {
  classic: '古风',
  modern: '现代',
}

export function applyAppearanceStyle(style: AppearanceStyle): void {
  if (typeof document === 'undefined') return
  const normalized = normalizeAppearanceStyle(style)
  document.documentElement.dataset.appearance = normalized
  document.documentElement.style.colorScheme = 'light'
}

applyAppearanceStyle(getStoredAppearanceStyle())

export function useAppearance(): AppearanceContextValue {
  const value = useContext(AppearanceContext)
  if (!value) {
    throw new Error('useAppearance must be used within AppearanceProvider')
  }
  return value
}
