import './bridgeApiTypes'

export type {
  WorkspaceAgentId,
} from '../workspaces/short/stageReadAccess'
export type {
  WorkspaceAgentReadAccessConfig,
  WorkspaceAgentReadAccessEntry,
} from '../workspaces/shared/readAccess'
export type {
  Book,
  BookStatus,
  BookSummary,
  BookType,
  ExpertDraft,
  ExpertDraftCharacterState,
  ExpertDraftSection,
  ScriptStageId,
  ShortStageId,
  StageId,
} from '../domain/workspaceCore'
export {
  SCRIPT_GENRE_OPTIONS,
  SHORT_GENRE_OPTIONS,
  WORKSPACE_CONTENT_STAGES,
  WORKSPACE_STAGES,
  bookTypeLabel,
  defaultExpertDraft,
  isWorkspaceBook,
  isWorkspaceShortBook,
  mergeStagePatchIntoAll,
  normalizeAllBookStages,
  normalizeExpertDraft,
  normalizeStages,
  normalizeStagesForWorkspaceBook,
  resolveWorkspaceBookGenre,
  resolveWorkspaceStagesForBook,
} from '../domain/workspaceCore'
export * from './aiModelConfig'
export * from './apiTypes'
export * from './booksClient'
export * from './commonSkillsClient'
export * from './coverClient'
export * from './libraryClient'
export * from './libraryDomain'
export * from './materialsClient'
export * from './preferencesClient'
export * from './skillPromptClient'
export * from './skillsClient'
export * from './materialPromptClient'
export * from './workspacePromptClient'
