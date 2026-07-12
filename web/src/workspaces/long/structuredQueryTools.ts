import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import {
  LONG_CHARACTER_GROUPS,
  orderedLongArcs,
  orderedLongChapterCards,
  orderedLongVolumes,
  type LongChapterCard,
  type LongCharacter,
  type LongCharacterGroupId,
  type LongPlotArc,
  type LongPlotVolume,
  type LongWorkspace,
  type LongWorldbuildingCategory,
  type LongWorldbuildingItem,
} from './longWorkspace'
import {
  longRootStageIdForStage,
  type LongRootStageId,
  type LongStageId,
} from './stages'
import {
  countNonWhitespaceChars,
  defineTool,
  textBlock,
} from '../shared/piToolkit'

export type LongStructuredQueryContext = {
  bookTitle: string
  stageId: LongStageId
  longWorkspace?: LongWorkspace | null
  getLongWorkspace?: () => LongWorkspace | null | undefined
  allowedWorkspaceStages?: readonly LongStageId[]
}

type ResolveResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

const ROOT_LABELS: Record<LongRootStageId, string> = {
  worldbuilding: '世界观',
  character_design: '人物',
  plot_design: '剧情',
  draft: '正文',
  continuity_ledger: '状态账本',
}

function normalizedName(raw: unknown): string {
  return String(raw ?? '').trim().toLocaleLowerCase('zh-CN')
}

function readableRoots(ctx: LongStructuredQueryContext): Set<LongRootStageId> {
  const stageIds = ctx.allowedWorkspaceStages?.length
    ? ctx.allowedWorkspaceStages
    : [ctx.stageId]
  return new Set(stageIds.map((stageId) => longRootStageIdForStage(stageId)))
}

function requireWorkspace(
  ctx: LongStructuredQueryContext,
  toolLabel: string,
  requiredRoots: readonly LongRootStageId[],
): ResolveResult<LongWorkspace> {
  const allowed = readableRoots(ctx)
  const denied = requiredRoots.filter((root) => !allowed.has(root))
  if (denied.length > 0) {
    return {
      ok: false,
      error:
        `当前智能体的读取范围未包含${denied.map((root) => `「${ROOT_LABELS[root]}」`).join('、')}根节点，无法${toolLabel}。`
        + '请在「创作空间设置 -> 长篇」中为当前智能体勾选对应创作空间阶段。',
    }
  }
  const workspace = ctx.getLongWorkspace?.() ?? ctx.longWorkspace
  if (!workspace) {
    return {
      ok: false,
      error: `当前书籍尚未加载结构化长篇数据，无法${toolLabel}。请先保存或重新打开该长篇书籍。`,
    }
  }
  return { ok: true, value: workspace }
}

function resolveOneByName<T>(
  rows: readonly T[],
  rawName: unknown,
  getId: (row: T) => string,
  getName: (row: T) => string,
  label: string,
  candidateLabel: (row: T) => string = (row) => getName(row),
): ResolveResult<T> {
  const query = normalizedName(rawName)
  if (!query) return { ok: false, error: `请提供${label}名称。` }
  const exact = rows.filter(
    (row) =>
      normalizedName(getId(row)) === query || normalizedName(getName(row)) === query,
  )
  if (exact.length === 1) return { ok: true, value: exact[0]! }
  const candidates = exact.length > 1
    ? exact
    : rows.filter((row) => {
        const id = normalizedName(getId(row))
        const name = normalizedName(getName(row))
        return id.includes(query) || name.includes(query) || query.includes(name)
      })
  if (candidates.length === 1) return { ok: true, value: candidates[0]! }
  if (candidates.length === 0) {
    return {
      ok: false,
      error: `未找到${label}「${String(rawName ?? '').trim()}」。`,
    }
  }
  return {
    ok: false,
    error: [
      `${label}名称不唯一，请使用更完整的名称或内部 id：`,
      ...candidates.map((row) => `- ${candidateLabel(row)}（id=${getId(row)}）`),
    ].join('\n'),
  }
}

function resolveWorldCategory(
  workspace: LongWorkspace,
  rawName: unknown,
): ResolveResult<LongWorldbuildingCategory> {
  return resolveOneByName(
    workspace.worldbuilding.categories,
    rawName,
    (row) => row.id,
    (row) => row.name,
    '世界观分类',
  )
}

function worldFormatLabel(category: LongWorldbuildingCategory): string {
  return category.format === 'list' ? '列表格式' : '文本格式'
}

function ensureWorldFormat(
  category: LongWorldbuildingCategory,
  expected: 'list' | 'text',
  requestedTool: string,
): string | null {
  if (category.format === expected) return null
  const correctTool = expected === 'list' ? 'query_worldbuilding_text' : 'query_worldbuilding'
  return (
    `世界观分类「${category.name}」当前是${worldFormatLabel(category)}，不能使用 ${requestedTool}。`
    + `请改用 ${correctTool}${category.format === 'list' ? '；读取单条完整信息时使用 query_worldbuilding_item' : ''}。`
  )
}

function formatWorldItemIndex(items: readonly LongWorldbuildingItem[]): string {
  if (items.length === 0) return '（暂无条目）'
  return items
    .map((item) => `- ${item.name}：${item.description.trim() || '（暂无描述）'}`)
    .join('\n')
}

function worldCategoryParameterSchema(
  categories: readonly LongWorldbuildingCategory[],
  description: string,
) {
  const values = [...new Set(
    categories.flatMap((category) => [category.name, category.id]).filter(Boolean),
  )]
  if (values.length === 0) return Type.String({ description })
  if (values.length === 1) return Type.Literal(values[0]!, { description })
  return Type.Union(values.map((value) => Type.Literal(value)), { description })
}

export function buildListWorldbuildingTool(
  ctx: LongStructuredQueryContext,
): AgentTool {
  return defineTool({
    name: 'list_worldbuilding',
    label: '列出世界观分类',
    description:
      '列出结构化长篇世界观的全部分类、格式与规模。列表格式后续用 query_worldbuilding/query_worldbuilding_item；文本格式用 query_worldbuilding_text。',
    parameters: Type.Object({}),
    execute: async () => {
      const resolved = requireWorkspace(ctx, '列出世界观分类', ['worldbuilding'])
      if (!resolved.ok) return textBlock(resolved.error)
      const categories = resolved.value.worldbuilding.categories
      if (categories.length === 0) return textBlock('当前世界观尚无分类。')
      return textBlock([
        `《${ctx.bookTitle}》世界观分类：`,
        ...categories.map((category) =>
          category.format === 'list'
            ? `- ${category.name}（id=${category.id}，列表格式，${category.items.length} 条，概述 ${countNonWhitespaceChars(category.overview)} 字）`
            : `- ${category.name}（id=${category.id}，文本格式，正文 ${countNonWhitespaceChars(category.text)} 字）`,
        ),
      ].join('\n'))
    },
  })
}

export function buildQueryWorldbuildingTool(
  ctx: LongStructuredQueryContext,
  readableCategories: readonly LongWorldbuildingCategory[] = [],
): AgentTool {
  const readableHint = readableCategories.length > 0
    ? `当前可读取的列表格式分类：${readableCategories.map((category) => category.name).join('、')}。`
    : ''
  return defineTool({
    name: 'query_worldbuilding',
    label: '查询世界观列表概述',
    description:
      `查看“列表格式”世界观分类的总概述以及所有条目的名称和描述，不返回条目详细介绍。${readableHint}`,
    parameters: Type.Object({
      category_name: worldCategoryParameterSchema(
        readableCategories,
        '要查看概述的列表格式世界观分类名称或 id。',
      ),
    }),
    execute: async (_toolCallId, params) => {
      const resolved = requireWorkspace(ctx, '查询世界观列表概述', ['worldbuilding'])
      if (!resolved.ok) return textBlock(resolved.error)
      const categoryResult = resolveWorldCategory(resolved.value, params.category_name)
      if (!categoryResult.ok) return textBlock(categoryResult.error)
      const category = categoryResult.value
      const mismatch = ensureWorldFormat(category, 'list', 'query_worldbuilding')
      if (mismatch) return textBlock(mismatch)
      return textBlock([
        `【${category.name}】（id=${category.id}，列表格式）`,
        `条目数：${category.items.length}`,
        '',
        '分类概述：',
        category.overview.trim() || '（暂无分类概述）',
        '',
        '全部条目名称与描述：',
        formatWorldItemIndex(category.items),
      ].join('\n'))
    },
  })
}

export function buildQueryWorldbuildingItemTool(
  ctx: LongStructuredQueryContext,
  readableCategories: readonly LongWorldbuildingCategory[] = [],
): AgentTool {
  const readableHint = readableCategories.length > 0
    ? `当前可按条目查询的列表格式分类：${readableCategories.map((category) => category.name).join('、')}。`
    : ''
  return defineTool({
    name: 'query_worldbuilding_item',
    label: '查询世界观条目全文',
    description: `在“列表格式”世界观分类中按条目名称读取名称、描述和完整详细介绍。${readableHint}`,
    parameters: Type.Object({
      category_name: worldCategoryParameterSchema(
        readableCategories,
        '要查询条目的列表格式世界观分类名称或 id。',
      ),
      item_name: Type.String({ description: '条目名称或 id，必须尽量精确。' }),
    }),
    execute: async (_toolCallId, params) => {
      const resolved = requireWorkspace(ctx, '查询世界观条目', ['worldbuilding'])
      if (!resolved.ok) return textBlock(resolved.error)
      const categoryResult = resolveWorldCategory(resolved.value, params.category_name)
      if (!categoryResult.ok) return textBlock(categoryResult.error)
      const category = categoryResult.value
      const mismatch = ensureWorldFormat(category, 'list', 'query_worldbuilding_item')
      if (mismatch) return textBlock(mismatch)
      const itemResult = resolveOneByName(
        category.items,
        params.item_name,
        (row) => row.id,
        (row) => row.name,
        `「${category.name}」条目`,
      )
      if (!itemResult.ok) return textBlock(itemResult.error)
      const item = itemResult.value
      return textBlock([
        `【${category.name} / ${item.name}】`,
        `条目 id：${item.id}`,
        '',
        '描述：',
        item.description.trim() || '（暂无描述）',
        '',
        '详细介绍：',
        item.detail.trim() || '（暂无详细介绍）',
      ].join('\n'))
    },
  })
}

export function buildQueryWorldbuildingTextTool(
  ctx: LongStructuredQueryContext,
  readableCategories: readonly LongWorldbuildingCategory[] = [],
): AgentTool {
  const readableHint = readableCategories.length > 0
    ? `当前可直接查看全部正文的文本格式分类：${readableCategories.map((category) => category.name).join('、')}。`
    : ''
  return defineTool({
    name: 'query_worldbuilding_text',
    label: '查看世界观全部文本',
    description: `一次读取“文本格式”世界观分类的全部正文。该格式没有概述或单条查询；列表格式必须改用 query_worldbuilding。${readableHint}`,
    parameters: Type.Object({
      category_name: worldCategoryParameterSchema(
        readableCategories,
        '要查看全部正文的文本格式世界观分类名称或 id。',
      ),
    }),
    execute: async (_toolCallId, params) => {
      const resolved = requireWorkspace(ctx, '查询世界观文本', ['worldbuilding'])
      if (!resolved.ok) return textBlock(resolved.error)
      const categoryResult = resolveWorldCategory(resolved.value, params.category_name)
      if (!categoryResult.ok) return textBlock(categoryResult.error)
      const category = categoryResult.value
      const mismatch = ensureWorldFormat(category, 'text', 'query_worldbuilding_text')
      if (mismatch) return textBlock(mismatch)
      return textBlock([
        `【${category.name}】（id=${category.id}，文本格式）`,
        `字数：${countNonWhitespaceChars(category.text)}`,
        '',
        category.text.trim() || '（该分类正文为空）',
      ].join('\n'))
    },
  })
}

const CHARACTER_GROUP_SCHEMA = Type.Union(
  LONG_CHARACTER_GROUPS.map((group) => Type.Literal(group.id)),
  { description: '人物分组：主角、主要配角、次要配角或路人。' },
)

function characterGroupLabel(groupId: LongCharacterGroupId): string {
  return LONG_CHARACTER_GROUPS.find((group) => group.id === groupId)?.label ?? groupId
}

function characterRows(
  workspace: LongWorkspace,
  groupId?: LongCharacterGroupId,
): Array<{ groupId: LongCharacterGroupId; character: LongCharacter }> {
  const groups = groupId
    ? LONG_CHARACTER_GROUPS.filter((group) => group.id === groupId)
    : LONG_CHARACTER_GROUPS
  return groups.flatMap((group) =>
    workspace.characters[group.id].entries.map((character) => ({
      groupId: group.id,
      character,
    })),
  )
}

export function buildListLongCharactersTool(
  ctx: LongStructuredQueryContext,
): AgentTool {
  return defineTool({
    name: 'list_long_characters',
    label: '列出长篇人物',
    description: '按固定人物分组列出人物名称；需要读取四个页签全文时再调用 query_long_character。',
    parameters: Type.Object({
      group_id: Type.Optional(CHARACTER_GROUP_SCHEMA),
    }),
    execute: async (_toolCallId, params) => {
      const resolved = requireWorkspace(ctx, '列出人物', ['character_design'])
      if (!resolved.ok) return textBlock(resolved.error)
      const selectedGroup = params.group_id as LongCharacterGroupId | undefined
      const groups = selectedGroup
        ? LONG_CHARACTER_GROUPS.filter((group) => group.id === selectedGroup)
        : LONG_CHARACTER_GROUPS
      return textBlock(groups.map((group) => {
        const entries = resolved.value.characters[group.id].entries
        return [
          `【${group.label}】（${entries.length} 人）`,
          entries.length
            ? entries.map((entry) => `- ${entry.name}（id=${entry.id}）`).join('\n')
            : '（暂无人物）',
        ].join('\n')
      }).join('\n\n'))
    },
  })
}

export function buildQueryLongCharacterTool(
  ctx: LongStructuredQueryContext,
): AgentTool {
  return defineTool({
    name: 'query_long_character',
    label: '查询长篇人物档案',
    description: '按人物名称读取核心人设、人物关系、当前状态和历史状态变化四个页签全文。',
    parameters: Type.Object({
      character_name: Type.String({ description: '人物名称或 id。' }),
      group_id: Type.Optional(CHARACTER_GROUP_SCHEMA),
    }),
    execute: async (_toolCallId, params) => {
      const resolved = requireWorkspace(ctx, '查询人物档案', ['character_design'])
      if (!resolved.ok) return textBlock(resolved.error)
      const rows = characterRows(
        resolved.value,
        params.group_id as LongCharacterGroupId | undefined,
      )
      const characterResult = resolveOneByName(
        rows,
        params.character_name,
        (row) => row.character.id,
        (row) => row.character.name,
        '人物',
        (row) => `${characterGroupLabel(row.groupId)} / ${row.character.name}`,
      )
      if (!characterResult.ok) return textBlock(characterResult.error)
      const { groupId, character } = characterResult.value
      return textBlock([
        `【${characterGroupLabel(groupId)} / ${character.name}】（id=${character.id}）`,
        '',
        '## 核心人设',
        character.core_profile.trim() || '（暂无）',
        '',
        '## 人物关系',
        character.relationships.trim() || '（暂无）',
        '',
        '## 当前状态',
        character.current_state.trim() || '（暂无）',
        '',
        '## 历史状态变化',
        character.history.trim() || '（暂无）',
      ].join('\n'))
    },
  })
}

function volumeLabel(volume: LongPlotVolume): string {
  return `${volume.name}（id=${volume.id}）`
}

function arcLabel(
  workspace: LongWorkspace,
  arc: LongPlotArc,
): string {
  const volume = workspace.plot.volumes.find((row) => row.id === arc.volume_id)
  return `${volume?.name ?? '未知分卷'} / ${arc.name}（id=${arc.id}）`
}

function resolveVolume(
  workspace: LongWorkspace,
  rawName: unknown,
): ResolveResult<LongPlotVolume> {
  return resolveOneByName(
    orderedLongVolumes(workspace),
    rawName,
    (row) => row.id,
    (row) => row.name,
    '分卷',
  )
}

function resolveArc(
  workspace: LongWorkspace,
  rawName: unknown,
  volumeId?: string,
): ResolveResult<LongPlotArc> {
  const arcs = orderedLongArcs(workspace, volumeId)
  return resolveOneByName(
    arcs,
    rawName,
    (row) => row.id,
    (row) => row.name,
    '剧情弧',
    (row) => arcLabel(workspace, row),
  )
}

const PLOT_SCOPE_SCHEMA = Type.Union([
  Type.Literal('all'),
  Type.Literal('book_line'),
  Type.Literal('volumes'),
  Type.Literal('arcs'),
  Type.Literal('foreshadowing'),
])

export function buildQueryLongPlotStructureTool(
  ctx: LongStructuredQueryContext,
): AgentTool {
  return defineTool({
    name: 'query_long_plot_structure',
    label: '查询长篇剧情结构',
    description: '查询全书线、分卷/卷纲、剧情弧/时间线或伏笔；章卡全文请用 query_long_chapter_card。',
    parameters: Type.Object({
      scope: PLOT_SCOPE_SCHEMA,
      volume_name: Type.Optional(Type.String({ description: '可选：分卷名称或 id。' })),
      arc_name: Type.Optional(Type.String({ description: '可选：剧情弧名称或 id。' })),
      foreshadowing_name: Type.Optional(Type.String({ description: '可选：伏笔名称或 id。' })),
    }),
    execute: async (_toolCallId, params) => {
      const resolved = requireWorkspace(ctx, '查询剧情结构', ['plot_design'])
      if (!resolved.ok) return textBlock(resolved.error)
      const workspace = resolved.value
      const scope = params.scope as 'all' | 'book_line' | 'volumes' | 'arcs' | 'foreshadowing'
      if (scope === 'book_line') {
        return textBlock(`【全书线（总纲）】\n\n${workspace.plot.book_line.trim() || '（暂无）'}`)
      }
      if (scope === 'volumes') {
        let volumes = orderedLongVolumes(workspace)
        if (params.volume_name) {
          const volumeResult = resolveVolume(workspace, params.volume_name)
          if (!volumeResult.ok) return textBlock(volumeResult.error)
          volumes = [volumeResult.value]
        }
        return textBlock(volumes.length
          ? volumes.map((volume) => [
              `【${volumeLabel(volume)}】`,
              `剧情弧：${orderedLongArcs(workspace, volume.id).length} 个；章卡：${workspace.plot.chapter_cards.filter((card) => card.volume_id === volume.id).length} 张`,
              '',
              volume.outline.trim() || '（暂无卷纲）',
            ].join('\n')).join('\n\n---\n\n')
          : '当前尚无分卷。')
      }
      if (scope === 'arcs') {
        let volumeId: string | undefined
        if (params.volume_name) {
          const volumeResult = resolveVolume(workspace, params.volume_name)
          if (!volumeResult.ok) return textBlock(volumeResult.error)
          volumeId = volumeResult.value.id
        }
        let arcs = orderedLongArcs(workspace, volumeId)
        if (params.arc_name) {
          const arcResult = resolveArc(workspace, params.arc_name, volumeId)
          if (!arcResult.ok) return textBlock(arcResult.error)
          arcs = [arcResult.value]
        }
        return textBlock(arcs.length
          ? arcs.map((arc) => [
              `【${arcLabel(workspace, arc)}】`,
              `章卡：${workspace.plot.chapter_cards.filter((card) => card.arc_id === arc.id).length} 张`,
              '',
              arc.timeline.trim() || '（暂无时间线安排）',
            ].join('\n')).join('\n\n---\n\n')
          : '当前筛选范围内尚无剧情弧。')
      }
      if (scope === 'foreshadowing') {
        let rows = workspace.plot.foreshadowing
        if (params.foreshadowing_name) {
          const rowResult = resolveOneByName(
            rows,
            params.foreshadowing_name,
            (row) => row.id,
            (row) => row.name,
            '伏笔',
          )
          if (!rowResult.ok) return textBlock(rowResult.error)
          rows = [rowResult.value]
        }
        return textBlock(rows.length
          ? rows.map((row) => [
              `【伏笔：${row.name}】（id=${row.id}，状态=${row.status || 'open'}）`,
              `描述：${row.description.trim() || '（暂无）'}`,
              '',
              row.content.trim() || '（暂无伏笔内容）',
            ].join('\n')).join('\n\n---\n\n')
          : '当前尚无伏笔。')
      }
      return textBlock([
        '【全书线】',
        workspace.plot.book_line.trim() || '（暂无）',
        '',
        '【分卷与剧情弧】',
        ...orderedLongVolumes(workspace).map((volume) => {
          const arcs = orderedLongArcs(workspace, volume.id)
          return `- ${volume.name}（${arcs.length} 个剧情弧，${workspace.plot.chapter_cards.filter((card) => card.volume_id === volume.id).length} 张章卡）${arcs.length ? `：${arcs.map((arc) => arc.name).join('、')}` : ''}`
        }),
        '',
        `【伏笔】${workspace.plot.foreshadowing.length} 条`,
        workspace.plot.foreshadowing.length
          ? workspace.plot.foreshadowing.map((row) => `- ${row.name}（${row.status || 'open'}）：${row.description || '暂无描述'}`).join('\n')
          : '（暂无）',
      ].join('\n'))
    },
  })
}

function chapterCardCandidateLabel(
  workspace: LongWorkspace,
  card: LongChapterCard,
): string {
  const volume = workspace.plot.volumes.find((row) => row.id === card.volume_id)
  const arc = workspace.plot.arcs.find((row) => row.id === card.arc_id)
  return `${volume?.name ?? '未知分卷'} / ${arc?.name ?? '未知剧情弧'} / ${card.title}`
}

function resolveChapterCard(
  workspace: LongWorkspace,
  raw: unknown,
): ResolveResult<LongChapterCard> {
  return resolveOneByName(
    orderedLongChapterCards(workspace),
    raw,
    (row) => row.stage_id,
    (row) => row.title,
    '章卡',
    (row) => chapterCardCandidateLabel(workspace, row),
  )
}

function formatChapterCard(
  workspace: LongWorkspace,
  card: LongChapterCard,
): string {
  const volume = workspace.plot.volumes.find((row) => row.id === card.volume_id)
  const arc = workspace.plot.arcs.find((row) => row.id === card.arc_id)
  return [
    `【${chapterCardCandidateLabel(workspace, card)}】`,
    `stage_id：${card.stage_id}`,
    `卷：${volume?.name ?? card.volume_id}`,
    `剧情弧：${arc?.name ?? card.arc_id}`,
    `出场人物：${card.characters.length ? card.characters.join('、') : '（未指定）'}`,
    '',
    '## 章纲',
    card.outline.trim() || '（暂无）',
    '',
    '## 世界观强约束',
    card.world_constraints.trim() || '（暂无）',
  ].join('\n')
}

export function buildQueryLongChapterCardTool(
  ctx: LongStructuredQueryContext,
): AgentTool {
  return defineTool({
    name: 'query_long_chapter_card',
    label: '查询长篇章卡',
    description: '按章名或 stage_id 查询权威章卡，返回卷、剧情弧、章纲、世界观强约束和出场人物。',
    parameters: Type.Object({
      chapter_name: Type.String({ description: '章名或 stage_id；同名章节建议直接传 stage_id。' }),
    }),
    execute: async (_toolCallId, params) => {
      const resolved = requireWorkspace(ctx, '查询章卡', ['plot_design'])
      if (!resolved.ok) return textBlock(resolved.error)
      const cardResult = resolveChapterCard(resolved.value, params.chapter_name)
      if (!cardResult.ok) return textBlock(cardResult.error)
      return textBlock(formatChapterCard(resolved.value, cardResult.value))
    },
  })
}

export function buildFindNextLongChapterTool(
  ctx: LongStructuredQueryContext,
): AgentTool {
  return defineTool({
    name: 'find_next_long_chapter',
    label: '查找下一长篇章节',
    description:
      '按权威章卡顺序查找最早尚未完成的章节：正文为空则需要写作，三块不完整则需要补齐，已写未落盘则需要先落盘。',
    parameters: Type.Object({}),
    execute: async () => {
      const resolved = requireWorkspace(
        ctx,
        '查找下一章节',
        ['plot_design', 'draft'],
      )
      if (!resolved.ok) return textBlock(resolved.error)
      const workspace = resolved.value
      const cards = orderedLongChapterCards(workspace)
      if (cards.length === 0) {
        return textBlock('当前没有章卡，无法开始正文写作。请先由剧情管理智能体创建章卡。')
      }
      for (let index = 0; index < cards.length; index += 1) {
        const card = cards[index]!
        const chapter = workspace.chapters[card.stage_id]
        const previousCard = index > 0 ? cards[index - 1] : undefined
        const previousChapter = previousCard
          ? workspace.chapters[previousCard.stage_id]
          : undefined
        const missing = chapter
          ? [
              !chapter.character_state.trim() ? '人物状态' : '',
              !chapter.handoff.trim() ? '交接注意文档' : '',
            ].filter(Boolean)
          : []
        const nextAction = !chapter?.body.trim()
          ? {
              action: 'write',
              reason: '正文为空，应调用写手智能体编写本章。',
            }
          : missing.length > 0
            ? {
                action: 'complete_blocks',
                reason: `正文已写，但缺少${missing.join('、')}，必须补齐后才能落盘。`,
              }
            : !chapter.committed
              ? {
                  action: 'commit',
                  reason: '正文三块已完整，但尚未落盘；应先落盘，不能越过本章。',
                }
              : null
        if (!nextAction) continue
        return textBlock([
          `下一处理节点：${chapterCardCandidateLabel(workspace, card)}`,
          `stage_id：${card.stage_id}`,
          `action：${nextAction.action}`,
          `原因：${nextAction.reason}`,
          `上一章交接：${previousChapter?.handoff.trim() || '（无，或这是第一章）'}`,
          '',
          formatChapterCard(workspace, card),
        ].join('\n'))
      }
      return textBlock(
        `现有 ${cards.length} 张章卡对应章节均已按顺序落盘。请先由剧情管理智能体创建下一张章卡，不能直接编写未建章卡的章节。`,
      )
    },
  })
}

export function buildLongStructuredQueryTools(
  ctx: LongStructuredQueryContext,
): AgentTool[] {
  const roots = readableRoots(ctx)
  const workspace = ctx.getLongWorkspace?.() ?? ctx.longWorkspace
  const canReadWorldbuilding = roots.has('worldbuilding')
  const listWorldbuildingCategories = canReadWorldbuilding
    ? workspace?.worldbuilding.categories.filter((category) => category.format === 'list') ?? []
    : []
  const textWorldbuildingCategories = canReadWorldbuilding
    ? workspace?.worldbuilding.categories.filter((category) => category.format === 'text') ?? []
    : []
  // 数据尚未装载时保留两种查询工具作为兼容兜底；一旦结构化数据可用，
  // 就只向所有阶段暴露当前实际存在的格式工具，避免文本分类被误走列表查询。
  const worldbuildingTools = canReadWorldbuilding
    ? [
        buildListWorldbuildingTool(ctx),
        ...(!workspace || listWorldbuildingCategories.length > 0
          ? [
              buildQueryWorldbuildingTool(
                ctx,
                listWorldbuildingCategories,
              ),
              buildQueryWorldbuildingItemTool(
                ctx,
                listWorldbuildingCategories,
              ),
            ]
          : []),
        ...(!workspace || textWorldbuildingCategories.length > 0
          ? [
              buildQueryWorldbuildingTextTool(
                ctx,
                textWorldbuildingCategories,
              ),
            ]
          : []),
      ]
    : []
  return [
    ...worldbuildingTools,
    buildListLongCharactersTool(ctx),
    buildQueryLongCharacterTool(ctx),
    buildQueryLongPlotStructureTool(ctx),
    buildQueryLongChapterCardTool(ctx),
    buildFindNextLongChapterTool(ctx),
  ]
}
