import { useCallback, useRef, useState } from 'react'
import type { Agent } from '@earendil-works/pi-agent-core'
import type { MutableRefObject } from 'react'

import {
  commitLongChapter as commitLongChapterViaBridge,
  resolveWorkspaceBookGenre,
  type Book,
  type MemoryEntry,
  type StageId,
  type WorkspaceAgentReadAccessConfig,
} from '../../bridge'
import type { BookWorkspaceSessionState } from '../../stores/workspaceStore'
import {
  chapterStageIdsForWritingScope,
  runLongChapterWriter,
} from '../../workspaces/long/chapterWriter'
import {
  runLongLedgerAgent,
  type LongLedgerUpdates,
} from '../../workspaces/long/ledgerAgent'
import {
  longWorkspaceCombinedDraft,
  longWorkspaceToFlatStages,
  normalizeLongWorkspace,
  type LongWorkspace,
} from '../../workspaces/long/longWorkspace'
import {
  EXPERT_SECTION_WRITER_AGENT_ID,
  resolveWorkspaceAgentReadAccess as resolveLongReadAccess,
} from '../../workspaces/long/stageReadAccess'

type CommitWorkspaceSession = (
  bookId: string,
  updater: (current: BookWorkspaceSessionState) => BookWorkspaceSessionState,
  syncActive?: boolean,
) => BookWorkspaceSessionState | null

export type LongWritingScopeInput = {
  scope: 'chapter' | 'arc' | 'volume'
  chapterStageId?: string
  arcId?: string
  volumeId?: string
  userWritingPrompt?: string
}

type UseLongWorkspaceRuntimeInput = {
  bookRef: MutableRefObject<Book | null>
  workspaceSessionsRef: MutableRefObject<Record<string, BookWorkspaceSessionState>>
  workspaceAgentReadAccess: WorkspaceAgentReadAccessConfig
  userMemories: MemoryEntry[]
  commitWorkspaceSession: CommitWorkspaceSession
  saveBookSession: (bookId: string) => Promise<Book | null>
  waitForSaveIdle?: (timeoutMs?: number) => Promise<boolean>
  setError: (message: string | null) => void
  setMessage: (message: string | null) => void
}

function sessionWithLongWorkspace(
  session: BookWorkspaceSessionState,
  longWorkspace: LongWorkspace,
): BookWorkspaceSessionState {
  const stages = longWorkspaceToFlatStages(longWorkspace, session.stages)
  return {
    ...session,
    longWorkspace,
    stages: stages as Record<StageId, string>,
    book: {
      ...session.book,
      long_workspace: longWorkspace,
      stages,
      content: longWorkspaceCombinedDraft(longWorkspace),
    },
  }
}

export function useLongWorkspaceRuntime({
  bookRef,
  workspaceSessionsRef,
  workspaceAgentReadAccess,
  userMemories,
  commitWorkspaceSession,
  saveBookSession,
  waitForSaveIdle,
  setError,
  setMessage,
}: UseLongWorkspaceRuntimeInput) {
  const writerAbortByBookRef = useRef<Record<string, AbortController | null>>({})
  const writerPromiseByBookRef = useRef<Record<string, Promise<void> | null>>({})
  const writerAgentByBookStageRef = useRef<Record<string, Agent>>({})
  const [writerAgentRevision, setWriterAgentRevision] = useState(0)
  const ledgerAbortByBookRef = useRef<Record<string, AbortController | null>>({})
  const ledgerPromiseByBookRef = useRef<Record<string, Promise<boolean> | null>>({})

  const updateLongWorkspaceForBook = useCallback(
    (
      bookId: string,
      updater: (workspace: LongWorkspace) => LongWorkspace,
    ): LongWorkspace | null => {
      let output: LongWorkspace | null = null
      commitWorkspaceSession(
        bookId,
        (session) => {
          if (session.book.book_type !== 'long' || !session.longWorkspace) {
            return session
          }
          const next = normalizeLongWorkspace(updater(session.longWorkspace))
          output = next
          return sessionWithLongWorkspace(session, next)
        },
        bookRef.current?.id === bookId,
      )
      return output
    },
    [bookRef, commitWorkspaceSession],
  )

  const replaceLongWorkspaceForBook = useCallback(
    (bookId: string, workspace: LongWorkspace) => {
      updateLongWorkspaceForBook(bookId, () => workspace)
    },
    [updateLongWorkspaceForBook],
  )

  const stopLongWritingForBook = useCallback((bookId: string) => {
    const controller = writerAbortByBookRef.current[bookId]
    if (!controller || controller.signal.aborted) return false
    controller.abort()
    return true
  }, [])

  const startLongWritingForBook = useCallback(
    (bookId: string, input: LongWritingScopeInput): boolean => {
      const session = workspaceSessionsRef.current[bookId]
      if (
        !session?.longWorkspace ||
        session.book.book_type !== 'long' ||
        writerPromiseByBookRef.current[bookId] ||
        ledgerPromiseByBookRef.current[bookId]
      ) {
        return false
      }
      const stageIds = chapterStageIdsForWritingScope(session.longWorkspace, input)
      if (stageIds.length === 0) {
        setError('没有可写章节：请先在剧情阶段创建对应章卡。')
        return false
      }
      const ac = new AbortController()
      writerAbortByBookRef.current[bookId] = ac
      setError(null)
      setMessage(
        input.scope === 'chapter'
          ? '写手智能体正在编写当前章'
          : input.scope === 'arc'
            ? `写手智能体将按顺序编写当前剧情弧的 ${stageIds.length} 章`
            : `写手智能体将按顺序编写当前卷的 ${stageIds.length} 章`,
      )
      const run = runLongChapterWriter({
        bookId,
        bookTitle: session.book.title,
        bookGenre: resolveWorkspaceBookGenre(session.book),
        stageIds,
        getWorkspace: () =>
          workspaceSessionsRef.current[bookId]?.longWorkspace ?? session.longWorkspace!,
        updateWorkspace: (updater) => {
          updateLongWorkspaceForBook(bookId, updater)
        },
        linkedMaterial: session.linkedMaterial,
        linkedMaterialsByKind: session.linkedMaterialsByKind,
        linkedSkill: session.linkedSkill,
        linkedSkillsByKind: session.linkedSkillsByKind,
        bookMemories: session.book.memories ?? [],
        userMemories,
        userWritingPrompt: input.userWritingPrompt,
        readAccess: resolveLongReadAccess(
          workspaceAgentReadAccess,
          EXPERT_SECTION_WRITER_AGENT_ID,
        ),
        signal: ac.signal,
        callbacks: {
          onChapterStart: ({ agent, stageId }) => {
            writerAgentByBookStageRef.current[`${bookId}:${stageId}`] = agent
            setWriterAgentRevision((value) => value + 1)
          },
        },
        onError: setError,
      })
        .then(async (completed) => {
          if (!ac.signal.aborted && completed) {
            const idle = await (waitForSaveIdle?.(15000) ?? Promise.resolve(true))
            const saved = idle ? await saveBookSession(bookId) : null
            if (saved) {
              setMessage('写手智能体已完成本次章节编写，请检查三个区块后逐章落盘')
            } else {
              setError('章节已写入当前工作区，但自动保存尚未完成，请稍后再试。')
            }
          }
        })
        .finally(() => {
          if (writerPromiseByBookRef.current[bookId] === run) {
            writerPromiseByBookRef.current[bookId] = null
            writerAbortByBookRef.current[bookId] = null
          }
        })
      writerPromiseByBookRef.current[bookId] = run
      void run
      return true
    },
    [
      saveBookSession,
      setError,
      setMessage,
      updateLongWorkspaceForBook,
      userMemories,
      waitForSaveIdle,
      workspaceAgentReadAccess,
      workspaceSessionsRef,
    ],
  )

  const commitLongChapterForBook = useCallback(
    async (bookId: string, stageId: string): Promise<boolean> => {
      const session = workspaceSessionsRef.current[bookId]
      if (
        !session?.longWorkspace ||
        session.book.book_type !== 'long' ||
        writerPromiseByBookRef.current[bookId] ||
        ledgerPromiseByBookRef.current[bookId]
      ) {
        return false
      }
      const idle = await (waitForSaveIdle?.(15000) ?? Promise.resolve(true))
      if (!idle) {
        setError('当前工作区仍在保存，请稍后再落盘。')
        return false
      }
      const persisted = await saveBookSession(bookId)
      if (!persisted) {
        setError('落盘前保存失败，本章尚未落盘。')
        return false
      }
      const ac = new AbortController()
      ledgerAbortByBookRef.current[bookId] = ac
      // 落盘由状态账本智能体负责。点击落盘后显式切到状态账本，
      // 让本次校验、状态流转和最终提交在其所属工作区中可见。
      commitWorkspaceSession(bookId, (latest) => ({
        ...latest,
        activeStage: 'continuity_ledger.timeline' as StageId,
        activePlotChildStage: '',
        activeExpertDraftSectionId: '',
      }))
      setError(null)
      setMessage('状态账本智能体正在校验并落盘本章')
      const run = runLongLedgerAgent({
        bookId,
        bookTitle: session.book.title,
        bookGenre: resolveWorkspaceBookGenre(session.book),
        stageId,
        getWorkspace: () =>
          workspaceSessionsRef.current[bookId]?.longWorkspace ?? session.longWorkspace!,
        bookMemories: session.book.memories ?? [],
        userMemories,
        signal: ac.signal,
        onError: setError,
        commitChapter: async (updates: LongLedgerUpdates) => {
          const saved = await commitLongChapterViaBridge(bookId, stageId, updates)
          if (!saved?.long_workspace) return false
          const next = normalizeLongWorkspace(saved.long_workspace, saved.stages)
          commitWorkspaceSession(
            bookId,
            (latest) => ({
              ...sessionWithLongWorkspace(latest, next),
              book: {
                ...saved,
                long_workspace: next,
                stages: longWorkspaceToFlatStages(next, saved.stages),
                content: longWorkspaceCombinedDraft(next),
              },
            }),
            bookRef.current?.id === bookId,
          )
          return true
        },
      })
        .then((ok) => {
          if (ok) setMessage('本章已按顺序落盘，人物与状态账本已更新')
          return ok
        })
        .catch((error) => {
          setError(
            error instanceof Error
              ? `状态账本智能体启动失败：${error.message}`
              : '状态账本智能体启动失败。',
          )
          return false
        })
        .finally(() => {
          if (ledgerPromiseByBookRef.current[bookId] === run) {
            ledgerPromiseByBookRef.current[bookId] = null
            ledgerAbortByBookRef.current[bookId] = null
          }
        })
      ledgerPromiseByBookRef.current[bookId] = run
      return run
    },
    [
      bookRef,
      commitWorkspaceSession,
      saveBookSession,
      setError,
      setMessage,
      userMemories,
      waitForSaveIdle,
      workspaceSessionsRef,
    ],
  )

  return {
    commitLongChapterForBook,
    replaceLongWorkspaceForBook,
    startLongWritingForBook,
    stopLongWritingForBook,
    updateLongWorkspaceForBook,
    getLongChapterWriterAgent: (bookId: string, stageId: string) =>
      writerAgentByBookStageRef.current[`${bookId}:${stageId}`],
    writerAgentRevision,
  }
}
