import { getEmbeddedPromptTemplate } from '../prompt/embeddedDefaults'
import { renderPromptFromTemplateRaw } from '../prompt/renderTemplate'
import { appendLoadableSkillsToPrompt } from '../workspaces/short/loadSkill'
import {
  WORKSPACE_AGENT_IDS,
  resolveWorkspaceAgentIdForStage,
  type WorkspaceAgentId,
} from '../workspaces/short/stageReadAccess'
import type {
  BookType,
  StageId,
} from '../domain/workspaceCore'
import type { Skill } from './libraryDomain'
import { getBridgeApi } from './runtime'
import {
  getWorkspaceAgentReadAccessDefaults,
  saveWorkspaceAgentReadAccess,
} from './preferencesClient'
import {
  ensureLocalPlotPromptMerged,
  ensureLocalScriptPromptSeeded,
  ensureLocalSharedPromptMigrated,
  localPromptLsKey,
  SCRIPT_SHARED_WORKSPACE_PROMPT_KIND,
  SHARED_WORKSPACE_PROMPT_KIND,
} from './promptLocalStorage'

/** 磁盘 / 嵌入式默认 + （浏览器）localStorage 覆盖；供集中设置页使用。 */
export async function readWorkspaceAgentPromptTemplate(
  agentId: WorkspaceAgentId,
  workspaceType: BookType = 'short',
): Promise<string> {
  const api = await getBridgeApi()
  if (api?.read_workspace_agent_prompt_template) {
    const t = await api.read_workspace_agent_prompt_template(agentId, workspaceType)
    return t.endsWith('\n') ? t.slice(0, -1) : t
  }
  ensureLocalSharedPromptMigrated()
  ensureLocalPlotPromptMerged()
  if (workspaceType === 'script') ensureLocalScriptPromptSeeded()
  try {
    const ls = localStorage.getItem(
      localPromptLsKey(
        workspaceType === 'script' ? SCRIPT_SHARED_WORKSPACE_PROMPT_KIND : SHARED_WORKSPACE_PROMPT_KIND,
        agentId,
      ),
    )
    if (ls != null) return ls.endsWith('\n') ? ls.slice(0, -1) : ls
  } catch {
    /* ignore */
  }
  return getEmbeddedPromptTemplate(
    workspaceType === 'script' ? SCRIPT_SHARED_WORKSPACE_PROMPT_KIND : SHARED_WORKSPACE_PROMPT_KIND,
    agentId,
  )
}

export async function saveWorkspaceAgentPromptOverride(
  agentId: WorkspaceAgentId,
  body: string,
  workspaceType: BookType = 'short',
): Promise<void> {
  const api = await getBridgeApi()
  if (api?.save_workspace_agent_prompt_override) {
    await api.save_workspace_agent_prompt_override(agentId, body, workspaceType)
    return
  }
  ensureLocalSharedPromptMigrated()
  ensureLocalPlotPromptMerged()
  if (workspaceType === 'script') ensureLocalScriptPromptSeeded()
  try {
    localStorage.setItem(
      localPromptLsKey(
        workspaceType === 'script' ? SCRIPT_SHARED_WORKSPACE_PROMPT_KIND : SHARED_WORKSPACE_PROMPT_KIND,
        agentId,
      ),
      body,
    )
  } catch {
    console.warn('[DeepSeekWrite] 无法保存创作空间提示词覆盖：无桌面桥接且无可用 localStorage')
  }
}

export async function resetWorkspaceAgentPromptOverride(
  agentId: WorkspaceAgentId,
  workspaceType: BookType = 'short',
): Promise<boolean> {
  const api = await getBridgeApi()
  if (api?.reset_workspace_agent_prompt_override) {
    return api.reset_workspace_agent_prompt_override(agentId, workspaceType)
  }
  ensureLocalSharedPromptMigrated()
  ensureLocalPlotPromptMerged()
  if (workspaceType === 'script') ensureLocalScriptPromptSeeded()
  try {
    const k = localPromptLsKey(
      workspaceType === 'script' ? SCRIPT_SHARED_WORKSPACE_PROMPT_KIND : SHARED_WORKSPACE_PROMPT_KIND,
      agentId,
    )
    const had = localStorage.getItem(k) != null
    localStorage.removeItem(k)
    return had
  } catch {
    return false
  }
}

/** 一键还原当前创作空间类型的所有智能体提示词覆盖与读取范围到默认配置。 */
export async function resetAllWorkspaceSettings(
  workspaceType: BookType = 'short',
): Promise<void> {
  const api = await getBridgeApi()

  // 1. 重置所有提示词覆盖
  if (api?.reset_workspace_agent_prompt_override) {
    await Promise.all(
      WORKSPACE_AGENT_IDS.map((agentId) =>
        api.reset_workspace_agent_prompt_override(agentId, workspaceType),
      ),
    )
  } else {
    ensureLocalSharedPromptMigrated()
    ensureLocalPlotPromptMerged()
    if (workspaceType === 'script') ensureLocalScriptPromptSeeded()
    try {
      const prefix =
        workspaceType === 'script'
          ? SCRIPT_SHARED_WORKSPACE_PROMPT_KIND
          : SHARED_WORKSPACE_PROMPT_KIND
      for (const agentId of WORKSPACE_AGENT_IDS) {
        localStorage.removeItem(localPromptLsKey(prefix, agentId))
      }
    } catch {
      /* ignore */
    }
  }

  // 2. 重置读取范围为默认值（优先从磁盘默认 JSON 读取，桌面端实时生效）
  const defaults = await getWorkspaceAgentReadAccessDefaults(workspaceType)
  await saveWorkspaceAgentReadAccess(defaults, workspaceType)
}

/** 将当前创作空间类型的用户提示词覆盖和读取范围同步为内置默认配置。 */
export async function syncWorkspaceSettingsDefaults(
  workspaceType: BookType = 'short',
): Promise<void> {
  const api = await getBridgeApi()
  if (api?.sync_workspace_settings_defaults) {
    await api.sync_workspace_settings_defaults(workspaceType)
    return
  }
  throw new Error('桌面端 API 不可用：无法同步提示词和读取范围默认配置')
}

export async function getWorkspaceSystemPrompt(
  stageId: StageId,
  input: {
    workspaceType?: BookType
    bookTitle: string
    bookGenre: string
    stageBody: string
    allStages: Partial<Record<StageId, string>>
    allowedWorkspaceStages: readonly StageId[]
    linkedSkill?: Skill | null
  },
): Promise<string> {
  const stagesObj: Record<string, string> = {}
  for (const [k, v] of Object.entries(input.allStages ?? {})) {
    stagesObj[k] = String(v ?? '')
  }

  const api = await getBridgeApi()
  const workspaceType = input.workspaceType ?? 'short'
  if (api?.get_workspace_system_prompt) {
    const prompt = await api.get_workspace_system_prompt(
      stageId,
      JSON.stringify({
        workspace_type: workspaceType,
        book_title: input.bookTitle,
        book_genre: input.bookGenre,
        stage_body: input.stageBody,
        all_stages: stagesObj,
        allowed_workspace_stages: input.allowedWorkspaceStages,
      }),
      workspaceType,
    )
    return appendLoadableSkillsToPrompt(prompt, input.linkedSkill, stageId)
  }

  const allowed = new Set(input.allowedWorkspaceStages)
  const filteredStages = Object.fromEntries(
    Object.entries(input.allStages).filter(([id]) => allowed.has(id as StageId)),
  ) as Partial<Record<StageId, string>>
  const promptAgentId = resolveWorkspaceAgentIdForStage(stageId)
  const raw = await readWorkspaceAgentPromptTemplate(promptAgentId, workspaceType)
  const prompt = renderPromptFromTemplateRaw(raw, {
    bookTitle: input.bookTitle,
    bookGenre: input.bookGenre,
    stageBody: input.stageBody,
    allStages: filteredStages,
    promptKind: 'workspace',
    stageId,
  })
  return appendLoadableSkillsToPrompt(prompt, input.linkedSkill, stageId)
}
