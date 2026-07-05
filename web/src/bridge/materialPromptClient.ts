import { getEmbeddedPromptTemplate } from '../prompt/embeddedDefaults'
import { renderPromptFromTemplateRaw } from '../prompt/renderTemplate'
import { getBridgeApi } from './runtime'
import {
  MATERIAL_MANAGER_AGENT_ID,
  MATERIAL_MANAGER_PROMPT_KIND,
  type MaterialKind,
  type MaterialPromptKind,
  type MaterialStageId,
  type MaterialType,
} from './libraryDomain'
import { localPromptLsKey } from './promptLocalStorage'

export async function getMaterialSystemPrompt(
  promptKind: MaterialPromptKind,
  stageId: MaterialStageId,
  input: {
    materialTitle: string
    materialTypeKey?: MaterialType
    materialType?: string
    materialGenre?: string
    materialKind?: MaterialKind | string
    materialOverview?: string
    currentEntryTitle?: string
    stageBody: string
    allStages: Partial<Record<MaterialStageId, string>>
  },
): Promise<string> {
  const stagesObj: Record<string, string> = {}
  for (const [k, v] of Object.entries(input.allStages ?? {})) {
    stagesObj[k] = String(v ?? '')
  }

  const api = await getBridgeApi()
  if (api?.get_material_system_prompt) {
    return api.get_material_system_prompt(
      promptKind,
      stageId,
      JSON.stringify({
        material_title: input.materialTitle,
        book_title: input.materialTitle,
        material_type_key: input.materialTypeKey ?? 'short',
        material_type: input.materialType ?? '',
        material_genre: input.materialGenre ?? '',
        material_kind: input.materialKind ?? '',
        material_overview: input.materialOverview ?? '',
        current_entry_title: input.currentEntryTitle ?? '',
        stage_body: input.stageBody,
        all_stages: stagesObj,
      }),
      input.materialTypeKey ?? 'short',
    )
  }

  const raw = await readMaterialAgentPromptTemplateForType(input.materialTypeKey ?? 'short')
  const kindRaw = input.materialKind
    ? await readMaterialKindPromptTemplateForType(
        input.materialTypeKey ?? 'short',
        input.materialKind as MaterialKind,
      )
    : ''
  return renderPromptFromTemplateRaw([raw, kindRaw].filter(Boolean).join('\n\n'), {
    bookTitle: input.materialTitle,
    materialType: input.materialType,
    materialGenre: input.materialGenre,
    materialKind: input.materialKind,
    materialOverview: input.materialOverview,
    currentEntryTitle: input.currentEntryTitle,
    stageBody: input.stageBody,
    allStages: input.allStages,
    promptKind,
    stageId,
  })
}

export async function readMaterialAgentPromptTemplate(): Promise<string> {
  return readMaterialAgentPromptTemplateForType('short')
}

export async function readMaterialAgentPromptTemplateForType(
  materialType: MaterialType = 'short',
): Promise<string> {
  const api = await getBridgeApi()
  if (api?.read_material_agent_prompt_template) {
    const t = await api.read_material_agent_prompt_template(materialType)
    return t.endsWith('\n') ? t.slice(0, -1) : t
  }
  const typedKey = localPromptLsKey(`material_${materialType}`, MATERIAL_MANAGER_AGENT_ID)
  try {
    const ls =
      localStorage.getItem(typedKey) ??
      (materialType === 'short'
        ? localStorage.getItem(
            localPromptLsKey(MATERIAL_MANAGER_PROMPT_KIND, MATERIAL_MANAGER_AGENT_ID),
          )
        : null)
    if (ls != null && ls.trim() !== '')
      return ls.endsWith('\n') ? ls.slice(0, -1) : ls
  } catch {
    /* ignore */
  }
  return getEmbeddedPromptTemplate(
    `material_${materialType}`,
    MATERIAL_MANAGER_AGENT_ID,
  )
}

export async function readMaterialKindPromptTemplateForType(
  materialType: MaterialType = 'short',
  materialKind: MaterialKind = 'other',
): Promise<string> {
  const api = await getBridgeApi()
  if (api?.read_material_kind_prompt_template) {
    const t = await api.read_material_kind_prompt_template(materialType, materialKind)
    return t.endsWith('\n') ? t.slice(0, -1) : t
  }
  const typedKey = localPromptLsKey(`material_${materialType}_kind`, materialKind)
  try {
    const ls = localStorage.getItem(typedKey)
    if (ls != null && ls.trim() !== '') {
      return ls.endsWith('\n') ? ls.slice(0, -1) : ls
    }
  } catch {
    /* ignore */
  }
  return getEmbeddedPromptTemplate(
    `material_${materialType}_kind`,
    materialKind,
  )
}

export async function saveMaterialAgentPromptOverride(
  body: string,
  materialType: MaterialType = 'short',
): Promise<void> {
  const api = await getBridgeApi()
  if (api?.save_material_agent_prompt_override) {
    await api.save_material_agent_prompt_override(body, materialType)
    return
  }
  try {
    localStorage.setItem(
      localPromptLsKey(`material_${materialType}`, MATERIAL_MANAGER_AGENT_ID),
      body,
    )
  } catch {
    console.warn('[DeepSeekWrite] 无法保存素材库智能体提示词覆盖：无桌面桥接且无可用 localStorage')
  }
}

export async function saveMaterialKindPromptOverride(
  body: string,
  materialType: MaterialType = 'short',
  materialKind: MaterialKind = 'other',
): Promise<void> {
  const api = await getBridgeApi()
  if (api?.save_material_kind_prompt_override) {
    await api.save_material_kind_prompt_override(body, materialType, materialKind)
    return
  }
  try {
    localStorage.setItem(
      localPromptLsKey(`material_${materialType}_kind`, materialKind),
      body,
    )
  } catch {
    console.warn('[DeepSeekWrite] 无法保存素材库类型提示词覆盖：无桌面桥接且无可用 localStorage')
  }
}

export async function resetMaterialAgentPromptOverride(
  materialType: MaterialType = 'short',
): Promise<boolean> {
  const api = await getBridgeApi()
  if (api?.reset_material_agent_prompt_override) {
    return api.reset_material_agent_prompt_override(materialType)
  }
  try {
    const k = localPromptLsKey(`material_${materialType}`, MATERIAL_MANAGER_AGENT_ID)
    const had = localStorage.getItem(k) != null
    localStorage.removeItem(k)
    return had
  } catch {
    return false
  }
}

export async function resetMaterialKindPromptOverride(
  materialType: MaterialType = 'short',
  materialKind: MaterialKind = 'other',
): Promise<boolean> {
  const api = await getBridgeApi()
  if (api?.reset_material_kind_prompt_override) {
    return api.reset_material_kind_prompt_override(materialType, materialKind)
  }
  try {
    const k = localPromptLsKey(`material_${materialType}_kind`, materialKind)
    const had = localStorage.getItem(k) != null
    localStorage.removeItem(k)
    return had
  } catch {
    return false
  }
}

export async function readMaterialPromptTemplate(
  promptKind: MaterialPromptKind,
  stageId: MaterialStageId,
): Promise<string> {
  void promptKind
  void stageId
  return readMaterialAgentPromptTemplate()
}

export async function saveMaterialPromptOverride(
  promptKind: MaterialPromptKind,
  stageId: MaterialStageId,
  body: string,
): Promise<void> {
  void promptKind
  void stageId
  await saveMaterialAgentPromptOverride(body)
}

export async function resetMaterialPromptOverride(
  promptKind: MaterialPromptKind,
  stageId: MaterialStageId,
): Promise<boolean> {
  void promptKind
  void stageId
  return resetMaterialAgentPromptOverride()
}
