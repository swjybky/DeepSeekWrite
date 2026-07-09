import { getBridgeApi } from './runtime'
import {
  normalizeMaterialLibraryGroup,
  normalizeMaterialLibraryGroups,
  normalizeSkillLibraryGroup,
  normalizeSkillLibraryGroups,
  type MaterialKind,
  type MaterialLibraryGroup,
  type SkillKind,
  type SkillLibraryGroup,
} from './libraryDomain'
import {
  mockCreateMaterialLibraryGroup,
  mockCreateSkillLibraryGroup,
  mockDeleteMaterialLibraryGroup,
  mockDeleteSkillLibraryGroup,
  mockListMaterialLibraryGroups,
  mockListSkillLibraryGroups,
  mockUpdateMaterialLibraryGroup,
  mockUpdateSkillLibraryGroup,
} from './mockStore'

export async function listMaterialLibraryGroups(): Promise<MaterialLibraryGroup[]> {
  const api = await getBridgeApi()
  if (api?.list_material_library_groups) {
    return normalizeMaterialLibraryGroups(await api.list_material_library_groups())
  }
  return mockListMaterialLibraryGroups()
}

export async function createMaterialLibraryGroup(
  title: string,
  members?: Partial<Record<MaterialKind, string>> | null,
): Promise<MaterialLibraryGroup> {
  const api = await getBridgeApi()
  if (api?.create_material_library_group) {
    const raw = await api.create_material_library_group(title, members ?? null)
    const group = normalizeMaterialLibraryGroup(raw)
    if (!group) throw new Error('创建素材分组失败')
    return group
  }
  return mockCreateMaterialLibraryGroup(title, members)
}

export async function updateMaterialLibraryGroup(
  groupId: string,
  options?: {
    title?: string | null
    members?: Partial<Record<MaterialKind, string>> | null
  },
): Promise<MaterialLibraryGroup | null> {
  const api = await getBridgeApi()
  const opts = options ?? {}
  if (api?.update_material_library_group) {
    const raw = await api.update_material_library_group(
      groupId,
      opts.title ?? null,
      opts.members ?? null,
    )
    return raw ? normalizeMaterialLibraryGroup(raw) : null
  }
  return mockUpdateMaterialLibraryGroup(groupId, opts.title, opts.members)
}

export async function deleteMaterialLibraryGroup(groupId: string): Promise<boolean> {
  const api = await getBridgeApi()
  if (api?.delete_material_library_group) {
    return api.delete_material_library_group(groupId)
  }
  return mockDeleteMaterialLibraryGroup(groupId)
}

export async function listSkillLibraryGroups(): Promise<SkillLibraryGroup[]> {
  const api = await getBridgeApi()
  if (api?.list_skill_library_groups) {
    return normalizeSkillLibraryGroups(await api.list_skill_library_groups())
  }
  return mockListSkillLibraryGroups()
}

export async function createSkillLibraryGroup(
  title: string,
  members?: Partial<Record<SkillKind, string>> | null,
): Promise<SkillLibraryGroup> {
  const api = await getBridgeApi()
  if (api?.create_skill_library_group) {
    const raw = await api.create_skill_library_group(title, members ?? null)
    const group = normalizeSkillLibraryGroup(raw)
    if (!group) throw new Error('创建技能分组失败')
    return group
  }
  return mockCreateSkillLibraryGroup(title, members)
}

export async function updateSkillLibraryGroup(
  groupId: string,
  options?: {
    title?: string | null
    members?: Partial<Record<SkillKind, string>> | null
  },
): Promise<SkillLibraryGroup | null> {
  const api = await getBridgeApi()
  const opts = options ?? {}
  if (api?.update_skill_library_group) {
    const raw = await api.update_skill_library_group(
      groupId,
      opts.title ?? null,
      opts.members ?? null,
    )
    return raw ? normalizeSkillLibraryGroup(raw) : null
  }
  return mockUpdateSkillLibraryGroup(groupId, opts.title, opts.members)
}

export async function deleteSkillLibraryGroup(groupId: string): Promise<boolean> {
  const api = await getBridgeApi()
  if (api?.delete_skill_library_group) {
    return api.delete_skill_library_group(groupId)
  }
  return mockDeleteSkillLibraryGroup(groupId)
}
