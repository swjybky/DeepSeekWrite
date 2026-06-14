import type {
  BookStatus,
  ExpertDraft,
} from '../domain/workspaceCore'
import type {
  SkillStageEntry,
  SkillStageId,
  SkillType,
} from './libraryDomain'

export type SaveBookOptions = {
  content?: string | null
  stages?: Record<string, string> | null
  linked_material_id?: string | null
  linked_skill_id?: string | null
  expert_draft?: ExpertDraft | null
  title?: string | null
  status?: BookStatus | null
}

export type SaveMaterialOptions = {
  stages?: Record<string, string> | null
  title?: string
}

export type SaveSkillOptions = {
  title?: string
  skill_type?: SkillType | string | null
  stages?: Partial<Record<SkillStageId, SkillStageEntry[]>> | null
}
