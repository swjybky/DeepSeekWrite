import { getBridgeApi } from './runtime'
import type { SaveMaterialOptions } from './apiTypes'
import { deleteAiChatSessionsForOwner } from './aiChatHistoryClient'
import {
  normalizeMaterial,
  normalizeMaterialSummary,
  type Material,
  type MaterialKindWithMixed,
  type MaterialSummary,
  type MaterialType,
} from './libraryDomain'
import {
  mockCreateMaterial,
  mockDeleteMaterial,
  mockGetMaterial,
  mockGetMaterialGenres,
  mockListMaterials,
  mockSaveMaterial,
} from './mockStore'

export async function listMaterials(): Promise<MaterialSummary[]> {
  const api = await getBridgeApi()
  if (api?.list_materials) {
    const list = await api.list_materials() as MaterialSummary[]
    return list.map((item) => normalizeMaterialSummary(item))
  }
  return mockListMaterials()
}

export async function getMaterial(material_id: string): Promise<Material | null> {
  const api = await getBridgeApi()
  if (api?.get_material) {
    const raw = await api.get_material(material_id)
    return raw ? normalizeMaterial(raw) : null
  }
  return mockGetMaterial(material_id)
}

export async function createMaterial(
  title: string,
  material_type: MaterialType,
  parent_genre?: string | null,
  sub_genre?: string | null,
  workspace_root?: string | null,
  material_kind?: MaterialKindWithMixed | null,
): Promise<Material> {
  const api = await getBridgeApi()
  if (api?.create_material) {
    return normalizeMaterial(
      await api.create_material(
        title,
        material_type,
        parent_genre ?? null,
        sub_genre ?? null,
        workspace_root ?? null,
        material_kind ?? null,
      ),
    )
  }
  return mockCreateMaterial(title, material_type, parent_genre, sub_genre, material_kind)
}


export async function saveMaterial(
  material_id: string,
  options?: SaveMaterialOptions,
): Promise<Material | null> {
  const api = await getBridgeApi()
  const opts = options ?? {}
  if (api?.save_material) {
    const raw = await api.save_material(
      material_id,
      opts.stages ?? null,
      opts.title ?? null,
      opts.stage_items ?? null,
      opts.overview ?? null,
    )
    return raw ? normalizeMaterial(raw) : null
  }
  return mockSaveMaterial(
    material_id,
    opts.stages,
    opts.title,
    opts.stage_items,
    opts.overview,
  )
}

export async function deleteMaterial(material_id: string): Promise<boolean> {
  const api = await getBridgeApi()
  const ok = api?.delete_material
    ? await api.delete_material(material_id)
    : await mockDeleteMaterial(material_id)
  if (ok && !api?.delete_material) {
    await deleteAiChatSessionsForOwner('material', material_id)
  }
  return ok
}

export async function getMaterialGenres(): Promise<Record<string, string[]>> {
  const api = await getBridgeApi()
  if (api?.get_material_genres) return api.get_material_genres()
  return mockGetMaterialGenres()
}
