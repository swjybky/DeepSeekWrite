import type { MaterialStageId } from '../../bridge'
import {
  SHORT_WORKSPACE_CONTENT_STAGES,
  SHORT_WORKSPACE_STAGES,
  type ShortStageId,
} from './stages'
import type {
  WorkspaceAgentReadAccessConfig,
  WorkspaceAgentReadAccessEntry,
} from '../shared/readAccess'

export type {
  WorkspaceAgentReadAccessConfig,
  WorkspaceAgentReadAccessEntry,
} from '../shared/readAccess'

export const EXPERT_DRAFT_COORDINATOR_AGENT_ID =
  'expert_draft_coordinator' as const
export const EXPERT_SECTION_WRITER_AGENT_ID =
  'expert_section_writer' as const

export const WORKSPACE_STANDARD_AGENT_IDS = [
  'character_design',
  'plot_design',
  'outline',
] as const satisfies readonly ShortStageId[]

export const WORKSPACE_AGENT_IDS = [
  ...WORKSPACE_STANDARD_AGENT_IDS,
  EXPERT_DRAFT_COORDINATOR_AGENT_ID,
  EXPERT_SECTION_WRITER_AGENT_ID,
] as const

export type WorkspaceAgentId = (typeof WORKSPACE_AGENT_IDS)[number]
export type WorkspaceStandardAgentId =
  (typeof WORKSPACE_STANDARD_AGENT_IDS)[number]

export const ALL_WORKSPACE_STAGE_IDS_FOR_READ = SHORT_WORKSPACE_STAGES.map(
  (stage) => stage.id,
)

export const ALL_WORKSPACE_CONTENT_STAGE_IDS = SHORT_WORKSPACE_CONTENT_STAGES.map(
  (stage) => stage.id,
)

/** 与 bridge.MATERIAL_STAGE_LABELS 键一致；勿从 bridge 取值以免循环依赖。 */
export const ALL_MATERIAL_STAGE_IDS: MaterialStageId[] = [
  'character',
  'intro',
  'gimmick',
  'plot_refine',
  'pacing',
  'draft_excerpt',
]

const DEFAULT_MATERIAL_BY_STAGE: Record<
  WorkspaceStandardAgentId,
  readonly MaterialStageId[]
> = {
  character_design: ['character'],
  plot_design: ['character', 'intro', 'gimmick', 'plot_refine', 'pacing'],
  outline: [],
}

const DEFAULT_COORDINATOR_WORKSPACE: ShortStageId[] = [
  'character_design',
  'plot_design',
  'intro_design',
  'plot_refine',
  'outline',
]

function defaultEntryForAgent(
  agentId: WorkspaceAgentId,
): WorkspaceAgentReadAccessEntry {
  if (agentId === EXPERT_DRAFT_COORDINATOR_AGENT_ID) {
    return {
      workspace: [...DEFAULT_COORDINATOR_WORKSPACE],
      material: [],
    }
  }
  if (agentId === EXPERT_SECTION_WRITER_AGENT_ID) {
    return {
      workspace: [...ALL_WORKSPACE_CONTENT_STAGE_IDS],
      material: [],
    }
  }
  return {
    workspace: [...ALL_WORKSPACE_CONTENT_STAGE_IDS],
    material: [...DEFAULT_MATERIAL_BY_STAGE[agentId as WorkspaceStandardAgentId]],
  }
}

export function getDefaultWorkspaceAgentReadAccess(): WorkspaceAgentReadAccessConfig {
  return Object.fromEntries(
    WORKSPACE_AGENT_IDS.map((agentId) => [
      agentId,
      defaultEntryForAgent(agentId),
    ]),
  ) as WorkspaceAgentReadAccessConfig
}

export function getDefaultWorkspaceAgentReadAccessEntry(
  agentId: WorkspaceAgentId,
): WorkspaceAgentReadAccessEntry {
  return defaultEntryForAgent(agentId)
}

export function isWorkspaceAgentId(id: string): id is WorkspaceAgentId {
  return (WORKSPACE_AGENT_IDS as readonly string[]).includes(id)
}

export function isWorkspaceStageAgentId(
  id: string,
): id is WorkspaceStandardAgentId {
  return (WORKSPACE_STANDARD_AGENT_IDS as readonly string[]).includes(id)
}

export function resolveWorkspaceAgentIdForStage(
  stageId: ShortStageId,
): WorkspaceAgentId {
  if (stageId === 'draft') return EXPERT_DRAFT_COORDINATOR_AGENT_ID
  if (stageId === 'intro_design' || stageId === 'plot_refine') {
    return 'plot_design'
  }
  return stageId as WorkspaceAgentId
}

function isShortStageId(id: string): id is ShortStageId {
  return ALL_WORKSPACE_CONTENT_STAGE_IDS.includes(id as ShortStageId)
}

function isMaterialStageId(id: string): id is MaterialStageId {
  return ALL_MATERIAL_STAGE_IDS.includes(id as MaterialStageId)
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function normalizeEntry(
  agentId: WorkspaceAgentId,
  raw: unknown,
): WorkspaceAgentReadAccessEntry {
  const fallback = defaultEntryForAgent(agentId)
  if (!raw || typeof raw !== 'object') return fallback
  const obj = raw as Record<string, unknown>
  const workspaceRaw = Array.isArray(obj.workspace) ? obj.workspace : null
  const materialRaw = Array.isArray(obj.material) ? obj.material : null
  const workspace =
    workspaceRaw === null
      ? fallback.workspace
      : dedupe(workspaceRaw.map(String).filter(isShortStageId))
  const material =
    materialRaw === null
      ? fallback.material
      : dedupe(materialRaw.map(String).filter(isMaterialStageId))
  return { workspace, material }
}

function mergePlotAgentReadAccessInput(
  input: Record<string, unknown>,
): unknown {
  const sourceIds = ['plot_design', 'intro_design', 'plot_refine']
  const workspace: string[] = []
  const material: string[] = []
  let hasWorkspace = false
  let hasMaterial = false

  for (const id of sourceIds) {
    const raw = input[id]
    if (!raw || typeof raw !== 'object') continue
    const obj = raw as Record<string, unknown>
    if (Array.isArray(obj.workspace)) {
      hasWorkspace = true
      workspace.push(...obj.workspace.map(String))
    }
    if (Array.isArray(obj.material)) {
      hasMaterial = true
      material.push(...obj.material.map(String))
    }
  }

  if (!hasWorkspace && !hasMaterial) return input.plot_design
  return {
    ...(input.plot_design && typeof input.plot_design === 'object'
      ? (input.plot_design as Record<string, unknown>)
      : {}),
    ...(hasWorkspace ? { workspace } : {}),
    ...(hasMaterial ? { material } : {}),
  }
}

export function normalizeWorkspaceAgentReadAccess(
  raw: unknown,
): WorkspaceAgentReadAccessConfig {
  const defaults = getDefaultWorkspaceAgentReadAccess()
  if (!raw || typeof raw !== 'object') return defaults
  const input = raw as Record<string, unknown>
  for (const agentId of WORKSPACE_AGENT_IDS) {
    defaults[agentId] =
      agentId === 'plot_design'
        ? normalizeEntry(agentId, mergePlotAgentReadAccessInput(input))
        : normalizeEntry(agentId, input[agentId])
  }
  return defaults
}

export function resolveWorkspaceAgentReadAccess(
  config: WorkspaceAgentReadAccessConfig | null | undefined,
  agentId: WorkspaceAgentId,
): WorkspaceAgentReadAccessEntry {
  return normalizeWorkspaceAgentReadAccess(config)[agentId]
}

export function isWorkspaceAgentReadAccessCustomized(
  config: WorkspaceAgentReadAccessConfig | null | undefined,
  agentId: WorkspaceAgentId,
): boolean {
  const current = resolveWorkspaceAgentReadAccess(config, agentId)
  const defaults = defaultEntryForAgent(agentId)
  const sameWorkspace =
    current.workspace.length === defaults.workspace.length &&
    current.workspace.every((id) => defaults.workspace.includes(id))
  const sameMaterial =
    current.material.length === defaults.material.length &&
    current.material.every((id) => defaults.material.includes(id))
  return !sameWorkspace || !sameMaterial
}
