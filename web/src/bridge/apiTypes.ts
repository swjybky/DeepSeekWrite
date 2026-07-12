import type {
  BookStatus,
  ExpertDraft,
} from '../domain/workspaceCore'
import type { LongWorkspace } from '../workspaces/long/longWorkspace'
export type { LongLedgerUpdates } from '../workspaces/long/longWorkspace'
import type {
  SkillStageEntry,
  SkillStageId,
  SkillKind,
  SkillType,
  MaterialKind,
  MaterialStageEntry,
  MaterialStageId,
} from './libraryDomain'

export type SaveBookOptions = {
  content?: string | null
  stages?: Record<string, string> | null
  long_workspace?: LongWorkspace | null
  linked_material_id?: string | null
  linked_material_ids_by_kind?: Partial<Record<MaterialKind, string[]>> | null
  linked_skill_id?: string | null
  linked_skill_ids_by_kind?: Partial<Record<SkillKind, string[]>> | null
  expert_draft?: ExpertDraft | null
  title?: string | null
  status?: BookStatus | null
  memory_auto_capture_enabled?: boolean | null
}

export type SaveMaterialOptions = {
  stages?: Record<string, string> | null
  stage_items?: Partial<Record<MaterialStageId, MaterialStageEntry[]>> | null
  title?: string
  overview?: string | null
}

export type SaveSkillOptions = {
  title?: string
  skill_type?: SkillType | string | null
  skill_kind?: SkillKind | string | null
  overview?: string | null
  stages?: Partial<Record<SkillStageId, SkillStageEntry[]>> | null
}
