import type {
  ExpertDraft,
  Material,
  MaterialKind,
  Skill,
  SkillKind,
  StageId,
} from '../../../bridge'
import { appendReadableLinkedMaterialsToPrompt } from '../../shared/linkedMaterialPrompt'
import { buildExpertWritingTaskPrompt } from '../../shared/expertWritingTaskPrompt'
import { appendLoadableSkillsToPrompt } from '../loadSkill'

export function buildExpertDraftCoordinatorSystemPrompt(input: {
  draft: ExpertDraft
  workspaceStages: Partial<Record<StageId, string>>
  allowedWorkspaceStages: readonly StageId[]
  allowedMaterialKinds?: readonly MaterialKind[]
  allowedSkillKinds?: readonly SkillKind[]
  linkedMaterialsByKind?: Partial<Record<MaterialKind, Material[]>>
  template: string
  linkedSkill?: Skill | null
  linkedSkillsByKind?: Partial<Record<SkillKind, Skill[]>>
}): string {
  return appendLoadableSkillsToPrompt(
    appendReadableLinkedMaterialsToPrompt(
      input.template,
      input.linkedMaterialsByKind,
      input.allowedMaterialKinds,
    ),
    input.linkedSkill,
    'expert_draft_coordinator',
    input.linkedSkillsByKind,
    input.allowedSkillKinds,
  )
}

export function buildSectionWriterSystemPrompt(input: {
  stageBody: string
  workspaceStages: Partial<Record<StageId, string>>
  allowedWorkspaceStages: readonly StageId[]
  allowedMaterialKinds?: readonly MaterialKind[]
  allowedSkillKinds?: readonly SkillKind[]
  linkedMaterialsByKind?: Partial<Record<MaterialKind, Material[]>>
  template: string
  linkedSkill?: Skill | null
  linkedSkillsByKind?: Partial<Record<SkillKind, Skill[]>>
}): string {
  return appendLoadableSkillsToPrompt(
    appendReadableLinkedMaterialsToPrompt(
      input.template,
      input.linkedMaterialsByKind,
      input.allowedMaterialKinds,
    ),
    input.linkedSkill,
    'expert_section_writer',
    input.linkedSkillsByKind,
    input.allowedSkillKinds,
  )
}

export function buildSectionWriterUserPrompt(input: {
  taskPrompt: string
  sectionId: string
  draft: ExpertDraft
  userWritingPrompt?: string
}): string {
  return buildExpertWritingTaskPrompt({
    workspaceType: 'script',
    ...input,
  })
}
