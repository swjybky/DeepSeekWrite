import type { BookType } from '../domain/workspaceCore'
import {
  getDefaultWorkspaceAgentReadAccess,
  normalizeWorkspaceAgentReadAccess,
} from '../workspaces/short/stageReadAccess'
import {
  getDefaultWorkspaceAgentReadAccess as getDefaultScriptWorkspaceAgentReadAccess,
  normalizeWorkspaceAgentReadAccess as normalizeScriptWorkspaceAgentReadAccess,
} from '../workspaces/script/stageReadAccess'
import {
  getDefaultWorkspaceAgentReadAccess as getDefaultLongWorkspaceAgentReadAccess,
  normalizeWorkspaceAgentReadAccess as normalizeLongWorkspaceAgentReadAccess,
} from '../workspaces/long/stageReadAccess'
import type { WorkspaceAgentReadAccessConfig } from '../workspaces/shared/readAccess'
import { getBridgeApi, isPywebviewDesktopBundle } from './runtime'
import type { AppearanceStyle } from './aiModelConfig'

/** 书架「工作文件夹」持久化键（浏览器 / pywebview 同源存储） */
export const WORKSPACE_ROOT_STORAGE_KEY = 'deepseekwrite_workspace_root'

/** 全局创作空间智能体读取配置（浏览器开发模式 localStorage） */
export const WORKSPACE_AGENT_READ_ACCESS_STORAGE_KEY =
  'deepseekwrite:workspace_agent_read_access'
const LEGACY_STAGE_READ_ACCESS_STORAGE_KEY = 'deepseekwrite:stage_read_access'
export const APPEARANCE_STYLE_STORAGE_KEY = 'deepseekwrite:appearance_style'
export const TEXT_DISPLAY_MODE_STORAGE_KEY = 'deepseekwrite:text_display_mode'
export type TextDisplayMode = 'text' | 'markdown'

export function getStoredWorkspaceRoot(): string | null {
  try {
    const v = localStorage.getItem(WORKSPACE_ROOT_STORAGE_KEY)
    return v?.trim() ? v.trim() : null
  } catch {
    return null
  }
}

export function setStoredWorkspaceRoot(path: string | null): void {
  try {
    if (path?.trim()) localStorage.setItem(WORKSPACE_ROOT_STORAGE_KEY, path.trim())
    else localStorage.removeItem(WORKSPACE_ROOT_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function normalizeAppearanceStyle(raw: unknown): AppearanceStyle {
  return raw === 'modern' || raw === 'night' ? raw : 'classic'
}

export function getStoredAppearanceStyle(): AppearanceStyle {
  try {
    return normalizeAppearanceStyle(localStorage.getItem(APPEARANCE_STYLE_STORAGE_KEY))
  } catch {
    return 'classic'
  }
}

export function setStoredAppearanceStyle(style: AppearanceStyle): void {
  try {
    localStorage.setItem(
      APPEARANCE_STYLE_STORAGE_KEY,
      normalizeAppearanceStyle(style),
    )
  } catch {
    /* ignore */
  }
}

export async function getAppearanceStyle(): Promise<AppearanceStyle> {
  const api = await getBridgeApi()
  if (api?.get_appearance_style) {
    try {
      const style = normalizeAppearanceStyle(await api.get_appearance_style())
      setStoredAppearanceStyle(style)
      return style
    } catch {
      /* fall through */
    }
  }
  return getStoredAppearanceStyle()
}

export async function saveAppearanceStyle(
  style: AppearanceStyle,
): Promise<AppearanceStyle> {
  const normalized = normalizeAppearanceStyle(style)
  const api = await getBridgeApi()
  if (api?.set_appearance_style) {
    const saved = normalizeAppearanceStyle(await api.set_appearance_style(normalized))
    setStoredAppearanceStyle(saved)
    return saved
  }
  setStoredAppearanceStyle(normalized)
  return normalized
}

export function normalizeTextDisplayMode(raw: unknown): TextDisplayMode {
  return raw === 'markdown' ? 'markdown' : 'text'
}

export function getStoredTextDisplayMode(): TextDisplayMode {
  try {
    return normalizeTextDisplayMode(localStorage.getItem(TEXT_DISPLAY_MODE_STORAGE_KEY))
  } catch {
    return 'text'
  }
}

export function setStoredTextDisplayMode(mode: TextDisplayMode): void {
  try {
    localStorage.setItem(TEXT_DISPLAY_MODE_STORAGE_KEY, normalizeTextDisplayMode(mode))
  } catch {
    /* ignore */
  }
}

export async function getTextDisplayMode(): Promise<TextDisplayMode> {
  const api = await getBridgeApi()
  if (api?.get_text_display_mode) {
    try {
      const mode = normalizeTextDisplayMode(await api.get_text_display_mode())
      setStoredTextDisplayMode(mode)
      return mode
    } catch {
      /* fall through */
    }
  }
  return getStoredTextDisplayMode()
}

export async function saveTextDisplayMode(mode: TextDisplayMode): Promise<TextDisplayMode> {
  const normalized = normalizeTextDisplayMode(mode)
  const api = await getBridgeApi()
  if (api?.set_text_display_mode) {
    const saved = normalizeTextDisplayMode(await api.set_text_display_mode(normalized))
    setStoredTextDisplayMode(saved)
    return saved
  }
  setStoredTextDisplayMode(normalized)
  return normalized
}

/**
 * 启动时解析工作文件夹：桌面端以 Python 持久化为准；若无则从 localStorage 读取并写回磁盘。
 * 纯浏览器开发仅使用 localStorage。
 *
 * 桌面壳里偶发首帧早于 `api` 注入：先让出 1～2 帧再取桥接；若 `get_workspace_root` 抛错则短重试（避免误显示「未选择」）。
 * 不在「无 api」时循环调用 getBridgeApi，以免重复触发长时间解析。
 */
export async function loadPersistedWorkspaceRoot(): Promise<string | null> {
  const fromLs = getStoredWorkspaceRoot()
  const desktop = isPywebviewDesktopBundle()
  if (desktop) {
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
  }

  const api = await getBridgeApi()
  if (!api?.get_workspace_root || !api?.set_workspace_root) {
    return fromLs
  }

  const attempts = desktop ? 8 : 1
  const delayMs = 100

  for (let i = 0; i < attempts; i++) {
    try {
      const fromDisk = await api.get_workspace_root()
      if (typeof fromDisk === 'string' && fromDisk.trim()) {
        const t = fromDisk.trim()
        setStoredWorkspaceRoot(t)
        return t
      }
      if (fromLs) {
        await api.set_workspace_root(fromLs)
        return fromLs
      }
      return null
    } catch {
      if (desktop && i < attempts - 1) {
        await new Promise<void>((r) => setTimeout(r, delayMs))
        continue
      }
      return fromLs
    }
  }
  return fromLs
}

/** 选择或更改工作文件夹后调用，同步 localStorage 与桌面端 preferences.json */
export async function persistWorkspaceRoot(path: string | null): Promise<void> {
  setStoredWorkspaceRoot(path)
  const api = await getBridgeApi()
  if (api?.set_workspace_root) {
    await api.set_workspace_root(path)
  }
}

function workspaceAgentReadAccessStorageKey(workspaceType: BookType): string {
  if (workspaceType === 'long') {
    return `${WORKSPACE_AGENT_READ_ACCESS_STORAGE_KEY}:long`
  }
  return workspaceType === 'script'
    ? `${WORKSPACE_AGENT_READ_ACCESS_STORAGE_KEY}:script`
    : WORKSPACE_AGENT_READ_ACCESS_STORAGE_KEY
}

function getStoredWorkspaceAgentReadAccessRaw(workspaceType: BookType = 'short'): unknown {
  try {
    const raw =
      localStorage.getItem(workspaceAgentReadAccessStorageKey(workspaceType)) ??
      (workspaceType === 'short'
        ? localStorage.getItem(LEGACY_STAGE_READ_ACCESS_STORAGE_KEY)
        : localStorage.getItem(WORKSPACE_AGENT_READ_ACCESS_STORAGE_KEY))
    if (!raw?.trim()) return null
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function setStoredWorkspaceAgentReadAccess(
  config: WorkspaceAgentReadAccessConfig,
  workspaceType: BookType = 'short',
): void {
  try {
    localStorage.setItem(
      workspaceAgentReadAccessStorageKey(workspaceType),
      JSON.stringify(config),
    )
  } catch {
    /* ignore */
  }
}

/** 读取全局创作空间智能体可读配置；桌面端以 preferences.json 为准。 */
export async function getWorkspaceAgentReadAccess(
  workspaceType: BookType = 'short',
): Promise<WorkspaceAgentReadAccessConfig> {
  const api = await getBridgeApi()
  if (api?.get_workspace_agent_read_access) {
    try {
      const fromDisk = await api.get_workspace_agent_read_access(workspaceType)
      const normalized =
        workspaceType === 'long'
          ? normalizeLongWorkspaceAgentReadAccess(
              fromDisk as WorkspaceAgentReadAccessConfig,
            )
          : workspaceType === 'script'
            ? normalizeScriptWorkspaceAgentReadAccess(
                fromDisk as WorkspaceAgentReadAccessConfig,
              )
            : normalizeWorkspaceAgentReadAccess(
                fromDisk as WorkspaceAgentReadAccessConfig,
              )
      setStoredWorkspaceAgentReadAccess(normalized, workspaceType)
      try {
        await api.set_workspace_agent_read_access(
          normalized as unknown as Record<string, unknown>,
          workspaceType,
        )
      } catch {
        /* 读取结果仍可使用；保存失败由后续设置修改重试 */
      }
      return normalized
    } catch {
      /* fall through */
    }
  }
  const normalized =
    workspaceType === 'long'
      ? normalizeLongWorkspaceAgentReadAccess(
          getStoredWorkspaceAgentReadAccessRaw(workspaceType) as WorkspaceAgentReadAccessConfig,
        )
      : workspaceType === 'script'
        ? normalizeScriptWorkspaceAgentReadAccess(
            getStoredWorkspaceAgentReadAccessRaw(workspaceType) as WorkspaceAgentReadAccessConfig,
          )
        : normalizeWorkspaceAgentReadAccess(
            getStoredWorkspaceAgentReadAccessRaw(workspaceType) as WorkspaceAgentReadAccessConfig,
          )
  setStoredWorkspaceAgentReadAccess(normalized, workspaceType)
  return normalized
}

/** 保存全局创作空间智能体可读配置，同步 localStorage 与桌面 preferences。 */
export async function saveWorkspaceAgentReadAccess(
  config: WorkspaceAgentReadAccessConfig,
  workspaceType: BookType = 'short',
): Promise<WorkspaceAgentReadAccessConfig> {
  const normalized =
    workspaceType === 'long'
      ? normalizeLongWorkspaceAgentReadAccess(config)
      : workspaceType === 'script'
        ? normalizeScriptWorkspaceAgentReadAccess(config)
        : normalizeWorkspaceAgentReadAccess(config)
  setStoredWorkspaceAgentReadAccess(normalized, workspaceType)
  const api = await getBridgeApi()
  if (api?.set_workspace_agent_read_access) {
    await api.set_workspace_agent_read_access(
      normalized as unknown as Record<string, unknown>,
      workspaceType,
    )
  }
  return normalized
}

/** 将当前用户读取范围配置同步为内置默认 JSON 文件（仅源码运行模式可用）。 */
export async function syncWorkspaceAgentReadAccessDefaults(
  workspaceType: BookType = 'short',
): Promise<WorkspaceAgentReadAccessConfig> {
  const api = await getBridgeApi()
  if (api?.sync_workspace_agent_read_access_defaults) {
    const result = await api.sync_workspace_agent_read_access_defaults(workspaceType)
    return workspaceType === 'long'
      ? normalizeLongWorkspaceAgentReadAccess(result as WorkspaceAgentReadAccessConfig)
      : workspaceType === 'script'
        ? normalizeScriptWorkspaceAgentReadAccess(result as WorkspaceAgentReadAccessConfig)
        : normalizeWorkspaceAgentReadAccess(result as WorkspaceAgentReadAccessConfig)
  }
  throw new Error('桌面端 API 不可用：无法同步读取范围默认配置')
}

/** 从磁盘默认 JSON 文件读取读取范围默认配置（桌面端），否则返回内嵌默认值。 */
export async function getWorkspaceAgentReadAccessDefaults(
  workspaceType: BookType = 'short',
): Promise<WorkspaceAgentReadAccessConfig> {
  const api = await getBridgeApi()
  if (api?.get_default_workspace_agent_read_access) {
    try {
      const result = await api.get_default_workspace_agent_read_access(workspaceType)
      return workspaceType === 'long'
        ? normalizeLongWorkspaceAgentReadAccess(result as WorkspaceAgentReadAccessConfig)
        : workspaceType === 'script'
          ? normalizeScriptWorkspaceAgentReadAccess(result as WorkspaceAgentReadAccessConfig)
          : normalizeWorkspaceAgentReadAccess(result as WorkspaceAgentReadAccessConfig)
    } catch {
      /* fall through */
    }
  }
  if (workspaceType === 'long') return getDefaultLongWorkspaceAgentReadAccess()
  return workspaceType === 'script'
    ? getDefaultScriptWorkspaceAgentReadAccess()
    : getDefaultWorkspaceAgentReadAccess()
}
