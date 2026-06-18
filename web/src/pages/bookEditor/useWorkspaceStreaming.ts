import { useCallback } from 'react'
import type { MutableRefObject } from 'react'
import {
  type Book,
  type StageId,
  mergeStagePatchIntoAll,
} from '../../bridge'
import type { ApplyToStageEditorPayload } from '../../pi/workspaceStageAgents'
import type { BookWorkspaceSessionState } from '../../stores/workspaceStore'
import { PLOT_STAGE_ID } from '../../workspaces/short/stages'
import { isPlotChildStageId } from './stageEditing'
import { syncWorkspaceStageTextarea } from './liveStageBody'

type CommitWorkspaceSession = (
  bookId: string,
  updater: (current: BookWorkspaceSessionState) => BookWorkspaceSessionState,
  syncActive?: boolean,
) => BookWorkspaceSessionState | null

type UseWorkspaceStreamingInput = {
  bookRef: MutableRefObject<Book | null>
  workspaceSessionsRef: MutableRefObject<Record<string, BookWorkspaceSessionState>>
  activeStageRef: MutableRefObject<StageId>
  activePlotChildStageRef: MutableRefObject<string>
  textareaRefsRef: MutableRefObject<
    Partial<Record<StageId, HTMLTextAreaElement | null>>
  >
  tokenBuffersRef: MutableRefObject<Partial<Record<StageId, string>>>
  tokenBufferRafRefsRef: MutableRefObject<Partial<Record<StageId, number>>>
  tokenBuffersByBookRef: MutableRefObject<
    Record<string, Partial<Record<StageId, string>>>
  >
  tokenBufferRafByBookRef: MutableRefObject<
    Record<string, Partial<Record<StageId, number>>>
  >
  streamingStagesRef: MutableRefObject<Partial<Record<StageId, boolean>>>
  commitWorkspaceSession: CommitWorkspaceSession
  recordTextChange?: (
    bookId: string,
    stageId: StageId,
    previous: string,
    next: string,
    kind: 'atomic' | 'stream',
  ) => void
  endTextHistoryGroup?: (bookId: string, stageId: StageId) => void
}

export function useWorkspaceStreaming({
  bookRef,
  workspaceSessionsRef,
  activeStageRef,
  activePlotChildStageRef,
  textareaRefsRef,
  tokenBuffersRef,
  tokenBufferRafRefsRef,
  tokenBuffersByBookRef,
  tokenBufferRafByBookRef,
  streamingStagesRef,
  commitWorkspaceSession,
  recordTextChange,
  endTextHistoryGroup,
}: UseWorkspaceStreamingInput) {
  const setEditorStreamingForBook = useCallback(
    (bookId: string, stageId: StageId, next: boolean) => {
      const current =
        bookRef.current?.id === bookId
          ? streamingStagesRef.current
          : workspaceSessionsRef.current[bookId]?.streamingStages ?? {}
      if (Boolean(current[stageId]) === next) return
      const updated = { ...current }
      if (next) {
        updated[stageId] = true
      } else {
        delete updated[stageId]
      }
      commitWorkspaceSession(
        bookId,
        (session) => ({
          ...session,
          streamingStages: updated,
        }),
        true,
      )
    },
    [bookRef, commitWorkspaceSession, streamingStagesRef, workspaceSessionsRef],
  )

  const updateStageForBook = useCallback(
    (
      bookId: string,
      stageId: StageId,
      updater: (current: string) => string,
    ) => {
      const session = commitWorkspaceSession(bookId, (session) => {
        const current = session.stages[stageId] ?? ''
        const next = updater(current)
        if (next === current) return session
        const updatedStages = { ...session.stages, [stageId]: next }
        return {
          ...session,
          stages: updatedStages,
          book: {
            ...session.book,
            stages: mergeStagePatchIntoAll(session.book.stages, updatedStages),
            content: updatedStages.draft ?? session.book.content,
          },
        }
      })
      if (session && bookRef.current?.id === bookId) {
        syncWorkspaceStageTextarea(
          textareaRefsRef,
          stageId,
          session.stages[stageId] ?? '',
        )
      }
    },
    [bookRef, commitWorkspaceSession, textareaRefsRef],
  )

  const updateStage = useCallback(
    (stageId: StageId, updater: (current: string) => string) => {
      const currentBookId = bookRef.current?.id
      if (!currentBookId) return
      updateStageForBook(currentBookId, stageId, updater)
    },
    [bookRef, updateStageForBook],
  )

  const cancelTokenFlushForBook = useCallback((bookId: string, stageId: StageId) => {
    const stageRafs = { ...(tokenBufferRafByBookRef.current[bookId] ?? {}) }
    const rafId = stageRafs[stageId]
    if (rafId !== undefined) {
      cancelAnimationFrame(rafId)
      delete stageRafs[stageId]
    }
    tokenBufferRafByBookRef.current[bookId] = stageRafs
    if (bookRef.current?.id === bookId) {
      tokenBufferRafRefsRef.current = stageRafs
    }
  }, [bookRef, tokenBufferRafByBookRef, tokenBufferRafRefsRef])

  const cancelTokenFlush = useCallback(
    (stageId: StageId) => {
      const currentBookId = bookRef.current?.id
      if (!currentBookId) return
      cancelTokenFlushForBook(currentBookId, stageId)
    },
    [bookRef, cancelTokenFlushForBook],
  )

  const flushTokenBufferForBook = useCallback(
    (bookId: string, stageId: StageId) => {
      const stageRafs = { ...(tokenBufferRafByBookRef.current[bookId] ?? {}) }
      delete stageRafs[stageId]
      tokenBufferRafByBookRef.current[bookId] = stageRafs

      const buffers = { ...(tokenBuffersByBookRef.current[bookId] ?? {}) }
      const buffer = buffers[stageId] ?? ''
      if (!buffer) return
      delete buffers[stageId]
      tokenBuffersByBookRef.current[bookId] = buffers

      if (bookRef.current?.id === bookId) {
        tokenBuffersRef.current = buffers
        tokenBufferRafRefsRef.current = stageRafs
      }
      updateStageForBook(bookId, stageId, (cur) => cur + buffer)
    },
    [
      bookRef,
      tokenBufferRafByBookRef,
      tokenBufferRafRefsRef,
      tokenBuffersByBookRef,
      tokenBuffersRef,
      updateStageForBook,
    ],
  )

  const flushAllTokenBuffersForBook = useCallback(
    (bookId: string) => {
      const rafIds = Object.values(tokenBufferRafByBookRef.current[bookId] ?? {})
      tokenBufferRafByBookRef.current[bookId] = {}
      rafIds.forEach((rafId) => {
        if (rafId !== undefined) cancelAnimationFrame(rafId)
      })

      const buffers = tokenBuffersByBookRef.current[bookId] ?? {}
      tokenBuffersByBookRef.current[bookId] = {}
      if (bookRef.current?.id === bookId) {
        tokenBuffersRef.current = {}
        tokenBufferRafRefsRef.current = {}
      }
      for (const [stageId, buffer] of Object.entries(buffers) as [
        StageId,
        string | undefined,
      ][]) {
        if (!buffer) continue
        updateStageForBook(bookId, stageId, (cur) => cur + buffer)
      }
    },
    [
      bookRef,
      tokenBufferRafByBookRef,
      tokenBufferRafRefsRef,
      tokenBuffersByBookRef,
      tokenBuffersRef,
      updateStageForBook,
    ],
  )

  const autoScrollTextarea = useCallback((stageId: StageId) => {
    const active = activeStageRef.current
    const activePlotChild = activePlotChildStageRef.current
    const visible =
      active === stageId ||
      (active === PLOT_STAGE_ID &&
        isPlotChildStageId(stageId) &&
        (!activePlotChild || activePlotChild === stageId))
    if (!visible) return
    const textarea = textareaRefsRef.current[stageId] ?? null
    if (!textarea) return
    const wasAtBottom =
      textarea.scrollHeight - textarea.scrollTop <= textarea.clientHeight + 20
    if (wasAtBottom) {
      // DOM refs are intentionally imperative here: this mirrors the previous
      // editor behavior after token flushes without routing scroll through React.
      // eslint-disable-next-line react-hooks/immutability
      textarea.scrollTop = textarea.scrollHeight
    }
  }, [activePlotChildStageRef, activeStageRef, textareaRefsRef])

  const applyToStageEditorForBook = useCallback(
    (bookId: string, stage: StageId, payload: ApplyToStageEditorPayload) => {
      const requestedTarget = String(payload.targetStageId ?? '').trim()
      const targetStage =
        stage === PLOT_STAGE_ID
          ? isPlotChildStageId(requestedTarget)
            ? requestedTarget
            : workspaceSessionsRef.current[bookId]?.activePlotChildStage ||
              PLOT_STAGE_ID
          : stage
      tokenBuffersByBookRef.current[bookId] =
        tokenBuffersByBookRef.current[bookId] ?? {}
      tokenBufferRafByBookRef.current[bookId] =
        tokenBufferRafByBookRef.current[bookId] ?? {}
      if (payload.mode === 'replace') {
        cancelTokenFlushForBook(bookId, targetStage)
        tokenBuffersByBookRef.current[bookId] = {
          ...(tokenBuffersByBookRef.current[bookId] ?? {}),
          [targetStage]: undefined,
        }
        setEditorStreamingForBook(bookId, targetStage, false)
        const current =
          (workspaceSessionsRef.current[bookId]?.stages[targetStage] ?? '') +
          (tokenBuffersByBookRef.current[bookId]?.[targetStage] ?? '')
        const next = payload.text.trim()
        // 流式覆盖会先用空文本清空编辑器，再逐 token 写入。
        // 将清空动作并入同一个 stream 历史组，避免撤销时先回到空文本。
        recordTextChange?.(
          bookId,
          targetStage,
          current,
          next,
          next.length === 0 ? 'stream' : 'atomic',
        )
        updateStageForBook(bookId, targetStage, () => next)
        if (bookRef.current?.id === bookId) {
          requestAnimationFrame(() => autoScrollTextarea(targetStage))
        }
        return
      }

      if (payload.mode === 'append_token') {
        if (!payload.text) return
        setEditorStreamingForBook(bookId, targetStage, true)
        const current =
          (workspaceSessionsRef.current[bookId]?.stages[targetStage] ?? '') +
          (tokenBuffersByBookRef.current[bookId]?.[targetStage] ?? '')
        recordTextChange?.(
          bookId,
          targetStage,
          current,
          current + payload.text,
          'stream',
        )
        const buffers = { ...(tokenBuffersByBookRef.current[bookId] ?? {}) }
        buffers[targetStage] = (buffers[targetStage] ?? '') + payload.text
        tokenBuffersByBookRef.current[bookId] = buffers
        const rafs = { ...(tokenBufferRafByBookRef.current[bookId] ?? {}) }
        if (rafs[targetStage] === undefined) {
          rafs[targetStage] = requestAnimationFrame(() => {
            flushTokenBufferForBook(bookId, targetStage)
            if (bookRef.current?.id === bookId) {
              requestAnimationFrame(() => autoScrollTextarea(targetStage))
            }
          })
          tokenBufferRafByBookRef.current[bookId] = rafs
        }
        if (bookRef.current?.id === bookId) {
          tokenBuffersRef.current = buffers
          tokenBufferRafRefsRef.current = rafs
        }
        return
      }

      if (payload.mode === 'streaming_end') {
        cancelTokenFlushForBook(bookId, targetStage)
        flushTokenBufferForBook(bookId, targetStage)
        setEditorStreamingForBook(bookId, targetStage, false)
        endTextHistoryGroup?.(bookId, targetStage)
        return
      }

      cancelTokenFlushForBook(bookId, targetStage)
      tokenBuffersByBookRef.current[bookId] = {
        ...(tokenBuffersByBookRef.current[bookId] ?? {}),
        [targetStage]: undefined,
      }
      setEditorStreamingForBook(bookId, targetStage, false)
      const trimmed = payload.text.trim()
      if (!trimmed) return
      const current = workspaceSessionsRef.current[bookId]?.stages[targetStage] ?? ''
      const sep = current.length === 0 ? '' : current.endsWith('\n') ? '\n' : '\n\n'
      const next = current + sep + trimmed
      recordTextChange?.(bookId, targetStage, current, next, 'atomic')
      updateStageForBook(bookId, targetStage, (cur) => {
        const sep = cur.length === 0 ? '' : cur.endsWith('\n') ? '\n' : '\n\n'
        return cur + sep + trimmed
      })
      if (bookRef.current?.id === bookId) {
        requestAnimationFrame(() => autoScrollTextarea(targetStage))
      }
    },
    [
      autoScrollTextarea,
      bookRef,
      cancelTokenFlushForBook,
      endTextHistoryGroup,
      flushTokenBufferForBook,
      recordTextChange,
      setEditorStreamingForBook,
      tokenBufferRafByBookRef,
      tokenBufferRafRefsRef,
      tokenBuffersByBookRef,
      tokenBuffersRef,
      updateStageForBook,
      workspaceSessionsRef,
    ],
  )

  return {
    applyToStageEditorForBook,
    cancelTokenFlush,
    flushAllTokenBuffersForBook,
    updateStage,
  }
}
