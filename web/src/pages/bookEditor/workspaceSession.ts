import type {
  Book,
  BookSummary,
  ExpertDraft,
  Material,
  MaterialKind,
  Skill,
  SkillKind,
  StageId,
} from '../../domain/workspace'
import {
  normalizeExpertDraft,
  normalizeStagesForWorkspaceBook,
  resolveWorkspaceContentStagesForBook,
} from '../../domain/workspace'
import { PLOT_STAGE_ID } from '../../workspaces/short/stages'
import {
  longWorkspaceCombinedDraft,
  longWorkspaceToFlatStages,
  normalizeLongWorkspace,
} from '../../workspaces/long/longWorkspace'
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
  const longWorkspace =
    book.book_type === 'long'
      ? normalizeLongWorkspace(book.long_workspace, normalizedStages)
      : null
  return {
    stages:
      longWorkspace == null
        ? normalizedStages
        : normalizeStagesForWorkspaceBook(
            book,
            longWorkspaceToFlatStages(longWorkspace, normalizedStages),
          ),
    expertDraft: normalizedExpertDraft,
    longWorkspace,
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

function contentStageIdsForSession(
  session: BookWorkspaceSessionState,
  snapshot?: BookPersistedSnapshot,
): string[] {
  const ids = new Set<string>(
    resolveWorkspaceContentStagesForBook(session.book).map((stage) => stage.id),
  )
  for (const key of Object.keys(session.stages)) ids.add(key)
  for (const key of Object.keys(snapshot?.stages ?? {})) ids.add(key)
  return [...ids].sort()
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
  for (const stageId of contentStageIdsForSession(session, snapshot)) {
    if ((session.stages[stageId] ?? '') !== (snapshot.stages[stageId] ?? '')) {
      return true
    }
  }
  return (
    JSON.stringify(session.longWorkspace) !==
      JSON.stringify(snapshot.longWorkspace) ||
    expertDraftPersistedFingerprint(session.expertDraft) !==
    expertDraftPersistedFingerprint(snapshot.expertDraft)
  )
}

export function workspaceSessionContentFingerprint(
  session: BookWorkspaceSessionState,
): string {
  return JSON.stringify({
    stages: contentStageIdsForSession(session).map((stageId) => [
      stageId,
      session.stages[stageId] ?? '',
    ]),
    expertDraft: expertDraftPersistedFingerprint(session.expertDraft),
    longWorkspace: session.longWorkspace,
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
  linkedMaterialsByKind?: Partial<Record<MaterialKind, Material[]>>
  linkedSkill: Skill | null
  linkedSkillsByKind?: Partial<Record<SkillKind, Skill[]>>
  coverData: string | null
  activeStage: StageId
  activePlotChildStage?: PlotChildStageId | ''
  resetExpertRuntime: boolean
  previous?: BookWorkspaceSessionState
}): BookWorkspaceSessionState {
  let normalizedStages = normalizeStagesForWorkspaceBook(
    input.book,
    input.book.stages,
  )
  const longWorkspace =
    input.book.book_type === 'long'
      ? normalizeLongWorkspace(input.book.long_workspace, normalizedStages)
      : null
  if (longWorkspace) {
    normalizedStages = normalizeStagesForWorkspaceBook(
      input.book,
      longWorkspaceToFlatStages(longWorkspace, normalizedStages),
    )
  }
  const normalizedExpertDraft = normalizeExpertDraft(
    input.book.expert_draft,
    input.resetExpertRuntime,
    input.book.book_type,
  )
  const expertDraft =
    input.book.book_type === 'long'
      ? normalizedExpertDraft
      : hydrateExpertDraftFromDraftStage(
          normalizedExpertDraft,
          normalizedStages.draft ?? '',
          input.book.book_type,
        )
  const stages =
    input.book.book_type === 'long' || (normalizedStages.draft ?? '').trim()
      ? normalizedStages
      : mapExpertDraftToDraftStage(normalizedStages, expertDraft)
  const book = {
    ...input.book,
    stages,
    content: longWorkspace
      ? longWorkspaceCombinedDraft(longWorkspace)
      : stages.draft ?? input.book.content,
    long_workspace: longWorkspace ?? undefined,
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
    longWorkspace,
    persistedSnapshot,
    activeStage: input.activeStage,
    activePlotChildStage,
    linkedMaterial: input.linkedMaterial,
    linkedMaterialsByKind: input.linkedMaterialsByKind ?? {},
    linkedSkill: input.linkedSkill,
    linkedSkillsByKind: input.linkedSkillsByKind ?? {},
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
