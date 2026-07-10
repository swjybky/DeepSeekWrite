import type {
  ExpertDraft,
  Material,
  MaterialKind,
  Skill,
  SkillKind,
  StageId,
} from '../../../bridge'
import { appendReadableLinkedMaterialsToPrompt } from '../../shared/linkedMaterialPrompt'
import { appendLoadableSkillsToPrompt } from '../loadSkill'

function wordCountRequirementLabel(value: string | undefined): string {
  const text = String(value ?? '').trim()
  return text || '未指定'
}

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
  sectionId: string
  draft: ExpertDraft
  userWritingPrompt?: string
}): string {
  const { sectionId, draft } = input
  const userWritingPrompt = String(input.userWritingPrompt ?? '').trim()
  const currentIndex = draft.sections.findIndex((s) => s.id === sectionId)
  const previousSections = currentIndex > 0
    ? draft.sections.slice(Math.max(0, currentIndex - 3), currentIndex)
    : []
  const completedSectionsList = previousSections
    .map((section) => `- ${section.title}（${section.id}）`)
    .join('\n')
  const currentSection = draft.sections.find((s) => s.id === sectionId)
  const currentWordRequirement = wordCountRequirementLabel(
    currentSection?.word_count_requirement,
  )
  const requiredBodyReadHint =
    previousSections.length > 0
      ? previousSections
          .map((section) => `${section.title}（${section.id}）`)
          .join('、')
      : ''

  return `请编写当前小节，并在完成后调用工具写回编辑器。

当前小节内部 id：${sectionId}
- 本章节字数要求：${currentWordRequirement}

上下文读取（本消息不附带正文、人物状态或创作阶段内容，请按需调用工具）：
- 普通创作阶段：调用 read_workspace_content；关联素材：调用 query_linked_material_entries，先用 mode=search 检索相关片段，再用 mode=read 读取需要的条目全文。
- 已完成小节或当前小节（${sectionId}）的正文与人物状态：调用 read_expert_draft_section，传入 section_id；默认同时返回正文与人物状态。
- 【必做】编写前读取当前小节之前最近三个已完成小节${requiredBodyReadHint ? `：${requiredBodyReadHint}` : '（当前没有前置小节）'}，逐节调用 read_expert_draft_section；正文为空的前置小节可跳过。必须读取紧邻上一节的人物状态以保持连贯。

用户写作提示（在不破坏既有设定、逻辑和字数要求的前提下贯穿执行）：
${userWritingPrompt || '（无）'}

最近的前置小节（正文与人物状态通过工具读取）：
${completedSectionsList || '（无）'}

完成标准：
- write_section_body 的 text 只能写入当前小节的正文内容，不要写入章节名、小节标题或任何标题行。
- 当前小节正文为空白时，必须调用 write_section_body 写回完整正文。
- 当前小节正文已有内容且本次是修改任务时，必须调用 replace_section_body_text 替换对应片段。
- 修改章节名称也使用 replace_section_body_text 直接替换当前章节名。
- 当前小节人物状态为空白时，必须调用 write_character_state 写回当前小节结束时的人物状态；已有内容且本次是修改任务时，调用 replace_character_state_text。
- 如果没有调用写回工具，本小节会被视为未完成。`
}
