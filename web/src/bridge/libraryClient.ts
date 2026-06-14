import { getBridgeApi } from './runtime'

export async function exportLibrary(
  libraryType: 'material' | 'skill',
  itemId: string,
): Promise<{ success: boolean; error: string | null; path: string | null }> {
  const api = await getBridgeApi()
  if (api?.export_library) {
    return api.export_library(libraryType, itemId)
  }
  return { success: false, error: '浏览器开发模式暂不支持导出', path: null }
}

export async function importLibrary(
  libraryType: 'material' | 'skill',
  workspaceRoot: string | null,
): Promise<{ success: boolean; error: string | null; item: Record<string, unknown> | null }> {
  const api = await getBridgeApi()
  if (api?.import_library) {
    return api.import_library(libraryType, workspaceRoot)
  }
  return { success: false, error: '浏览器开发模式暂不支持导入', item: null }
}
