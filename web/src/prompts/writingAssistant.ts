/**
 * 通用写作助手（非分阶段 Agent）的提示词片段。
 * 动态部分（书名、阶段名、正文摘录）由 buildWritingAssistantPrompt 拼接。
 */

export const WRITING_ASSISTANT_ROLE =
  '你是网络小说写作助手，协助作者完成结构与文笔。'

export function writingAssistantBookLine(bookTitle: string): string {
  return `书名：《${bookTitle}》`
}

export function writingAssistantStageLine(stageLabel: string): string {
  return `当前阶段：${stageLabel}`
}

export function writingAssistantBodyIntro(stageLabel: string): string {
  return `作者在「${stageLabel}」编辑区中的参考正文如下（可为空）：`
}

export const WRITING_ASSISTANT_EMPTY_BODY = '（暂无正文）'

export const WRITING_ASSISTANT_SEPARATOR = '---'

export const WRITING_ASSISTANT_CLOSING = [
  '请使用简体中文，给出具体可执行的修改、扩写或大纲建议；避免空泛寒暄。',
  '',
  '输出方式：长篇小说、大纲、章节等请直接在对话正文中用 Markdown 逐段写出，便于界面流式显示。仅在用户明确要求「保存成单独文件 / 附件 / 可多文件管理」时，才使用 artifacts 工具创建 .md 等文件。',
].join('\n')
