import { create } from 'zustand'
import type {
  Book,
  ExpertDraft,
  Material,
  MaterialKind,
  Skill,
  StageId,
} from '../domain/workspace'
import type { PlotChildStageId as ScriptPlotChildStageId } from '../workspaces/script/stages'
import type { PlotChildStageId as ShortPlotChildStageId } from '../workspaces/short/stages'

type WorkspacePlotChildStageId = ShortPlotChildStageId | ScriptPlotChildStageId

export type BookPersistedSnapshot = {
  stages: Record<StageId, string>
  expertDraft: ExpertDraft
}

export type WorkspaceSession = {
  book: Book
  stages: Record<StageId, string>
  expertDraft: ExpertDraft
  linkedMaterial: Material | null
  linkedMaterialsByKind: Partial<Record<MaterialKind, Material[]>>
  linkedSkill: Skill | null
  coverData: string | null
  activeStage: StageId
  activePlotChildStage: WorkspacePlotChildStageId | ''
  persistedSnapshot: BookPersistedSnapshot | null
  aiChatEpochByStage: Partial<Record<StageId, number>>
  expertAiChatEpoch: number
  streamingStages: Partial<Record<StageId, boolean>>
}

export type BookWorkspaceSessionState = WorkspaceSession

export type WorkspaceRuntimeState = {
  activeBookId: string | null
  sessions: Record<string, WorkspaceSession>
  loadedBookIds: string[]
}

type WorkspaceStore = WorkspaceRuntimeState & {
  setActiveBookId: (bookId: string | null) => void
  replaceSessions: (sessions: Record<string, WorkspaceSession>) => void
  upsertSession: (session: WorkspaceSession) => void
  updateSession: (
    bookId: string,
    updater: (session: WorkspaceSession) => WorkspaceSession,
  ) => WorkspaceSession | null
  markBookLoaded: (bookId: string) => void
  resetWorkspaceRuntime: () => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  activeBookId: null,
  sessions: {},
  loadedBookIds: [],

  setActiveBookId: (bookId) => set({ activeBookId: bookId }),

  replaceSessions: (sessions) => set({ sessions }),

  upsertSession: (session) =>
    set((state) => ({
      sessions: {
        ...state.sessions,
        [session.book.id]: session,
      },
      loadedBookIds: state.loadedBookIds.includes(session.book.id)
        ? state.loadedBookIds
        : [...state.loadedBookIds, session.book.id],
    })),

  updateSession: (bookId, updater) => {
    const current = get().sessions[bookId]
    if (!current) return null
    const next = updater(current)
    set((state) => ({
      sessions: {
        ...state.sessions,
        [bookId]: next,
      },
      loadedBookIds: state.loadedBookIds.includes(bookId)
        ? state.loadedBookIds
        : [...state.loadedBookIds, bookId],
    }))
    return next
  },

  markBookLoaded: (bookId) =>
    set((state) => {
      if (state.loadedBookIds.includes(bookId)) return state
      return { loadedBookIds: [...state.loadedBookIds, bookId] }
    }),

  resetWorkspaceRuntime: () =>
    set({
      activeBookId: null,
      sessions: {},
      loadedBookIds: [],
    }),
}))
