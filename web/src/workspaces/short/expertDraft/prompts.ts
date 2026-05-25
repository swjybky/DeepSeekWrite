import type { ExpertDraft, PromptKind, StageId } from '../../../bridge'
import { SHORT_STAGE_LABELS } from '../stages'

const EXCERPT_LIMIT = 8000
const RECENT_PREVIOUS_SECTION_LIMIT = 3
const PREVIOUS_SECTION_EXCERPT_LIMIT = 2200
const PREVIOUS_STATE_EXCERPT_LIMIT = 900
const CURRENT_SECTION_DRAFT_LIMIT = 3000

const SECTION_WRITER_PLACEHOLDER_RE = /\{\{(BOOK_TITLE|STYLE)\}\}/g

export function promptKindStyleLabel(promptKind: PromptKind): string {
  if (promptKind === 'qinggan') return '追妻短篇'
  if (promptKind === 'kehuan') return '科幻短篇'
  if (promptKind === 'xuanyi') return '悬疑短篇'
  return '世情短篇'
}

export const DEFAULT_SECTION_WRITER_SYSTEM_PROMPT = `你是《{{BOOK_TITLE}}》专家模式的后台小节编写智能体，当前类型：{{STYLE}}。

你一次只写一个小节，必须串行完成当前任务。

硬性规则：
- 先基于当前任务上下文编写当前小节正文。
- 如需人物设计、导语设计、剧情设计、剧情细化或大纲纲要，调用 read_workspace_content 按 stage_id 读取；不要凭空补全缺失设定。
- 正文完成后必须调用 write_section_body，传入干净正文，覆盖当前小节正文框。
- 然后总结当前小节结束时的人物状态，并调用 write_character_state 覆盖当前小节人物状态框。
- write_section_body 里的 text 只允许是小说正文，不要包含思考、说明、标题解释、工具调用说明。
- write_character_state 里的 text 要记录人物处境、关系、情绪、隐瞒信息、冲突推进、下一节接续点。
- 不要修改其它小节，不要调用普通模式工具。`

function excerpt(body: string, max = EXCERPT_LIMIT): string {
  void max
  return body.trim()
}

function stageExcerptLimit(stageId: StageId): number {
  return stageId === 'outline' ? Number.POSITIVE_INFINITY : EXCERPT_LIMIT
}

function stageBlock(
  stages: Partial<Record<StageId, string>>,
  stageId: StageId,
): string {
  const body = excerpt(String(stages[stageId] ?? ''), stageExcerptLimit(stageId))
  return `【${SHORT_STAGE_LABELS[stageId]}】（${stageId}）\n${body || '（空）'}`
}

function wordCountRequirementLabel(value: string | undefined): string {
  const text = String(value ?? '').trim()
  return text || '未指定'
}

function expertDraftBlock(draft: ExpertDraft): string {
  const sectionLines = draft.sections
    .map((s, idx) => {
      const body = excerpt(s.body, 1600)
      const words = wordCountRequirementLabel(s.word_count_requirement)
      return `${idx + 1}. ${s.title}（${s.id}）\n字数要求：${words}\n${body || '（空）'}`
    })
    .join('\n\n')
  const stateLines = draft.character_states
    .map((s, idx) => {
      const body = excerpt(s.body, 1200)
      return `${idx + 1}. ${s.title}（${s.section_id}）\n${body || '（空）'}`
    })
    .join('\n\n')
  return [
    '## 专家正文列表',
    sectionLines || '（空）',
    '## 专家人物状态列表',
    stateLines || '（空）',
  ].join('\n\n')
}

export function buildExpertDraftCoordinatorSystemPrompt(input: {
  bookTitle: string
  promptKind: PromptKind
  stages: Partial<Record<StageId, string>>
  draft: ExpertDraft
}): string {
  const { bookTitle, promptKind, stages, draft } = input
  const style = promptKindStyleLabel(promptKind)
  return `你是《${bookTitle}》的专家模式正文编写总控智能体，当前类型：${style}。

你只负责两件事：
1. 根据已有大纲和设计内容，初始化专家模式的正文小节列表与人物状态列表。
2. 当用户确认开始后，调用 start_expert_writing 启动后台小节编写。从第一节开始写，不写导语。
3. 启动后台编写之前，必须进行初始化

工作规则：
- 必须使用工具修改左侧专家模式编辑器，不要只在聊天里输出列表。
- 正文列表默认至少包含「导语」「第一节」；如果大纲要求更多小节，用 create_draft_sections 一次性创建完整列表。
- 人物状态列表必须与正文小节一一对应；导语对应「导语人物状态」，第一节对应「第一节人物状态」。
- 创建正文列表时，必须把大纲/章节设计里的「预估字数」「字数规划」填入 create_draft_sections 的 word_count_requirement；没有明确数字再留空。
- 如果能从导语设计或大纲中确定导语正文和导语人物状态，直接填入对应 body。
- start_expert_writing 是异步启动工具；调用成功后不要等待后台逐节完成。
- 不要调用普通模式工具，不要要求用户复制粘贴。
- 初始化时，不要进行除开导语人物状态的其他写入

可用小节 id 已显示在专家正文列表中。启动写书时传入 section_ids，顺序就是后台串行写作顺序。

${stageBlock(stages, 'character_design')}

${stageBlock(stages, 'intro_design')}

${stageBlock(stages, 'plot_design')}

${stageBlock(stages, 'plot_refine')}

${stageBlock(stages, 'outline')}

${expertDraftBlock(draft)}`
}

export function buildSectionWriterSystemPrompt(input: {
  bookTitle: string
  promptKind: PromptKind
  template?: string
}): string {
  const style = promptKindStyleLabel(input.promptKind)
  const template = input.template?.trim()
    ? input.template
    : DEFAULT_SECTION_WRITER_SYSTEM_PROMPT
  return template.replace(SECTION_WRITER_PLACEHOLDER_RE, (_match, key) => {
    if (key === 'BOOK_TITLE') return input.bookTitle.trim()
    if (key === 'STYLE') return style
    return ''
  })
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

如需人物设计、导语设计、剧情设计、剧情细化或大纲纲要，请调用 read_workspace_content 读取对应阶段内容；本消息不再直接附带这些阶段全文。

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
