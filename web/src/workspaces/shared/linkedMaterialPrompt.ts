import {
  MATERIAL_KIND_LABELS,
  materialMatchesKind,
  materialTypeLabel,
  type Material,
  type MaterialKind,
} from '../../bridge/libraryDomain'

const LINKED_MATERIAL_OVERVIEW_MAX_CHARS = 1200

function clipForPrompt(text: string, maxChars = LINKED_MATERIAL_OVERVIEW_MAX_CHARS): string {
  const body = text.trim()
  if (!body) return '（暂无概述）'
  return body.length <= maxChars ? body : `${body.slice(0, maxChars)}…`
}

export function appendReadableLinkedMaterialsToPrompt(
  prompt: string,
  linkedMaterialsByKind: Partial<Record<MaterialKind, Material[]>> | undefined,
  allowedMaterialKinds: readonly MaterialKind[] | undefined,
): string {
  const allowedKinds = [...new Set(allowedMaterialKinds ?? [])]
  if (!allowedKinds.length || !linkedMaterialsByKind) return prompt

  const sections: string[] = []
  for (const kind of allowedKinds) {
    const seen = new Set<string>()
    const materials = (linkedMaterialsByKind[kind] ?? []).filter((material) => {
      if (!material || seen.has(material.id) || !materialMatchesKind(material, kind)) {
        return false
      }
      seen.add(material.id)
      return true
    })
    if (!materials.length) continue

    sections.push(`【${MATERIAL_KIND_LABELS[kind]}】`)
    for (const material of materials) {
      const meta = [
        materialTypeLabel(material.material_type),
        MATERIAL_KIND_LABELS[material.material_kind],
        material.parent_genre,
      ].filter(Boolean).join(' / ')
      sections.push(
        [
          `- 《${material.title || '未命名素材库'}》 material_id=${material.id}`,
          meta ? `  类型：${meta}` : '',
          `  概述：${clipForPrompt(material.overview ?? '')}`,
        ].filter(Boolean).join('\n'),
      )
    }
  }

  if (!sections.length) return prompt
  return `${prompt.trimEnd()}

---

当前智能体可读取的关联素材库：
以下列表只包含当前读取范围允许访问的素材部门。需要检索或读取具体素材条目时，调用 query_linked_material_entries；不要臆造未读取的条目正文。

${sections.join('\n')}`
}
