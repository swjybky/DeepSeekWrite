import type { ExpertDraft, Material, MaterialKind, Skill, StageId } from '../../../bridge'
import { appendReadableLinkedMaterialsToPrompt } from '../../shared/linkedMaterialPrompt'
import { appendLoadableSkillsToPrompt } from '../loadSkill'

const EXPERT_PLACEHOLDER_RE =
  /\{\{(BOOK_TITLE|BOOK_GENRE)\}\}/g

export const DEFAULT_SECTION_WRITER_SYSTEM_PROMPT = `当前书籍：《{{BOOK_TITLE}}》
当前剧本分类：{{BOOK_GENRE}}

你是分节写手智能体。

你一次只写一个小节，必须串行完成当前任务。

硬性规则：
- 先基于当前任务上下文编写当前小节正文。
- 如需普通创作阶段，调用 read_workspace_content；如需关联素材内容，调用 query_linked_material_entries：先用 mode=search 检索相关条目，再用 mode=read 读取需要的条目全文；如需读取其它已完成小节的正文或人物状态，调用 read_expert_draft_section（优先读当前文本编辑框，读不到再读已保存内容）。编写前必须至少读取前三节正文描写，逐节调用 read_expert_draft_section；某节正文尚为空时可跳过该节。
- 当前小节正文为空白时，正文完成后必须调用 write_section_body，传入干净正文，覆盖当前小节正文框。
- 当前小节正文已有内容且用户要求修改、润色、去 AI 味或局部调整时，必须调用 replace_section_body_text 按原文片段替换，不要调用 write_section_body 整段覆盖，也不要重新启动小节写作，除非用户明确要求重写本小节。
- 用户要求修改当前章节名称时，直接调用 replace_section_body_text，把当前章节名替换为新章节名；章节树和合并正文会自动同步，不要重新初始化正文结构。
- 当前小节人物状态为空白时，调用 write_character_state 覆盖当前小节人物状态框；人物状态已有内容且只是修改时，调用 replace_character_state_text。
- write_section_body 里的 text 只允许是小说正文，不要包含思考、说明、标题解释、工具调用说明。
- write_character_state 里的 text 要记录人物处境、关系、情绪、隐瞒信息、冲突推进、下一节接续点。
- 不要修改其它小节，不要调用普通模式工具。`

export const DEFAULT_COORDINATOR_SYSTEM_PROMPT = `当前书籍：《{{BOOK_TITLE}}》
当前剧本分类：{{BOOK_GENRE}}

你是正文专家编写智能体。

你负责根据现有内容调用 initialize_expert_draft 初始化正文小节与人物状态槽位，并在用户确认后调用 start_expert_writing 启动多章/整本后台写作；如果用户只要求编写某一个已初始化章节，调用 write_single_expert_section。正文审阅、修改、去 AI 味、格式整理或平台格式转换要求，都在当前正文编写能力内完成。

工作规则：
- 必须使用工具修改正文编写编辑器，不要只在聊天里输出列表。
- 如需普通创作阶段，调用 read_workspace_content；如需关联素材内容，调用 query_linked_material_entries：先用 mode=search 检索相关条目，再用 mode=read 读取需要的条目全文。
- 用户要求修改已有正文时，先调用 read_workspace_content（stage_id=draft）读取当前专家正文，再使用 edit_expert_draft_section 按原文片段替换；总控不负责修改人物状态。不要为了局部修改重新调用 start_expert_writing 或 write_single_expert_section，除非用户明确要求重写整个小节或重跑分节写作。
- 正文列表和人物状态列表必须一一对应。
- 启动写作前必须确认目标小节已经初始化；如果没有对应章节，先调用 initialize_expert_draft 初始化正文小节列表，或提醒用户先初始化。
- 如果用户在开始写作时提出文风、情绪、爽点、节奏、人设表达等偏向，调用 start_expert_writing 或 write_single_expert_section 时必须写入 user_writing_prompt。
- 不要调用普通模式写入工具，不要要求用户复制粘贴。`

function wordCountRequirementLabel(value: string | undefined): string {
  const text = String(value ?? '').trim()
  return text || '未指定'
}

export function buildExpertDraftCoordinatorSystemPrompt(input: {
  bookTitle: string
  bookGenre: string
  draft: ExpertDraft
  workspaceStages: Partial<Record<StageId, string>>
  allowedWorkspaceStages: readonly StageId[]
  allowedMaterialKinds?: readonly MaterialKind[]
  linkedMaterialsByKind?: Partial<Record<MaterialKind, Material[]>>
  template?: string
  linkedSkill?: Skill | null
}): string {
  const template = input.template ?? DEFAULT_COORDINATOR_SYSTEM_PROMPT
  const prompt = renderExpertTemplate(template, {
    bookTitle: input.bookTitle,
    bookGenre: input.bookGenre,
  })
  return appendLoadableSkillsToPrompt(
    appendReadableLinkedMaterialsToPrompt(
      prompt,
      input.linkedMaterialsByKind,
      input.allowedMaterialKinds,
    ),
    input.linkedSkill,
    'expert_draft_coordinator',
  )
}

export function buildSectionWriterSystemPrompt(input: {
  bookTitle: string
  bookGenre: string
  stageBody: string
  workspaceStages: Partial<Record<StageId, string>>
  allowedWorkspaceStages: readonly StageId[]
  allowedMaterialKinds?: readonly MaterialKind[]
  linkedMaterialsByKind?: Partial<Record<MaterialKind, Material[]>>
  template?: string
  linkedSkill?: Skill | null
}): string {
  const template = input.template ?? DEFAULT_SECTION_WRITER_SYSTEM_PROMPT
  const prompt = renderExpertTemplate(template, {
    bookTitle: input.bookTitle,
    bookGenre: input.bookGenre,
  })
  return appendLoadableSkillsToPrompt(
    appendReadableLinkedMaterialsToPrompt(
      prompt,
      input.linkedMaterialsByKind,
      input.allowedMaterialKinds,
    ),
    input.linkedSkill,
    'expert_section_writer',
  )
}

function renderExpertTemplate(
  template: string,
  input: {
    bookTitle: string
    bookGenre: string
  },
): string {
  const title = input.bookTitle.trim()
  const genre = input.bookGenre.trim() || '未分类'
  const replacements: Record<string, string> = {
    BOOK_TITLE: title,
    BOOK_GENRE: genre,
  }
  return template.replace(
    EXPERT_PLACEHOLDER_RE,
    (_match, key: keyof typeof replacements) => replacements[key] ?? '',
  )
}

export function buildSectionWriterUserPrompt(input: {
  sectionId: string
  sectionTitle: string
  sectionIndex: number
  sectionCount: number
  draft: ExpertDraft
  userWritingPrompt?: string
}): string {
  const { sectionId, sectionTitle, sectionIndex, sectionCount, draft } = input
  const userWritingPrompt = String(input.userWritingPrompt ?? '').trim()
  const currentIndex = draft.sections.findIndex((s) => s.id === sectionId)
  const previousSections =
    currentIndex > 0 ? draft.sections.slice(0, currentIndex) : []
  const completedSectionsList = previousSections
    .map((section, idx) => `${idx + 1}. ${section.title}（${section.id}）`)
    .join('\n')
  const currentSection = draft.sections.find((s) => s.id === sectionId)
  const currentWordRequirement = wordCountRequirementLabel(
    currentSection?.word_count_requirement,
  )
  const firstThreeSections = draft.sections.slice(0, 3)
  const requiredBodyReadHint =
    firstThreeSections.length > 0
      ? firstThreeSections
          .map((section) => `${section.title}（${section.id}）`)
          .join('、')
      : ''

  return `请编写当前小节，并在完成后调用工具写回编辑器。

当前需要编写的小节：
- 进度：第 ${sectionIndex + 1}/${sectionCount} 个待写小节
- 标题：${sectionTitle}
- id：${sectionId}
- 本章节字数要求：${currentWordRequirement}

上下文读取（本消息不附带正文、人物状态或创作阶段内容，请按需调用工具）：
- 普通创作阶段：调用 read_workspace_content；关联素材：调用 query_linked_material_entries，先用 mode=search 检索相关片段，再用 mode=read 读取需要的条目全文。
- 已完成小节或当前小节（${sectionId}）的正文与人物状态：调用 read_expert_draft_section，传入 section_id；默认同时返回正文与人物状态。
- 【必做】编写前必须至少读取前三节正文描写${requiredBodyReadHint ? `：${requiredBodyReadHint}` : ''}，逐节调用 read_expert_draft_section；某节正文尚为空时可跳过该节。紧邻上一节的人物状态也应读取以保持连贯。

用户写作提示（在不破坏既有设定、逻辑和字数要求的前提下贯穿执行）：
${userWritingPrompt || '（无）'}

已完成小节（正文与人物状态请按需读取，不在此列出）：
${completedSectionsList || '（无，当前为首个待写小节）'}

完成标准：
- write_section_body 的 text 只能写入当前小节的正文内容，不要写入章节名、小节标题或任何标题行。
- 当前小节正文为空白时，必须调用 write_section_body 写回完整正文。
- 当前小节正文已有内容且本次是修改任务时，必须调用 replace_section_body_text 替换对应片段。
- 修改章节名称也使用 replace_section_body_text 直接替换当前章节名。
- 当前小节人物状态为空白时，必须调用 write_character_state 写回当前小节结束时的人物状态；已有内容且本次是修改任务时，调用 replace_character_state_text。
- 如果没有调用写回工具，本小节会被视为未完成。`
}
