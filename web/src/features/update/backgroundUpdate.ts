import { useSyncExternalStore } from 'react'
import { downloadLatestUpdate } from '../../bridge'

export type BackgroundUpdateStatus =
  | 'idle'
  | 'downloading'
  | 'downloaded'
  | 'browser-opened'
  | 'up-to-date'
  | 'error'

export type BackgroundUpdateState = {
  status: BackgroundUpdateStatus
  noticeVisible: boolean
  title: string
  detail: string
}

const IDLE_STATE: BackgroundUpdateState = {
  status: 'idle',
  noticeVisible: false,
  title: '',
  detail: '',
}

let state = IDLE_STATE
const listeners = new Set<() => void>()

function publish(next: BackgroundUpdateState) {
  state = next
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return state
}

export function useBackgroundUpdate(): BackgroundUpdateState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function dismissBackgroundUpdateNotice() {
  if (!state.noticeVisible) return
  publish({ ...state, noticeVisible: false })
}

export function startBackgroundUpdate(): boolean {
  if (state.status === 'downloading') return false

  publish({
    status: 'downloading',
    noticeVisible: false,
    title: '正在后台下载新版本',
    detail: '下载完成后会通知你。',
  })

  void (async () => {
    try {
      const downloaded = await downloadLatestUpdate()
      if (!downloaded.success) {
        throw new Error(downloaded.error || '下载安装包失败')
      }
      if (downloaded.up_to_date) {
        publish({
          status: 'up-to-date',
          noticeVisible: true,
          title: '当前已是最新版本',
          detail: `当前版本：v${downloaded.current_version}`,
        })
        return
      }
      if (downloaded.browser_opened) {
        publish({
          status: 'browser-opened',
          noticeVisible: true,
          title: '已打开浏览器下载页面',
          detail: 'Gitee 大文件需要登录，请在浏览器中继续下载。',
        })
        return
      }
      publish({
        status: 'downloaded',
        noticeVisible: true,
        title: '新版本下载完成',
        detail: downloaded.path || downloaded.file_name || '安装包已保存到下载目录。',
      })
    } catch (error) {
      publish({
        status: 'error',
        noticeVisible: true,
        title: '新版本下载失败',
        detail: error instanceof Error ? error.message : '下载安装包失败',
      })
    }
  })()

  return true
}
