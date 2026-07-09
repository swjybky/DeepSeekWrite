import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import {
  SKILL_KIND_LABELS,
  SKILL_KIND_STAGE_IDS,
  SKILL_STAGE_LABELS,
  type SkillKind,
  type SkillStageEntry,
  type SkillStageId,
} from '../../bridge'
import { defineTool, excerptFn as excerpt, textBlock } from '../shared/piToolkit'

export type ApplyToStageEditorPayload = {
  text: string
  mode: 'replace' | 'append' | 'append_token' | 'streaming_end'
}

export type SkillWorkspaceStageAgentContext = {
  skillTitle: string
  skillKind?: SkillKind
  overview?: string
  currentEntryTitle?: string
  stageId: SkillStageId
  stageBody: string
  stageItems?: Partial<Record<SkillStageId, SkillStageEntry[]>>
  getSkillStages?: () => Partial<Record<SkillStageId, SkillStageEntry[]>>
  getSkillOverview?: () => string
  selectSkillEntry?: (stageId: SkillStageId, entryId: string) => void
  createSkillEntry?: (input: {
    stageId: SkillStageId
    title: string
    body: string
  }) => SkillStageEntry | null
  editSkillEntry?: (input: {
    stageId: SkillStageId
    entryId: string
    title?: string
    body?: string
  }) => boolean
  writeSkillOverview?: (text: string) => void
  applyToStageEditor?: (payload: ApplyToStageEditorPayload) => void
  isToolCallStreamed?: (toolCallId: string) => boolean
  onRequestSave?: () => void | Promise<void>
}

function allowedSkillStages(ctx: SkillWorkspaceStageAgentContext): SkillStageId[] {
  return SKILL_KIND_STAGE_IDS[ctx.skillKind ?? 'general'] ?? SKILL_KIND_STAGE_IDS.general
}

function normalizeSkillStageId(
  ctx: SkillWorkspaceStageAgentContext,
  raw: unknown,
): SkillStageId {
  const requested = String(raw ?? '').trim() as SkillStageId
  const allowed = allowedSkillStages(ctx)
  if (allowed.includes(requested)) return requested
  return ctx.stageId
}

function currentStages(
  ctx: SkillWorkspaceStageAgentContext,
): Partial<Record<SkillStageId, SkillStageEntry[]>> {
  return ctx.getSkillStages?.() ?? ctx.stageItems ?? {}
}

function allEntries(
  ctx: SkillWorkspaceStageAgentContext,
  stageId?: SkillStageId,
): Array<{ stageId: SkillStageId; entry: SkillStageEntry }> {
  const stages = currentStages(ctx)
  const allowed = stageId ? [stageId] : allowedSkillStages(ctx)
  return allowed.flatMap((sid) =>
    (stages[sid] ?? []).map((entry) => ({ stageId: sid, entry })),
  )
}

function findEntry(
  ctx: SkillWorkspaceStageAgentContext,
  input: { stageId?: SkillStageId; entryId?: string; title?: string },
): Array<{ stageId: SkillStageId; entry: SkillStageEntry }> {
  const title = (input.title ?? '').trim()
  const entryId = (input.entryId ?? '').trim()
  return allEntries(ctx, input.stageId).filter(({ entry }) => {
    if (entryId && entry.id === entryId) return true
    if (title && entry.title === title) return true
    return false
  })
}

function summarizeEntry(stageId: SkillStageId, entry: SkillStageEntry): string {
  const label = SKILL_STAGE_LABELS[stageId] ?? stageId
  const body = String(entry.body ?? '').trim()
  const bodyHint = body ? excerpt(body, 180) : '暂无正文'
  return `- ${label} / ${entry.title || '未命名技能'}（${entry.id}）：${bodyHint}`
}

export function buildSkillWorkspaceAdditionalTools(
  ctx: SkillWorkspaceStageAgentContext,
): AgentTool[] {
  const stageIdSchema = Type.Optional(
    Type.String({
      description: `阶段 ID。可用阶段：${allowedSkillStages(ctx).join('、')}`,
    }),
  )

  return [
    defineTool({
      name: 'list_skill_entries',
      label: '列出技能条目',
      description: '列出当前技能库允许分类范围内的技能条目，可限定阶段。',
      parameters: Type.Object({
        stage_id: stageIdSchema,
      }),
      execute: async (_toolCallId, params) => {
        const stageId = params.stage_id
          ? normalizeSkillStageId(ctx, params.stage_id)
          : undefined
        const rows = allEntries(ctx, stageId)
        const kindLabel = SKILL_KIND_LABELS[ctx.skillKind ?? 'general']
        if (rows.length === 0) {
          return textBlock(`《${ctx.skillTitle}》${kindLabel}暂无技能条目。`)
        }
        return textBlock(
          `《${ctx.skillTitle}》${kindLabel}技能条目：\n\n${rows
            .map(({ stageId: sid, entry }) => summarizeEntry(sid, entry))
            .join('\n')}`,
        )
      },
    }),
    defineTool({
      name: 'read_skill_entry',
      label: '读取技能条目',
      description: '按 entry_id 或标题读取技能条目全文。',
      parameters: Type.Object({
        stage_id: stageIdSchema,
        entry_id: Type.Optional(Type.String({ description: '技能条目 ID' })),
        title: Type.Optional(Type.String({ description: '技能条目标题，需精确匹配' })),
      }),
      execute: async (_toolCallId, params) => {
        const matches = findEntry(ctx, {
          stageId: params.stage_id
            ? normalizeSkillStageId(ctx, params.stage_id)
            : undefined,
          entryId: String(params.entry_id ?? ''),
          title: String(params.title ?? ''),
        })
        if (matches.length === 0) return textBlock('未找到匹配的技能条目。')
        if (matches.length > 1) {
          return textBlock(
            `找到 ${matches.length} 个匹配条目，请用 entry_id 指定：\n\n${matches
              .map(({ stageId, entry }) => summarizeEntry(stageId, entry))
              .join('\n')}`,
          )
        }
        const { stageId, entry } = matches[0]!
        ctx.selectSkillEntry?.(stageId, entry.id)
        return textBlock(
          `技能库：《${ctx.skillTitle}》\n阶段：${SKILL_STAGE_LABELS[stageId]}（${stageId}）\n条目：${entry.title || '未命名技能'}（${entry.id}）\n\n${String(entry.body ?? '').trim() || '暂无正文'}`,
        )
      },
    }),
    defineTool({
      name: 'search_skill_entries',
      label: '搜索技能条目',
      description: '按关键词搜索技能标题、正文和技能库概述。',
      parameters: Type.Object({
        query: Type.String({ description: '搜索关键词' }),
        stage_id: stageIdSchema,
      }),
      execute: async (_toolCallId, params) => {
        const query = String(params.query ?? '').trim().toLowerCase()
        if (!query) return textBlock('未搜索：query 不能为空。')
        const stageId = params.stage_id
          ? normalizeSkillStageId(ctx, params.stage_id)
          : undefined
        const rows = allEntries(ctx, stageId)
          .map((row) => {
            const haystack = `${row.entry.title}\n${row.entry.body}`.toLowerCase()
            const score = haystack.includes(query) ? 1 : 0
            return { ...row, score }
          })
          .filter((row) => row.score > 0)
        const overview = ctx.getSkillOverview?.() ?? ctx.overview ?? ''
        const overviewHit = overview.toLowerCase().includes(query)
        if (rows.length === 0 && !overviewHit) return textBlock('没有找到匹配的技能内容。')
        const parts: string[] = []
        if (overviewHit) parts.push(`- 技能库概述：${excerpt(overview, 220)}`)
        parts.push(
          ...rows.map(({ stageId: sid, entry }) => summarizeEntry(sid, entry)),
        )
        return textBlock(`搜索结果：\n\n${parts.join('\n')}`)
      },
    }),
    defineTool({
      name: 'create_skill_entry',
      label: '创建技能条目',
      description: '在指定阶段创建一个新的技能条目，并自动保存。',
      parameters: Type.Object({
        stage_id: Type.String({ description: '目标阶段 ID' }),
        title: Type.String({ description: '技能条目标题' }),
        body: Type.Optional(Type.String({ description: '技能条目正文' })),
      }),
      execute: async (_toolCallId, params) => {
        const stageId = normalizeSkillStageId(ctx, params.stage_id)
        const title = String(params.title ?? '').trim()
        if (!title) return textBlock('未创建：title 不能为空。')
        const entry = ctx.createSkillEntry?.({
          stageId,
          title,
          body: String(params.body ?? '').trim(),
        })
        if (!entry) return textBlock('（当前环境无法创建技能条目：未连接界面）')
        await ctx.onRequestSave?.()
        return textBlock(
          `已在「${SKILL_STAGE_LABELS[stageId]}」创建技能条目：${entry.title}（${entry.id}）。`,
        )
      },
    }),
    defineTool({
      name: 'edit_skill_entry',
      label: '编辑技能条目',
      description: '按 entry_id 或标题修改技能条目的标题或正文，并自动保存。',
      parameters: Type.Object({
        stage_id: stageIdSchema,
        entry_id: Type.Optional(Type.String({ description: '技能条目 ID' })),
        title: Type.Optional(Type.String({ description: '用于查找或替换的新标题' })),
        new_title: Type.Optional(Type.String({ description: '新标题；不传则不改标题' })),
        body: Type.Optional(Type.String({ description: '要写入或追加的正文' })),
        mode: Type.Optional(
          Type.Union([Type.Literal('replace'), Type.Literal('append')], {
            description: 'replace 覆盖正文；append 追加正文。默认 replace',
          }),
        ),
      }),
      execute: async (_toolCallId, params) => {
        const stageId = params.stage_id
          ? normalizeSkillStageId(ctx, params.stage_id)
          : undefined
        const matches = findEntry(ctx, {
          stageId,
          entryId: String(params.entry_id ?? ''),
          title: String(params.title ?? ''),
        })
        if (matches.length === 0) return textBlock('未找到要编辑的技能条目。')
        if (matches.length > 1) {
          return textBlock(
            `找到 ${matches.length} 个匹配条目，请用 entry_id 指定：\n\n${matches
              .map(({ stageId: sid, entry }) => summarizeEntry(sid, entry))
              .join('\n')}`,
          )
        }
        const match = matches[0]!
        const newTitle = String(params.new_title ?? '').trim()
        const body = String(params.body ?? '')
        const mode = params.mode === 'append' ? 'append' : 'replace'
        const nextBody =
          body.length === 0
            ? undefined
            : mode === 'append'
              ? `${String(match.entry.body ?? '').trimEnd()}${String(match.entry.body ?? '').trim() ? '\n\n' : ''}${body.trim()}`
              : body.trim()
        const ok = ctx.editSkillEntry?.({
          stageId: match.stageId,
          entryId: match.entry.id,
          title: newTitle || undefined,
          body: nextBody,
        })
        if (!ok) return textBlock('（当前环境无法编辑技能条目：未连接界面）')
        ctx.selectSkillEntry?.(match.stageId, match.entry.id)
        await ctx.onRequestSave?.()
        return textBlock(
          `已更新「${SKILL_STAGE_LABELS[match.stageId]}」技能条目：${newTitle || match.entry.title || '未命名技能'}。`,
        )
      },
    }),
    defineTool({
      name: 'write_skill_overview',
      label: '写入技能库概述',
      description: '写入或追加技能库概述，并自动保存。',
      parameters: Type.Object({
        text: Type.String({ description: '概述正文' }),
        mode: Type.Optional(
          Type.Union([Type.Literal('replace'), Type.Literal('append')], {
            description: 'replace 覆盖概述；append 追加概述。默认 replace',
          }),
        ),
        allow_overwrite_existing: Type.Optional(
          Type.Boolean({
            description: '概述已有内容且 mode=replace 时，必须为 true 才允许覆盖',
          }),
        ),
      }),
      execute: async (_toolCallId, params) => {
        const text = String(params.text ?? '').trim()
        if (!text) return textBlock('未写入：text 不能为空。')
        const current = ctx.getSkillOverview?.() ?? ctx.overview ?? ''
        const mode = params.mode === 'append' ? 'append' : 'replace'
        if (mode === 'replace' && current.trim() && !params.allow_overwrite_existing) {
          return textBlock(
            '概述已有内容。如需覆盖，请重新调用并设置 allow_overwrite_existing=true；或使用 append 模式追加。',
          )
        }
        const next =
          mode === 'append'
            ? `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${text}`
            : text
        ctx.writeSkillOverview?.(next)
        await ctx.onRequestSave?.()
        return textBlock('已写入技能库概述。')
      },
    }),
  ]
}
