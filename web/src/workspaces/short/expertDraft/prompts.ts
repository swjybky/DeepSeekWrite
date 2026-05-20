import type { ExpertDraft, PromptKind, StageId } from '../../../bridge'
import { SHORT_STAGE_LABELS } from '../stages'

const EXCERPT_LIMIT = 8000

function excerpt(body: string, max = EXCERPT_LIMIT): string {
  const t = body.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max)}\n\n...（内容过长已截断）`
}

function stageBlock(
  stages: Partial<Record<StageId, string>>,
  stageId: StageId,
): string {
  const body = excerpt(String(stages[stageId] ?? ''))
  return `【${SHORT_STAGE_LABELS[stageId]}】（${stageId}）\n${body || '（空）'}`
}

function expertDraftBlock(draft: ExpertDraft): string {
  const sectionLines = draft.sections
    .map((s, idx) => {
      const body = excerpt(s.body, 1600)
      return `${idx + 1}. ${s.title}（${s.id}）\n${body || '（空）'}`
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
  const style = promptKind === 'qinggan' ? '追妻短篇' : '世情短篇'
  return `你是《${bookTitle}》的专家模式正文编写总控智能体，当前类型：${style}。

你只负责两件事：
1. 根据已有大纲和设计内容，初始化专家模式的正文小节列表与人物状态列表。
2. 当用户确认开始后，调用 start_expert_writing 启动后台小节编写。

工作规则：
- 必须使用工具修改左侧专家模式编辑器，不要只在聊天里输出列表。
- 正文列表默认至少包含「导语」「第一节」；如果大纲要求更多小节，用 create_draft_sections 一次性创建完整列表。
- 人物状态列表必须与正文小节一一对应；导语对应「导语人物状态」，第一节对应「第一节人物状态」。
- 如果能从导语设计或大纲中确定导语正文和导语人物状态，直接填入对应 body。
- start_expert_writing 是异步启动工具；调用成功后不要等待后台逐节完成。
- 不要调用普通模式工具，不要要求用户复制粘贴。

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
}): string {
  const style = input.promptKind === 'qinggan' ? '追妻短篇' : '世情短篇'
  return `你是《${input.bookTitle}》专家模式的后台小节编写智能体，当前类型：${style}。

你一次只写一个小节，必须串行完成当前任务。

硬性规则：
- 先基于当前任务上下文编写当前小节正文。
- 正文完成后必须调用 write_section_body，传入干净正文，覆盖当前小节正文框。
- 然后总结当前小节结束时的人物状态，并调用 write_character_state 覆盖当前小节人物状态框。
- write_section_body 里的 text 只允许是小说正文，不要包含思考、说明、标题解释、工具调用说明。
- write_character_state 里的 text 要记录人物处境、关系、情绪、隐瞒信息、冲突推进、下一节接续点。
- 不要修改其它小节，不要调用普通模式工具。`
}

export function buildSectionWriterUserPrompt(input: {
  sectionId: string
  sectionTitle: string
  sectionIndex: number
  sectionCount: number
  stages: Partial<Record<StageId, string>>
  draft: ExpertDraft
}): string {
  const { sectionId, sectionTitle, sectionIndex, sectionCount, stages, draft } = input
  const currentIndex = draft.sections.findIndex((s) => s.id === sectionId)
  const previousSections =
    currentIndex > 0 ? draft.sections.slice(0, currentIndex) : []
  const previousState =
    currentIndex > 0
      ? draft.character_states.find(
          (s) => s.section_id === draft.sections[currentIndex - 1]?.id,
        )
      : null
  const sectionList = draft.sections
    .map((s, idx) => `${idx + 1}. ${s.title}（${s.id}）`)
    .join('\n')
  const previousBodies = previousSections
    .map((s, idx) => `## 已完成小节 ${idx + 1}：${s.title}\n${excerpt(s.body, 5000) || '（空）'}`)
    .join('\n\n')

  return `请编写当前小节，并在完成后调用工具写回编辑器。

当前任务：第 ${sectionIndex + 1}/${sectionCount} 个待写小节
当前小节：${sectionTitle}（${sectionId}）

全书小节顺序：
${sectionList}

${stageBlock(stages, 'character_design')}

${stageBlock(stages, 'intro_design')}

${stageBlock(stages, 'plot_design')}

${stageBlock(stages, 'plot_refine')}

${stageBlock(stages, 'outline')}

上一小节人物状态：
${previousState?.body.trim() || '（无，当前是导语或前序状态为空）'}

前面已写小节全文：
${previousBodies || '（无）'}

当前小节已有草稿：
${excerpt(draft.sections.find((s) => s.id === sectionId)?.body ?? '', 5000) || '（空）'}`
}
