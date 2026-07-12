import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import {
  LONG_CHARACTER_GROUPS,
  addLongArc,
  addLongChapterCard,
  addLongVolume,
  addLongWorldCategory,
  bumpLongWorkspace,
  newLongWorkspaceId,
  newLongWorkspaceItemId,
  normalizeLongWorkspace,
  removeLongArc,
  removeLongChapterCard,
  removeLongVolume,
  removeLongWorldCategory,
  setLongWorldbuildingFormat,
  type LongCharacterGroupId,
  type LongChapterCard,
  type LongWorkspace,
  type LongWorldbuildingCategory,
} from './longWorkspace'
import {
  longRootStageIdForStage,
  type LongRootStageId,
  type LongStageId,
} from './stages'
import { defineTool, textBlock } from '../shared/piToolkit'

export type ReplaceLongWorkspace = (
  workspace: LongWorkspace,
) => boolean | void | Promise<boolean | void>

export type LongStructuredMutationContext = {
  stageId: LongStageId
  longWorkspace?: LongWorkspace | null
  getLongWorkspace?: () => LongWorkspace | null | undefined
  replaceLongWorkspace?: ReplaceLongWorkspace
  isToolCallStreamed?: (toolCallId: string) => boolean
}

type MutationResult =
  | { ok: true; workspace: LongWorkspace; message: string }
  | { ok: false; error: string }

const CHARACTER_GROUP_SCHEMA = Type.Union(
  LONG_CHARACTER_GROUPS.map((group) => Type.Literal(group.id)),
  { description: 'protagonists=主角；major_supporting=主要配角；minor_supporting=次要配角；passersby=路人。' },
)

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function cleanId(raw: unknown): string {
  return String(raw ?? '').trim()
}

function cleanName(raw: unknown): string {
  return String(raw ?? '').trim()
}

function rootLabel(root: LongRootStageId): string {
  if (root === 'worldbuilding') return '世界观'
  if (root === 'character_design') return '人物'
  if (root === 'plot_design') return '剧情'
  if (root === 'draft') return '正文'
  return '状态账本'
}

async function runMutation(
  ctx: LongStructuredMutationContext,
  expectedRoot: LongRootStageId,
  mutate: (workspace: LongWorkspace) => MutationResult,
) {
  const currentRoot = longRootStageIdForStage(ctx.stageId)
  if (currentRoot !== expectedRoot) {
    return textBlock(
      `未写入：当前是「${rootLabel(currentRoot)}」智能体，只有「${rootLabel(expectedRoot)}」智能体可以调用此结构化变更工具。`,
    )
  }
  const current = ctx.getLongWorkspace?.() ?? ctx.longWorkspace
  if (!current) {
    return textBlock('未写入：当前书籍尚未加载结构化长篇数据，请先保存或重新打开书籍。')
  }
  if (!ctx.replaceLongWorkspace) {
    return textBlock('未写入：当前界面尚未连接长篇结构化数据更新器。')
  }
  const base = normalizeLongWorkspace(current)
  const result = mutate(base)
  if (!result.ok) return textBlock(`未写入：${result.error}`)
  const next = result.workspace.revision === base.revision
    ? bumpLongWorkspace(result.workspace)
    : result.workspace
  try {
    const applied = await ctx.replaceLongWorkspace(next)
    if (applied === false) return textBlock('未写入：界面拒绝了本次结构化变更。')
    return textBlock(result.message)
  } catch (error) {
    return textBlock(
      `写入失败：${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function findWorldCategory(
  workspace: LongWorkspace,
  categoryId: string,
): LongWorldbuildingCategory | undefined {
  return workspace.worldbuilding.categories.find((row) => row.id === categoryId)
}

function ensureWorldCategory(
  workspace: LongWorkspace,
  rawCategoryId: unknown,
): { category: LongWorldbuildingCategory; categoryId: string } | { error: string } {
  const categoryId = cleanId(rawCategoryId)
  if (!categoryId) return { error: 'category_id 不能为空。请先调用 list_worldbuilding 获取内部 id。' }
  const category = findWorldCategory(workspace, categoryId)
  if (!category) return { error: `找不到 category_id=${categoryId} 的世界观分类。` }
  return { category, categoryId }
}

function ensureListCategory(
  workspace: LongWorkspace,
  rawCategoryId: unknown,
): { category: LongWorldbuildingCategory; categoryId: string } | { error: string } {
  const resolved = ensureWorldCategory(workspace, rawCategoryId)
  if ('error' in resolved) return resolved
  if (resolved.category.format !== 'list') {
    return {
      error: `「${resolved.category.name}」当前是文本格式，请使用 write_worldbuilding_text；如需切换格式请调用 manage_worldbuilding_category(action=set_format)。`,
    }
  }
  return resolved
}

function replaceTextFragment(
  current: string,
  original: unknown,
  replacement: unknown,
): { ok: true; text: string } | { ok: false; error: string } {
  const source = String(original ?? '')
  if (!source) return { ok: false, error: 'original_text 不能为空。' }
  const first = current.indexOf(source)
  if (first < 0) return { ok: false, error: '找不到 original_text 对应的真实原文，请先查询最新内容。' }
  if (current.indexOf(source, first + source.length) >= 0) {
    return { ok: false, error: 'original_text 在正文中出现多次，请提供更长且唯一的原文片段。' }
  }
  return {
    ok: true,
    text: current.slice(0, first) + String(replacement ?? '') + current.slice(first + source.length),
  }
}

export function buildManageWorldbuildingCategoryTool(
  ctx: LongStructuredMutationContext,
): AgentTool {
  return defineTool({
    name: 'manage_worldbuilding_category',
    label: '管理世界观分类',
    description:
      '新增、重命名、删除世界观分类，或安全切换列表/文本格式。切换格式会保留原格式数据，并在目标格式为空时自动生成可见副本。',
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal('create'),
        Type.Literal('rename'),
        Type.Literal('delete'),
        Type.Literal('set_format'),
      ]),
      category_id: Type.Optional(Type.String({ description: '除 create 外必填；来自 list_worldbuilding。' })),
      name: Type.Optional(Type.String({ description: 'create/rename 时必填。' })),
      format: Type.Optional(Type.Union([Type.Literal('list'), Type.Literal('text')])),
    }),
    execute: async (_toolCallId, params) => runMutation(ctx, 'worldbuilding', (workspace) => {
      const action = String(params.action)
      if (action === 'create') {
        const name = cleanName(params.name)
        if (!name) return { ok: false, error: 'create 时 name 不能为空。' }
        if (workspace.worldbuilding.categories.some((row) => row.name === name)) {
          return { ok: false, error: `世界观分类「${name}」已经存在。` }
        }
        const added = addLongWorldCategory(workspace, name)
        const format = params.format === 'text' ? 'text' : 'list'
        const next = format === 'text'
          ? setLongWorldbuildingFormat(added.workspace, added.categoryId, 'text')
          : added.workspace
        return {
          ok: true,
          workspace: next,
          message: `已新增世界观分类「${name}」（category_id=${added.categoryId}，${format === 'list' ? '列表格式' : '文本格式'}）。`,
        }
      }
      const resolved = ensureWorldCategory(workspace, params.category_id)
      if ('error' in resolved) return { ok: false, error: resolved.error }
      if (action === 'rename') {
        const name = cleanName(params.name)
        if (!name) return { ok: false, error: 'rename 时 name 不能为空。' }
        if (workspace.worldbuilding.categories.some(
          (row) => row.id !== resolved.categoryId && row.name === name,
        )) {
          return { ok: false, error: `世界观分类「${name}」已经存在。` }
        }
        resolved.category.name = name
        return {
          ok: true,
          workspace,
          message: `已将世界观分类重命名为「${name}」。`,
        }
      }
      if (action === 'delete') {
        return {
          ok: true,
          workspace: removeLongWorldCategory(workspace, resolved.categoryId),
          message: `已删除世界观分类「${resolved.category.name}」及其结构化内容。`,
        }
      }
      if (action === 'set_format') {
        const format = params.format
        if (format !== 'list' && format !== 'text') {
          return { ok: false, error: 'set_format 时 format 只能是 list 或 text。' }
        }
        return {
          ok: true,
          workspace: setLongWorldbuildingFormat(workspace, resolved.categoryId, format),
          message: `已将「${resolved.category.name}」切换为${format === 'list' ? '列表格式' : '文本格式'}；原格式数据仍保留。`,
        }
      }
      return { ok: false, error: `不支持 action=${action}。` }
    }),
  })
}

export function buildWriteWorldbuildingListTool(
  ctx: LongStructuredMutationContext,
): AgentTool {
  return defineTool({
    name: 'write_worldbuilding_list',
    label: '写入世界观列表',
    description:
      '精确维护列表格式世界观的分类概述或单个条目。文本格式不得使用此工具。',
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal('set_overview'),
        Type.Literal('create_item'),
        Type.Literal('update_item'),
        Type.Literal('delete_item'),
      ]),
      category_id: Type.String({ description: '世界观分类内部 id。' }),
      item_id: Type.Optional(Type.String({ description: 'update_item/delete_item 时必填。' })),
      overview: Type.Optional(Type.String({ maxLength: 30000 })),
      name: Type.Optional(Type.String({ maxLength: 500 })),
      description: Type.Optional(Type.String({ maxLength: 30000 })),
      detail: Type.Optional(Type.String({ maxLength: 200000 })),
    }),
    execute: async (_toolCallId, params) => runMutation(ctx, 'worldbuilding', (workspace) => {
      const resolved = ensureListCategory(workspace, params.category_id)
      if ('error' in resolved) return { ok: false, error: resolved.error }
      const action = String(params.action)
      if (action === 'set_overview') {
        if (!hasOwn(params, 'overview')) return { ok: false, error: 'set_overview 时必须提供 overview。' }
        resolved.category.overview = String(params.overview ?? '')
        return {
          ok: true,
          workspace,
          message: `已更新「${resolved.category.name}」的所有条目列表概述。`,
        }
      }
      if (action === 'create_item') {
        const name = cleanName(params.name)
        if (!name) return { ok: false, error: 'create_item 时 name 不能为空。' }
        if (resolved.category.items.some((row) => row.name === name)) {
          return { ok: false, error: `「${resolved.category.name}」中已存在条目「${name}」。` }
        }
        const itemId = newLongWorkspaceItemId()
        resolved.category.items.push({
          id: itemId,
          name,
          description: String(params.description ?? ''),
          detail: String(params.detail ?? ''),
        })
        return {
          ok: true,
          workspace,
          message: `已在「${resolved.category.name}」新增条目「${name}」（item_id=${itemId}）。`,
        }
      }
      const itemId = cleanId(params.item_id)
      if (!itemId) return { ok: false, error: `${action} 时 item_id 不能为空。` }
      const item = resolved.category.items.find((row) => row.id === itemId)
      if (!item) return { ok: false, error: `找不到 item_id=${itemId} 的世界观条目。` }
      if (action === 'delete_item') {
        resolved.category.items = resolved.category.items.filter((row) => row.id !== itemId)
        return {
          ok: true,
          workspace,
          message: `已从「${resolved.category.name}」删除条目「${item.name}」。`,
        }
      }
      if (action === 'update_item') {
        const changed = ['name', 'description', 'detail'].some((key) => hasOwn(params, key))
        if (!changed) return { ok: false, error: 'update_item 至少提供 name、description、detail 之一。' }
        if (hasOwn(params, 'name')) {
          const name = cleanName(params.name)
          if (!name) return { ok: false, error: '条目 name 不能为空。' }
          if (resolved.category.items.some((row) => row.id !== itemId && row.name === name)) {
            return { ok: false, error: `「${resolved.category.name}」中已存在条目「${name}」。` }
          }
          item.name = name
        }
        if (hasOwn(params, 'description')) item.description = String(params.description ?? '')
        if (hasOwn(params, 'detail')) item.detail = String(params.detail ?? '')
        return {
          ok: true,
          workspace,
          message: `已更新「${resolved.category.name} / ${item.name}」。`,
        }
      }
      return { ok: false, error: `不支持 action=${action}。` }
    }),
  })
}

export function buildWriteWorldbuildingTextTool(
  ctx: LongStructuredMutationContext,
): AgentTool {
  return defineTool({
    name: 'write_worldbuilding_text',
    label: '写入世界观文本',
    description:
      '维护文本格式世界观正文。局部修改用 replace_fragment；整体覆盖必须明确设置 allow_overwrite_existing=true。列表格式不得使用此工具。',
    parameters: Type.Object({
      category_id: Type.String(),
      mode: Type.Union([Type.Literal('replace'), Type.Literal('replace_fragment')]),
      allow_overwrite_existing: Type.Optional(Type.Boolean()),
      text: Type.Optional(Type.String({ maxLength: 500000 })),
      original_text: Type.Optional(Type.String({ maxLength: 50000 })),
      new_text: Type.Optional(Type.String({ maxLength: 50000 })),
    }),
    execute: async (toolCallId, params) => {
      if (ctx.isToolCallStreamed?.(toolCallId)) {
        return textBlock('已流式更新世界观文本。')
      }
      return runMutation(ctx, 'worldbuilding', (workspace) => {
      const resolved = ensureWorldCategory(workspace, params.category_id)
      if ('error' in resolved) return { ok: false, error: resolved.error }
      if (resolved.category.format !== 'text') {
        return {
          ok: false,
          error: `「${resolved.category.name}」当前是列表格式，请使用 write_worldbuilding_list；如需切换格式请调用 manage_worldbuilding_category(action=set_format)。`,
        }
      }
      if (params.mode === 'replace') {
        const text = String(params.text ?? '')
        if (!text.trim()) return { ok: false, error: 'replace 时 text 不能为空。' }
        if (resolved.category.text.trim() && !params.allow_overwrite_existing) {
          return { ok: false, error: '该分类已有正文；整体覆盖前必须设置 allow_overwrite_existing=true。局部修改请使用 replace_fragment。' }
        }
        resolved.category.text = text
      } else {
        const next = replaceTextFragment(
          resolved.category.text,
          params.original_text,
          params.new_text,
        )
        if (!next.ok) return { ok: false, error: next.error }
        resolved.category.text = next.text
      }
      return {
        ok: true,
        workspace,
        message: `已更新文本格式世界观「${resolved.category.name}」。`,
      }
      })
    },
  })
}

export function buildManageLongCharacterTool(
  ctx: LongStructuredMutationContext,
): AgentTool {
  return defineTool({
    name: 'manage_long_character',
    label: '管理长篇人物',
    description: '在四个固定分组中新增、精确更新或删除一条人物记录；更新只修改明确提供的页签。',
    parameters: Type.Object({
      action: Type.Union([Type.Literal('create'), Type.Literal('update'), Type.Literal('delete')]),
      group_id: CHARACTER_GROUP_SCHEMA,
      character_id: Type.Optional(Type.String({ description: 'update/delete 时必填。' })),
      target_group_id: Type.Optional(CHARACTER_GROUP_SCHEMA),
      name: Type.Optional(Type.String({ maxLength: 500 })),
      core_profile: Type.Optional(Type.String({ maxLength: 200000 })),
      relationships: Type.Optional(Type.String({ maxLength: 200000 })),
      current_state: Type.Optional(Type.String({ maxLength: 200000 })),
      history: Type.Optional(Type.String({ maxLength: 300000 })),
    }),
    execute: async (_toolCallId, params) => runMutation(ctx, 'character_design', (workspace) => {
      const groupId = params.group_id as LongCharacterGroupId
      const group = workspace.characters[groupId]
      if (!group) return { ok: false, error: `未知人物分组 group_id=${String(groupId)}。` }
      const action = String(params.action)
      if (action === 'create') {
        const name = cleanName(params.name)
        if (!name) return { ok: false, error: 'create 时 name 不能为空。' }
        if (LONG_CHARACTER_GROUPS.some((row) =>
          workspace.characters[row.id].entries.some((character) => character.name === name),
        )) {
          return { ok: false, error: `人物「${name}」已经存在，请先查询并更新原记录。` }
        }
        const characterId = newLongWorkspaceId('character')
        group.entries.push({
          id: characterId,
          name,
          core_profile: String(params.core_profile ?? ''),
          relationships: String(params.relationships ?? ''),
          current_state: String(params.current_state ?? ''),
          history: String(params.history ?? ''),
        })
        return {
          ok: true,
          workspace,
          message: `已新增人物「${name}」（character_id=${characterId}）。`,
        }
      }
      const characterId = cleanId(params.character_id)
      if (!characterId) return { ok: false, error: `${action} 时 character_id 不能为空。` }
      const character = group.entries.find((row) => row.id === characterId)
      if (!character) {
        return { ok: false, error: `在指定分组中找不到 character_id=${characterId}。请先调用 list_long_characters。` }
      }
      if (action === 'delete') {
        group.entries = group.entries.filter((row) => row.id !== characterId)
        return { ok: true, workspace, message: `已删除人物「${character.name}」。` }
      }
      if (action === 'update') {
        const editable = ['name', 'core_profile', 'relationships', 'current_state', 'history']
        const changed = editable.some((key) => hasOwn(params, key)) || hasOwn(params, 'target_group_id')
        if (!changed) return { ok: false, error: 'update 至少提供一个要修改的字段。' }
        if (hasOwn(params, 'name')) {
          const name = cleanName(params.name)
          if (!name) return { ok: false, error: '人物 name 不能为空。' }
          const duplicate = LONG_CHARACTER_GROUPS.some((row) =>
            workspace.characters[row.id].entries.some(
              (other) => other.id !== characterId && other.name === name,
            ),
          )
          if (duplicate) return { ok: false, error: `人物「${name}」已经存在。` }
          character.name = name
        }
        if (hasOwn(params, 'core_profile')) character.core_profile = String(params.core_profile ?? '')
        if (hasOwn(params, 'relationships')) character.relationships = String(params.relationships ?? '')
        if (hasOwn(params, 'current_state')) character.current_state = String(params.current_state ?? '')
        if (hasOwn(params, 'history')) character.history = String(params.history ?? '')
        const targetGroupId = params.target_group_id as LongCharacterGroupId | undefined
        if (targetGroupId && targetGroupId !== groupId) {
          const target = workspace.characters[targetGroupId]
          if (!target) return { ok: false, error: `未知目标人物分组 target_group_id=${targetGroupId}。` }
          group.entries = group.entries.filter((row) => row.id !== characterId)
          target.entries.push(character)
        }
        return { ok: true, workspace, message: `已更新人物「${character.name}」的指定字段。` }
      }
      return { ok: false, error: `不支持 action=${action}。` }
    }),
  })
}

function buildReplaceablePlotTextTool(
  ctx: LongStructuredMutationContext,
): AgentTool {
  return defineTool({
    name: 'write_long_book_line',
    label: '写入长篇全书线',
    description: '维护全书线（总纲）文本。局部修改优先 replace_fragment；整体覆盖已有总纲需显式确认。',
    parameters: Type.Object({
      mode: Type.Union([Type.Literal('replace'), Type.Literal('replace_fragment')]),
      allow_overwrite_existing: Type.Optional(Type.Boolean()),
      text: Type.Optional(Type.String({ maxLength: 500000 })),
      original_text: Type.Optional(Type.String({ maxLength: 50000 })),
      new_text: Type.Optional(Type.String({ maxLength: 50000 })),
    }),
    execute: async (toolCallId, params) => {
      if (ctx.isToolCallStreamed?.(toolCallId)) {
        return textBlock('已流式更新全书线（总纲）。')
      }
      return runMutation(ctx, 'plot_design', (workspace) => {
      if (params.mode === 'replace') {
        const text = String(params.text ?? '')
        if (!text.trim()) return { ok: false, error: 'replace 时 text 不能为空。' }
        if (workspace.plot.book_line.trim() && !params.allow_overwrite_existing) {
          return { ok: false, error: '全书线已有内容；整体覆盖前必须设置 allow_overwrite_existing=true。局部修改请使用 replace_fragment。' }
        }
        workspace.plot.book_line = text
      } else {
        const next = replaceTextFragment(
          workspace.plot.book_line,
          params.original_text,
          params.new_text,
        )
        if (!next.ok) return { ok: false, error: next.error }
        workspace.plot.book_line = next.text
      }
      return { ok: true, workspace, message: '已更新全书线（总纲）。' }
      })
    },
  })
}

function affectedCardsForVolume(workspace: LongWorkspace, volumeId: string) {
  return workspace.plot.chapter_cards.filter((card) => card.volume_id === volumeId)
}

function resolveLongVolume(
  workspace: LongWorkspace,
  rawVolumeId: unknown,
  rawName: unknown,
): { volume: LongWorkspace['plot']['volumes'][number]; usedNameFallback: boolean } | null {
  const volumeId = cleanId(rawVolumeId)
  const byId = workspace.plot.volumes.find((row) => row.id === volumeId)
  if (byId) return { volume: byId, usedNameFallback: false }

  // Long-running chats can retain an ID after import/rebuild regenerated it.
  // A name is safe as a recovery key only when exactly one current row matches.
  const name = cleanName(rawName)
  if (!name) return null
  const byName = workspace.plot.volumes.filter((row) => row.name.trim() === name)
  return byName.length === 1 ? { volume: byName[0]!, usedNameFallback: true } : null
}

function affectedCardsForArc(workspace: LongWorkspace, arcId: string) {
  return workspace.plot.chapter_cards.filter((card) => card.arc_id === arcId)
}

function protectChapterDeletion(
  workspace: LongWorkspace,
  cards: readonly LongChapterCard[],
  allowWritten: boolean,
): string | null {
  const committed = cards.find((card) => workspace.chapters[card.stage_id]?.committed)
  if (committed) return `章节「${committed.title}」已经落盘，禁止通过剧情工具删除其上级结构或章卡。`
  const written = cards.find((card) => {
    const chapter = workspace.chapters[card.stage_id]
    return Boolean(
      chapter?.body.trim() || chapter?.character_state.trim() || chapter?.handoff.trim(),
    )
  })
  if (written && !allowWritten) {
    return `章节「${written.title}」已有未落盘内容；确认确实要级联删除后请设置 allow_delete_written_chapters=true。`
  }
  return null
}

export function buildManageLongVolumeTool(
  ctx: LongStructuredMutationContext,
): AgentTool {
  return defineTool({
    name: 'manage_long_volume',
    label: '管理长篇分卷',
    description: '新增、更新或删除分卷。删除会级联删除所属剧情弧、章卡和未落盘章节，已落盘章节永远禁止删除。',
    parameters: Type.Object({
      action: Type.Union([Type.Literal('create'), Type.Literal('update'), Type.Literal('delete')]),
      volume_id: Type.Optional(Type.String()),
      name: Type.Optional(Type.String({ maxLength: 500 })),
      outline: Type.Optional(Type.String({ maxLength: 300000 })),
      order: Type.Optional(Type.Integer({ minimum: 1, maximum: 100000 })),
      allow_delete_written_chapters: Type.Optional(Type.Boolean()),
    }),
    execute: async (_toolCallId, params) => runMutation(ctx, 'plot_design', (workspace) => {
      const action = String(params.action)
      if (action === 'create') {
        const name = cleanName(params.name)
        if (!name) return { ok: false, error: 'create 时 name 不能为空。' }
        const added = addLongVolume(workspace)
        const volume = added.workspace.plot.volumes.find((row) => row.id === added.volumeId)!
        volume.name = name
        if (hasOwn(params, 'outline')) volume.outline = String(params.outline ?? '')
        if (params.order) volume.order = Number(params.order)
        return { ok: true, workspace: added.workspace, message: `已新增分卷「${name}」（volume_id=${added.volumeId}）。` }
      }
      const requestedVolumeId = cleanId(params.volume_id)
      const resolved = resolveLongVolume(workspace, params.volume_id, params.name)
      if (!resolved) return { ok: false, error: `找不到 volume_id=${requestedVolumeId || '（空）'} 的分卷。` }
      const { volume } = resolved
      const volumeId = volume.id
      if (action === 'delete') {
        const blocked = protectChapterDeletion(
          workspace,
          affectedCardsForVolume(workspace, volumeId),
          Boolean(params.allow_delete_written_chapters),
        )
        if (blocked) return { ok: false, error: blocked }
        return { ok: true, workspace: removeLongVolume(workspace, volumeId), message: `已删除分卷「${volume.name}」及其未落盘下级结构。` }
      }
      if (action === 'update') {
        const changed = ['name', 'outline', 'order'].some((key) => hasOwn(params, key))
        if (!changed) return { ok: false, error: 'update 至少提供 name、outline、order 之一。' }
        if (hasOwn(params, 'name')) {
          const name = cleanName(params.name)
          if (!name) return { ok: false, error: '分卷 name 不能为空。' }
          volume.name = name
        }
        if (hasOwn(params, 'outline')) volume.outline = String(params.outline ?? '')
        if (params.order) volume.order = Number(params.order)
        const recovered = resolved.usedNameFallback
          ? `（历史 volume_id=${requestedVolumeId} 已失效，已按唯一卷名匹配当前 volume_id=${volume.id}）`
          : ''
        return { ok: true, workspace, message: `已更新分卷「${volume.name}」。${recovered}` }
      }
      return { ok: false, error: `不支持 action=${action}。` }
    }),
  })
}

export function buildManageLongArcTool(
  ctx: LongStructuredMutationContext,
): AgentTool {
  return defineTool({
    name: 'manage_long_arc',
    label: '管理长篇剧情弧',
    description: '在指定分卷下新增、更新或删除剧情弧。删除会级联删除章卡和未落盘章节。',
    parameters: Type.Object({
      action: Type.Union([Type.Literal('create'), Type.Literal('update'), Type.Literal('delete')]),
      volume_id: Type.Optional(Type.String({ description: 'create 时必填。' })),
      arc_id: Type.Optional(Type.String({ description: 'update/delete 时必填。' })),
      name: Type.Optional(Type.String({ maxLength: 500 })),
      timeline: Type.Optional(Type.String({ maxLength: 300000 })),
      order: Type.Optional(Type.Integer({ minimum: 1, maximum: 100000 })),
      allow_delete_written_chapters: Type.Optional(Type.Boolean()),
    }),
    execute: async (_toolCallId, params) => runMutation(ctx, 'plot_design', (workspace) => {
      const action = String(params.action)
      if (action === 'create') {
        const volumeId = cleanId(params.volume_id)
        const volume = workspace.plot.volumes.find((row) => row.id === volumeId)
        if (!volume) return { ok: false, error: `找不到 volume_id=${volumeId || '（空）'} 的分卷。` }
        const name = cleanName(params.name)
        if (!name) return { ok: false, error: 'create 时 name 不能为空。' }
        const added = addLongArc(workspace, volumeId)
        const arc = added.workspace.plot.arcs.find((row) => row.id === added.arcId)!
        arc.name = name
        if (hasOwn(params, 'timeline')) arc.timeline = String(params.timeline ?? '')
        if (params.order) arc.order = Number(params.order)
        return { ok: true, workspace: added.workspace, message: `已在「${volume.name}」新增剧情弧「${name}」（arc_id=${added.arcId}）。` }
      }
      const arcId = cleanId(params.arc_id)
      const arc = workspace.plot.arcs.find((row) => row.id === arcId)
      if (!arc) return { ok: false, error: `找不到 arc_id=${arcId || '（空）'} 的剧情弧。` }
      if (action === 'delete') {
        const blocked = protectChapterDeletion(
          workspace,
          affectedCardsForArc(workspace, arcId),
          Boolean(params.allow_delete_written_chapters),
        )
        if (blocked) return { ok: false, error: blocked }
        return { ok: true, workspace: removeLongArc(workspace, arcId), message: `已删除剧情弧「${arc.name}」及其未落盘章卡。` }
      }
      if (action === 'update') {
        const changed = ['name', 'timeline', 'order'].some((key) => hasOwn(params, key))
        if (!changed) return { ok: false, error: 'update 至少提供 name、timeline、order 之一。' }
        if (hasOwn(params, 'name')) {
          const name = cleanName(params.name)
          if (!name) return { ok: false, error: '剧情弧 name 不能为空。' }
          arc.name = name
        }
        if (hasOwn(params, 'timeline')) arc.timeline = String(params.timeline ?? '')
        if (params.order) arc.order = Number(params.order)
        return { ok: true, workspace, message: `已更新剧情弧「${arc.name}」。` }
      }
      return { ok: false, error: `不支持 action=${action}。` }
    }),
  })
}

export function buildManageLongChapterCardTool(
  ctx: LongStructuredMutationContext,
): AgentTool {
  return defineTool({
    name: 'manage_long_chapter_card',
    label: '管理长篇章卡',
    description: '在“分卷 -> 剧情弧”下新增、更新或删除章卡。章卡自动同步创建正文三块；已落盘章卡禁止修改或删除。',
    parameters: Type.Object({
      action: Type.Union([Type.Literal('create'), Type.Literal('update'), Type.Literal('delete')]),
      volume_id: Type.Optional(Type.String({ description: 'create 时必填。' })),
      arc_id: Type.Optional(Type.String({ description: 'create 时必填。' })),
      card_id: Type.Optional(Type.String({ description: 'update/delete 时必填。' })),
      title: Type.Optional(Type.String({ maxLength: 500 })),
      outline: Type.Optional(Type.String({ maxLength: 300000 })),
      world_constraints: Type.Optional(Type.String({ maxLength: 300000 })),
      characters: Type.Optional(Type.Array(Type.String({ maxLength: 500 }), { maxItems: 500 })),
      order: Type.Optional(Type.Integer({ minimum: 1, maximum: 100000 })),
      allow_delete_written_chapters: Type.Optional(Type.Boolean()),
    }),
    execute: async (_toolCallId, params) => runMutation(ctx, 'plot_design', (workspace) => {
      const action = String(params.action)
      if (action === 'create') {
        const volumeId = cleanId(params.volume_id)
        const arcId = cleanId(params.arc_id)
        const volume = workspace.plot.volumes.find((row) => row.id === volumeId)
        const arc = workspace.plot.arcs.find((row) => row.id === arcId)
        if (!volume) return { ok: false, error: `找不到 volume_id=${volumeId || '（空）'} 的分卷。` }
        if (!arc || arc.volume_id !== volumeId) {
          return { ok: false, error: `找不到属于该分卷的 arc_id=${arcId || '（空）'} 剧情弧。` }
        }
        const title = cleanName(params.title)
        if (!title) return { ok: false, error: 'create 时 title 不能为空。' }
        const added = addLongChapterCard(workspace, volumeId, arcId)
        const card = added.workspace.plot.chapter_cards.find((row) => row.id === added.cardId)!
        card.title = title
        if (hasOwn(params, 'outline')) card.outline = String(params.outline ?? '')
        if (hasOwn(params, 'world_constraints')) card.world_constraints = String(params.world_constraints ?? '')
        if (hasOwn(params, 'characters')) card.characters = [...new Set((params.characters ?? []).map(cleanName).filter(Boolean))]
        if (params.order) card.order = Number(params.order)
        const chapter = added.workspace.chapters[added.stageId]
        if (chapter) chapter.title = title
        return { ok: true, workspace: added.workspace, message: `已新增章卡「${title}」（card_id=${added.cardId}，stage_id=${added.stageId}），正文三块已同步创建。` }
      }
      const cardId = cleanId(params.card_id)
      const card = workspace.plot.chapter_cards.find((row) => row.id === cardId)
      if (!card) return { ok: false, error: `找不到 card_id=${cardId || '（空）'} 的章卡。` }
      const chapter = workspace.chapters[card.stage_id]
      if (chapter?.committed) return { ok: false, error: `章卡「${card.title}」对应章节已经落盘，禁止修改或删除。` }
      if (action === 'delete') {
        const blocked = protectChapterDeletion(
          workspace,
          [card],
          Boolean(params.allow_delete_written_chapters),
        )
        if (blocked) return { ok: false, error: blocked }
        return { ok: true, workspace: removeLongChapterCard(workspace, cardId), message: `已删除章卡「${card.title}」及其未落盘正文三块。` }
      }
      if (action === 'update') {
        const editable = ['title', 'outline', 'world_constraints', 'characters', 'order']
        if (!editable.some((key) => hasOwn(params, key))) {
          return { ok: false, error: 'update 至少提供 title、outline、world_constraints、characters、order 之一。' }
        }
        if (hasOwn(params, 'title')) {
          const title = cleanName(params.title)
          if (!title) return { ok: false, error: '章卡 title 不能为空。' }
          card.title = title
          if (chapter) chapter.title = title
        }
        if (hasOwn(params, 'outline')) card.outline = String(params.outline ?? '')
        if (hasOwn(params, 'world_constraints')) card.world_constraints = String(params.world_constraints ?? '')
        if (hasOwn(params, 'characters')) card.characters = [...new Set((params.characters ?? []).map(cleanName).filter(Boolean))]
        if (params.order) card.order = Number(params.order)
        return { ok: true, workspace, message: `已更新章卡「${card.title}」。` }
      }
      return { ok: false, error: `不支持 action=${action}。` }
    }),
  })
}

export function buildManageLongForeshadowingTool(
  ctx: LongStructuredMutationContext,
): AgentTool {
  return defineTool({
    name: 'manage_long_foreshadowing',
    label: '管理长篇伏笔',
    description: '新增、更新或删除伏笔记录；每条包含名称、描述、内容和状态。',
    parameters: Type.Object({
      action: Type.Union([Type.Literal('create'), Type.Literal('update'), Type.Literal('delete')]),
      foreshadowing_id: Type.Optional(Type.String()),
      name: Type.Optional(Type.String({ maxLength: 500 })),
      description: Type.Optional(Type.String({ maxLength: 50000 })),
      content: Type.Optional(Type.String({ maxLength: 300000 })),
      status: Type.Optional(Type.String({ maxLength: 500 })),
    }),
    execute: async (_toolCallId, params) => runMutation(ctx, 'plot_design', (workspace) => {
      const action = String(params.action)
      if (action === 'create') {
        const name = cleanName(params.name)
        if (!name) return { ok: false, error: 'create 时 name 不能为空。' }
        const id = newLongWorkspaceId('foreshadowing')
        workspace.plot.foreshadowing.push({
          id,
          name,
          description: String(params.description ?? ''),
          content: String(params.content ?? ''),
          status: cleanName(params.status) || 'open',
        })
        return { ok: true, workspace, message: `已新增伏笔「${name}」（foreshadowing_id=${id}）。` }
      }
      const id = cleanId(params.foreshadowing_id)
      const row = workspace.plot.foreshadowing.find((item) => item.id === id)
      if (!row) return { ok: false, error: `找不到 foreshadowing_id=${id || '（空）'} 的伏笔。` }
      if (action === 'delete') {
        workspace.plot.foreshadowing = workspace.plot.foreshadowing.filter((item) => item.id !== id)
        return { ok: true, workspace, message: `已删除伏笔「${row.name}」。` }
      }
      if (action === 'update') {
        const editable = ['name', 'description', 'content', 'status']
        if (!editable.some((key) => hasOwn(params, key))) {
          return { ok: false, error: 'update 至少提供 name、description、content、status 之一。' }
        }
        if (hasOwn(params, 'name')) {
          const name = cleanName(params.name)
          if (!name) return { ok: false, error: '伏笔 name 不能为空。' }
          row.name = name
        }
        if (hasOwn(params, 'description')) row.description = String(params.description ?? '')
        if (hasOwn(params, 'content')) row.content = String(params.content ?? '')
        if (hasOwn(params, 'status')) row.status = cleanName(params.status) || 'open'
        return { ok: true, workspace, message: `已更新伏笔「${row.name}」。` }
      }
      return { ok: false, error: `不支持 action=${action}。` }
    }),
  })
}

export function buildLongStructuredMutationTools(
  ctx: LongStructuredMutationContext,
): AgentTool[] {
  const root = longRootStageIdForStage(ctx.stageId)
  if (root === 'worldbuilding') {
    return [
      buildManageWorldbuildingCategoryTool(ctx),
      buildWriteWorldbuildingListTool(ctx),
      buildWriteWorldbuildingTextTool(ctx),
    ]
  }
  if (root === 'character_design') {
    return [buildManageLongCharacterTool(ctx)]
  }
  if (root === 'plot_design') {
    return [
      buildReplaceablePlotTextTool(ctx),
      buildManageLongVolumeTool(ctx),
      buildManageLongArcTool(ctx),
      buildManageLongChapterCardTool(ctx),
      buildManageLongForeshadowingTool(ctx),
    ]
  }
  return []
}
