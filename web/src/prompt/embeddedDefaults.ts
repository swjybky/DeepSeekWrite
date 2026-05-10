/** 打包进前端的仓库默认模板副本（桌面端仍以 Python / 磁盘为准）；供 `npm run dev` 降级。 */

const RAW = import.meta.glob('../../../app/prompt_defaults/short/*/*.txt', {
  eager: true,
  as: 'raw',
})

function normalizeGlobKey(importPath: string): string | null {
  const up = importPath.replace(/\\/g, '/')
  const m = up.match(/prompt_defaults\/short\/(.+)\.txt$/i)
  if (!m) return null
  return m[1]
}

const CACHE = new Map<string, string>()
for (const [k, v] of Object.entries(RAW)) {
  const nk = normalizeGlobKey(k)
  if (!nk || typeof v !== 'string') continue
  CACHE.set(nk, v.endsWith('\n') ? v.slice(0, -1) : v)
}

/** `shiqing/intro_design` 等 */
export function getEmbeddedPromptTemplate(workspace: string, stageId: string): string {
  const key = `${workspace}/${stageId}`
  return CACHE.get(key) ?? `[缺少内嵌模板] ${key}`
}
