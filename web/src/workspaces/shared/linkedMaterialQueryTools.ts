import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import {
  MATERIAL_KIND_LABELS,
  MATERIAL_KIND_STAGE_IDS,
  MATERIAL_STAGE_LABELS,
  MATERIAL_STAGE_KIND,
  materialMatchesKind,
  materialTypeLabel,
  normalizeMaterialStageItems,
  type Material,
  type MaterialKind,
  type MaterialStageEntry,
  type MaterialStageId,
} from '../../bridge'
import {
  countNonWhitespaceChars,
  defineTool,
  excerptFn as excerpt,
  textBlock,
} from './piToolkit'

export type LinkedMaterialQueryContext = {
  linkedMaterial?: Material | null
  linkedMaterialsByKind?: Partial<Record<MaterialKind, Material[]>>
}

type LinkedMaterialEntryRow = {
  mountKind: MaterialKind
  material: Material
  stageId: MaterialStageId
  entry: MaterialStageEntry
}

const MAX_QUERY_CHARS = 600
const DEFAULT_MAX_RESULTS = 8
const MAX_RESULTS = 30

function uniqueMaterialKinds(kinds: readonly MaterialKind[]): MaterialKind[] {
  return [...new Set(kinds)]
}

function materialKindSchema(allowedKinds: readonly MaterialKind[]) {
  const literals = allowedKinds.map((kind) => Type.Literal(kind))
  const description = allowedKinds
    .map((kind) => `${MATERIAL_KIND_LABELS[kind]}(${kind})`)
    .join('、')
  if (literals.length === 1) {
    return { schema: literals[0]!, description }
  }
  return {
    schema: Type.Union(literals, {
      description: `可查询的素材部门：${description}`,
    }),
    description,
  }
}

function materialStageIdSchema(allowedKinds: readonly MaterialKind[]) {
  const allowedStages = uniqueMaterialKinds(allowedKinds).flatMap(
    (kind) => MATERIAL_KIND_STAGE_IDS[kind],
  )
  const uniqueStages = [...new Set(allowedStages)]
  const literals = uniqueStages.map((stageId) => Type.Literal(stageId))
  const description = uniqueStages
    .map((stageId) => `${MATERIAL_STAGE_LABELS[stageId]}(${stageId})`)
    .join('、')
  if (literals.length === 0) {
    return Type.String({ description: '当前没有可查询素材栏目' })
  }
  if (literals.length === 1) return literals[0]!
  return Type.Union(literals, {
    description: `可选素材栏目：${description}`,
  })
}

function linkedMaterialsForKind(
  ctx: LinkedMaterialQueryContext,
  kind: MaterialKind,
): Material[] {
  const out: Material[] = []
  const seen = new Set<string>()
  for (const material of ctx.linkedMaterialsByKind?.[kind] ?? []) {
    if (!material || seen.has(material.id) || !materialMatchesKind(material, kind)) continue
    seen.add(material.id)
    out.push(material)
  }
  const legacy = ctx.linkedMaterial
  if (legacy && !seen.has(legacy.id) && materialMatchesKind(legacy, kind)) {
    out.push(legacy)
  }
  return out
}

function linkedMaterialRows(
  ctx: LinkedMaterialQueryContext,
  allowedKinds: readonly MaterialKind[],
): LinkedMaterialEntryRow[] {
  const rows: LinkedMaterialEntryRow[] = []
  const seen = new Set<string>()
  for (const kind of uniqueMaterialKinds(allowedKinds)) {
    const stageIds = MATERIAL_KIND_STAGE_IDS[kind]
    for (const material of linkedMaterialsForKind(ctx, kind)) {
      const stageItems = normalizeMaterialStageItems(material.stage_items ?? null, material.stages)
      for (const stageId of stageIds) {
        for (const entry of stageItems[stageId] ?? []) {
          const key = `${kind}:${material.id}:${stageId}:${entry.id}`
          if (seen.has(key)) continue
          seen.add(key)
          rows.push({ mountKind: kind, material, stageId, entry })
        }
      }
    }
  }
  return rows
}

function entryTitle(row: LinkedMaterialEntryRow): string {
  return row.entry.title?.trim() || `未命名${MATERIAL_STAGE_LABELS[row.stageId]}`
}

function materialGenreLine(material: Material): string {
  return [
    materialTypeLabel(material.material_type),
    MATERIAL_KIND_LABELS[material.material_kind],
    material.parent_genre,
  ].filter(Boolean).join(' / ')
}

function tokensForSearch(query: string): string[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return []
  const parts = normalized.split(/[\s,，。；;、]+/).filter(Boolean)
  return parts.length > 0 ? parts : [normalized]
}

function countTokenHits(text: string, token: string): number {
  if (!token) return 0
  let hits = 0
  let index = text.indexOf(token)
  while (index >= 0) {
    hits += 1
    index = text.indexOf(token, index + token.length)
  }
  return hits
}

function scoreRow(row: LinkedMaterialEntryRow, tokens: readonly string[]): number {
  const title = entryTitle(row).toLowerCase()
  const materialTitle = row.material.title.toLowerCase()
  const body = (row.entry.body ?? '').toLowerCase()
  const overview = (row.material.overview ?? '').toLowerCase()
  return tokens.reduce((score, token) => {
    return score
      + countTokenHits(title, token) * 8
      + countTokenHits(materialTitle, token) * 5
      + countTokenHits(overview, token) * 2
      + countTokenHits(body, token)
  }, 0)
}

function snippetForQuery(text: string, query: string): string {
  const body = text.trim()
  if (!body) return '（该素材条目暂无正文）'
  const lower = body.toLowerCase()
  const needle = query.trim().toLowerCase()
  const index = needle ? lower.indexOf(needle) : -1
  if (index < 0) return excerpt(body, 360)
  const start = Math.max(0, index - 140)
  const end = Math.min(body.length, index + needle.length + 220)
  return `${start > 0 ? '…' : ''}${body.slice(start, end)}${end < body.length ? '…' : ''}`
}

function normalizedEntryName(raw: string): string {
  return raw.trim().toLowerCase()
}

function findRowsByEntryName(
  rows: readonly LinkedMaterialEntryRow[],
  entryName: string,
): LinkedMaterialEntryRow[] {
  const target = normalizedEntryName(entryName)
  if (!target) return []
  const exact = rows.filter((row) => normalizedEntryName(entryTitle(row)) === target)
  if (exact.length > 0) return exact
  return rows.filter((row) => {
    const title = normalizedEntryName(entryTitle(row))
    return title.includes(target) || target.includes(title)
  })
}

function rankRowsByQuery(
  rows: readonly LinkedMaterialEntryRow[],
  query: string,
  maxResults: number,
): LinkedMaterialEntryRow[] {
  const tokens = tokensForSearch(query)
  return rows
    .map((row) => ({ row, score: scoreRow(row, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((item) => item.row)
}

function formatEntryListRow(row: LinkedMaterialEntryRow): string {
  const body = row.entry.body ?? ''
  const genre = materialGenreLine(row.material)
  return [
    `- 素材库：《${row.material.title}》`,
    genre ? `  类型：${genre}` : '',
    `  部门：${MATERIAL_KIND_LABELS[row.mountKind]}(${row.mountKind})`,
    `  栏目：${MATERIAL_STAGE_LABELS[row.stageId]}(${row.stageId})`,
    `  条目：${entryTitle(row)}`,
    `  字数：${countNonWhitespaceChars(body).toLocaleString('zh-CN')}`,
  ].filter(Boolean).join('\n')
}

function formatEntryList(rows: readonly LinkedMaterialEntryRow[]): string {
  return [
    '读取全文时使用 mode=read + entry_name=条目名称；同名时可补充 material_kind 或 stage_id 缩小范围。',
    '',
    rows.map((row) => formatEntryListRow(row)).join('\n'),
  ].join('\n')
}

function formatSearchRow(row: LinkedMaterialEntryRow, query: string): string {
  const body = row.entry.body ?? ''
  const genre = materialGenreLine(row.material)
  return [
    `素材库：《${row.material.title}》`,
    genre ? `类型：${genre}` : '',
    `部门：${MATERIAL_KIND_LABELS[row.mountKind]}(${row.mountKind})`,
    `栏目：${MATERIAL_STAGE_LABELS[row.stageId]}(${row.stageId})`,
    `条目：${entryTitle(row)}`,
    `字数：${countNonWhitespaceChars(body).toLocaleString('zh-CN')}`,
    '',
    snippetForQuery(body, query),
  ].filter(Boolean).join('\n')
}

function formatFullRow(row: LinkedMaterialEntryRow): string {
  const body = row.entry.body?.trim() ?? ''
  const genre = materialGenreLine(row.material)
  return [
    `素材库：《${row.material.title}》`,
    genre ? `类型：${genre}` : '',
    `部门：${MATERIAL_KIND_LABELS[row.mountKind]}(${row.mountKind})`,
    `栏目：${MATERIAL_STAGE_LABELS[row.stageId]}(${row.stageId})`,
    `条目：${entryTitle(row)}`,
    `字数：${countNonWhitespaceChars(body).toLocaleString('zh-CN')}`,
    '',
    body || '（该素材条目暂无正文）',
  ].filter(Boolean).join('\n')
}

function clampMaxResults(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_MAX_RESULTS
  return Math.max(1, Math.min(MAX_RESULTS, Math.floor(n)))
}

function resolveReadableRows(
  ctx: LinkedMaterialQueryContext,
  allowedKinds: readonly MaterialKind[],
  input: {
    material_kind?: unknown
    material_id?: unknown
    stage_id?: unknown
  },
): LinkedMaterialEntryRow[] | string {
  const allowedSet = new Set(allowedKinds)
  const requestedKind = String(input.material_kind ?? '').trim() as MaterialKind
  if (requestedKind && !allowedSet.has(requestedKind)) {
    return `当前智能体不可读取${MATERIAL_KIND_LABELS[requestedKind] ?? requestedKind}。`
  }
  const requestedStageId = String(input.stage_id ?? '').trim() as MaterialStageId
  if (requestedStageId) {
    const stageKind = MATERIAL_STAGE_KIND[requestedStageId]
    if (!stageKind || !allowedSet.has(stageKind)) {
      return `当前智能体不可读取${MATERIAL_STAGE_LABELS[requestedStageId] ?? requestedStageId}。`
    }
    if (requestedKind && stageKind !== requestedKind) {
      return `${MATERIAL_STAGE_LABELS[requestedStageId]}不属于${MATERIAL_KIND_LABELS[requestedKind]}。`
    }
  }

  const materialId = String(input.material_id ?? '').trim()
  return linkedMaterialRows(
    ctx,
    requestedKind ? [requestedKind] : allowedKinds,
  ).filter((row) => {
    if (materialId && row.material.id !== materialId) return false
    if (requestedStageId && row.stageId !== requestedStageId) return false
    return true
  })
}

export function buildQueryLinkedMaterialEntriesTool(
  ctx: LinkedMaterialQueryContext,
  allowedMaterialKinds: readonly MaterialKind[],
): AgentTool {
  const allowedKinds = uniqueMaterialKinds(allowedMaterialKinds)
  const { schema: kindSchema, description } = materialKindSchema(allowedKinds)

  return defineTool({
    name: 'query_linked_material_entries',
    label: '查询关联素材条目',
    description:
      `在当前书籍已关联且当前智能体可读的素材库中查询条目。当前可读部门：${description}。`
      + '\nmode=list 列出可读条目；mode=search 用 query 搜索条目；mode=read 优先用 entry_name 读取完整条目正文。'
      + '\n无需传内部 ID；同名条目无法区分时，补充 material_kind 或 stage_id 缩小范围。',
    parameters: Type.Object({
      mode: Type.Union([Type.Literal('list'), Type.Literal('search'), Type.Literal('read')], {
        description: 'list=列出可读素材条目；search=搜索相关素材条目；read=读取指定素材条目全文。',
      }),
      material_kind: Type.Optional(kindSchema),
      material_id: Type.Optional(Type.String({
        description: '可选：限定某个素材库；通常不需要填写。',
      })),
      stage_id: Type.Optional(materialStageIdSchema(allowedKinds)),
      query: Type.Optional(Type.String({
        maxLength: MAX_QUERY_CHARS,
        description: 'search 模式必填：关键词、短句或原文片段。',
      })),
      entry_name: Type.Optional(Type.String({
        maxLength: MAX_QUERY_CHARS,
        description: 'read 模式推荐填写：素材条目名称或人物名；工具会按标题匹配，匹配不到则返回候选。',
      })),
      max_results: Type.Optional(Type.Integer({
        minimum: 1,
        maximum: MAX_RESULTS,
        description: `list/search 模式最多返回条数，默认 ${DEFAULT_MAX_RESULTS}，最高 ${MAX_RESULTS}。`,
      })),
    }),
    execute: async (_toolCallId, params) => {
      const mode = params.mode as 'list' | 'search' | 'read'
      const resolved = resolveReadableRows(ctx, allowedKinds, params)
      if (typeof resolved === 'string') return textBlock(resolved)
      if (!resolved.length) {
        return textBlock('当前可读范围内暂无已关联素材条目。')
      }

      const maxResults = clampMaxResults(params.max_results)
      const entryName = String(params.entry_name ?? '').trim()

      if (mode === 'read') {
        const legacyParams = params as Record<string, unknown>
        const entryId = String(legacyParams.entry_id ?? '').trim()
        if (entryId) {
          const matches = resolved.filter((row) => row.entry.id === entryId)
          if (matches.length > 0) {
            if (matches.length > 1 && !params.material_id) {
              return textBlock(
                [
                  '旧版内部 ID 匹配到多个素材条目，请改用 entry_name，并补充 material_kind 或 stage_id 缩小范围：',
                  formatEntryList(matches.slice(0, maxResults)),
                ].join('\n'),
              )
            }
            return textBlock(formatFullRow(matches[0]!))
          }
          if (!entryName) {
            const related = rankRowsByQuery(resolved, entryId, maxResults)
            return textBlock(
              [
                '未在当前可读关联素材中找到这个内部条目 ID。',
                related.length
                  ? `\n可能相关的可读条目：\n${formatEntryList(related)}`
                  : '\n请优先用 mode=read + entry_name=条目名称 读取，或先用 mode=list / mode=search 查询条目名称。',
              ].join('\n'),
            )
          }
        }

        if (!entryName) {
          return textBlock('read 模式请提供 entry_name。无需传内部 ID；如果不知道条目名称，请先用 mode=list 或 mode=search。')
        }

        const nameMatches = findRowsByEntryName(resolved, entryName)
        if (nameMatches.length === 1) {
          return textBlock(formatFullRow(nameMatches[0]!))
        }
        if (nameMatches.length > 1) {
          return textBlock(
            [
              `entry_name=${entryName} 匹配到多个同名素材条目，请补充 material_kind 或 stage_id 缩小范围，或换成更完整的条目名称：`,
              formatEntryList(nameMatches.slice(0, maxResults)),
            ].join('\n'),
          )
        }

        const related = rankRowsByQuery(resolved, entryName, maxResults)
        if (related.length === 1) {
          return textBlock(formatFullRow(related[0]!))
        }
        return textBlock(
          related.length
            ? [
                `未找到标题匹配 entry_name=${entryName} 的素材条目。以下是相关候选，请用目标条目的名称作为 entry_name 后用 mode=read 读取全文：`,
                formatEntryList(related),
              ].join('\n')
            : `未找到 entry_name=${entryName} 的素材条目。请先用 mode=list 查看当前可读条目，或用 mode=search 换关键词检索。`,
        )
      }

      if (mode === 'list') {
        const rows = entryName
          ? findRowsByEntryName(resolved, entryName)
          : resolved.slice(0, maxResults)
        if (rows.length > 0) {
          return textBlock(formatEntryList(rows.slice(0, maxResults)))
        }
        const related = rankRowsByQuery(resolved, entryName, maxResults)
        return textBlock(
          related.length
            ? [
                `未找到标题匹配 entry_name=${entryName} 的素材条目。以下是相关候选：`,
                formatEntryList(related),
              ].join('\n')
            : `未找到 entry_name=${entryName} 的素材条目。`,
        )
      }

      const query = String(params.query ?? entryName).trim()
      if (!query) return textBlock('search 模式需要提供 query。')
      if (query.length > MAX_QUERY_CHARS) {
        return textBlock(`query 过长，最多 ${MAX_QUERY_CHARS} 个字符。`)
      }
      const rows = rankRowsByQuery(resolved, query, maxResults)

      if (!rows.length) {
        return textBlock(
          [
            `未在当前可读关联素材中检索到「${query}」。`,
            '如果你只知道概述里的条目名称，可尝试 mode=read 并填写 entry_name；如果不知道条目名称，请先用 mode=list 查看当前可读条目。',
          ].join('\n'),
        )
      }
      return textBlock(rows.map((row) => formatSearchRow(row, query)).join('\n\n---\n\n'))
    },
  })
}
