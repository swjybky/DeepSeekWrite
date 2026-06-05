import type { ExpertDraft, StageId } from '../../../bridge'

const EXCERPT_LIMIT = 8000
const RECENT_PREVIOUS_SECTION_LIMIT = 3
const PREVIOUS_SECTION_EXCERPT_LIMIT = 2200
const PREVIOUS_STATE_EXCERPT_LIMIT = 900
const CURRENT_SECTION_DRAFT_LIMIT = 3000

const EXPERT_PLACEHOLDER_RE =
  /\{\{(BOOK_TITLE|BOOK_GENRE)\}\}/g

export const DEFAULT_SECTION_WRITER_SYSTEM_PROMPT = `当前书籍：《{{BOOK_TITLE}}》
当前短篇分类：{{BOOK_GENRE}}

你是专家模式的后台小节编写智能体。

你一次只写一个小节，必须串行完成当前任务。

硬性规则：
- 先基于当前任务上下文编写当前小节正文。
- 如需普通创作阶段或关联素材内容，调用当前可用的读取工具；不要凭空补全缺失设定。
- 正文完成后必须调用 write_section_body，传入干净正文，覆盖当前小节正文框。
- 然后总结当前小节结束时的人物状态，并调用 write_character_state 覆盖当前小节人物状态框。
- write_section_body 里的 text 只允许是小说正文，不要包含思考、说明、标题解释、工具调用说明。
- write_character_state 里的 text 要记录人物处境、关系、情绪、隐瞒信息、冲突推进、下一节接续点。
- 不要修改其它小节，不要调用普通模式工具。`

export const DEFAULT_COORDINATOR_SYSTEM_PROMPT = `当前书籍：《{{BOOK_TITLE}}》
当前短篇分类：{{BOOK_GENRE}}

你是专家模式正文编写总控智能体。

你负责根据现有内容初始化专家模式正文与人物状态列表，并在用户确认后调用 start_expert_writing 启动后台写作。

工作规则：
- 必须使用工具修改左侧专家模式编辑器，不要只在聊天里输出列表。
- 如需普通创作阶段或关联素材内容，调用可用的读取工具。
- 正文列表和人物状态列表必须一一对应。
- 不要调用普通模式写入工具，不要要求用户复制粘贴。`

function excerpt(body: string, max = EXCERPT_LIMIT): string {
  void max
  return body.trim()
}

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
}): string {
  const template = input.template ?? DEFAULT_COORDINATOR_SYSTEM_PROMPT
  return renderExpertTemplate(template, {
    bookTitle: input.bookTitle,
    bookGenre: input.bookGenre,
  })
}

export function buildSectionWriterSystemPrompt(input: {
  bookTitle: string
  bookGenre: string
  stageBody: string
  workspaceStages: Partial<Record<StageId, string>>
  allowedWorkspaceStages: readonly StageId[]
  template?: string
}): string {
  const template = input.template ?? DEFAULT_SECTION_WRITER_SYSTEM_PROMPT
  return renderExpertTemplate(template, {
    bookTitle: input.bookTitle,
    bookGenre: input.bookGenre,
  })
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
}): string {
  const { sectionId, sectionTitle, sectionIndex, sectionCount, draft } = input
  const currentIndex = draft.sections.findIndex((s) => s.id === sectionId)
  const previousSections =
    currentIndex > 0 ? draft.sections.slice(0, currentIndex) : []
  const omittedCount = Math.max(
    0,
    previousSections.length - RECENT_PREVIOUS_SECTION_LIMIT,
  )
  const recentPreviousSections = previousSections.slice(
    -RECENT_PREVIOUS_SECTION_LIMIT,
  )
  const previousBodies = recentPreviousSections
    .map((s, idx) => {
      const absoluteIndex = omittedCount + idx + 1
      return `## 已完成小节 ${absoluteIndex}：${s.title}\n${excerpt(s.body, PREVIOUS_SECTION_EXCERPT_LIMIT) || '（空）'}`
    })
    .join('\n\n')
  const previousStates = previousSections
    .map((section, idx) => {
      const state = draft.character_states.find(
        (item) => item.section_id === section.id,
      )
      const stateBody = excerpt(state?.body ?? '', PREVIOUS_STATE_EXCERPT_LIMIT)
      return `${idx + 1}. ${section.title}：${stateBody || '（空）'}`
    })
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

如需普通创作阶段或关联素材内容，请调用当前可用的读取工具；本消息不再直接附带这些内容。

前文（为保证连续长文写作性能，只附最近 ${RECENT_PREVIOUS_SECTION_LIMIT} 个已完成小节正文；更早变化见人物状态摘要）：
${omittedCount > 0 ? `（更早 ${omittedCount} 个小节正文已省略）\n\n` : ''}${previousBodies || '（无）'}

人物状态摘要：
${previousStates || '（无）'}

当前小节已有草稿：
${excerpt(draft.sections.find((s) => s.id === sectionId)?.body ?? '', CURRENT_SECTION_DRAFT_LIMIT) || '（空）'}

完成标准：
- 必须调用 write_section_body 写回当前小节正文。
- 必须调用 write_character_state 写回当前小节结束时的人物状态。
- 如果没有调用写回工具，本小节会被视为未完成。`
}
