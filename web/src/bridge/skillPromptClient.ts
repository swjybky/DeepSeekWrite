import { getEmbeddedPromptTemplate } from '../prompt/embeddedDefaults'
import { renderPromptFromTemplateRaw } from '../prompt/renderTemplate'
import { appendSkillManagerSkillsToPrompt } from '../workspaces/skill/managerSkills'
import { getBridgeApi } from './runtime'
import {
  SKILL_MANAGER_AGENT_ID,
  SKILL_MANAGER_PROMPT_KIND,
  skillKindPromptKind,
  SKILL_KIND_LABELS,
  skillTypeLabel,
  type SkillKind,
  type SkillManagerSkill,
  type SkillPromptKind,
  type SkillStageId,
  type SkillType,
} from './libraryDomain'
import { localPromptLsKey } from './promptLocalStorage'

export async function getSkillSystemPrompt(
  stageId: SkillStageId,
  input: {
    skillTitle: string
    skillType?: SkillType
    skillKind?: SkillKind
    skillOverview?: string
    currentEntryTitle?: string
    stageBody: string
    allStages: Partial<Record<SkillStageId, string>>
  },
  managerSkills: readonly SkillManagerSkill[] = [],
): Promise<string> {
  const stagesObj: Record<string, string> = {}
  for (const [k, v] of Object.entries(input.allStages ?? {})) {
    stagesObj[k] = String(v ?? '')
  }

  const api = await getBridgeApi()
  if (api?.get_skill_system_prompt) {
    const prompt = await api.get_skill_system_prompt(
      stageId,
      JSON.stringify({
        skill_title: input.skillTitle,
        book_title: input.skillTitle,
        skill_type: input.skillType ?? 'short',
        skill_kind: input.skillKind ?? 'general',
        skill_overview: input.skillOverview ?? '',
        current_entry_title: input.currentEntryTitle ?? '',
        stage_body: input.stageBody,
        all_stages: stagesObj,
      }),
      input.skillType ?? 'short',
    )
    return appendSkillManagerSkillsToPrompt(prompt, managerSkills)
  }

  const [managerRaw, kindRaw] = await Promise.all([
    readSkillAgentPromptTemplateForType(input.skillType ?? 'short'),
    readSkillPromptTemplateForType(
      skillKindPromptKind(input.skillKind ?? 'general'),
      input.skillType ?? 'short',
    ),
  ])
  const raw = `${managerRaw.trimEnd()}\n\n---\n\n${kindRaw.trim()}`
  const prompt = renderPromptFromTemplateRaw(raw, {
    bookTitle: input.skillTitle,
    skillType: skillTypeLabel(input.skillType ?? 'short'),
    skillKind: input.skillKind ?? 'general',
    skillKindLabel: SKILL_KIND_LABELS[input.skillKind ?? 'general'],
    skillOverview: input.skillOverview ?? '',
    currentEntryTitle: input.currentEntryTitle ?? '',
    stageBody: input.stageBody,
    allStages: input.allStages,
    promptKind: SKILL_MANAGER_PROMPT_KIND,
    stageId,
  })
  return appendSkillManagerSkillsToPrompt(prompt, managerSkills)
}

export async function readSkillAgentPromptTemplate(): Promise<string> {
  return readSkillAgentPromptTemplateForType('short')
}

export async function readSkillAgentPromptTemplateForType(
  skillType: SkillType = 'short',
): Promise<string> {
  return readSkillPromptTemplateForType(SKILL_MANAGER_PROMPT_KIND, skillType)
}

export async function readSkillPromptTemplateForType(
  promptKind: SkillPromptKind = SKILL_MANAGER_PROMPT_KIND,
  skillType: SkillType = 'short',
): Promise<string> {
  const api = await getBridgeApi()
  if (api?.read_skill_agent_prompt_template) {
    const t = await api.read_skill_agent_prompt_template(skillType, promptKind)
    return t.endsWith('\n') ? t.slice(0, -1) : t
  }
  const agentId = promptKind === SKILL_MANAGER_PROMPT_KIND
    ? SKILL_MANAGER_AGENT_ID
    : promptKind
  const typedKey = localPromptLsKey(`skill_${skillType}`, agentId)
  try {
    const ls =
      localStorage.getItem(typedKey) ??
      (skillType === 'short' && promptKind === SKILL_MANAGER_PROMPT_KIND
        ? localStorage.getItem(
            localPromptLsKey(SKILL_MANAGER_PROMPT_KIND, SKILL_MANAGER_AGENT_ID),
          )
        : null)
    if (ls != null && ls.trim() !== '')
      return ls.endsWith('\n') ? ls.slice(0, -1) : ls
  } catch {
    /* ignore */
  }
  return getEmbeddedPromptTemplate(
    `skill_${skillType}`,
    agentId,
  )
}

export async function saveSkillAgentPromptOverride(
  body: string,
  skillType: SkillType = 'short',
  promptKind: SkillPromptKind = SKILL_MANAGER_PROMPT_KIND,
): Promise<void> {
  const api = await getBridgeApi()
  if (api?.save_skill_agent_prompt_override) {
    await api.save_skill_agent_prompt_override(body, skillType, promptKind)
    return
  }
  try {
    const agentId = promptKind === SKILL_MANAGER_PROMPT_KIND
      ? SKILL_MANAGER_AGENT_ID
      : promptKind
    localStorage.setItem(
      localPromptLsKey(`skill_${skillType}`, agentId),
      body,
    )
  } catch {
    console.warn('[DeepWrite] 无法保存技能库智能体提示词覆盖：无桌面桥接且无可用 localStorage')
  }
}

export async function resetSkillAgentPromptOverride(
  skillType: SkillType = 'short',
  promptKind: SkillPromptKind = SKILL_MANAGER_PROMPT_KIND,
): Promise<boolean> {
  const api = await getBridgeApi()
  if (api?.reset_skill_agent_prompt_override) {
    return api.reset_skill_agent_prompt_override(skillType, promptKind)
  }
  try {
    const agentId = promptKind === SKILL_MANAGER_PROMPT_KIND
      ? SKILL_MANAGER_AGENT_ID
      : promptKind
    const k = localPromptLsKey(`skill_${skillType}`, agentId)
    const had = localStorage.getItem(k) != null
    localStorage.removeItem(k)
    return had
  } catch {
    return false
  }
}
