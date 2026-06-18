import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type Ref,
} from 'react'
import { MarkdownTextEditor } from './MarkdownTextEditor'

const COMMIT_DEBOUNCE_MS = 400

export type DraftStageEditorMetrics = { total: number; nonSpace: number }

function textMetrics(text: string): DraftStageEditorMetrics {
  return {
    total: text.length,
    nonSpace: text.replace(/\p{White_Space}/gu, '').length,
  }
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
}

export const DraftStageEditor = memo(function DraftStageEditor({
  value,
  onLiveChange,
  onCommit,
  onMetrics,
  readOnly = false,
  textareaRef,
}: Props) {
  const [localText, setLocalText] = useState(value)
  const localTextRef = useRef(value)
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )

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
      onMetricsRef.current?.(textMetrics(value))
    }
  }, [value])

  useEffect(
    () => () => {
      if (commitTimerRef.current !== undefined) {
        clearTimeout(commitTimerRef.current)
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
  }

  return (
    <MarkdownTextEditor
      id="stage-body"
      textareaRef={setTextareaNode}
      className="editor-body workspace-textarea"
      value={localText}
      onValueChange={handleChange}
      onBlur={flushCommit}
      placeholder="在此编辑当前阶段内容…"
      spellCheck={false}
      readOnly={readOnly}
    />
  )
})
