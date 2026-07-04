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
  MemoryEntry,
  MemoryTag,
  LongStageId,
  ScriptStageId,
  ShortStageId,
  StageId,
} from '../domain/workspaceCore'
export {
  MEMORY_TAGS,
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
  normalizeMemoryEntries,
  normalizeMemoryTag,
  normalizeStages,
  normalizeStagesForWorkspaceBook,
  resolveWorkspaceContentStagesForBook,
  resolveWorkspaceBookGenre,
  resolveWorkspaceStagesForBook,
} from '../domain/workspaceCore'
export * from './aiModelConfig'
export * from './aiChatHistoryClient'
export * from './apiTypes'
export * from './booksClient'
export * from './commonSkillsClient'
export * from './coverClient'
export * from './libraryClient'
export * from './libraryDomain'
export * from './learningImitationClient'
export * from './materialsClient'
export * from './memoryClient'
export * from './preferencesClient'
export * from './skillPromptClient'
export * from './skillsClient'
export * from './materialPromptClient'
export * from './updateClient'
export * from './workspacePromptClient'
