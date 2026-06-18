import { createContext, useContext } from 'react'
import type { TextDisplayMode } from './bridge'

export type TextDisplayContextValue = {
  mode: TextDisplayMode
  saving: boolean
  error: string | null
  setMode: (mode: TextDisplayMode) => Promise<void>
}

export const TextDisplayContext = createContext<TextDisplayContextValue | null>(null)

export const TEXT_DISPLAY_MODE_LABELS: Record<TextDisplayMode, string> = {
  text: '文本模式',
  markdown: 'MD 模式',
}

export function useTextDisplay(): TextDisplayContextValue {
  const value = useContext(TextDisplayContext)
  if (!value) throw new Error('useTextDisplay must be used within TextDisplayProvider')
  return value
}
