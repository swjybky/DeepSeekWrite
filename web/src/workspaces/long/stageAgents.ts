import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import {
  isLongStageId,
  longContentStageRowsFromStages,
  longRootStageIdForStage,
  longStageLabel,
  type LongStageId,
} from './stages'
import {
  currentWordCountLine,
  defineTool,
  textBlock,
} from '../shared/piToolkit'

export type LongWorkspaceStageAgentContext = {
  bookTitle: string
  stageId: LongStageId
  stageBody: string
  getCurrentStageBody?: (stageId: LongStageId) => string | undefined
  allStages: Partial<Record<LongStageId, string>>
  allowedWorkspaceStages?: readonly LongStageId[]
  applyToStageEditor?: (payload: {
    mode: 'replace' | 'append' | 'append_token' | 'streaming_end'
    text: string
    targetStageId?: LongStageId
  }) => void
  isToolCallStreamed?: (toolCallId: string) => boolean
}

function stageLabel(stageId: LongStageId | string): string {
  return longStageLabel(stageId)
}

function readWorkspaceStageBody(
  ctx: LongWorkspaceStageAgentContext,
  stageId: LongStageId,
): string {
  try {
    const current = ctx.getCurrentStageBody?.(stageId)
    if (current !== undefined) return current
  } catch {
    /* fallback below */
  }
  return ctx.allStages[stageId] ?? ''
}

function dedupe<T>(items: readonly T[]): T[] {
  return [...new Set(items)]
}

function allKnownStageIds(ctx: LongWorkspaceStageAgentContext): LongStageId[] {
  return longContentStageRowsFromStages(ctx.allStages).map((stage) => stage.id)
}

function allowedWorkspaceStages(
  ctx: LongWorkspaceStageAgentContext,
): readonly LongStageId[] {
  const allowed = ctx.allowedWorkspaceStages?.filter(isLongStageId) ?? []
  const allowedRoots = new Set(
    [...allowed, ctx.stageId].map((stageId) => longRootStageIdForStage(stageId)),
  )
  const dynamicAllowed = allKnownStageIds(ctx).filter((stageId) =>
    allowedRoots.has(longRootStageIdForStage(stageId)),
  )
  return dedupe([...allowed, ...dynamicAllowed, ctx.stageId])
}

function longStageIdSchema(allowedStageIds: readonly LongStageId[]) {
  const literals = allowedStageIds.map((id) => Type.Literal(id))
  const description = allowedStageIds
    .map((id) => `${stageLabel(id)}（${id}）`)
    .join('、')
  if (literals.length === 1) return { schema: literals[0]!, description }
  return {
    schema: Type.Union(literals, {
      description: `允许读取的长篇阶段：${description}`,
    }),
    description,
  }
}

function writableStageIds(ctx: LongWorkspaceStageAgentContext): readonly LongStageId[] {
  return dedupe([...allKnownStageIds(ctx), ctx.stageId])
}

function writableStageIdSchema(ctx: LongWorkspaceStageAgentContext) {
  const writable = writableStageIds(ctx)
  if (writable.length === 1) return Type.Optional(Type.Literal(writable[0]!))
  return Type.Optional(
    Type.Union(
      writable.map((stageId) => Type.Literal(stageId)),
      {
        description:
          '可写入的长篇子节点：世界观、人物、剧情、正文卷/剧情弧线/章节、状态账本各叶子节点。',
      },
    ),
  )
}

function resolveWritableStageId(
  ctx: LongWorkspaceStageAgentContext,
  raw: unknown,
): LongStageId {
  const requested = String(raw ?? '').trim()
  return isLongStageId(requested) ? requested : ctx.stageId
}

export function buildReadWorkspaceContentTool(
  ctx: LongWorkspaceStageAgentContext,
): AgentTool {
  const allowed = allowedWorkspaceStages(ctx)
  const allowedSet = new Set(allowed)
  const { schema, description } = longStageIdSchema(allowed)
  return defineTool({
    name: 'read_workspace_content',
    label: '读取长篇工作区内容',
    description:
      `读取本书长篇创作空间某一阶段的当前内容。当前仅允许读取：${description || '（无）'}。每次调用只返回一个 stage_id。`,
    parameters: Type.Object({
      stage_id: schema,
    }),
    execute: async (_toolCallId, params) => {
      const stageId = params.stage_id as LongStageId
      if (!allowedSet.has(stageId)) {
        return textBlock(`当前不允许读取「${stageLabel(stageId)}」。`)
      }
      const raw = readWorkspaceStageBody(ctx, stageId).trim()
      const header = `书名：《${ctx.bookTitle}》\n【${stageLabel(stageId)}】（${stageId}）`
      const wordCount = currentWordCountLine(raw)
      if (!raw) return textBlock(`${header}\n${wordCount}\n\n该阶段当前文本为空。`)
      return textBlock(`${header}\n${wordCount}\n\n${raw}`)
    },
  })
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

function snippetAround(text: string, start: number, end: number, contextChars: number) {
  const left = Math.max(0, start - contextChars)
  const right = Math.min(text.length, end + contextChars)
  return `${left > 0 ? '...' : ''}${text.slice(left, right)}${right < text.length ? '...' : ''}`
}

export function buildSearchWorkspaceTextTool(
  ctx: LongWorkspaceStageAgentContext,
): AgentTool {
  const allowed = allowedWorkspaceStages(ctx)
  const { schema, description } = longStageIdSchema(allowed)
  return defineTool({
    name: 'search_workspace_text',
    label: '搜索长篇文本',
    description:
      `在长篇创作空间里搜索文本，只返回命中位置和少量上下文。当前仅允许搜索：${description || '（无）'}。不传 stage_id 时搜索所有允许阶段。`,
    parameters: Type.Object({
      query: Type.String({
        maxLength: 600,
        description: '要搜索的原文片段或关键词。',
      }),
      stage_id: Type.Optional(schema),
      max_matches: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      context_chars: Type.Optional(Type.Integer({ minimum: 10, maximum: 500 })),
    }),
    execute: async (_toolCallId, params) => {
      const query = String(params.query ?? '').trim()
      if (!query) return textBlock('未搜索：query 不能为空。')
      const maxMatches = Math.max(1, Math.min(100, Number(params.max_matches ?? 20)))
      const contextChars = Math.max(10, Math.min(500, Number(params.context_chars ?? 80)))
      const requested = String(params.stage_id ?? '').trim()
      const targets = isLongStageId(requested)
        ? allowed.filter((id) => id === requested)
        : allowed
      const results: string[] = []
      for (const stageId of targets) {
        const body = readWorkspaceStageBody(ctx, stageId)
        let pos = 0
        while (results.length < maxMatches) {
          const found = body.indexOf(query, pos)
          if (found < 0) break
          const lc = lineColumnAt(body, found)
          results.push(
            `【${stageLabel(stageId)}】${stageId}:${lc.line}:${lc.column}\n${snippetAround(body, found, found + query.length, contextChars)}`,
          )
          pos = found + query.length
        }
        if (results.length >= maxMatches) break
      }
      if (results.length === 0) return textBlock(`未找到：${query}`)
      return textBlock(`已返回 ${results.length} 处匹配。\n\n${results.join('\n\n')}`)
    },
  })
}

export function buildWriteWorkspaceEditorTool(
  ctx: LongWorkspaceStageAgentContext,
): AgentTool {
  return defineTool({
    name: 'write_workspace_editor',
    label: '写入长篇文本框',
    description:
      '覆盖写入长篇某一阶段的文本框。已有内容且只是局部修改时，优先使用 replace_current_stage_text。只有用户明确要求整体覆盖、重写、重新生成或替换全文时，才允许设置 allow_overwrite_existing=true 后覆盖写入。',
    parameters: Type.Object({
      target_stage_id: writableStageIdSchema(ctx),
      text: Type.String({
        description: '要写入目标阶段的正文稿件，建议 Markdown。',
      }),
      allow_overwrite_existing: Type.Optional(Type.Boolean()),
      mode: Type.Literal('replace'),
    }),
    execute: async (toolCallId, params) => {
      const apply = ctx.applyToStageEditor
      if (!apply) return textBlock('（当前环境无法写入编辑区：未连接界面）')
      const targetStageId = resolveWritableStageId(ctx, params.target_stage_id)
      const label = stageLabel(targetStageId)
      if (ctx.isToolCallStreamed?.(toolCallId)) {
        return textBlock(`已用新内容覆盖「${label}」编辑区。`)
      }
      const t = String(params.text ?? '').trim()
      if (!t) return textBlock('（未写入：文本为空）')
      const existing = readWorkspaceStageBody(ctx, targetStageId).trim()
      if (existing && !params.allow_overwrite_existing) {
        return textBlock(
          `未覆盖「${label}」：该阶段已有内容。如需整体覆盖，请确认用户明确要求后设置 allow_overwrite_existing=true；局部修改请改用 replace_current_stage_text。`,
        )
      }
      apply({ text: t, mode: 'replace', targetStageId })
      return textBlock(`已用新内容覆盖「${label}」编辑区。`)
    },
  })
}

export function buildReplaceCurrentStageTextTool(
  ctx: LongWorkspaceStageAgentContext,
): AgentTool {
  return defineTool({
    name: 'replace_current_stage_text',
    label: '替换长篇阶段文本',
    description:
      '根据当前文本编辑框中的原文片段替换成新文本。局部修改、润色、扩写某段、修正设定或状态账本时优先使用本工具，不要整段覆盖。',
    parameters: Type.Object({
      target_stage_id: writableStageIdSchema(ctx),
      original_text: Type.String({
        maxLength: 20000,
        description: '要被替换的原文片段，必须来自当前阶段真实文本。',
      }),
      new_text: Type.String({
        maxLength: 20000,
        description: '替换后的新片段。',
      }),
    }),
    execute: async (_toolCallId, params) => {
      const apply = ctx.applyToStageEditor
      if (!apply) return textBlock('（当前环境无法写入编辑区：未连接界面）')
      const targetStageId = resolveWritableStageId(ctx, params.target_stage_id)
      const body = readWorkspaceStageBody(ctx, targetStageId)
      const original = String(params.original_text ?? '')
      if (!original) return textBlock('未替换：original_text 不能为空。')
      const index = body.indexOf(original)
      if (index < 0) {
        return textBlock(
          `未替换：在「${stageLabel(targetStageId)}」中找不到该原文片段。请先调用 search_workspace_text 定位真实原文。`,
        )
      }
      const next =
        body.slice(0, index) + String(params.new_text ?? '') + body.slice(index + original.length)
      apply({ text: next, mode: 'replace', targetStageId })
      return textBlock(`已替换「${stageLabel(targetStageId)}」中的 1 个片段。`)
    },
  })
}

export function buildUpdateLongStoryLedgerTool(
  ctx: LongWorkspaceStageAgentContext,
): AgentTool {
  return defineTool({
    name: 'update_long_story_ledger',
    label: '更新长篇状态账本',
    description:
      '将一章或一场正文完成后的状态变化写入状态账本的四个子节点：时间线、人物状态、未回收伏笔、连续性记录。不要用它写正文。',
    parameters: Type.Object({
      source_label: Type.String({
        description: '来源章节或场景，例如“第12章”或“北境议事厅一场”。',
      }),
      summary: Type.String({
        description: '本次推进的简短摘要。',
      }),
      character_state_changes: Type.Array(Type.String(), {
        description: '人物状态/关系变化列表。',
      }),
      plot_threads: Type.Array(Type.String(), {
        description: '新增、推进或待回收的伏笔/剧情线列表。',
      }),
      timeline_updates: Type.Array(Type.String(), {
        description: '时间线或世界状态变化列表。',
      }),
      continuity_notes: Type.Array(Type.String(), {
        description: '需要后续保持一致的连续性注意事项。',
      }),
    }),
    execute: async (_toolCallId, params) => {
      const apply = ctx.applyToStageEditor
      if (!apply) return textBlock('（当前环境无法写入状态账本：未连接界面）')
      const source = String(params.source_label || '未命名片段').trim()
      const summary = String(params.summary || '').trim()
      const itemLines = (items: string[]) =>
        items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : ''
      const appendBlock = (
        stageId: LongStageId,
        title: string,
        body: string,
      ) => {
        const cleanBody = body.trim()
        if (!cleanBody) return false
        const block = [`## ${source}`, '', `### ${title}`, cleanBody].join('\n')
        const current = readWorkspaceStageBody(ctx, stageId).trim()
        apply({
          mode: 'replace',
          text: current ? `${current}\n\n${block}` : block,
          targetStageId: stageId,
        })
        return true
      }
      const changed = [
        appendBlock(
          'continuity_ledger.timeline',
          '时间线与世界状态',
          itemLines(params.timeline_updates ?? []),
        ),
        appendBlock(
          'continuity_ledger.character_states',
          '人物状态变化',
          itemLines(params.character_state_changes ?? []),
        ),
        appendBlock(
          'continuity_ledger.open_foreshadowing',
          '伏笔与剧情线',
          itemLines(params.plot_threads ?? []),
        ),
        appendBlock(
          'continuity_ledger.continuity_notes',
          '连续性记录',
          [
            summary ? `推进摘要：${summary}` : '',
            itemLines(params.continuity_notes ?? []),
          ].filter(Boolean).join('\n'),
        ),
      ].some(Boolean)
      return textBlock(changed ? '已更新「状态账本」子节点。' : '未更新：没有可写入的账本内容。')
    },
  })
}

export function buildLongWorkspaceAdditionalTools(
  ctx: LongWorkspaceStageAgentContext,
): AgentTool[] {
  return [
    buildReadWorkspaceContentTool(ctx),
    buildSearchWorkspaceTextTool(ctx),
    buildWriteWorkspaceEditorTool(ctx),
    buildReplaceCurrentStageTextTool(ctx),
    buildUpdateLongStoryLedgerTool(ctx),
  ]
}
