import { useEffect, useState } from 'react'
import {
  clampAiPanelWidth,
  persistAiPanelWidth,
  readStoredAiWidth,
} from './aiPanelLayout'

export function useAiPanelWidth() {
  const [aiPanelWidth, setAiPanelWidth] = useState(readStoredAiWidth)

  useEffect(() => {
    persistAiPanelWidth(aiPanelWidth)
  }, [aiPanelWidth])

  useEffect(() => {
    const onResize = () => {
      setAiPanelWidth((width) => clampAiPanelWidth(width, window.innerWidth))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return [aiPanelWidth, setAiPanelWidth] as const
}
