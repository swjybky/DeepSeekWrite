import { useEffect, useState } from 'react'
import {
  clampAiPanelWidth,
  persistAiPanelWidth,
  readStoredAiWidth,
} from './aiPanelLayout'

type UseAiPanelWidthOptions = {
  railWidth?: number
  splitterCount?: number
}

export function useAiPanelWidth({
  railWidth,
  splitterCount,
}: UseAiPanelWidthOptions = {}) {
  const [aiPanelWidth, setAiPanelWidth] = useState(() =>
    readStoredAiWidth(railWidth, splitterCount),
  )

  useEffect(() => {
    persistAiPanelWidth(aiPanelWidth)
  }, [aiPanelWidth])

  useEffect(() => {
    const onResize = () => {
      setAiPanelWidth((width) =>
        clampAiPanelWidth(width, window.innerWidth, railWidth, splitterCount),
      )
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [railWidth, splitterCount])

  return [aiPanelWidth, setAiPanelWidth] as const
}
