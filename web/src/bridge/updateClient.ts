import { getBridgeApi } from './runtime'

export type UpdateCheckResult = {
  success: boolean
  error: string | null
  current_version: string
  latest_version: string | null
  update_available: boolean
  platform_key: string | null
  file_name: string | null
  release_notes: string[]
}

export type UpdateDownloadResult = {
  success: boolean
  error: string | null
  up_to_date: boolean
  current_version: string
  latest_version: string | null
  path: string | null
  browser_opened: boolean
  file_name: string | null
  release_notes: string[]
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const api = await getBridgeApi()
  if (!api?.check_for_update) {
    throw new Error('软件更新功能仅可在桌面安装包中使用')
  }
  return api.check_for_update()
}

export async function downloadLatestUpdate(): Promise<UpdateDownloadResult> {
  const api = await getBridgeApi()
  if (!api?.download_latest_update) {
    throw new Error('软件更新功能仅可在桌面安装包中使用')
  }
  return api.download_latest_update()
}
