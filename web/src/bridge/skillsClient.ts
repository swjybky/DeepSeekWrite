import { getBridgeApi } from './runtime'
import type { SaveSkillOptions } from './apiTypes'
import {
  normalizeSkill,
  normalizeSkillSummary,
  type Skill,
  type SkillSummary,
  type SkillType,
} from './libraryDomain'
import {
  mockCreateSkill,
  mockDeleteSkill,
  mockGetSkill,
  mockListSkills,
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
  load_common_skills = false,
): Promise<Skill> {
  const api = await getBridgeApi()
  if (api?.create_skill) {
    return normalizeSkill(
      await api.create_skill(
        title,
        skill_type,
        workspace_root ?? null,
        load_common_skills,
      ),
    )
  }
  return mockCreateSkill(title, skill_type, load_common_skills)
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

export async function deleteSkill(skill_id: string): Promise<boolean> {
  const api = await getBridgeApi()
  if (api?.delete_skill) return api.delete_skill(skill_id)
  return mockDeleteSkill(skill_id)
}
