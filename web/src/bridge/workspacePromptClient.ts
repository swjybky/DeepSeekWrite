import { getEmbeddedPromptTemplate } from '../prompt/embeddedDefaults'
import { renderPromptFromTemplateRaw } from '../prompt/renderTemplate'
import { appendLoadableSkillsToPrompt } from '../workspaces/short/loadSkill'
import { appendReadableLinkedMaterialsToPrompt } from '../workspaces/shared/linkedMaterialPrompt'
import {
  WORKSPACE_AGENT_IDS,
  resolveWorkspaceAgentIdForStage,
  type WorkspaceAgentId,
} from '../workspaces/short/stageReadAccess'
import {
  WORKSPACE_AGENT_IDS as LONG_WORKSPACE_AGENT_IDS,
  resolveWorkspaceAgentIdForStage as resolveLongWorkspaceAgentIdForStage,
  type LongWorkspaceAgentId,
} from '../workspaces/long/stageReadAccess'
import type { LongStageId } from '../workspaces/long/stages'
import type {
  BookType,
  StageId,
} from '../domain/workspaceCore'
import type { Material, MaterialKind, Skill } from './libraryDomain'
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
  LONG_SHARED_WORKSPACE_PROMPT_KIND,
  SCRIPT_SHARED_WORKSPACE_PROMPT_KIND,
  SHARED_WORKSPACE_PROMPT_KIND,
} from './promptLocalStorage'

type AnyWorkspaceAgentId = WorkspaceAgentId | LongWorkspaceAgentId

function promptKindForWorkspaceType(workspaceType: BookType): string {
  if (workspaceType === 'long') return LONG_SHARED_WORKSPACE_PROMPT_KIND
  return workspaceType === 'script'
    ? SCRIPT_SHARED_WORKSPACE_PROMPT_KIND
    : SHARED_WORKSPACE_PROMPT_KIND
}

function agentIdsForWorkspaceType(workspaceType: BookType): readonly AnyWorkspaceAgentId[] {
  return workspaceType === 'long' ? LONG_WORKSPACE_AGENT_IDS : WORKSPACE_AGENT_IDS
}

/** 磁盘 / 嵌入式默认 + （浏览器）localStorage 覆盖；供集中设置页使用。 */
export async function readWorkspaceAgentPromptTemplate(
  agentId: AnyWorkspaceAgentId,
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
      localPromptLsKey(promptKindForWorkspaceType(workspaceType), agentId),
    )
    if (ls != null) return ls.endsWith('\n') ? ls.slice(0, -1) : ls
  } catch {
    /* ignore */
  }
  return getEmbeddedPromptTemplate(
    promptKindForWorkspaceType(workspaceType),
    agentId,
  )
}

export async function saveWorkspaceAgentPromptOverride(
  agentId: AnyWorkspaceAgentId,
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
      localPromptLsKey(promptKindForWorkspaceType(workspaceType), agentId),
      body,
    )
  } catch {
    console.warn('[DeepSeekWrite] 无法保存创作空间提示词覆盖：无桌面桥接且无可用 localStorage')
  }
}

export async function resetWorkspaceAgentPromptOverride(
  agentId: AnyWorkspaceAgentId,
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
    const k = localPromptLsKey(promptKindForWorkspaceType(workspaceType), agentId)
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
      agentIdsForWorkspaceType(workspaceType).map((agentId) =>
        api.reset_workspace_agent_prompt_override(agentId, workspaceType),
      ),
    )
  } else {
    ensureLocalSharedPromptMigrated()
    ensureLocalPlotPromptMerged()
    if (workspaceType === 'script') ensureLocalScriptPromptSeeded()
    try {
      const prefix = promptKindForWorkspaceType(workspaceType)
      for (const agentId of agentIdsForWorkspaceType(workspaceType)) {
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
    allowedMaterialKinds?: readonly MaterialKind[]
    linkedMaterialsByKind?: Partial<Record<MaterialKind, Material[]>>
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
    return appendLoadableSkillsToPrompt(
      appendReadableLinkedMaterialsToPrompt(
        prompt,
        input.linkedMaterialsByKind,
        input.allowedMaterialKinds,
      ),
      input.linkedSkill,
      stageId,
    )
  }

  const allowed = new Set(input.allowedWorkspaceStages)
  const filteredStages = Object.fromEntries(
    Object.entries(input.allStages).filter(([id]) => allowed.has(id as StageId)),
  ) as Partial<Record<StageId, string>>
  const promptAgentId =
    workspaceType === 'long'
      ? resolveLongWorkspaceAgentIdForStage(stageId as LongStageId)
      : resolveWorkspaceAgentIdForStage(
          stageId as Parameters<typeof resolveWorkspaceAgentIdForStage>[0],
        )
  const raw = await readWorkspaceAgentPromptTemplate(promptAgentId, workspaceType)
  const prompt = renderPromptFromTemplateRaw(raw, {
    bookTitle: input.bookTitle,
    bookGenre: input.bookGenre,
    stageBody: input.stageBody,
    allStages: filteredStages,
    promptKind: 'workspace',
    stageId,
  })
  return appendLoadableSkillsToPrompt(
    appendReadableLinkedMaterialsToPrompt(
      prompt,
      input.linkedMaterialsByKind,
      input.allowedMaterialKinds,
    ),
    input.linkedSkill,
    stageId,
  )
}
