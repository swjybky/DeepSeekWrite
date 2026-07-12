import type { SkillManagerSkill } from './libraryDomain'
import { getBridgeApi } from './runtime'

const STORAGE_KEY = 'deepseekwrite_skill_manager_skills_override'
const DEFAULT_MODULES = import.meta.glob(
  '../../../app/prompt_defaults/skill/manager_skills.json',
  { eager: true, import: 'default' },
) as Record<string, { skills?: unknown[] }>

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
}

function normalizeSkillManagerSkills(raw: unknown): SkillManagerSkill[] {
  const source = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { skills?: unknown }).skills)
      ? (raw as { skills: unknown[] }).skills
      : []
  const seenIds = new Set<string>()
  const seenNames = new Set<string>()
  return source.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`第 ${index + 1} 个管理技能格式无效`)
    }
    const record = item as Partial<SkillManagerSkill>
    const name = String(record.name ?? '').trim()
    const description = String(record.description ?? '').trim()
    const body = String(record.body ?? '').trim()
    if (!name) throw new Error(`第 ${index + 1} 个管理技能缺少名称`)
    if (!description) throw new Error(`管理技能「${name}」缺少描述`)
    if (!body) throw new Error(`管理技能「${name}」缺少正文`)
    if (seenNames.has(name)) throw new Error(`管理技能名称重复：${name}`)
    seenNames.add(name)
    let id = String(record.id ?? '').trim()
    if (!id || seenIds.has(id)) id = randomId()
    seenIds.add(id)
    return { id, name, description, body }
  })
}

function defaultSkillManagerSkills(): SkillManagerSkill[] {
  const payload = Object.values(DEFAULT_MODULES)[0] ?? { skills: [] }
  return normalizeSkillManagerSkills(payload)
}

export async function readSkillManagerSkills(): Promise<SkillManagerSkill[]> {
  const api = await getBridgeApi()
  if (api?.read_skill_manager_skills) {
    try {
      const skills = normalizeSkillManagerSkills(await api.read_skill_manager_skills())
      // 兼容旧版后端、缺失的用户配置以及意外保存的空列表。
      // load_skill 必须始终至少能回退到随前端发布的默认管理技能。
      return skills.length > 0 ? skills : defaultSkillManagerSkills()
    } catch {
      return defaultSkillManagerSkills()
    }
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const skills = raw ? normalizeSkillManagerSkills(JSON.parse(raw)) : []
    return skills.length > 0 ? skills : defaultSkillManagerSkills()
  } catch {
    return defaultSkillManagerSkills()
  }
}

export async function saveSkillManagerSkills(
  skills: SkillManagerSkill[],
): Promise<SkillManagerSkill[]> {
  const normalized = normalizeSkillManagerSkills(skills)
  const api = await getBridgeApi()
  if (api?.save_skill_manager_skills) {
    return api.save_skill_manager_skills(normalized)
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

export async function resetSkillManagerSkills(): Promise<SkillManagerSkill[]> {
  const api = await getBridgeApi()
  if (api?.reset_skill_manager_skills) return api.reset_skill_manager_skills()
  localStorage.removeItem(STORAGE_KEY)
  return defaultSkillManagerSkills()
}
