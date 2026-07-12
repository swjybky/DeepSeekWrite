import type { MaterialKind, MaterialStageId, SkillKind } from '../../bridge'
import {
  LONG_CHARACTER_STAGES,
  LONG_CONTINUITY_STAGES,
  LONG_DEFAULT_DRAFT_STAGES,
  LONG_PLOT_STAGES,
  LONG_WORLDBUILDING_STAGES,
  isLongStageId,
  longRootStageIdForStage,
  type LongStageId,
} from './stages'
import type {
  WorkspaceAgentReadAccessConfig,
  WorkspaceAgentReadAccessEntry,
} from '../shared/readAccess'

export type {
  WorkspaceAgentReadAccessConfig,
  WorkspaceAgentReadAccessEntry,
} from '../shared/readAccess'

export const EXPERT_SECTION_WRITER_AGENT_ID = 'expert_section_writer' as const

/**
 * 长篇由五个主智能体负责创作，状态账本智能体在章节落盘时于后台运行。
 * `continuity_ledger` 仍保留独立配置，便于维护其系统提示词和最小读取范围。
 */
export const WORKSPACE_AGENT_IDS = [
  'worldbuilding',
  'character_design',
  'plot_design',
  'draft',
  EXPERT_SECTION_WRITER_AGENT_ID,
  'continuity_ledger',
] as const

export type LongWorkspaceAgentId = (typeof WORKSPACE_AGENT_IDS)[number]

export const ALL_WORKSPACE_CONTENT_STAGE_IDS = [
  ...LONG_WORLDBUILDING_STAGES,
  ...LONG_CHARACTER_STAGES,
  ...LONG_PLOT_STAGES,
  ...LONG_DEFAULT_DRAFT_STAGES,
  ...LONG_CONTINUITY_STAGES,
].map((stage) => stage.id)

export const ALL_MATERIAL_STAGE_IDS: MaterialStageId[] = [
  'gimmick',
  'character',
  'pacing',
  'intro',
  'plot_refine',
  'draft_excerpt',
  'other',
]

export const ALL_MATERIAL_KIND_IDS: MaterialKind[] = [
  'character',
  'gimmick',
  'plot',
  'draft',
  'other',
]

export const ALL_SKILL_KIND_IDS: SkillKind[] = [
  'general',
  'plot',
  'style',
  'other',
]

const MATERIAL_STAGE_TO_KIND: Record<MaterialStageId, MaterialKind> = {
  gimmick: 'gimmick',
  character: 'character',
  pacing: 'plot',
  intro: 'plot',
  plot_refine: 'plot',
  draft_excerpt: 'draft',
  other: 'other',
}

const world = LONG_WORLDBUILDING_STAGES.map((stage) => stage.id)
const characters = LONG_CHARACTER_STAGES.map((stage) => stage.id)
const plot = LONG_PLOT_STAGES.map((stage) => stage.id)
const draft = LONG_DEFAULT_DRAFT_STAGES.map((stage) => stage.id)
const ledger = LONG_CONTINUITY_STAGES.map((stage) => stage.id)

const BUILTIN_READ_ACCESS_MODULES = import.meta.glob(
  '../../../../app/prompt_defaults/long/shared/read_access.json',
  { eager: true, import: 'default' },
) as Record<string, WorkspaceAgentReadAccessConfig>

const FALLBACK_DEFAULTS: WorkspaceAgentReadAccessConfig = {
  worldbuilding: {
    workspace: [
      ...world,
      'plot_design.book_line',
      'plot_design.foreshadowing',
      'continuity_ledger.timeline',
      'continuity_ledger.faction_states',
      'continuity_ledger.realm_states',
      'continuity_ledger.continuity_notes',
    ],
    material: ['gimmick', 'plot', 'other'],
    skill: ['general', 'plot', 'other'],
  },
  character_design: {
    workspace: [
      ...characters,
      'worldbuilding.rules',
      'worldbuilding.factions',
      'worldbuilding.realms',
      'plot_design.book_line',
      'plot_design.story_arcs',
      'continuity_ledger.timeline',
      'continuity_ledger.character_states',
      'continuity_ledger.faction_states',
      'continuity_ledger.realm_states',
    ],
    material: ['character', 'other'],
    skill: ['general', 'plot', 'other'],
  },
  plot_design: {
    workspace: [
      ...plot,
      ...characters,
      'worldbuilding.rules',
      'worldbuilding.factions',
      'worldbuilding.geography',
      'worldbuilding.history',
      'worldbuilding.realms',
      'continuity_ledger.timeline',
      'continuity_ledger.faction_states',
      'continuity_ledger.realm_states',
      'continuity_ledger.open_foreshadowing',
    ],
    material: ['gimmick', 'character', 'plot', 'other'],
    skill: ['general', 'plot', 'other'],
  },
  draft: {
    workspace: [
      ...draft,
      'plot_design.chapter_cards',
      'plot_design.story_arcs',
      'plot_design.foreshadowing',
      ...characters,
      'worldbuilding.rules',
      'worldbuilding.realms',
      'worldbuilding.items',
      ...ledger,
    ],
    material: ['character', 'plot', 'draft', 'other'],
    skill: ['general', 'plot', 'style', 'other'],
  },
  expert_section_writer: {
    workspace: [
      ...draft,
      'plot_design.chapter_cards',
      'plot_design.story_arcs',
      'plot_design.foreshadowing',
      ...characters,
      'worldbuilding.rules',
      'worldbuilding.realms',
      'worldbuilding.items',
      ...ledger,
    ],
    material: ['character', 'plot', 'draft', 'other'],
    skill: ['general', 'style', 'other'],
  },
  continuity_ledger: {
    workspace: [
      ...ledger,
      ...draft,
      'plot_design.chapter_cards',
      'plot_design.foreshadowing',
      'character_design.protagonists',
      'character_design.major_supporting',
      'worldbuilding.rules',
      'worldbuilding.factions',
      'worldbuilding.realms',
    ],
    material: [],
    skill: [],
  },
}

const REQUIRED_WORKSPACE_STAGE_IDS: Record<
  LongWorkspaceAgentId,
  readonly LongStageId[]
> = {
  worldbuilding: ['worldbuilding.rules'],
  character_design: ['character_design.protagonists'],
  plot_design: ['plot_design.book_line'],
  draft: ['draft.volume-1.arc-1.chapter-1'],
  expert_section_writer: ['draft.volume-1.arc-1.chapter-1'],
  continuity_ledger: ['continuity_ledger.timeline'],
}

function isMaterialStageId(id: string): id is MaterialStageId {
  return ALL_MATERIAL_STAGE_IDS.includes(id as MaterialStageId)
}

function isMaterialKindId(id: string): id is MaterialKind {
  return ALL_MATERIAL_KIND_IDS.includes(id as MaterialKind)
}

function isSkillKindId(id: string): id is SkillKind {
  return ALL_SKILL_KIND_IDS.includes(id as SkillKind)
}

function normalizeMaterialAccessIds(raw: readonly string[]): MaterialKind[] {
  const out: MaterialKind[] = []
  for (const id of raw) {
    const kind = isMaterialKindId(id)
      ? id
      : isMaterialStageId(id)
        ? MATERIAL_STAGE_TO_KIND[id]
        : null
    if (kind && !out.includes(kind)) out.push(kind)
  }
  return out
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function ensureRequiredWorkspaceStages(
  agentId: LongWorkspaceAgentId,
  workspace: readonly string[],
): LongStageId[] {
  return dedupe([
    ...workspace.filter(isLongStageId),
    ...REQUIRED_WORKSPACE_STAGE_IDS[agentId],
  ])
}

function loadBuiltinDefaults(): WorkspaceAgentReadAccessConfig {
  const json = Object.values(BUILTIN_READ_ACCESS_MODULES)[0] as
    | WorkspaceAgentReadAccessConfig
    | undefined
  if (!json || typeof json !== 'object') return { ...FALLBACK_DEFAULTS }

  const result: WorkspaceAgentReadAccessConfig = { ...FALLBACK_DEFAULTS }
  for (const agentId of WORKSPACE_AGENT_IDS) {
    const entry = json[agentId]
    if (!entry || typeof entry !== 'object') continue
    const workspace = Array.isArray(entry.workspace)
      ? entry.workspace.filter((id) => isLongStageId(String(id)))
      : FALLBACK_DEFAULTS[agentId].workspace
    const material = Array.isArray(entry.material)
      ? normalizeMaterialAccessIds(entry.material.map(String))
      : FALLBACK_DEFAULTS[agentId].material
    const skill = Array.isArray(entry.skill)
      ? entry.skill.map(String).filter(isSkillKindId)
      : FALLBACK_DEFAULTS[agentId].skill
    result[agentId] = {
      workspace: ensureRequiredWorkspaceStages(agentId, workspace),
      material,
      skill: dedupe(skill ?? []),
    }
  }
  return result
}

const BUILTIN_DEFAULTS = loadBuiltinDefaults()

function defaultEntryForAgent(
  agentId: LongWorkspaceAgentId,
): WorkspaceAgentReadAccessEntry {
  return BUILTIN_DEFAULTS[agentId] ?? FALLBACK_DEFAULTS[agentId]
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
  agentId: LongWorkspaceAgentId,
): WorkspaceAgentReadAccessEntry {
  return defaultEntryForAgent(agentId)
}

export function isWorkspaceAgentId(id: string): id is LongWorkspaceAgentId {
  return (WORKSPACE_AGENT_IDS as readonly string[]).includes(id)
}

export function getRequiredWorkspaceStageIdsForAgent(
  agentId: LongWorkspaceAgentId,
): readonly LongStageId[] {
  return REQUIRED_WORKSPACE_STAGE_IDS[agentId] ?? []
}

export function isRequiredWorkspaceStageForAgent(
  agentId: LongWorkspaceAgentId,
  stageId: string,
): boolean {
  return getRequiredWorkspaceStageIdsForAgent(agentId).includes(stageId)
}

export function resolveWorkspaceAgentIdForStage(
  stageId: LongStageId,
): LongWorkspaceAgentId {
  if (stageId === EXPERT_SECTION_WRITER_AGENT_ID) {
    return EXPERT_SECTION_WRITER_AGENT_ID
  }
  return longRootStageIdForStage(stageId)
}

function normalizeEntry(
  agentId: LongWorkspaceAgentId,
  raw: unknown,
): WorkspaceAgentReadAccessEntry {
  const fallback = defaultEntryForAgent(agentId)
  if (!raw || typeof raw !== 'object') return fallback
  const obj = raw as Record<string, unknown>
  const workspaceRaw = Array.isArray(obj.workspace) ? obj.workspace : null
  const materialRaw = Array.isArray(obj.material) ? obj.material : null
  const skillRaw = Array.isArray(obj.skill) ? obj.skill : null
  const workspace =
    workspaceRaw === null
      ? fallback.workspace
      : dedupe(workspaceRaw.map(String).filter(isLongStageId))
  const material =
    materialRaw === null
      ? fallback.material
      : normalizeMaterialAccessIds(materialRaw.map(String))
  const skill =
    skillRaw === null
      ? fallback.skill
      : dedupe(skillRaw.map(String).filter(isSkillKindId))
  return {
    workspace: ensureRequiredWorkspaceStages(agentId, workspace),
    material,
    skill,
  }
}

export function normalizeWorkspaceAgentReadAccess(
  raw?: WorkspaceAgentReadAccessConfig | null,
): WorkspaceAgentReadAccessConfig {
  const source = raw && typeof raw === 'object' ? raw : {}
  return Object.fromEntries(
    WORKSPACE_AGENT_IDS.map((agentId) => [
      agentId,
      normalizeEntry(agentId, source[agentId]),
    ]),
  ) as WorkspaceAgentReadAccessConfig
}

export function resolveWorkspaceAgentReadAccess(
  config: WorkspaceAgentReadAccessConfig | null | undefined,
  agentId: string,
): WorkspaceAgentReadAccessEntry {
  const normalized = normalizeWorkspaceAgentReadAccess(config)
  const normalizedAgent = isWorkspaceAgentId(agentId)
    ? agentId
    : longRootStageIdForStage(agentId) as LongWorkspaceAgentId
  return normalized[normalizedAgent] ?? defaultEntryForAgent('draft')
}
