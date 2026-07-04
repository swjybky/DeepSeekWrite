import { getBridgeApi } from './runtime'
import {
  SKILL_STAGE_KEYS,
  type CommonSkill,
  type SkillStageId,
} from './libraryDomain'

const COMMON_SKILLS_MOCK_KEY = 'deepseekwrite_dev_common_skills'
const COMMON_SKILLS_MODULES = import.meta.glob(
  '../../../app/prompt_defaults/skill/common_skills.json',
  { eager: true, import: 'default' },
) as Record<string, { skills?: unknown[] }>

function normalizeCommonSkill(raw: unknown): CommonSkill | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<CommonSkill>
  const selected = new Set(
    Array.isArray(value.effective_stages) ? value.effective_stages : [],
  )
  return {
    id: String(value.id || globalThis.crypto?.randomUUID?.() || Math.random()),
    title: String(value.title || '').trim() || '未命名通用技能',
    body: String(value.body || ''),
    effective_stages: SKILL_STAGE_KEYS.filter((stageId) =>
      selected.has(stageId),
    ) as SkillStageId[],
  }
}

function normalizeCommonSkills(raw: unknown): CommonSkill[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    const normalized = normalizeCommonSkill(item)
    return normalized ? [normalized] : []
  })
}

function readMockCommonSkills(): CommonSkill[] {
  try {
    const saved = localStorage.getItem(COMMON_SKILLS_MOCK_KEY)
    if (saved) return normalizeCommonSkills(JSON.parse(saved))
  } catch {
    // 浏览器开发模式下回退到随前端构建的默认值。
  }
  return normalizeCommonSkills(Object.values(COMMON_SKILLS_MODULES)[0]?.skills)
}

export async function readCommonSkills(): Promise<CommonSkill[]> {
  const api = await getBridgeApi()
  if (api?.read_common_skills) {
    return normalizeCommonSkills(await api.read_common_skills())
  }
  return readMockCommonSkills()
}

export async function saveCommonSkills(
  skills: CommonSkill[],
): Promise<CommonSkill[]> {
  const api = await getBridgeApi()
  if (api?.save_common_skills) {
    return normalizeCommonSkills(await api.save_common_skills(skills))
  }
  const normalized = normalizeCommonSkills(skills)
  localStorage.setItem(COMMON_SKILLS_MOCK_KEY, JSON.stringify(normalized))
  return normalized
}
