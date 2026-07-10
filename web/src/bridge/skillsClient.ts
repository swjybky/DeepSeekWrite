import { getBridgeApi } from './runtime'
import type { SaveSkillOptions } from './apiTypes'
import { deleteAiChatSessionsForOwner } from './aiChatHistoryClient'
import {
  normalizeSkill,
  normalizeSkillSummary,
  type ImportSkillEntriesResult,
  type Skill,
  type SkillImportSelection,
  type SkillImportSource,
  type SkillKind,
  type SkillSummary,
  type SkillType,
} from './libraryDomain'
import {
  mockCreateSkill,
  mockDeleteSkill,
  mockGetSkill,
  mockImportSkillEntries,
  mockListSkills,
  mockListSkillImportSources,
  mockSaveSkill,
} from './mockStore'

export async function listSkills(): Promise<SkillSummary[]> {
  const api = await getBridgeApi()
  if (api?.list_skills) {
    const list = await api.list_skills() as SkillSummary[]
    return list.map((item) => normalizeSkillSummary(item))
  }
  return mockListSkills()
}

export async function getSkill(skill_id: string): Promise<Skill | null> {
  const api = await getBridgeApi()
  if (api?.get_skill) {
    const raw = await api.get_skill(skill_id)
    return raw ? normalizeSkill(raw) : null
  }
  return mockGetSkill(skill_id)
}

export async function createSkill(
  title: string,
  skill_type: SkillType = 'short',
  workspace_root?: string | null,
  skill_kind: SkillKind = 'general',
): Promise<Skill> {
  const api = await getBridgeApi()
  if (api?.create_skill) {
    return normalizeSkill(
      await api.create_skill(
        title,
        skill_type,
        workspace_root ?? null,
        skill_kind,
      ),
    )
  }
  return mockCreateSkill(title, skill_type, skill_kind)
}


export async function saveSkill(
  skill_id: string,
  options?: SaveSkillOptions,
): Promise<Skill | null> {
  const api = await getBridgeApi()
  const opts = options ?? {}
  if (api?.save_skill) {
    const raw = await api.save_skill(skill_id, opts as Record<string, unknown>)
    return raw ? normalizeSkill(raw) : null
  }
  return mockSaveSkill(skill_id, opts)
}

export async function listSkillImportSources(
  target_skill_id: string,
): Promise<SkillImportSource[]> {
  const api = await getBridgeApi()
  if (api?.list_skill_import_sources) {
    return await api.list_skill_import_sources(target_skill_id)
  }
  return mockListSkillImportSources(target_skill_id)
}

export async function importSkillEntries(
  target_skill_id: string,
  selections: SkillImportSelection[],
): Promise<ImportSkillEntriesResult | null> {
  const api = await getBridgeApi()
  if (api?.import_skill_entries) {
    const raw = await api.import_skill_entries(target_skill_id, selections)
    return raw
      ? {
          skill: normalizeSkill(raw.skill),
          added_count: Number(raw.added_count || 0),
          skipped_count: Number(raw.skipped_count || 0),
        }
      : null
  }
  return mockImportSkillEntries(target_skill_id, selections)
}

export async function deleteSkill(skill_id: string): Promise<boolean> {
  const api = await getBridgeApi()
  const ok = api?.delete_skill
    ? await api.delete_skill(skill_id)
    : await mockDeleteSkill(skill_id)
  if (ok && !api?.delete_skill) {
    await deleteAiChatSessionsForOwner('skill', skill_id)
  }
  return ok
}
