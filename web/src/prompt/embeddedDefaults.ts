/** 打包进前端的仓库默认模板副本（桌面端仍以 Python / 磁盘为准）；供 `npm run dev` 降级。 */

const RAW_SHORT = import.meta.glob('../../../app/prompt_defaults/short/shared/*.txt', {
  eager: true,
  query: '?raw',
  import: 'default',
})

const RAW_SCRIPT = import.meta.glob('../../../app/prompt_defaults/script/shared/*.txt', {
  eager: true,
  query: '?raw',
  import: 'default',
})

const RAW_MATERIAL_TYPED = import.meta.glob('../../../app/prompt_defaults/material/*/shared/*.txt', {
  eager: true,
  query: '?raw',
  import: 'default',
})

const RAW_MATERIAL_LEGACY = import.meta.glob('../../../app/prompt_defaults/material/*/*.txt', {
  eager: true,
  query: '?raw',
  import: 'default',
})

const RAW_SKILL_TYPED = import.meta.glob('../../../app/prompt_defaults/skill/*/shared/*.txt', {
  eager: true,
  query: '?raw',
  import: 'default',
})

const RAW_SKILL_LEGACY = import.meta.glob('../../../app/prompt_defaults/skill/*/*.txt', {
  eager: true,
  query: '?raw',
  import: 'default',
})

const RAW_LEARNING_IMITATION = import.meta.glob(
  '../../../app/prompt_defaults/learning_imitation/shared/*.txt',
  {
    eager: true,
    query: '?raw',
    import: 'default',
  },
)

function normalizeGlobKey(importPath: string): string | null {
  const up = importPath.replace(/\\/g, '/')
  // short: prompt_defaults/short/shared/xxx.txt → shared/xxx
  const shortM = up.match(/prompt_defaults\/short\/(.+)\.txt$/i)
  if (shortM) return shortM[1]
  // script: prompt_defaults/script/shared/xxx.txt → script_shared/xxx
  const scriptM = up.match(/prompt_defaults\/script\/shared\/(.+)\.txt$/i)
  if (scriptM) return `script_shared/${scriptM[1]}`
  // typed material: prompt_defaults/material/script/shared/material_manager.txt → material_script/material_manager
  const typedMaterialM = up.match(
    /prompt_defaults\/material\/([^/]+)\/shared\/material_manager\.txt$/i,
  )
  if (typedMaterialM) return `material_${typedMaterialM[1]}/material_manager`
  // material: prompt_defaults/material/shared/material_manager.txt → material_manager/material_manager
  const materialManagerM = up.match(
    /prompt_defaults\/material\/shared\/material_manager\.txt$/i,
  )
  if (materialManagerM) return 'material_manager/material_manager'
  // typed skill: prompt_defaults/skill/script/shared/skill_manager.txt → skill_script/skill_manager
  const typedSkillM = up.match(
    /prompt_defaults\/skill\/([^/]+)\/shared\/skill_manager\.txt$/i,
  )
  if (typedSkillM) return `skill_${typedSkillM[1]}/skill_manager`
  const skillManagerM = up.match(
    /prompt_defaults\/skill\/shared\/skill_manager\.txt$/i,
  )
  if (skillManagerM) return 'skill_manager/skill_manager'
  const learningImitationM = up.match(
    /prompt_defaults\/learning_imitation\/shared\/(.+)\.txt$/i,
  )
  if (learningImitationM) return `learning_imitation/${learningImitationM[1]}`
  // material: prompt_defaults/material/short_shiqing/xxx.txt → material_short_shiqing/xxx
  const materialM = up.match(/prompt_defaults\/material\/(.+)\.txt$/i)
  if (materialM) return `material_${materialM[1]}`
  return null
}

const CACHE = new Map<string, string>()
for (const [k, v] of Object.entries({
  ...RAW_SHORT,
  ...RAW_SCRIPT,
  ...RAW_MATERIAL_LEGACY,
  ...RAW_MATERIAL_TYPED,
  ...RAW_SKILL_LEGACY,
  ...RAW_SKILL_TYPED,
  ...RAW_LEARNING_IMITATION,
})) {
  const nk = normalizeGlobKey(k)
  if (!nk || typeof v !== 'string') continue
  CACHE.set(nk, v.endsWith('\n') ? v.slice(0, -1) : v)
}

/** `shared/intro_design` 或 `material_short_shiqing/character` 等 */
export function getEmbeddedPromptTemplate(workspace: string, stageId: string): string {
  const key = `${workspace}/${stageId}`
  return CACHE.get(key) ?? `[缺少内嵌模板] ${key}`
}
