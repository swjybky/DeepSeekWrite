const AI_PANEL_WIDTH_KEY = 'deepseekwrite:workspace-ai-width'
const AI_PANEL_MIN = 240
/** 超宽屏下的绝对上限，避免 AI 栏占满整屏 */
const AI_PANEL_HARD_MAX = 1000
const WORKSPACE_SPLITTER_W = 6
const WORKSPACE_DEFAULT_SPLITTER_COUNT = 1
/** 三栏份额：左 : 中 : 右（AI）= 18 : 36 : 36，可分配宽 = 视口宽 - 分割条 */
const WORKSPACE_COL_L = 18
const WORKSPACE_COL_R = 36
const WORKSPACE_COL_SUM = 18 + 36 + 36
/** 为中间编辑区保留的近似最小宽度（用于计算 AI 栏在当前窗口下最大能拉多宽） */
const EDITOR_MIN_FOR_LAYOUT = 160

function usableWidthLessSplitter(viewportWidth: number): number {
  return Math.max(0, viewportWidth - WORKSPACE_SPLITTER_W)
}

function approxRailWidthPx(viewportWidth: number): number {
  return Math.round(
    (usableWidthLessSplitter(viewportWidth) * WORKSPACE_COL_L) /
      WORKSPACE_COL_SUM,
  )
}

function defaultAiPanelWidthPx(viewportWidth: number): number {
  return Math.round(
    (usableWidthLessSplitter(viewportWidth) * WORKSPACE_COL_R) /
      WORKSPACE_COL_SUM,
  )
}

function maxAiWidthForViewport(
  viewportWidth: number,
  railWidth = approxRailWidthPx(viewportWidth),
  splitterCount = WORKSPACE_DEFAULT_SPLITTER_COUNT,
): number {
  const splitters = WORKSPACE_SPLITTER_W * Math.max(0, splitterCount)
  const raw =
    viewportWidth - railWidth - splitters - EDITOR_MIN_FOR_LAYOUT
  return Math.min(
    AI_PANEL_HARD_MAX,
    Math.max(AI_PANEL_MIN, Math.floor(raw)),
  )
}

export function clampAiPanelWidth(
  width: number,
  viewportWidth: number,
  railWidth?: number,
  splitterCount = WORKSPACE_DEFAULT_SPLITTER_COUNT,
): number {
  const cap = maxAiWidthForViewport(viewportWidth, railWidth, splitterCount)
  return Math.min(cap, Math.max(AI_PANEL_MIN, width))
}

export function readStoredAiWidth(
  railWidth?: number,
  splitterCount = WORKSPACE_DEFAULT_SPLITTER_COUNT,
): number {
  const vw =
    typeof window !== 'undefined' ? window.innerWidth : 1280
  try {
    const raw = localStorage.getItem(AI_PANEL_WIDTH_KEY)
    const n = raw ? Number.parseInt(raw, 10) : NaN
    if (!Number.isFinite(n))
      return clampAiPanelWidth(defaultAiPanelWidthPx(vw), vw, railWidth, splitterCount)
    return clampAiPanelWidth(n, vw, railWidth, splitterCount)
  } catch {
    return clampAiPanelWidth(defaultAiPanelWidthPx(vw), vw, railWidth, splitterCount)
  }
}

export function persistAiPanelWidth(width: number): void {
  try {
    localStorage.setItem(AI_PANEL_WIDTH_KEY, String(width))
  } catch {
    /* ignore */
  }
}
