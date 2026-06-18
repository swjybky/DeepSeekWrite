import type {
  Book,
  BookSummary,
  ExpertDraft,
  Material,
  Skill,
  StageId,
} from '../../domain/workspace'
import {
  WORKSPACE_CONTENT_STAGES,
  normalizeExpertDraft,
  normalizeStagesForWorkspaceBook,
} from '../../domain/workspace'
import { PLOT_STAGE_ID } from '../../workspaces/short/stages'
import type {
  BookPersistedSnapshot,
  BookWorkspaceSessionState,
} from '../../stores/workspaceStore'
import { defaultPlotChildStageForBook } from './stageEditing'
import {
  hydrateExpertDraftFromDraftStage,
  mapExpertDraftToDraftStage,
} from './expertDraftUtils'
import type { PlotChildStageId } from './workspaceTypes'

function expertDraftPersistedFingerprint(draft: ExpertDraft): string {
  return JSON.stringify({
    sections: draft.sections.map((section) => ({
      id: section.id,
      title: section.title,
      word_count_requirement: section.word_count_requirement ?? '',
      body: section.body,
    })),
    character_states: draft.character_states.map((state) => ({
      section_id: state.section_id,
      title: state.title,
      body: state.body,
    })),
  })
}

export function createBookPersistedSnapshot(
  book: Book,
  expertDraft?: ExpertDraft,
): BookPersistedSnapshot {
  const normalizedExpertDraft = normalizeExpertDraft(
    expertDraft ?? book.expert_draft,
    true,
    book.book_type,
  )
  const normalizedStages = normalizeStagesForWorkspaceBook(book, book.stages)
  return {
    stages: normalizedStages,
    expertDraft: normalizedExpertDraft,
  }
}

function resolvePersistedSnapshot(
  session: BookWorkspaceSessionState,
): BookPersistedSnapshot {
  return (
    session.persistedSnapshot ??
    createBookPersistedSnapshot(session.book, session.expertDraft)
  )
}

export function bookSessionHasUnsavedChanges(
  session: BookWorkspaceSessionState,
  tokenBuffers: Partial<Record<StageId, string>> | undefined,
): boolean {
  if (
    tokenBuffers &&
    Object.values(tokenBuffers).some((value) => (value ?? '').length > 0)
  ) {
    return true
  }
  const snapshot = resolvePersistedSnapshot(session)
  for (const stage of WORKSPACE_CONTENT_STAGES) {
    if ((session.stages[stage.id] ?? '') !== (snapshot.stages[stage.id] ?? '')) {
      return true
    }
  }
  return (
    expertDraftPersistedFingerprint(session.expertDraft) !==
    expertDraftPersistedFingerprint(snapshot.expertDraft)
  )
}

export function workspaceSessionContentFingerprint(
  session: BookWorkspaceSessionState,
): string {
  return JSON.stringify({
    stages: WORKSPACE_CONTENT_STAGES.map((stage) => [
      stage.id,
      session.stages[stage.id] ?? '',
    ]),
    expertDraft: expertDraftPersistedFingerprint(session.expertDraft),
  })
}

export function hasAnyUnsavedWorkspaceChanges(
  sessions: Record<string, BookWorkspaceSessionState>,
  tokenBuffersByBook: Record<string, Partial<Record<StageId, string>>>,
): boolean {
  return Object.entries(sessions).some(([bookId, session]) =>
    bookSessionHasUnsavedChanges(
      session,
      tokenBuffersByBook[bookId],
    ),
  )
}

/** 左侧树书籍列表保持进入工作台时的顺序，不因保存/切换导致按更新时间重排 */
export function mergeWorkspaceBooksStable(
  orderRef: { current: string[] | null },
  incoming: BookSummary[],
): BookSummary[] {
  const byId = new Map(incoming.map((b) => [b.id, b]))
  let order = orderRef.current
  if (!order?.length) {
    order = incoming.map((b) => b.id)
  } else {
    for (const b of incoming) {
      if (!order.includes(b.id)) order.push(b.id)
    }
    order = order.filter((bookId) => byId.has(bookId))
  }
  orderRef.current = order
  return order
    .map((bookId) => byId.get(bookId))
    .filter((b): b is BookSummary => b != null)
}

export function createBookWorkspaceSession(input: {
  book: Book
  linkedMaterial: Material | null
  linkedSkill: Skill | null
  coverData: string | null
  activeStage: StageId
  activePlotChildStage?: PlotChildStageId | ''
  resetExpertRuntime: boolean
  previous?: BookWorkspaceSessionState
}): BookWorkspaceSessionState {
  const normalizedStages = normalizeStagesForWorkspaceBook(
    input.book,
    input.book.stages,
  )
  const normalizedExpertDraft = normalizeExpertDraft(
    input.book.expert_draft,
    input.resetExpertRuntime,
    input.book.book_type,
  )
  const expertDraft = hydrateExpertDraftFromDraftStage(
    normalizedExpertDraft,
    normalizedStages.draft ?? '',
    input.book.book_type,
  )
  const stages = (normalizedStages.draft ?? '').trim()
    ? normalizedStages
    : mapExpertDraftToDraftStage(normalizedStages, expertDraft)
  const book = {
    ...input.book,
    stages,
    content: stages.draft,
    expert_draft: expertDraft,
  }
  const persistedSnapshot =
    input.previous?.persistedSnapshot ??
    createBookPersistedSnapshot(book, expertDraft)
  const activePlotChildStage =
    input.activeStage === PLOT_STAGE_ID
      ? input.activePlotChildStage ||
        input.previous?.activePlotChildStage ||
        defaultPlotChildStageForBook(input.book)
      : ''
  return {
    book,
    stages,
    expertDraft,
    persistedSnapshot,
    activeStage: input.activeStage,
    activePlotChildStage,
    linkedMaterial: input.linkedMaterial,
    linkedSkill: input.linkedSkill,
    coverData: input.coverData,
    aiChatEpochByStage: input.previous?.aiChatEpochByStage ?? {},
    expertAiChatEpoch: input.previous?.expertAiChatEpoch ?? 0,
    streamingStages: input.previous?.streamingStages ?? {},
  }
}

export function ensurePlotChildSelection(
  session: BookWorkspaceSessionState,
): BookWorkspaceSessionState {
  if (session.activeStage !== PLOT_STAGE_ID || session.activePlotChildStage) {
    return session
  }
  return {
    ...session,
    activePlotChildStage: defaultPlotChildStageForBook(session.book),
  }
}
