import type { MaterialStageId } from '../../bridge'
import {
  SHORT_WORKSPACE_STAGES,
  type ShortStageId,
} from './stages'

/** 支持配置「可读取阶段」的创作空间阶段 */
export const CONFIGURABLE_READ_STAGES = [
  'character_design',
  'intro_design',
  'plot_design',
  'plot_refine',
  'outline',
  'draft',
] as const

export type ConfigurableReadStageId = (typeof CONFIGURABLE_READ_STAGES)[number]

export type StageReadAccessEntry = {
  workspace: ShortStageId[]
  material: MaterialStageId[]
}

export type StageReadAccessConfig = Partial<
  Record<ConfigurableReadStageId, StageReadAccessEntry>
>

const ALL_SHORT_STAGE_IDS = SHORT_WORKSPACE_STAGES.map((s) => s.id)

/** 与 bridge.MATERIAL_STAGE_LABELS 键一致；勿从 bridge 取值以免循环依赖 */
const ALL_MATERIAL_STAGE_IDS: MaterialStageId[] = [
  'character',
  'intro',
  'gimmick',
  'plot_refine',
  'pacing',
  'draft_excerpt',
]

/** 与现网 stageAgents 硬编码对齐的默认素材可读阶段 */
const DEFAULT_MATERIAL_BY_STAGE: Record<
  ConfigurableReadStageId,
  readonly MaterialStageId[]
> = {
  character_design: ['character'],
  intro_design: ['intro'],
  plot_design: ['character', 'intro', 'gimmick', 'pacing'],
  plot_refine: ['plot_refine', 'pacing'],
  outline: [],
  draft: [],
}

function defaultEntryForStage(
  stageId: ConfigurableReadStageId,
): StageReadAccessEntry {
  return {
    workspace: [...ALL_SHORT_STAGE_IDS],
    material: [...DEFAULT_MATERIAL_BY_STAGE[stageId]],
  }
}

export function getDefaultStageReadAccess(): StageReadAccessConfig {
  const out: StageReadAccessConfig = {}
  for (const id of CONFIGURABLE_READ_STAGES) {
    out[id] = defaultEntryForStage(id)
  }
  return out
}

function isConfigurableStageId(id: string): id is ConfigurableReadStageId {
  return (CONFIGURABLE_READ_STAGES as readonly string[]).includes(id)
}

function isShortStageId(id: string): id is ShortStageId {
  return ALL_SHORT_STAGE_IDS.includes(id as ShortStageId)
}

function isMaterialStageId(id: string): id is MaterialStageId {
  return ALL_MATERIAL_STAGE_IDS.includes(id as MaterialStageId)
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function normalizeEntry(
  stageId: ConfigurableReadStageId,
  raw: unknown,
): StageReadAccessEntry {
  const fallback = defaultEntryForStage(stageId)
  if (!raw || typeof raw !== 'object') return fallback
  const obj = raw as Record<string, unknown>
  const workspaceRaw = Array.isArray(obj.workspace) ? obj.workspace : null
  const materialRaw = Array.isArray(obj.material) ? obj.material : null
  const workspace =
    workspaceRaw === null
      ? fallback.workspace
      : dedupe(
          workspaceRaw
            .map((v) => String(v))
            .filter(isShortStageId),
        )
  const material =
    materialRaw === null
      ? fallback.material
      : dedupe(
          materialRaw
            .map((v) => String(v))
            .filter(isMaterialStageId),
        )
  return { workspace, material }
}

export function normalizeStageReadAccess(
  raw: unknown,
): StageReadAccessConfig {
  const defaults = getDefaultStageReadAccess()
  if (!raw || typeof raw !== 'object') return defaults
  const out: StageReadAccessConfig = { ...defaults }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isConfigurableStageId(key)) continue
    out[key] = normalizeEntry(key, value)
  }
  return out
}

export function resolveReadAccessForStage(
  config: StageReadAccessConfig | null | undefined,
  stageId: ShortStageId,
): StageReadAccessEntry | null {
  if (!isConfigurableStageId(stageId)) return null
  const normalized = normalizeStageReadAccess(config)
  return normalized[stageId] ?? defaultEntryForStage(stageId)
}

export function isConfigurableReadStage(
  stageId: string,
): stageId is ConfigurableReadStageId {
  return isConfigurableStageId(stageId)
}

/** 判断某阶段配置是否与默认值不同（用于导航图标高亮） */
export function isStageReadAccessCustomized(
  config: StageReadAccessConfig | null | undefined,
  stageId: ConfigurableReadStageId,
): boolean {
  const current = resolveReadAccessForStage(config, stageId)
  const defaults = defaultEntryForStage(stageId)
  if (!current) return false
  const sameWorkspace =
    current.workspace.length === defaults.workspace.length &&
    current.workspace.every((id) => defaults.workspace.includes(id))
  const sameMaterial =
    current.material.length === defaults.material.length &&
    current.material.every((id) => defaults.material.includes(id))
  return !sameWorkspace || !sameMaterial
}

export {
  ALL_SHORT_STAGE_IDS as ALL_WORKSPACE_STAGE_IDS_FOR_READ,
  ALL_MATERIAL_STAGE_IDS,
}
