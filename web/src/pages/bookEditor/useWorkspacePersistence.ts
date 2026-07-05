import { useCallback, useEffect } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getBook,
  getBookCover,
  getMaterial,
  getSkill,
  getWorkspaceAgentReadAccess,
  isWorkspaceBook,
  listBooks,
  MATERIAL_KIND_KEYS,
  materialMatchesKind,
  mergeStagePatchIntoAll,
  normalizeLinkedMaterialIdsByKind,
  resolveWorkspaceStagesForBook,
  saveBook,
  type Book,
  type BookSummary,
  type Material,
  type MaterialKind,
  type Skill,
  type StageId,
  type WorkspaceAgentReadAccessConfig,
} from '../../bridge'
import { coerceLongStageId } from '../../workspaces/long/stages'
import type {
  BookPersistedSnapshot,
  BookWorkspaceSessionState,
} from '../../stores/workspaceStore'
import { PLOT_STAGE_ID } from '../../workspaces/short/stages'
import {
  createBookPersistedSnapshot,
  createBookWorkspaceSession,
  ensurePlotChildSelection,
  hasAnyUnsavedWorkspaceChanges,
  mergeWorkspaceBooksStable,
} from './workspaceSession'
import { workspaceBookType } from './stageEditing'
import {
  WORKSPACE_LEAVE_CONFIRM_MESSAGE,
  type PlotChildStageId,
  type SaveCurrentBookOptions,
} from './workspaceTypes'

type CommitWorkspaceSession = (
  bookId: string,
  updater: (current: BookWorkspaceSessionState) => BookWorkspaceSessionState,
  syncActive?: boolean,
) => BookWorkspaceSessionState | null

function resolveInitialStageForBook(
  book: Pick<Book, 'book_type'>,
  requestedStageId: StageId | undefined,
  fallbackStageId: StageId,
): StageId {
  if (book.book_type === 'long') {
    return coerceLongStageId(requestedStageId ?? fallbackStageId) as StageId
  }
  return requestedStageId ?? fallbackStageId
}

async function loadLinkedMaterialsForBook(
  book: Book,
): Promise<{
  linkedMaterial: Material | null
  linkedMaterialsByKind: Partial<Record<MaterialKind, Material[]>>
}> {
  const linkedIdsByKind = normalizeLinkedMaterialIdsByKind(
    book.linked_material_ids_by_kind,
    book.linked_material_id,
  )
  const ids = [
    ...new Set(
      MATERIAL_KIND_KEYS.flatMap((kind) => linkedIdsByKind[kind] ?? []),
    ),
  ]
  const materials = (
    await Promise.all(ids.map((materialId) => getMaterial(materialId)))
  ).filter((material): material is Material => Boolean(material))
  const byId = new Map(materials.map((material) => [material.id, material]))
  const linkedMaterialsByKind: Partial<Record<MaterialKind, Material[]>> = {}
  for (const kind of MATERIAL_KIND_KEYS) {
    linkedMaterialsByKind[kind] = (linkedIdsByKind[kind] ?? [])
      .map((materialId) => byId.get(materialId) ?? null)
        .filter(
          (material): material is Material =>
            material !== null &&
            material.material_type === book.book_type &&
            materialMatchesKind(material, kind),
        )
  }
  return {
    linkedMaterial: MATERIAL_KIND_KEYS.flatMap(
      (kind) => linkedMaterialsByKind[kind] ?? [],
    )[0] ?? null,
    linkedMaterialsByKind,
  }
}

type UseWorkspacePersistenceInput = {
  id: string | undefined
  book: Book | null
  bookRef: MutableRefObject<Book | null>
  workspaceSessionsRef: MutableRefObject<Record<string, BookWorkspaceSessionState>>
  workspaceBookOrderRef: MutableRefObject<string[] | null>
  pendingInitialStageRef: MutableRefObject<{
    bookId: string
    stageId: StageId
    childId?: PlotChildStageId
  } | null>
  hasLoadedOnceRef: MutableRefObject<boolean>
  saveInFlightRef: MutableRefObject<boolean>
  saveInFlightByBookRef: MutableRefObject<Record<string, boolean>>
  tokenBuffersByBookRef: MutableRefObject<
    Record<string, Partial<Record<StageId, string>>>
  >
  setBook: Dispatch<SetStateAction<Book | null>>
  setWorkspaceBooks: Dispatch<SetStateAction<BookSummary[]>>
  setWorkspaceAgentReadAccess: Dispatch<
    SetStateAction<WorkspaceAgentReadAccessConfig>
  >
  setLoading: Dispatch<SetStateAction<boolean>>
  setBookTransitioning: Dispatch<SetStateAction<boolean>>
  setSaving: Dispatch<SetStateAction<boolean>>
  setMessage: Dispatch<SetStateAction<string | null>>
  setError: Dispatch<SetStateAction<string | null>>
  commitWorkspaceSession: CommitWorkspaceSession
  storeWorkspaceSession: (
    session: BookWorkspaceSessionState,
    makeActive: boolean,
  ) => void
  syncActiveSessionState: (session: BookWorkspaceSessionState) => void
  flushAllTokenBuffersForBook: (bookId: string) => void
}

export function useWorkspacePersistence({
  id,
  book,
  bookRef,
  workspaceSessionsRef,
  workspaceBookOrderRef,
  pendingInitialStageRef,
  hasLoadedOnceRef,
  saveInFlightRef,
  saveInFlightByBookRef,
  tokenBuffersByBookRef,
  setBook,
  setWorkspaceBooks,
  setWorkspaceAgentReadAccess,
  setLoading,
  setBookTransitioning,
  setSaving,
  setMessage,
  setError,
  commitWorkspaceSession,
  storeWorkspaceSession,
  syncActiveSessionState,
  flushAllTokenBuffersForBook,
}: UseWorkspacePersistenceInput) {
  const navigate = useNavigate()

  const refreshWorkspaceBooks = useCallback(async () => {
    const list = await listBooks()
    setWorkspaceBooks(mergeWorkspaceBooksStable(workspaceBookOrderRef, list))
    return list
  }, [setWorkspaceBooks, workspaceBookOrderRef])

  const syncWorkspaceBookSummary = useCallback((next: Book) => {
    const summary: BookSummary = {
      id: next.id,
      title: next.title,
      book_type: next.book_type,
      categories: next.categories,
      status: next.status,
      output_dir: next.output_dir,
      linked_material_id: next.linked_material_id,
      linked_skill_id: next.linked_skill_id,
    }
    setWorkspaceBooks((prev) => {
      const index = prev.findIndex((item) => item.id === summary.id)
      if (index < 0) {
        workspaceBookOrderRef.current = [
          ...(workspaceBookOrderRef.current ?? []),
          summary.id,
        ]
        return [...prev, summary]
      }
      return prev.map((item) => (item.id === summary.id ? summary : item))
    })
  }, [setWorkspaceBooks, workspaceBookOrderRef])

  const waitForSaveIdle = useCallback(async (timeoutMs = 8000): Promise<boolean> => {
    const start = Date.now()
    while (saveInFlightRef.current) {
      if (Date.now() - start >= timeoutMs) return false
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return true
  }, [saveInFlightRef])

  const load = useCallback(async () => {
    if (!id) return
    setError(null)
    const switching = hasLoadedOnceRef.current
    if (!switching) {
      setLoading(true)
    } else {
      setBookTransitioning(true)
    }
    try {
      const cached = workspaceSessionsRef.current[id]
      if (cached) {
        const pending = pendingInitialStageRef.current
        if (pending?.bookId === id) {
          pendingInitialStageRef.current = null
        }
        const rows = resolveWorkspaceStagesForBook(cached.book)
        const fallbackStage = rows[0]!.id
        const pendingStage =
          pending?.bookId === id
            ? resolveInitialStageForBook(
                cached.book,
                pending.stageId,
                fallbackStage,
              )
            : null
        let nextCached =
          pending?.bookId === id && pendingStage
            ? commitWorkspaceSession(
                id,
                (session) => ({
                  ...session,
                  activeStage: pendingStage,
                  activePlotChildStage:
                    pendingStage === PLOT_STAGE_ID
                      ? pending.childId ?? session.activePlotChildStage
                      : '',
                }),
                false,
              ) ?? cached
            : cached
        if (nextCached.book.book_type === 'long') {
          const coercedStage = coerceLongStageId(nextCached.activeStage) as StageId
          if (coercedStage !== nextCached.activeStage) {
            nextCached =
              commitWorkspaceSession(
                id,
                (session) => ({
                  ...session,
                  activeStage: coercedStage,
                  activePlotChildStage: '',
                }),
                false,
              ) ?? nextCached
          }
        }
        const ensuredCached = ensurePlotChildSelection(nextCached)
        nextCached =
          ensuredCached === nextCached
            ? nextCached
            : commitWorkspaceSession(id, () => ensuredCached, false) ??
              ensuredCached
        if (!nextCached.persistedSnapshot) {
          const cachedStages = nextCached.stages
          nextCached = {
            ...nextCached,
            stages: cachedStages,
            book: {
              ...nextCached.book,
              stages: mergeStagePatchIntoAll(
                nextCached.book.stages,
                cachedStages,
                nextCached.book,
              ),
              content: cachedStages.draft,
              expert_draft: nextCached.expertDraft,
            },
            persistedSnapshot: createBookPersistedSnapshot(
              {
                ...nextCached.book,
                stages: mergeStagePatchIntoAll(
                  nextCached.book.stages,
                  cachedStages,
                  nextCached.book,
                ),
                content: cachedStages.draft,
                expert_draft: nextCached.expertDraft,
              },
              nextCached.expertDraft,
            ),
          }
        }
        syncActiveSessionState(nextCached)
        try {
          const [readAccessConfig, bookSummaries] = await Promise.all([
            getWorkspaceAgentReadAccess(workspaceBookType(cached.book)),
            listBooks(),
          ])
          setWorkspaceAgentReadAccess(readAccessConfig)
          setWorkspaceBooks(
            mergeWorkspaceBooksStable(workspaceBookOrderRef, bookSummaries),
          )
        } catch {
          /* 缓存可用时，列表刷新失败不阻塞切回旧书 */
        }
        return
      }

      const [b, bookSummaries] = await Promise.all([
        getBook(id),
        listBooks(),
      ])
      if (!b) {
        setBook(null)
        setError('未找到该书籍')
        return
      }
      const readAccessConfig = await getWorkspaceAgentReadAccess(workspaceBookType(b))
      setWorkspaceAgentReadAccess(readAccessConfig)
      setWorkspaceBooks(
        mergeWorkspaceBooksStable(workspaceBookOrderRef, bookSummaries),
      )
      const coverRes = await getBookCover(b.id)
      const nextCoverData = coverRes.cover_data
      const { linkedMaterial, linkedMaterialsByKind } =
        await loadLinkedMaterialsForBook(b)
      let skill: Skill | null = null
      if (b.linked_skill_id) {
        skill = await getSkill(b.linked_skill_id)
      }
      const rows = resolveWorkspaceStagesForBook(b)
      const pending = pendingInitialStageRef.current
      const pendingForBook = pending?.bookId === b.id ? pending : null
      const pendingStage = pendingForBook
        ? resolveInitialStageForBook(b, pendingForBook.stageId, rows[0]!.id)
        : null
      const pendingPlotChild =
        pendingStage === PLOT_STAGE_ID && pendingForBook?.childId
          ? pendingForBook.childId
          : ''
      if (pendingForBook) {
        pendingInitialStageRef.current = null
      }
      const previous = workspaceSessionsRef.current[b.id]
      const session = createBookWorkspaceSession({
        book: b,
        linkedMaterial,
        linkedMaterialsByKind,
        linkedSkill: skill,
        coverData: nextCoverData,
        activeStage: resolveInitialStageForBook(
          b,
          pendingStage ?? previous?.activeStage,
          rows[0]!.id,
        ),
        activePlotChildStage: pendingPlotChild || previous?.activePlotChildStage || '',
        resetExpertRuntime: previous == null,
        previous,
      })
      storeWorkspaceSession(session, true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      hasLoadedOnceRef.current = true
      setLoading(false)
      setBookTransitioning(false)
    }
  }, [
    id,
    commitWorkspaceSession,
    hasLoadedOnceRef,
    pendingInitialStageRef,
    setBook,
    setBookTransitioning,
    setError,
    setLoading,
    setWorkspaceAgentReadAccess,
    setWorkspaceBooks,
    storeWorkspaceSession,
    syncActiveSessionState,
    workspaceBookOrderRef,
    workspaceSessionsRef,
  ])

  useEffect(() => {
    void load()
  }, [load])

  const saveBookSession = useCallback(
    async (
      bookId: string,
      options: SaveCurrentBookOptions = {},
      snapshotOverride?: BookPersistedSnapshot,
    ): Promise<Book | null> => {
      const session = workspaceSessionsRef.current[bookId]
      if (!session) return null
      const isActiveBook = bookRef.current?.id === bookId
      if (saveInFlightByBookRef.current[bookId]) {
        if (isActiveBook) setError('正在保存，请稍后再试')
        return null
      }
      saveInFlightByBookRef.current[bookId] = true
      if (isActiveBook) {
        saveInFlightRef.current = true
        setSaving(true)
        setMessage(null)
        setError(null)
      }
      try {
        flushAllTokenBuffersForBook(bookId)
        const beforeSave = workspaceSessionsRef.current[bookId] ?? session
        const snapshotForSave =
          snapshotOverride ??
          createBookPersistedSnapshot(
            {
              ...beforeSave.book,
              stages: beforeSave.stages,
              expert_draft: beforeSave.expertDraft,
            },
            beforeSave.expertDraft,
          )
        const stagesForSave = snapshotForSave.stages
        const merged = mergeStagePatchIntoAll(
          beforeSave.book.stages,
          stagesForSave,
          beforeSave.book,
        )
        const next = await saveBook(bookId, {
          stages: merged,
          expert_draft: snapshotForSave.expertDraft,
          status: options.status,
          memory_auto_capture_enabled: options.memory_auto_capture_enabled,
        })
        if (!next) {
          if (isActiveBook) setError('保存失败：书籍不存在')
          return null
        }
        const latest = workspaceSessionsRef.current[bookId] ?? beforeSave
        const latestStages = latest.stages
        const nextBookStages = mergeStagePatchIntoAll(
          next.stages,
          latestStages,
          next,
        )
        const nextSession: BookWorkspaceSessionState = {
          ...latest,
          book: {
            ...next,
            stages: nextBookStages,
            expert_draft: latest.expertDraft,
            content: latestStages.draft,
          },
          stages: latestStages,
          expertDraft: latest.expertDraft,
          // 只把这次请求实际提交的快照标记为已保存。请求期间产生的
          // 新输入继续保持 dirty，随后由自动保存队列再次提交。
          persistedSnapshot: snapshotForSave,
        }
        storeWorkspaceSession(nextSession, isActiveBook)
        syncWorkspaceBookSummary(next)
        if (isActiveBook && options.successMessage) {
          setMessage(options.successMessage)
          window.setTimeout(() => setMessage(null), 2000)
        }
        return next
      } catch (e) {
        if (isActiveBook) setError(e instanceof Error ? e.message : '保存失败')
        return null
      } finally {
        saveInFlightByBookRef.current[bookId] = false
        if (isActiveBook) {
          saveInFlightRef.current = false
          setSaving(false)
        }
      }
    },
    [
      bookRef,
      flushAllTokenBuffersForBook,
      saveInFlightByBookRef,
      saveInFlightRef,
      setError,
      setMessage,
      setSaving,
      storeWorkspaceSession,
      syncWorkspaceBookSummary,
      workspaceSessionsRef,
    ],
  )

  const saveCurrentBook = useCallback(
    async (options: SaveCurrentBookOptions = {}): Promise<Book | null> => {
      const currentBookId = bookRef.current?.id
      if (!currentBookId) return null
      return saveBookSession(currentBookId, options)
    },
    [bookRef, saveBookSession],
  )

  const handleSave = useCallback(async () => {
    await saveCurrentBook({ successMessage: '已保存' })
  }, [saveCurrentBook])

  const hasUnsavedWorkspaceChanges = useCallback(() => {
    return hasAnyUnsavedWorkspaceChanges(
      workspaceSessionsRef.current,
      tokenBuffersByBookRef.current,
    )
  }, [tokenBuffersByBookRef, workspaceSessionsRef])

  const confirmLeaveWorkspace = useCallback(() => {
    if (!hasUnsavedWorkspaceChanges()) return true
    return window.confirm(WORKSPACE_LEAVE_CONFIRM_MESSAGE)
  }, [hasUnsavedWorkspaceChanges])

  const handleBackToShelf = useCallback(() => {
    if (!confirmLeaveWorkspace()) return
    navigate('/')
  }, [confirmLeaveWorkspace, navigate])

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedWorkspaceChanges()) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasUnsavedWorkspaceChanges])

  useEffect(() => {
    if (!book || !isWorkspaceBook(book)) return
    const onPopState = () => {
      if (!hasUnsavedWorkspaceChanges()) return
      const ok = window.confirm(WORKSPACE_LEAVE_CONFIRM_MESSAGE)
      if (!ok) {
        window.history.go(1)
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [book, hasUnsavedWorkspaceChanges])

  return {
    handleBackToShelf,
    handleSave,
    refreshWorkspaceBooks,
    saveBookSession,
    saveCurrentBook,
    syncWorkspaceBookSummary,
    waitForSaveIdle,
  }
}
