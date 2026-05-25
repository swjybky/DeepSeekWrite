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
  const excerpt = stageBody
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
