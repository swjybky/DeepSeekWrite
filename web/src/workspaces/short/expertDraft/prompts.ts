import type { ExpertDraft, Skill, StageId } from '../../../bridge'
import { appendLoadableSkillsToPrompt } from '../loadSkill'

const EXPERT_PLACEHOLDER_RE =
  /\{\{(BOOK_TITLE|BOOK_GENRE)\}\}/g

export const DEFAULT_SECTION_WRITER_SYSTEM_PROMPT = `当前书籍：《{{BOOK_TITLE}}》
当前短篇分类：{{BOOK_GENRE}}

你是分节写手智能体。

你一次只写一个小节，必须串行完成当前任务。

硬性规则：
- 先基于当前任务上下文编写当前小节正文。
- 如需普通创作阶段或关联素材内容，调用 read_workspace_content / read_linked_material_content；如需读取其它已完成小节的正文或人物状态，调用 read_expert_draft_section（优先读当前文本编辑框，读不到再读已保存内容）。
- 正文完成后必须调用 write_section_body，传入干净正文，覆盖当前小节正文框。
- 然后总结当前小节结束时的人物状态，并调用 write_character_state 覆盖当前小节人物状态框。
- write_section_body 里的 text 只允许是小说正文，不要包含思考、说明、标题解释、工具调用说明。
- write_character_state 里的 text 要记录人物处境、关系、情绪、隐瞒信息、冲突推进、下一节接续点。
- 不要修改其它小节，不要调用普通模式工具。`

export const DEFAULT_COORDINATOR_SYSTEM_PROMPT = `当前书籍：《{{BOOK_TITLE}}》
当前短篇分类：{{BOOK_GENRE}}

你是正文专家编写智能体。

你负责根据现有内容初始化正文小节与人物状态列表，并在用户确认后调用 start_expert_writing 启动后台写作。正文审阅、修改、去 AI 味、格式整理或平台格式转换要求，都在当前正文编写能力内完成。

工作规则：
- 必须使用工具修改正文编写编辑器，不要只在聊天里输出列表。
- 如需普通创作阶段或关联素材内容，调用可用的读取工具。
- 正文列表和人物状态列表必须一一对应。
- 如果用户在开始写作时提出文风、情绪、爽点、节奏、人设表达等偏向，调用 start_expert_writing 时必须写入 user_writing_prompt。
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
  template?: string
  linkedSkill?: Skill | null
}): string {
  const template = input.template ?? DEFAULT_COORDINATOR_SYSTEM_PROMPT
  const prompt = renderExpertTemplate(template, {
    bookTitle: input.bookTitle,
    bookGenre: input.bookGenre,
  })
  return appendLoadableSkillsToPrompt(
    prompt,
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
  template?: string
  linkedSkill?: Skill | null
}): string {
  const template = input.template ?? DEFAULT_SECTION_WRITER_SYSTEM_PROMPT
  const prompt = renderExpertTemplate(template, {
    bookTitle: input.bookTitle,
    bookGenre: input.bookGenre,
  })
  return appendLoadableSkillsToPrompt(
    prompt,
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

  return `请编写当前小节，并在完成后调用工具写回编辑器。

当前需要编写的小节：
- 进度：第 ${sectionIndex + 1}/${sectionCount} 个待写小节
- 标题：${sectionTitle}
- id：${sectionId}
- 本章节字数要求：${currentWordRequirement}

上下文读取（本消息不附带正文、人物状态或创作阶段内容，请按需调用工具）：
- 普通创作阶段、关联素材等：调用 read_workspace_content / read_linked_material_content 等工具。
- 已完成小节或当前小节（${sectionId}）的正文与人物状态：调用 read_expert_draft_section，传入 section_id；默认同时返回正文与人物状态。

用户写作提示（在不破坏既有设定、逻辑和字数要求的前提下贯穿执行）：
${userWritingPrompt || '（无）'}

已完成小节（正文与人物状态请按需读取，不在此列出）：
${completedSectionsList || '（无，当前为首个待写小节）'}

完成标准：
- 必须调用 write_section_body 写回当前小节正文。
- 必须调用 write_character_state 写回当前小节结束时的人物状态。
- 如果没有调用写回工具，本小节会被视为未完成。`
}
