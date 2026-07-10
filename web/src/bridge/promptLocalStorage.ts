import { WORKSPACE_AGENT_IDS } from '../workspaces/short/stageReadAccess'

const PROMPT_TEMPLATE_LS_PREFIX = 'deepseekwrite_prompt_template_override:'
export const SHARED_WORKSPACE_PROMPT_KIND = 'shared'
export const SCRIPT_SHARED_WORKSPACE_PROMPT_KIND = 'script_shared'
export const LONG_SHARED_WORKSPACE_PROMPT_KIND = 'long_shared'
const LEGACY_QINGGAN_PROMPT_KIND = 'qinggan'
const SHARED_PROMPT_LS_MIGRATION_MARKER =
  'deepseekwrite_shared_prompt_migration_from_qinggan_v1'
const PLOT_PROMPT_LS_MERGE_MARKER = 'deepseekwrite_plot_prompt_merge_v1'
const WORKSPACE_PROMPT_DEFAULTS_V2_RESET_MARKER =
  'deepseekwrite_workspace_prompt_defaults_v2_reset'

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

export function ensureLocalScriptPromptPrepared(): void {
  // Legacy entry point kept for callers; script prompts now fall back to
  // script built-in defaults instead of copying short prompt overrides.
}

export function ensureLocalWorkspacePromptDefaultsV2Reset(): void {
  try {
    if (localStorage.getItem(WORKSPACE_PROMPT_DEFAULTS_V2_RESET_MARKER)) return
    const removablePrefixes = [
      `${PROMPT_TEMPLATE_LS_PREFIX}${SHARED_WORKSPACE_PROMPT_KIND}:`,
      `${PROMPT_TEMPLATE_LS_PREFIX}${SCRIPT_SHARED_WORKSPACE_PROMPT_KIND}:`,
      `${PROMPT_TEMPLATE_LS_PREFIX}${LEGACY_QINGGAN_PROMPT_KIND}:`,
    ]
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index)
      if (key && removablePrefixes.some((prefix) => key.startsWith(prefix))) {
        localStorage.removeItem(key)
      }
    }
    localStorage.setItem(WORKSPACE_PROMPT_DEFAULTS_V2_RESET_MARKER, '1')
  } catch {
    /* ignore */
  }
}
