import {
  WRITING_ASSISTANT_CLOSING,
  WRITING_ASSISTANT_EMPTY_BODY,
  WRITING_ASSISTANT_ROLE,
  WRITING_ASSISTANT_SEPARATOR,
  writingAssistantBodyIntro,
  writingAssistantBookLine,
  writingAssistantStageLine,
} from '../prompts/writingAssistant'

export function buildWritingAssistantPrompt(
  bookTitle: string,
  stageLabel: string,
  stageBody: string,
): string {
  const excerpt =
    stageBody.length > 12000
      ? `${stageBody.slice(0, 12000)}\n\n…（内容过长已截断）`
      : stageBody
  return [
    WRITING_ASSISTANT_ROLE,
    '',
    writingAssistantBookLine(bookTitle),
    writingAssistantStageLine(stageLabel),
    '',
    writingAssistantBodyIntro(stageLabel),
    WRITING_ASSISTANT_SEPARATOR,
    excerpt || WRITING_ASSISTANT_EMPTY_BODY,
    WRITING_ASSISTANT_SEPARATOR,
    '',
    WRITING_ASSISTANT_CLOSING,
  ].join('\n')
}
