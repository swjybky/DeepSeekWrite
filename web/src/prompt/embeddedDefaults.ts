/** 打包进前端的仓库默认模板副本（桌面端仍以 Python / 磁盘为准）；供 `npm run dev` 降级。 */

const RAW_SHORT = import.meta.glob('../../../app/prompt_defaults/short/*/*.txt', {
  eager: true,
  as: 'raw',
})

const RAW_MATERIAL = import.meta.glob('../../../app/prompt_defaults/material/*/*.txt', {
  eager: true,
  as: 'raw',
})

function normalizeGlobKey(importPath: string): string | null {
  const up = importPath.replace(/\\/g, '/')
  // short: prompt_defaults/short/shiqing/xxx.txt → shiqing/xxx
  const shortM = up.match(/prompt_defaults\/short\/(.+)\.txt$/i)
  if (shortM) return shortM[1]
  // material: prompt_defaults/material/short_shiqing/xxx.txt → material_short_shiqing/xxx
  const materialM = up.match(/prompt_defaults\/material\/(.+)\.txt$/i)
  if (materialM) return `material_${materialM[1]}`
  return null
}

const CACHE = new Map<string, string>()
for (const [k, v] of Object.entries({ ...RAW_SHORT, ...RAW_MATERIAL })) {
  const nk = normalizeGlobKey(k)
  if (!nk || typeof v !== 'string') continue
  CACHE.set(nk, v.endsWith('\n') ? v.slice(0, -1) : v)
}

/** `shiqing/intro_design` 或 `material_short_shiqing/character` 等 */
export function getEmbeddedPromptTemplate(workspace: string, stageId: string): string {
  const key = `${workspace}/${stageId}`
  return CACHE.get(key) ?? `[缺少内嵌模板] ${key}`
}
