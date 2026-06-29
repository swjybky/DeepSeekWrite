import { getEmbeddedPromptTemplate } from '../prompt/embeddedDefaults'
import { WORKSPACE_AGENT_IDS } from '../workspaces/short/stageReadAccess'

const PROMPT_TEMPLATE_LS_PREFIX = 'deepseekwrite_prompt_template_override:'
export const SHARED_WORKSPACE_PROMPT_KIND = 'shared'
export const SCRIPT_SHARED_WORKSPACE_PROMPT_KIND = 'script_shared'
const LEGACY_QINGGAN_PROMPT_KIND = 'qinggan'
const SHARED_PROMPT_LS_MIGRATION_MARKER =
  'deepseekwrite_shared_prompt_migration_from_qinggan_v1'
const PLOT_PROMPT_LS_MERGE_MARKER = 'deepseekwrite_plot_prompt_merge_v1'
const SCRIPT_PROMPT_LS_SEED_MARKER = 'deepseekwrite_script_prompt_seed_from_short_v1'

export function localPromptLsKey(promptKind: string, stage: string): string {
  return PROMPT_TEMPLATE_LS_PREFIX + `${promptKind}:${stage}`
}

export function ensureLocalSharedPromptMigrated(): void {
  try {
    if (localStorage.getItem(SHARED_PROMPT_LS_MIGRATION_MARKER)) return
    for (const agentId of [
      ...WORKSPACE_AGENT_IDS,
      'intro_design',
      'plot_refine',
    ]) {
      const target = localPromptLsKey(SHARED_WORKSPACE_PROMPT_KIND, agentId)
      const source = localPromptLsKey(LEGACY_QINGGAN_PROMPT_KIND, agentId)
      if (localStorage.getItem(target) == null) {
        const legacy = localStorage.getItem(source)
        if (legacy != null) localStorage.setItem(target, legacy)
      }
    }
    localStorage.setItem(SHARED_PROMPT_LS_MIGRATION_MARKER, '1')
  } catch {
    /* ignore */
  }
}

export function ensureLocalPlotPromptMerged(): void {
  try {
    if (localStorage.getItem(PLOT_PROMPT_LS_MERGE_MARKER)) return
    const sections = [
      ['plot_design', '剧情设计'],
      ['intro_design', '导语设计'],
      ['plot_refine', '剧情细化'],
    ].flatMap(([agentId, label]) => {
      const body =
        localStorage.getItem(
          localPromptLsKey(SHARED_WORKSPACE_PROMPT_KIND, agentId),
        )?.trim() ?? ''
      return body ? [`## ${label}\n\n${body}`] : []
    })
    if (sections.length > 0) {
      localStorage.setItem(
        localPromptLsKey(SHARED_WORKSPACE_PROMPT_KIND, 'plot_design'),
        sections.join('\n\n---\n\n'),
      )
    }
    localStorage.setItem(PLOT_PROMPT_LS_MERGE_MARKER, '1')
  } catch {
    /* ignore */
  }
}

export function ensureLocalScriptPromptSeeded(): void {
  try {
    if (localStorage.getItem(SCRIPT_PROMPT_LS_SEED_MARKER)) return
    ensureLocalSharedPromptMigrated()
    ensureLocalPlotPromptMerged()
    for (const agentId of WORKSPACE_AGENT_IDS) {
      const target = localPromptLsKey(SCRIPT_SHARED_WORKSPACE_PROMPT_KIND, agentId)
      if (localStorage.getItem(target) != null) continue
      const shortOverride = localStorage.getItem(
        localPromptLsKey(SHARED_WORKSPACE_PROMPT_KIND, agentId),
      )
      localStorage.setItem(
        target,
        shortOverride ?? getEmbeddedPromptTemplate(SHARED_WORKSPACE_PROMPT_KIND, agentId),
      )
    }
    localStorage.setItem(SCRIPT_PROMPT_LS_SEED_MARKER, '1')
  } catch {
    /* ignore */
  }
}
