import type { BookType } from '../domain/workspaceCore'
import { getEmbeddedPromptTemplate } from '../prompt/embeddedDefaults'
import { getBridgeApi } from './runtime'
import {
  SCRIPT_SHARED_WORKSPACE_PROMPT_KIND,
  SHARED_WORKSPACE_PROMPT_KIND,
  localPromptLsKey,
} from './promptLocalStorage'

export type ExpertWritingWorkspaceType = Extract<BookType, 'short' | 'script'>

const EXPERT_WRITING_TASK_PROMPT_ID = 'expert_writing_task'

function normalizeWorkspaceType(
  workspaceType: BookType | string | null | undefined,
): ExpertWritingWorkspaceType {
  return workspaceType === 'script' ? 'script' : 'short'
}

function promptKind(workspaceType: ExpertWritingWorkspaceType): string {
  return workspaceType === 'script'
    ? SCRIPT_SHARED_WORKSPACE_PROMPT_KIND
    : SHARED_WORKSPACE_PROMPT_KIND
}

function localOverrideKey(workspaceType: ExpertWritingWorkspaceType): string {
  return localPromptLsKey(
    `expert_writing_task_${workspaceType}`,
    EXPERT_WRITING_TASK_PROMPT_ID,
  )
}

function embeddedDefault(workspaceType: ExpertWritingWorkspaceType): string {
  return getEmbeddedPromptTemplate(
    promptKind(workspaceType),
    EXPERT_WRITING_TASK_PROMPT_ID,
  )
}

export async function getDefaultExpertWritingTaskPrompt(
  workspaceType: BookType | string = 'short',
): Promise<string> {
  const normalized = normalizeWorkspaceType(workspaceType)
  const api = await getBridgeApi()
  if (api?.get_default_expert_writing_task_prompt) {
    const body = await api.get_default_expert_writing_task_prompt(normalized)
    return body.endsWith('\n') ? body.slice(0, -1) : body
  }
  return embeddedDefault(normalized)
}

export async function getExpertWritingTaskPrompt(
  workspaceType: BookType | string = 'short',
): Promise<string> {
  const normalized = normalizeWorkspaceType(workspaceType)
  const api = await getBridgeApi()
  if (api?.get_expert_writing_task_prompt) {
    const body = await api.get_expert_writing_task_prompt(normalized)
    return body.endsWith('\n') ? body.slice(0, -1) : body
  }
  try {
    const stored = localStorage.getItem(localOverrideKey(normalized))
    if (stored != null) return stored
  } catch {
    /* ignore */
  }
  return embeddedDefault(normalized)
}

export async function saveExpertWritingTaskPrompt(
  workspaceType: BookType | string,
  body: string,
): Promise<void> {
  const normalized = normalizeWorkspaceType(workspaceType)
  if (!body.trim()) throw new Error('自动写作任务提示词不能为空')
  const api = await getBridgeApi()
  if (api?.save_expert_writing_task_prompt) {
    await api.save_expert_writing_task_prompt(normalized, body)
    return
  }
  localStorage.setItem(localOverrideKey(normalized), body)
}

export async function resetExpertWritingTaskPrompt(
  workspaceType: BookType | string,
): Promise<string> {
  const normalized = normalizeWorkspaceType(workspaceType)
  const api = await getBridgeApi()
  if (api?.reset_expert_writing_task_prompt) {
    await api.reset_expert_writing_task_prompt(normalized)
  } else {
    localStorage.removeItem(localOverrideKey(normalized))
  }
  return getDefaultExpertWritingTaskPrompt(normalized)
}
