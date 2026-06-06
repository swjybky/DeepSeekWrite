/**
 * Pi Web UI 全局存储（API Key、会话元数据等），与 pi-web-ui 示例一致。
 * @mariozechner/pi-coding-agent 为终端 CLI，不在此桌面壳内嵌；需在系统终端单独运行。
 */
import '@earendil-works/pi-ai'

import {
  AppStorage,
  CustomProvidersStore,
  IndexedDBStorageBackend,
  ProviderKeysStore,
  SessionsStore,
  SettingsStore,
  setAppStorage,
} from '@earendil-works/pi-web-ui'

import { warmupWorkspaceModelStorage } from './resolveWorkspaceChatModel'

let ready: Promise<void> | null = null

export function ensurePiAppStorage(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const settings = new SettingsStore()
      const providerKeys = new ProviderKeysStore()
      const sessions = new SessionsStore()
      const customProviders = new CustomProvidersStore()

      const configs = [
        settings.getConfig(),
        SessionsStore.getMetadataConfig(),
        providerKeys.getConfig(),
        customProviders.getConfig(),
        sessions.getConfig(),
      ]

      const backend = new IndexedDBStorageBackend({
        dbName: 'write_claw_pi',
        version: 2,
        stores: configs,
      })

      settings.setBackend(backend)
      providerKeys.setBackend(backend)
      customProviders.setBackend(backend)
      sessions.setBackend(backend)

      const storage = new AppStorage(
        settings,
        providerKeys,
        sessions,
        customProviders,
        backend,
      )
      setAppStorage(storage)
      await warmupWorkspaceModelStorage()
    })()
  }
  return ready
}
