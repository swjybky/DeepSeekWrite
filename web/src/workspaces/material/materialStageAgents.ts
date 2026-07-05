import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import {
  MATERIAL_KIND_LABELS,
  MATERIAL_KIND_STAGE_IDS,
  MATERIAL_STAGE_KEYS,
  MATERIAL_STAGE_LABELS,
  type MaterialKindWithMixed,
  type MaterialPromptKind,
  type MaterialStageEntry,
  type MaterialStageId,
} from '../../bridge'
import {
  countNonWhitespaceChars,
  defineTool,
  excerptFn as excerpt,
  textBlock,
} from '../shared/piToolkit'
import {
  applyTextSpanReplacement,
  findFlexibleOccurrences,
  normalizeNewlines,
  resolveReplacementSpan,
  suggestClosestFragment,
  type TextSpan,
} from '../shared/textReplaceMatch'

export type ApplyToStageEditorPayload = {
  text: string
  mode: 'replace' | 'append' | 'append_token' | 'streaming_end'
}

export type CreateMaterialEntryInput = {
  stageId: MaterialStageId
  title: string
  body: string
}

export type EditMaterialEntryInput = {
  stageId: MaterialStageId
  entryId: string
  title?: string
  body?: string
}

export type MaterialWorkspaceStageAgentContext = {
  materialTitle: string
  materialKind?: MaterialKindWithMixed
  promptKind: MaterialPromptKind
  stageId: MaterialStageId
  stageBody: string
  allStages: Partial<Record<MaterialStageId, string>>
  overview?: string
  currentEntryTitle?: string
  stageItems?: Partial<Record<MaterialStageId, MaterialStageEntry[]>>
  getMaterialStageItems?: () => Partial<Record<MaterialStageId, MaterialStageEntry[]>>
  getMaterialOverview?: () => string
  selectMaterialEntry?: (stageId: MaterialStageId, entryId: string) => void
  createMaterialEntry?: (input: CreateMaterialEntryInput) => MaterialStageEntry | null
  editMaterialEntry?: (input: EditMaterialEntryInput) => boolean
  writeMaterialOverview?: (text: string) => void
  applyToStageEditor?: (payload: ApplyToStageEditorPayload) => void
  onRequestSave?: () => void | Promise<void>
  isToolCallStreamed?: (toolCallId: string) => boolean
}

type MaterialEntryRow = {
  stageId: MaterialStageId
  stageLabel: string
  entry: MaterialStageEntry
}

const MAX_MATERIAL_SEARCH_QUERY_CHARS = 600
const MIN_MATERIAL_SEARCH_CONTEXT_CHARS = 10
const DEFAULT_MATERIAL_SEARCH_CONTEXT_CHARS = 80
const MAX_MATERIAL_SEARCH_CONTEXT_CHARS = 500
const DEFAULT_MATERIAL_SEARCH_MATCHES = 10
const MAX_MATERIAL_SEARCH_MATCHES = 200
const MAX_MATERIAL_ENTRY_REPLACE_CHARS = 2400

const materialStageIdSchema = () =>
  Type.Union(
    MATERIAL_STAGE_KEYS.map((stageId) => Type.Literal(stageId)),
    {
      description:
        '素材阶段：gimmick=梗，character=人设，pacing=剧情设计，intro=导语设计，plot_refine=剧情细化，draft_excerpt=优秀正文片段，other=其他素材。',
    },
  )

function activeMaterialKind(ctx: MaterialWorkspaceStageAgentContext): MaterialKindWithMixed {
  const kind = ctx.materialKind ?? 'mixed'
  return kind in MATERIAL_KIND_STAGE_IDS ? kind : 'mixed'
}

function allowedStageIds(ctx: MaterialWorkspaceStageAgentContext): MaterialStageId[] {
  return [...(MATERIAL_KIND_STAGE_IDS[activeMaterialKind(ctx)] ?? MATERIAL_STAGE_KEYS)]
}

function liveStageItems(
  ctx: MaterialWorkspaceStageAgentContext,
): Partial<Record<MaterialStageId, MaterialStageEntry[]>> {
  return ctx.getMaterialStageItems?.() ?? ctx.stageItems ?? {}
}

function materialRows(ctx: MaterialWorkspaceStageAgentContext): MaterialEntryRow[] {
  const items = liveStageItems(ctx)
  return allowedStageIds(ctx).flatMap((stageId) =>
    (items[stageId] ?? []).map((entry) => ({
      stageId,
      stageLabel: MATERIAL_STAGE_LABELS[stageId],
      entry,
    })),
  )
}

function normalizeEntryName(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function entryTitle(entry: MaterialStageEntry, stageId: MaterialStageId): string {
  return entry.title?.trim() || `未命名${MATERIAL_STAGE_LABELS[stageId]}`
}

function formatEntryChoice(row: MaterialEntryRow): string {
  return `- ${entryTitle(row.entry, row.stageId)}｜${row.stageLabel}（${row.stageId}）｜entry_id=${row.entry.id}`
}

function resolveEntry(
  ctx: MaterialWorkspaceStageAgentContext,
  input: {
    entry_id?: unknown
    name?: unknown
    stage_id?: unknown
  },
): { row: MaterialEntryRow } | { error: string } {
  const rows = materialRows(ctx)
  const stageId = String(input.stage_id ?? '').trim() as MaterialStageId
  const scoped = stageId
    ? rows.filter((row) => row.stageId === stageId)
    : rows

  const entryId = String(input.entry_id ?? '').trim()
  if (entryId) {
    const matches = scoped.filter((row) => row.entry.id === entryId)
    if (matches.length === 1) return { row: matches[0]! }
    if (matches.length > 1) {
      return { error: `entry_id=${entryId} 匹配到多个条目，请补充 stage_id。` }
    }
    return { error: `未找到 entry_id=${entryId} 的素材条目。` }
  }

  const name = normalizeEntryName(String(input.name ?? ''))
  if (!name) return { error: '请提供 name 或 entry_id。' }
  const matches = scoped.filter((row) => normalizeEntryName(entryTitle(row.entry, row.stageId)) === name)
  if (matches.length === 1) return { row: matches[0]! }
  if (matches.length > 1) {
    return {
      error: [
        `找到 ${matches.length} 个同名素材条目「${name}」，请补充 stage_id 或 entry_id 后重试：`,
        ...matches.map(formatEntryChoice),
      ].join('\n'),
    }
  }

  const fuzzy = scoped.filter((row) => entryTitle(row.entry, row.stageId).includes(name))
  if (fuzzy.length > 0) {
    return {
      error: [
        `未找到标题完全等于「${name}」的素材条目。相近条目：`,
        ...fuzzy.slice(0, 10).map(formatEntryChoice),
      ].join('\n'),
    }
  }
  return { error: `未找到名为「${name}」的素材条目。可先调用 list_material_entries 查看名称。` }
}

function formatEntryBlock(
  ctx: MaterialWorkspaceStageAgentContext,
  row: MaterialEntryRow,
): string {
  const body = row.entry.body?.trim() ?? ''
  const title = entryTitle(row.entry, row.stageId)
  const count = countNonWhitespaceChars(body)
  return [
    `素材库：《${ctx.materialTitle}》`,
    `条目：${title}`,
    `栏目：${row.stageLabel}（${row.stageId}）`,
    `entry_id：${row.entry.id}`,
    `当前字数：${count.toLocaleString('zh-CN')} 字`,
    '',
    body ? excerpt(body) : '该条目暂无正文。',
  ].join('\n')
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function findLiteralOccurrences(haystack: string, needle: string): TextSpan[] {
  if (!needle) return []
  const results: TextSpan[] = []
  let pos = 0
  while (pos <= haystack.length) {
    const found = haystack.indexOf(needle, pos)
    if (found === -1) break
    results.push({
      start: found,
      end: found + needle.length,
      matched: haystack.slice(found, found + needle.length),
    })
    pos = found + needle.length
  }
  return results
}

function lineColumnAt(text: string, index: number): { line: number; column: number } {
  let line = 1
  let lastBreak = -1
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1
      lastBreak = i
    }
  }
  return { line, column: index - lastBreak }
}

function snippetAroundMatch(
  text: string,
  span: TextSpan,
  contextChars: number,
): string {
  const start = Math.max(0, span.start - contextChars)
  const end = Math.min(text.length, span.end + contextChars)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < text.length ? '...' : ''
  return `${prefix}${text.slice(start, span.start)}${span.matched}${text.slice(span.end, end)}${suffix}`
}

type MaterialEntryReplacement = {
  original_text: string
  new_text: string
}

function replaceEntryText(input: {
  currentBody: string
  replacements: MaterialEntryReplacement[]
}): { next: string; count: number; flexibleCount: number } | { error: string } {
  if (input.replacements.length === 0) return { error: 'replacements 不能为空。' }

  let next = normalizeNewlines(input.currentBody)
  let flexibleCount = 0
  for (const [index, replacement] of input.replacements.entries()) {
    const itemName = `第 ${index + 1} 个片段`
    const originalText = normalizeNewlines(replacement.original_text)
    const newText = normalizeNewlines(replacement.new_text)
    if (!originalText.trim()) return { error: `${itemName}的 original_text 不能为空。` }
    if (originalText.length > MAX_MATERIAL_ENTRY_REPLACE_CHARS) {
      return { error: `${itemName}的 original_text 过长，请只传需要替换的小段原文。` }
    }
    if (newText.length > MAX_MATERIAL_ENTRY_REPLACE_CHARS) {
      return { error: `${itemName}的 new_text 过长，请拆成多个小段替换。` }
    }

    const resolved = resolveReplacementSpan(next, originalText, itemName)
    if (resolved.kind === 'error') return { error: resolved.message }
    if (resolved.usedFlexibleMatch) flexibleCount += 1
    next = applyTextSpanReplacement(next, resolved.span, newText)
  }
  return { next, count: input.replacements.length, flexibleCount }
}

async function requestSave(ctx: MaterialWorkspaceStageAgentContext): Promise<void> {
  if (!ctx.onRequestSave) return
  await new Promise((resolve) => window.setTimeout(resolve, 30))
  await ctx.onRequestSave()
}

export function buildListMaterialEntriesTool(
  ctx: MaterialWorkspaceStageAgentContext,
): AgentTool {
  return defineTool({
    name: 'list_material_entries',
    label: '列出素材条目',
    description:
      '列出当前打开素材库内的素材条目名称、栏目、entry_id 和字数。只覆盖当前素材库，不跨其它素材库。',
    parameters: Type.Object({
      stage_id: Type.Optional(materialStageIdSchema()),
    }),
    execute: async (_toolCallId, params) => {
      const requestedStageId = params.stage_id as MaterialStageId | undefined
      const rows = materialRows(ctx).filter((row) =>
        requestedStageId ? row.stageId === requestedStageId : true,
      )
      const kindLabel = MATERIAL_KIND_LABELS[activeMaterialKind(ctx)]
      const head = `素材库：《${ctx.materialTitle}》｜${kindLabel}｜共 ${rows.length} 条`
      if (!rows.length) return textBlock(`${head}\n\n暂无素材条目。`)
      const lines = rows.map((row, index) => {
        const body = row.entry.body ?? ''
        return [
          `${index + 1}. ${entryTitle(row.entry, row.stageId)}`,
          `栏目：${row.stageLabel}（${row.stageId}）`,
          `entry_id：${row.entry.id}`,
          `字数：${countNonWhitespaceChars(body).toLocaleString('zh-CN')}`,
        ].join('｜')
      })
      return textBlock([head, '', ...lines].join('\n'))
    },
  })
}

export function buildReadMaterialEntryTool(
  ctx: MaterialWorkspaceStageAgentContext,
): AgentTool {
  return defineTool({
    name: 'read_material_entry',
    label: '读取素材条目',
    description:
      '根据素材条目名称读取当前素材库内的条目正文。若重名，工具会要求补充 stage_id 或 entry_id。',
    parameters: Type.Object({
      name: Type.Optional(Type.String({ description: '素材条目名称，需与列表中的名称完全一致。' })),
      entry_id: Type.Optional(Type.String({ description: '素材条目 ID；重名时优先使用。' })),
      stage_id: Type.Optional(materialStageIdSchema()),
    }),
    execute: async (_toolCallId, params) => {
      const resolved = resolveEntry(ctx, params)
      if ('error' in resolved) return textBlock(resolved.error)
      return textBlock(formatEntryBlock(ctx, resolved.row))
    },
  })
}

export function buildSearchMaterialEntriesTool(
  ctx: MaterialWorkspaceStageAgentContext,
): AgentTool {
  return defineTool({
    name: 'search_material_entries',
    label: '搜索素材内容',
    description:
      '在当前素材库条目正文中搜索文本，只返回命中位置和少量上下文，不返回全部内容。不传 stage_id 时搜索当前素材库允许的全部栏目。',
    parameters: Type.Object({
      query: Type.String({
        maxLength: MAX_MATERIAL_SEARCH_QUERY_CHARS,
        description: '要搜索的原文片段或关键词。建议传 2-80 个连续字符。',
      }),
      stage_id: Type.Optional(materialStageIdSchema()),
      max_matches: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: MAX_MATERIAL_SEARCH_MATCHES,
          description: '最多返回多少处匹配，默认 10，最高 200。',
        }),
      ),
      context_chars: Type.Optional(
        Type.Integer({
          minimum: MIN_MATERIAL_SEARCH_CONTEXT_CHARS,
          maximum: MAX_MATERIAL_SEARCH_CONTEXT_CHARS,
          description: '每处匹配前后返回多少字符上下文，默认 80，最小 10，最高 500。',
        }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      const query = normalizeNewlines(params.query).trim()
      if (!query) return textBlock('搜索文本不能为空。')
      if (query.length > MAX_MATERIAL_SEARCH_QUERY_CHARS) {
        return textBlock(`搜索文本过长（${query.length} 字符），最多 ${MAX_MATERIAL_SEARCH_QUERY_CHARS} 字符。`)
      }
      const requestedStageId = params.stage_id as MaterialStageId | undefined
      const rows = materialRows(ctx).filter((row) =>
        requestedStageId ? row.stageId === requestedStageId : true,
      )
      if (!rows.length) return textBlock('当前搜索范围内暂无素材条目。')

      const maxMatches = clampInteger(
        params.max_matches,
        DEFAULT_MATERIAL_SEARCH_MATCHES,
        1,
        MAX_MATERIAL_SEARCH_MATCHES,
      )
      const contextChars = clampInteger(
        params.context_chars,
        DEFAULT_MATERIAL_SEARCH_CONTEXT_CHARS,
        MIN_MATERIAL_SEARCH_CONTEXT_CHARS,
        MAX_MATERIAL_SEARCH_CONTEXT_CHARS,
      )
      const output: string[] = [
        `素材库：《${ctx.materialTitle}》`,
        `搜索：${query}`,
      ]
      let total = 0
      const closestHints: string[] = []

      for (const row of rows) {
        const body = normalizeNewlines(row.entry.body ?? '')
        if (!body.trim()) continue

        let matchKind = '精确匹配'
        let matches = findLiteralOccurrences(body, query)
        if (matches.length === 0) {
          matches = findFlexibleOccurrences(body, query)
          if (matches.length > 0) matchKind = '引号/标点容错匹配'
        }
        if (matches.length === 0) {
          const hint = suggestClosestFragment(body, query, 220)
          if (hint) closestHints.push(`${entryTitle(row.entry, row.stageId)}：${hint}`)
          continue
        }

        output.push(
          '',
          `【${row.stageLabel}】${entryTitle(row.entry, row.stageId)}（entry_id=${row.entry.id}）${matchKind} ${matches.length} 处：`,
        )
        for (const [index, match] of matches.entries()) {
          if (total >= maxMatches) break
          const loc = lineColumnAt(body, match.start)
          output.push(
            `${index + 1}. L${loc.line}:C${loc.column} chars ${match.start}-${match.end}`,
            snippetAroundMatch(body, match, contextChars),
          )
          total += 1
        }
        if (total >= maxMatches) break
      }

      if (total > 0) {
        output.push('', `已返回 ${total} 处匹配。`)
        return textBlock(output.join('\n'))
      }
      const notFound = [`未在当前素材库条目中找到「${query}」。`]
      if (closestHints.length > 0) {
        notFound.push('接近片段：', ...closestHints.slice(0, 5))
      }
      return textBlock(notFound.join('\n'))
    },
  })
}

export function buildCreateMaterialEntryTool(
  ctx: MaterialWorkspaceStageAgentContext,
): AgentTool {
  return defineTool({
    name: 'create_material_entry',
    label: '创建素材条目',
    description:
      '在当前素材库指定栏目创建一个素材条目，创建后默认选中新条目并自动保存。只写当前素材库，不跨其它素材库。',
    parameters: Type.Object({
      stage_id: materialStageIdSchema(),
      title: Type.String({ description: '新素材条目名称。' }),
      body: Type.Optional(Type.String({ description: '新素材条目正文，可为空。' })),
    }),
    execute: async (_toolCallId, params) => {
      const stageId = params.stage_id as MaterialStageId
      if (!allowedStageIds(ctx).includes(stageId)) {
        return textBlock(`当前素材库不支持写入「${MATERIAL_STAGE_LABELS[stageId]}」。`)
      }
      const create = ctx.createMaterialEntry
      if (!create) return textBlock('（当前环境无法创建素材条目：未连接界面）')
      const title = String(params.title ?? '').trim()
      const body = String(params.body ?? '').trim()
      if (!title && !body) return textBlock('未创建：title 和 body 不能同时为空。')
      const entry = create({ stageId, title, body })
      if (!entry) return textBlock('创建素材条目失败。')
      ctx.selectMaterialEntry?.(stageId, entry.id)
      await requestSave(ctx)
      return textBlock(
        `已创建素材条目「${entryTitle(entry, stageId)}」｜${MATERIAL_STAGE_LABELS[stageId]}（entry_id=${entry.id}），并已自动保存。`,
      )
    },
  })
}

export function buildEditMaterialEntryTool(
  ctx: MaterialWorkspaceStageAgentContext,
): AgentTool {
  return defineTool({
    name: 'edit_material_entry',
    label: '修改素材条目',
    description:
      '修改当前素材库内的一个素材条目。局部修改用 replace_fragments；追加用 append；只有用户明确要求覆盖全文时，才用 replace 并设置 allow_overwrite_existing=true。',
    parameters: Type.Object({
      name: Type.Optional(Type.String({ description: '素材条目名称；重名时补充 stage_id 或 entry_id。' })),
      entry_id: Type.Optional(Type.String({ description: '素材条目 ID；重名时优先使用。' })),
      stage_id: Type.Optional(materialStageIdSchema()),
      title: Type.Optional(Type.String({ description: '可选：修改后的条目名称。' })),
      mode: Type.Union([Type.Literal('replace_fragments'), Type.Literal('append'), Type.Literal('replace')], {
        description: 'replace_fragments=局部替换；append=追加正文；replace=覆盖全文。',
      }),
      body: Type.Optional(Type.String({ description: 'append 或 replace 模式下写入的正文。' })),
      allow_overwrite_existing: Type.Optional(
        Type.Boolean({
          description: '仅 replace 非空条目正文时允许设为 true。用户未明确要求覆盖全文时不要设 true。',
        }),
      ),
      replacements: Type.Optional(
        Type.Array(
          Type.Object({
            original_text: Type.String({
              maxLength: MAX_MATERIAL_ENTRY_REPLACE_CHARS,
              description: '要被替换的原文片段，必须来自 read/search 返回的真实正文。',
            }),
            new_text: Type.String({
              maxLength: MAX_MATERIAL_ENTRY_REPLACE_CHARS,
              description: '替换后的新片段。',
            }),
          }),
          {
            minItems: 1,
            maxItems: 20,
            description: 'replace_fragments 模式下的局部替换列表。',
          },
        ),
      ),
    }),
    execute: async (_toolCallId, params) => {
      const resolved = resolveEntry(ctx, params)
      if ('error' in resolved) return textBlock(resolved.error)
      const edit = ctx.editMaterialEntry
      if (!edit) return textBlock('（当前环境无法修改素材条目：未连接界面）')

      const row = resolved.row
      const mode = params.mode as 'replace_fragments' | 'append' | 'replace'
      const currentBody = row.entry.body ?? ''
      let nextBody: string | undefined

      if (mode === 'replace_fragments') {
        const replacements = (params.replacements ?? []) as MaterialEntryReplacement[]
        const result = replaceEntryText({ currentBody, replacements })
        if ('error' in result) return textBlock(`未修改：${result.error}`)
        nextBody = result.next
      } else {
        const body = String(params.body ?? '').trim()
        if (!body) return textBlock('未修改：body 不能为空。')
        if (mode === 'append') {
          const sep = currentBody.length === 0 ? '' : currentBody.endsWith('\n') ? '\n' : '\n\n'
          nextBody = `${currentBody}${sep}${body}`
        } else {
          if (currentBody.trim() && !params.allow_overwrite_existing) {
            return textBlock(
              '未覆盖：该条目已有正文。只有用户明确要求覆盖全文时，才可设置 allow_overwrite_existing=true 后重试；普通局部修改请用 replace_fragments。',
            )
          }
          nextBody = body
        }
      }

      const nextTitle = params.title == null ? undefined : String(params.title).trim()
      if (nextBody === undefined && nextTitle === undefined) {
        return textBlock('未修改：没有提供 title、body 或 replacements。')
      }
      const ok = edit({
        stageId: row.stageId,
        entryId: row.entry.id,
        title: nextTitle,
        body: nextBody,
      })
      if (!ok) return textBlock('修改素材条目失败。')
      ctx.selectMaterialEntry?.(row.stageId, row.entry.id)
      await requestSave(ctx)
      return textBlock(
        `已修改素材条目「${nextTitle || entryTitle(row.entry, row.stageId)}」｜${row.stageLabel}（entry_id=${row.entry.id}），并已自动保存。`,
      )
    },
  })
}

export function buildWriteMaterialOverviewTool(
  ctx: MaterialWorkspaceStageAgentContext,
): AgentTool {
  return defineTool({
    name: 'write_material_overview',
    label: '写入素材概览',
    description:
      '写入或覆盖当前素材库概览。概览用于沉淀素材库总说明、使用边界和索引提示。覆盖非空概览时必须显式允许。',
    parameters: Type.Object({
      text: Type.String({ description: '要写入概览的正文。' }),
      mode: Type.Union([Type.Literal('replace'), Type.Literal('append')], {
        description: 'replace=覆盖概览；append=追加到概览末尾。',
      }),
      allow_overwrite_existing: Type.Optional(
        Type.Boolean({
          description: '仅 replace 非空概览时允许设为 true。',
        }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      const writeOverview = ctx.writeMaterialOverview
      if (!writeOverview) return textBlock('（当前环境无法写入素材库概览：未连接界面）')
      const text = String(params.text ?? '').trim()
      if (!text) return textBlock('未写入：text 不能为空。')
      const current = ctx.getMaterialOverview?.() ?? ctx.overview ?? ''
      let next = text
      if (params.mode === 'append') {
        const sep = current.length === 0 ? '' : current.endsWith('\n') ? '\n' : '\n\n'
        next = `${current}${sep}${text}`
      } else if (current.trim() && !params.allow_overwrite_existing) {
        return textBlock(
          '未覆盖：当前素材库概览已有内容。只有用户明确要求覆盖概览时，才可设置 allow_overwrite_existing=true 后重试。',
        )
      }
      writeOverview(next)
      await requestSave(ctx)
      return textBlock(`已${params.mode === 'append' ? '追加' : '覆盖'}素材库概览，并已自动保存。`)
    },
  })
}

/**
 * 素材库工作台系统提示词由后端磁盘模板提供；此处仅附加 Pi 工具。
 */
export function buildMaterialWorkspaceAdditionalTools(
  ctx: MaterialWorkspaceStageAgentContext,
): AgentTool[] {
  return [
    buildListMaterialEntriesTool(ctx),
    buildReadMaterialEntryTool(ctx),
    buildSearchMaterialEntriesTool(ctx),
    buildCreateMaterialEntryTool(ctx),
    buildEditMaterialEntryTool(ctx),
    buildWriteMaterialOverviewTool(ctx),
  ]
}
