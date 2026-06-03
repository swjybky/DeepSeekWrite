import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from 'react'

const COMMIT_DEBOUNCE_MS = 400
const GUTTER_DEBOUNCE_MS = 180
const HEIGHT_SYNC_DEBOUNCE_MS = 180

export type DraftStageEditorMetrics = { total: number; nonSpace: number }

function textMetrics(text: string): DraftStageEditorMetrics {
  return {
    total: text.length,
    nonSpace: text.replace(/\p{White_Space}/gu, '').length,
  }
}

function splitLogicalLines(text: string): string[] {
  return text.split('\n')
}

function assignRef<T>(ref: Ref<T | null> | undefined, value: T | null) {
  if (!ref) return
  if (typeof ref === 'function') ref(value)
  else ref.current = value
}

type Props = {
  value: string
  /** 每次输入立即调用（用于 stagesRef，不落 React state） */
  onLiveChange: (value: string) => void
  /** 防抖后同步到上层 stages state */
  onCommit: (value: string) => void
  onMetrics?: (metrics: DraftStageEditorMetrics) => void
  readOnly?: boolean
  textareaRef?: Ref<HTMLTextAreaElement | null>
  /** 侧栏宽度变化时需重新测量换行高度 */
  resizeKey?: number
}

export const DraftStageEditor = memo(function DraftStageEditor({
  value,
  onLiveChange,
  onCommit,
  onMetrics,
  readOnly = false,
  textareaRef,
  resizeKey = 0,
}: Props) {
  const [localText, setLocalText] = useState(value)
  const localTextRef = useRef(value)
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )
  const gutterTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )
  const [gutterLines, setGutterLines] = useState(() => splitLogicalLines(value))

  const innerTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const gutterRef = useRef<HTMLDivElement | null>(null)
  const measureRef = useRef<HTMLDivElement | null>(null)

  const onLiveChangeRef = useRef(onLiveChange)
  const onCommitRef = useRef(onCommit)
  const onMetricsRef = useRef(onMetrics)
  useEffect(() => {
    onLiveChangeRef.current = onLiveChange
    onCommitRef.current = onCommit
    onMetricsRef.current = onMetrics
  })

  const setTextareaNode = useCallback(
    (el: HTMLTextAreaElement | null) => {
      innerTextareaRef.current = el
      assignRef(textareaRef, el)
    },
    [textareaRef],
  )

  const flushCommit = useCallback(() => {
    if (commitTimerRef.current !== undefined) {
      clearTimeout(commitTimerRef.current)
      commitTimerRef.current = undefined
    }
    onCommitRef.current(localTextRef.current)
  }, [])

  const scheduleCommit = useCallback(
    (next: string) => {
      if (commitTimerRef.current !== undefined) {
        clearTimeout(commitTimerRef.current)
      }
      commitTimerRef.current = setTimeout(() => {
        commitTimerRef.current = undefined
        onCommitRef.current(next)
      }, COMMIT_DEBOUNCE_MS)
    },
    [],
  )

  useEffect(() => {
    if (value !== localTextRef.current) {
      localTextRef.current = value
      setLocalText(value)
      setGutterLines(splitLogicalLines(value))
      onMetricsRef.current?.(textMetrics(value))
    }
  }, [value])

  useEffect(
    () => () => {
      if (commitTimerRef.current !== undefined) {
        clearTimeout(commitTimerRef.current)
      }
      if (gutterTimerRef.current !== undefined) {
        clearTimeout(gutterTimerRef.current)
      }
      onCommitRef.current(localTextRef.current)
    },
    [],
  )

  const handleChange = (next: string) => {
    localTextRef.current = next
    setLocalText(next)
    onLiveChangeRef.current(next)
    onMetricsRef.current?.(textMetrics(next))
    scheduleCommit(next)
    if (gutterTimerRef.current !== undefined) {
      clearTimeout(gutterTimerRef.current)
    }
    gutterTimerRef.current = setTimeout(() => {
      gutterTimerRef.current = undefined
      setGutterLines(splitLogicalLines(next))
    }, GUTTER_DEBOUNCE_MS)
  }

  const handleScroll = () => {
    const textarea = innerTextareaRef.current
    const gutter = gutterRef.current
    if (!textarea || !gutter) return
    gutter.scrollTop = textarea.scrollTop
  }

  useLayoutEffect(() => {
    const textarea = innerTextareaRef.current
    const gutter = gutterRef.current
    const measure = measureRef.current
    if (!textarea || !gutter || !measure) return

    let rafId = 0
    let debounceId = 0

    const syncLineNumberHeights = () => {
      const style = window.getComputedStyle(textarea)
      const paddingLeft = Number.parseFloat(style.paddingLeft) || 0
      const paddingRight = Number.parseFloat(style.paddingRight) || 0
      const contentWidth = Math.max(
        0,
        textarea.clientWidth - paddingLeft - paddingRight,
      )

      measure.style.width = `${contentWidth}px`
      measure.style.fontFamily = style.fontFamily
      measure.style.fontSize = style.fontSize
      measure.style.fontStyle = style.fontStyle
      measure.style.fontWeight = style.fontWeight
      measure.style.letterSpacing = style.letterSpacing
      measure.style.lineHeight = style.lineHeight
      measure.style.textTransform = style.textTransform
      measure.style.wordSpacing = style.wordSpacing
      measure.style.tabSize = style.tabSize

      const fallbackHeight =
        Number.parseFloat(style.lineHeight) ||
        Number.parseFloat(style.fontSize) * 1.55 ||
        22
      const measureRows = Array.from(measure.children) as HTMLElement[]
      const gutterRows = Array.from(
        gutter.querySelectorAll<HTMLElement>('.workspace-line-number'),
      )
      gutterRows.forEach((row, index) => {
        const measured = measureRows[index]?.offsetHeight ?? fallbackHeight
        row.style.height = `${Math.max(fallbackHeight, measured)}px`
      })
      gutter.scrollTop = textarea.scrollTop
    }

    const scheduleSync = () => {
      clearTimeout(debounceId)
      debounceId = window.setTimeout(() => {
        cancelAnimationFrame(rafId)
        rafId = requestAnimationFrame(syncLineNumberHeights)
      }, HEIGHT_SYNC_DEBOUNCE_MS)
    }

    scheduleSync()
    const resizeObserver = new ResizeObserver(scheduleSync)
    resizeObserver.observe(textarea)
    window.addEventListener('resize', scheduleSync)

    return () => {
      clearTimeout(debounceId)
      cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleSync)
    }
  }, [gutterLines, resizeKey])

  return (
    <div className="workspace-textarea-shell workspace-textarea-shell--line-numbers">
      <div
        ref={gutterRef}
        className="workspace-line-number-gutter"
        aria-hidden="true"
      >
        {gutterLines.map((_line, index) => (
          <div className="workspace-line-number" key={index}>
            {index + 1}
          </div>
        ))}
      </div>
      <textarea
        id="stage-body"
        ref={setTextareaNode}
        className="editor-body workspace-textarea workspace-textarea--with-line-numbers"
        value={localText}
        onChange={(e) => handleChange(e.target.value)}
        onScroll={handleScroll}
        onBlur={flushCommit}
        placeholder="在此编辑当前阶段内容…"
        spellCheck={false}
        readOnly={readOnly}
      />
      <div ref={measureRef} className="workspace-line-measure" aria-hidden="true">
        {gutterLines.map((line, index) => (
          <div className="workspace-line-measure-row" key={index}>
            {line || '\u00a0'}
          </div>
        ))}
      </div>
    </div>
  )
})
