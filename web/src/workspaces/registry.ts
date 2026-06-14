import {
  PLOT_CHILD_STAGES as SHORT_PLOT_CHILD_STAGES,
  SHORT_WORKSPACE_CONTENT_STAGES,
  SHORT_WORKSPACE_STAGES,
} from './short/stages'
import {
  PLOT_CHILD_STAGES as SCRIPT_PLOT_CHILD_STAGES,
  SCRIPT_WORKSPACE_CONTENT_STAGES,
  SCRIPT_WORKSPACE_STAGES,
} from './script/stages'

export type WorkspaceType = 'short' | 'script' | 'long'

export type WorkspaceStageDefinition = {
  id: string
  label: string
}

export type WorkspaceDefinition = {
  type: WorkspaceType
  label: string
  enabled: boolean
  visibleStages: readonly WorkspaceStageDefinition[]
  contentStages: readonly WorkspaceStageDefinition[]
  plotChildStages: readonly WorkspaceStageDefinition[]
  expertDraftMode: 'short' | 'script' | 'none'
}

const LONG_WORKSPACE_STAGES: readonly WorkspaceStageDefinition[] = []

export const WORKSPACE_DEFINITIONS: Record<WorkspaceType, WorkspaceDefinition> = {
  short: {
    type: 'short',
    label: '短篇',
    enabled: true,
    visibleStages: SHORT_WORKSPACE_STAGES,
    contentStages: SHORT_WORKSPACE_CONTENT_STAGES,
    plotChildStages: SHORT_PLOT_CHILD_STAGES,
    expertDraftMode: 'short',
  },
  script: {
    type: 'script',
    label: '剧本',
    enabled: true,
    visibleStages: SCRIPT_WORKSPACE_STAGES,
    contentStages: SCRIPT_WORKSPACE_CONTENT_STAGES,
    plotChildStages: SCRIPT_PLOT_CHILD_STAGES,
    expertDraftMode: 'script',
  },
  long: {
    type: 'long',
    label: '长篇',
    enabled: false,
    visibleStages: LONG_WORKSPACE_STAGES,
    contentStages: LONG_WORKSPACE_STAGES,
    plotChildStages: LONG_WORKSPACE_STAGES,
    expertDraftMode: 'none',
  },
}

export function normalizeWorkspaceType(raw: unknown): WorkspaceType {
  return raw === 'script' || raw === 'long' ? raw : 'short'
}

export function getWorkspaceDefinition(raw: unknown): WorkspaceDefinition {
  return WORKSPACE_DEFINITIONS[normalizeWorkspaceType(raw)]
}

export function isWorkspaceTypeEnabled(raw: unknown): boolean {
  return getWorkspaceDefinition(raw).enabled
}
