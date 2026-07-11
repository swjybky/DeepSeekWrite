import type { BookType, ExpertDraft } from '../../domain/workspaceCore'

function workspaceTypeLabel(workspaceType: BookType): string {
  return workspaceType === 'script' ? '剧本' : '短篇小说'
}

function wordCountRequirementLabel(value: string | undefined): string {
  const text = String(value ?? '').trim()
  return text || '未指定'
}

export function buildExpertWritingTaskPrompt(input: {
  workspaceType: Extract<BookType, 'short' | 'script'>
  taskPrompt: string
  sectionId: string
  draft: ExpertDraft
  userWritingPrompt?: string
}): string {
  const { workspaceType, sectionId, draft } = input
  const configuredPrompt = input.taskPrompt.trim() || '请完成当前小节正文。'
  const userWritingPrompt = String(input.userWritingPrompt ?? '').trim()
  const currentIndex = draft.sections.findIndex((section) => section.id === sectionId)
  const currentSection = draft.sections.find((section) => section.id === sectionId)
  const previousSections = currentIndex > 0
    ? draft.sections.slice(Math.max(0, currentIndex - 3), currentIndex)
    : []
  const previousSectionList = previousSections
    .map((section) => `- ${section.title || '未命名小节'}（${section.id}）`)
    .join('\n')
  const position = currentIndex >= 0
    ? `第 ${currentIndex + 1} 节 / 共 ${draft.sections.length} 节`
    : `未定位 / 共 ${draft.sections.length} 节`

  return `${configuredPrompt}

## 当前运行状态

- 创作类型：${workspaceTypeLabel(workspaceType)}
- 当前进度：${position}
- 当前小节标题：${currentSection?.title?.trim() || '未命名小节'}
- 当前小节内部 ID：${sectionId}
- 当前小节字数要求：${wordCountRequirementLabel(currentSection?.word_count_requirement)}
- 最近三个前置小节：
${previousSectionList || '（无）'}

## 用户本轮写作要求

${userWritingPrompt || '（无明确要求）'}

## 自动化执行规则

- 普通创作阶段按需调用 read_workspace_content；关联素材先调用 query_linked_material_entries 的 search 模式检索，再用 read 模式读取需要的条目全文。
- 编写前逐节调用 read_expert_draft_section，读取当前小节之前最近三个已有正文的小节；正文为空的前置小节可跳过。必须读取紧邻上一节的人物状态以保持连贯。
- 修改已有正文时，先读取当前小节正文与人物状态，不得凭记忆直接覆盖。
- 当前小节正文为空时，必须调用 write_section_body 写回完整正文；text 只能包含正文，不得包含章节名、小节标题、分析、解释或工具说明。
- 当前小节已有正文且本次是局部修改时，必须调用 replace_section_body_text；只有用户明确要求整节重写时才允许整体重写。
- 当前小节人物状态为空时，必须调用 write_character_state；已有状态需要修改时调用 replace_character_state_text。
- 人物状态应记录本节结束时的处境、关系、情绪、已知与隐瞒信息、关键物品、未解决冲突和下一节承接点。
- 没有完成正文与人物状态所需的写回工具调用，本小节视为未完成。`
}
