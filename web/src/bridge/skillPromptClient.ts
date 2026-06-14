import { getEmbeddedPromptTemplate } from '../prompt/embeddedDefaults'
import { renderPromptFromTemplateRaw } from '../prompt/renderTemplate'
import { getBridgeApi } from './runtime'
import {
  SKILL_MANAGER_AGENT_ID,
  SKILL_MANAGER_PROMPT_KIND,
  skillTypeLabel,
  type SkillStageId,
  type SkillType,
} from './libraryDomain'
import { localPromptLsKey } from './promptLocalStorage'

export async function getSkillSystemPrompt(
  stageId: SkillStageId,
  input: {
    skillTitle: string
    skillType?: SkillType
    stageBody: string
    allStages: Partial<Record<SkillStageId, string>>
  },
): Promise<string> {
  const stagesObj: Record<string, string> = {}
  for (const [k, v] of Object.entries(input.allStages ?? {})) {
    stagesObj[k] = String(v ?? '')
  }

  const api = await getBridgeApi()
  if (api?.get_skill_system_prompt) {
    return api.get_skill_system_prompt(
      stageId,
      JSON.stringify({
        skill_title: input.skillTitle,
        book_title: input.skillTitle,
        skill_type: input.skillType ?? 'short',
        stage_body: input.stageBody,
        all_stages: stagesObj,
      }),
      input.skillType ?? 'short',
    )
  }

  const raw = await readSkillAgentPromptTemplateForType(input.skillType ?? 'short')
  return renderPromptFromTemplateRaw(raw, {
    bookTitle: input.skillTitle,
    skillType: skillTypeLabel(input.skillType ?? 'short'),
    stageBody: input.stageBody,
    allStages: input.allStages,
    promptKind: SKILL_MANAGER_PROMPT_KIND,
    stageId,
  })
}

export async function readSkillAgentPromptTemplate(): Promise<string> {
  return readSkillAgentPromptTemplateForType('short')
}

export async function readSkillAgentPromptTemplateForType(
  skillType: SkillType = 'short',
): Promise<string> {
  const api = await getBridgeApi()
  if (api?.read_skill_agent_prompt_template) {
    const t = await api.read_skill_agent_prompt_template(skillType)
    return t.endsWith('\n') ? t.slice(0, -1) : t
  }
  const typedKey = localPromptLsKey(`skill_${skillType}`, SKILL_MANAGER_AGENT_ID)
  try {
    const ls =
      localStorage.getItem(typedKey) ??
      (skillType === 'short'
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
    SKILL_MANAGER_AGENT_ID,
  )
}

export async function saveSkillAgentPromptOverride(
  body: string,
  skillType: SkillType = 'short',
): Promise<void> {
  const api = await getBridgeApi()
  if (api?.save_skill_agent_prompt_override) {
    await api.save_skill_agent_prompt_override(body, skillType)
    return
  }
  try {
    localStorage.setItem(
      localPromptLsKey(`skill_${skillType}`, SKILL_MANAGER_AGENT_ID),
      body,
    )
  } catch {
    console.warn('[DeepseekWrite] 无法保存技能库智能体提示词覆盖：无桌面桥接且无可用 localStorage')
  }
}

export async function resetSkillAgentPromptOverride(
  skillType: SkillType = 'short',
): Promise<boolean> {
  const api = await getBridgeApi()
  if (api?.reset_skill_agent_prompt_override) {
    return api.reset_skill_agent_prompt_override(skillType)
  }
  try {
    const k = localPromptLsKey(`skill_${skillType}`, SKILL_MANAGER_AGENT_ID)
    const had = localStorage.getItem(k) != null
    localStorage.removeItem(k)
    return had
  } catch {
    return false
  }
}
