const RAIL_WIDTH_KEY = 'deepseekwrite:workspace-rail-width'
const RAIL_MIN = 168
const RAIL_DEFAULT = 216
const RAIL_HARD_MAX = 420
const RAIL_VIEWPORT_MAX_RATIO = 0.42

function maxRailWidthForViewport(viewportWidth: number): number {
  const proportionalCap = Math.floor(viewportWidth * RAIL_VIEWPORT_MAX_RATIO)
  return Math.max(RAIL_MIN, Math.min(RAIL_HARD_MAX, proportionalCap))
}

export function clampWorkspaceRailWidth(
  width: number,
  viewportWidth: number,
): number {
  const cap = maxRailWidthForViewport(viewportWidth)
  return Math.min(cap, Math.max(RAIL_MIN, width))
}

export function readStoredWorkspaceRailWidth(): number {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  try {
    const raw = localStorage.getItem(RAIL_WIDTH_KEY)
    const n = raw ? Number.parseInt(raw, 10) : NaN
    if (!Number.isFinite(n)) return clampWorkspaceRailWidth(RAIL_DEFAULT, vw)
    return clampWorkspaceRailWidth(n, vw)
  } catch {
    return clampWorkspaceRailWidth(RAIL_DEFAULT, vw)
  }
}

export function persistWorkspaceRailWidth(width: number): void {
  try {
    localStorage.setItem(RAIL_WIDTH_KEY, String(width))
  } catch {
    /* ignore */
  }
}
