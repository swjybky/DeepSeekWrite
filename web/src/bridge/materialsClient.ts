import { getBridgeApi } from './runtime'
import type { SaveMaterialOptions } from './apiTypes'
import {
  normalizeMaterial,
  normalizeMaterialSummary,
  type Material,
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
      ),
    )
  }
  return mockCreateMaterial(title, material_type, parent_genre, sub_genre)
}


export async function saveMaterial(
  material_id: string,
  options?: SaveMaterialOptions,
): Promise<Material | null> {
  const api = await getBridgeApi()
  const opts = options ?? {}
  if (api?.save_material) {
    const raw = await api.save_material(material_id, opts.stages ?? null, opts.title ?? null)
    return raw ? normalizeMaterial(raw) : null
  }
  return mockSaveMaterial(material_id, opts.stages, opts.title)
}

export async function deleteMaterial(material_id: string): Promise<boolean> {
  const api = await getBridgeApi()
  if (api?.delete_material) return api.delete_material(material_id)
  return mockDeleteMaterial(material_id)
}

export async function getMaterialGenres(): Promise<Record<string, string[]>> {
  const api = await getBridgeApi()
  if (api?.get_material_genres) return api.get_material_genres()
  return mockGetMaterialGenres()
}
