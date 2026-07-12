import {
  buildLongDraftStageId,
  longDraftArcLabel,
  longDraftChapterLabel,
  longDraftVolumeLabel,
  parseLongDraftStageId,
  type LongStageId,
} from './stages'

export const LONG_WORKSPACE_SCHEMA_VERSION = 2

export type LongWorldbuildingFormat = 'list' | 'text'

export type LongWorldbuildingItem = {
  id: string
  name: string
  description: string
  detail: string
}

export type LongWorldbuildingCategory = {
  id: string
  name: string
  format: LongWorldbuildingFormat
  overview: string
  items: LongWorldbuildingItem[]
  text: string
}

export const LONG_CHARACTER_GROUPS = [
  { id: 'protagonists', label: '主角' },
  { id: 'major_supporting', label: '主要配角' },
  { id: 'minor_supporting', label: '次要配角' },
  { id: 'passersby', label: '路人' },
] as const

export type LongCharacterGroupId = (typeof LONG_CHARACTER_GROUPS)[number]['id']

export type LongCharacter = {
  id: string
  name: string
  core_profile: string
  relationships: string
  current_state: string
  history: string
}

export type LongCharacterGroup = {
  entries: LongCharacter[]
}

export type LongPlotVolume = {
  id: string
  name: string
  outline: string
  order: number
}

export type LongPlotArc = {
  id: string
  volume_id: string
  name: string
  timeline: string
  order: number
}

export type LongChapterCard = {
  id: string
  volume_id: string
  arc_id: string
  stage_id: LongStageId
  title: string
  outline: string
  world_constraints: string
  characters: string[]
  order: number
}

export type LongForeshadowing = {
  id: string
  name: string
  description: string
  content: string
  status: string
}

export type LongChapter = {
  title: string
  body: string
  character_state: string
  handoff: string
  committed: boolean
  committed_at: string
  commit_id: string
}

export type LongLedgerEntry = {
  id: string
  chapter_stage_id: string
  chapter_title: string
  content: string
  created_at: string
  commit_id?: string
}

export type LongLedgerUpdateEntry = {
  id?: string
  content?: string
  description?: string
  detail?: string
  state?: string
  note?: string
}

export type LongCharacterLedgerUpdate = {
  character_id?: string
  id?: string
  name?: string
  relationships?: string
  current_state?: string
  history?: string
  history_append?: string
}

export type LongForeshadowingLedgerUpdate = {
  foreshadowing_id?: string
  id?: string
  name?: string
  description?: string
  content?: string
  status?: string
}

export type LongLedgerUpdates = {
  timeline?: Array<string | LongLedgerUpdateEntry>
  faction_states?: Array<string | LongLedgerUpdateEntry>
  realm_states?: Array<string | LongLedgerUpdateEntry>
  foreshadowing_states?: Array<string | LongLedgerUpdateEntry>
  continuity_notes?: Array<string | LongLedgerUpdateEntry>
  character_updates?: LongCharacterLedgerUpdate[]
  foreshadowing_updates?: LongForeshadowingLedgerUpdate[]
}

export type LongWorkspace = {
  schema_version: number
  revision: number
  worldbuilding: {
    categories: LongWorldbuildingCategory[]
  }
  characters: Record<LongCharacterGroupId, LongCharacterGroup>
  plot: {
    book_line: string
    volumes: LongPlotVolume[]
    arcs: LongPlotArc[]
    chapter_cards: LongChapterCard[]
    foreshadowing: LongForeshadowing[]
  }
  chapters: Record<string, LongChapter>
  ledger: {
    committed_through: string
    timeline: LongLedgerEntry[]
    faction_states: LongLedgerEntry[]
    realm_states: LongLedgerEntry[]
    foreshadowing_states: LongLedgerEntry[]
    continuity_notes: LongLedgerEntry[]
  }
}

export const LONG_WORLD_CATEGORY_DEFAULTS = [
  { id: 'rules', name: '规则' },
  { id: 'factions', name: '势力' },
  { id: 'geography', name: '地理' },
  { id: 'history', name: '历史' },
  { id: 'terminology', name: '术语' },
  { id: 'realms', name: '境界' },
  { id: 'items', name: '物品' },
] as const

const LEGACY_WORLD_STAGE_BY_CATEGORY: Record<string, string> = {
  rules: 'worldbuilding.rules',
  factions: 'worldbuilding.factions',
  geography: 'worldbuilding.geography',
  history: 'worldbuilding.history',
  terminology: 'worldbuilding.terminology',
  realms: 'worldbuilding.realms',
  items: 'worldbuilding.items',
}

const CHARACTER_STAGE_BY_GROUP: Record<LongCharacterGroupId, string> = {
  protagonists: 'character_design.protagonists',
  major_supporting: 'character_design.major_supporting',
  minor_supporting: 'character_design.minor_supporting',
  passersby: 'character_design.passersby',
}

function record(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {}
}

function list(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : []
}

function stringValue(raw: unknown): string {
  return typeof raw === 'string' ? raw : raw == null ? '' : String(raw)
}

function numberValue(raw: unknown, fallback: number): number {
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback
}

function booleanValue(raw: unknown): boolean {
  return raw === true || raw === 1 || raw === '1' || raw === 'true'
}

const LEGACY_LONG_DRAFT_STAGE_RE =
  /^draft\.volume-(\d+)\.arc-(\d+)\.chapter-(\d+)$/

function parseLegacyLongDraftStageId(stageId: string) {
  const strict = parseLongDraftStageId(stageId)
  if (strict) return strict
  const match = LEGACY_LONG_DRAFT_STAGE_RE.exec(stageId)
  if (!match) return null
  return {
    volumeNumber: Number(match[1]),
    arcNumber: Number(match[2]),
    chapterNumber: Number(match[3]),
  }
}

function allocateNormalizedDraftStageId(
  parts: { volumeNumber: number; arcNumber: number; chapterNumber: number },
  used: Set<string>,
): LongStageId {
  let chapterNumber = Math.max(1, parts.chapterNumber)
  let stageId = buildLongDraftStageId(
    Math.max(1, parts.volumeNumber),
    Math.max(1, parts.arcNumber),
    chapterNumber,
  )
  while (used.has(stageId)) {
    chapterNumber += 1
    stageId = buildLongDraftStageId(
      Math.max(1, parts.volumeNumber),
      Math.max(1, parts.arcNumber),
      chapterNumber,
    )
  }
  return stageId
}

function uniqueId(raw: unknown, prefix: string, index: number, seen: Set<string>): string {
  let id = stringValue(raw).trim() || `${prefix}-${index + 1}`
  let suffix = 2
  const base = id
  while (seen.has(id)) {
    id = `${base}-${suffix}`
    suffix += 1
  }
  seen.add(id)
  return id
}

export function newLongWorkspaceId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid ? `${prefix}-${uuid}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** 世界观列表条目的 item_id：仅保留 8 位，旧版长 ID 仍可正常读取。 */
export function newLongWorkspaceItemId(): string {
  const uuid = globalThis.crypto?.randomUUID?.().replaceAll('-', '')
  if (uuid) return uuid.slice(0, 8)
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0')
}

export function longWorldbuildingStageId(categoryId: string): LongStageId {
  return `worldbuilding.${categoryId}`
}

export function longWorldbuildingCategoryId(stageId: string): string | null {
  return stageId.startsWith('worldbuilding.')
    ? stageId.slice('worldbuilding.'.length) || null
    : null
}

export function longCharacterGroupId(stageId: string): LongCharacterGroupId | null {
  const value = stageId.startsWith('character_design.')
    ? stageId.slice('character_design.'.length)
    : ''
  return LONG_CHARACTER_GROUPS.some((group) => group.id === value)
    ? (value as LongCharacterGroupId)
    : null
}

function emptyWorldCategory(id: string, name: string): LongWorldbuildingCategory {
  return {
    id,
    name,
    format: 'list',
    overview: '',
    items: [],
    text: '',
  }
}

export function defaultLongWorkspace(): LongWorkspace {
  const firstStageId = buildLongDraftStageId(1, 1, 1)
  return {
    schema_version: LONG_WORKSPACE_SCHEMA_VERSION,
    revision: 0,
    worldbuilding: {
      categories: LONG_WORLD_CATEGORY_DEFAULTS.map((category) =>
        emptyWorldCategory(category.id, category.name),
      ),
    },
    characters: {
      protagonists: { entries: [] },
      major_supporting: { entries: [] },
      minor_supporting: { entries: [] },
      passersby: { entries: [] },
    },
    plot: {
      book_line: '',
      volumes: [{ id: 'volume-1', name: longDraftVolumeLabel(1), outline: '', order: 1 }],
      arcs: [
        {
          id: 'arc-1-1',
          volume_id: 'volume-1',
          name: longDraftArcLabel(1),
          timeline: '',
          order: 1,
        },
      ],
      chapter_cards: [
        {
          id: 'chapter-card-1-1-1',
          volume_id: 'volume-1',
          arc_id: 'arc-1-1',
          stage_id: firstStageId,
          title: longDraftChapterLabel(1),
          outline: '',
          world_constraints: '',
          characters: [],
          order: 1,
        },
      ],
      foreshadowing: [],
    },
    chapters: {
      [firstStageId]: {
        title: longDraftChapterLabel(1),
        body: '',
        character_state: '',
        handoff: '',
        committed: false,
        committed_at: '',
        commit_id: '',
      },
    },
    ledger: {
      committed_through: '',
      timeline: [],
      faction_states: [],
      realm_states: [],
      foreshadowing_states: [],
      continuity_notes: [],
    },
  }
}

function normalizeWorldCategories(raw: unknown, fallback: LongWorldbuildingCategory[]) {
  const source = Array.isArray(raw) ? raw : fallback
  const seen = new Set<string>()
  return source.map((item, index) => {
    const value = record(item)
    const fallbackCategory = fallback[index]
    const id = uniqueId(value.id, 'world-category', index, seen)
    const itemSeen = new Set<string>()
    return {
      id,
      name: stringValue(value.name).trim() || fallbackCategory?.name || `未命名分类${index + 1}`,
      format: value.format === 'text' ? 'text' : 'list',
      overview: stringValue(value.overview),
      items: list(value.items).map((rawItem, itemIndex) => {
        const row = record(rawItem)
        return {
          id: uniqueId(row.id, `${id}-item`, itemIndex, itemSeen),
          name: stringValue(row.name).trim() || `未命名条目${itemIndex + 1}`,
          description: stringValue(row.description),
          detail: stringValue(row.detail || row.introduction),
        }
      }),
      text: stringValue(value.text),
    } satisfies LongWorldbuildingCategory
  })
}

function normalizeCharacters(raw: unknown): LongWorkspace['characters'] {
  const source = record(raw)
  const seen = new Set<string>()
  return Object.fromEntries(
    LONG_CHARACTER_GROUPS.map((group) => {
      const groupRaw = record(source[group.id])
      const rows = Array.isArray(source[group.id]) ? list(source[group.id]) : list(groupRaw.entries)
      return [
        group.id,
        {
          entries: rows.map((item, index) => {
            const value = record(item)
            return {
              id: uniqueId(value.id, `character-${group.id}`, index, seen),
              name: stringValue(value.name).trim() || `未命名人物${index + 1}`,
              core_profile: stringValue(value.core_profile),
              relationships: stringValue(value.relationships),
              current_state: stringValue(value.current_state),
              history: stringValue(value.history),
            }
          }),
        },
      ]
    }),
  ) as LongWorkspace['characters']
}

function normalizeLedgerEntries(raw: unknown, prefix: string): LongLedgerEntry[] {
  const seen = new Set<string>()
  return list(raw).flatMap((item, index) => {
    const source = typeof item === 'string' ? { content: item } : record(item)
    const content = stringValue(
      source.content || source.description || source.detail || source.state || source.note,
    ).trim()
    if (!content) return []
    return [{
      id: uniqueId(source.id, prefix, index, seen),
      chapter_stage_id: stringValue(source.chapter_stage_id),
      chapter_title: stringValue(source.chapter_title),
      content,
      created_at: stringValue(source.created_at),
      ...(source.commit_id ? { commit_id: stringValue(source.commit_id) } : {}),
    }]
  })
}

function migrateLegacyLongWorkspace(
  legacyStages?: Partial<Record<string, string>> | null,
): LongWorkspace {
  const workspace = defaultLongWorkspace()
  const stages = legacyStages ?? {}
  for (const category of workspace.worldbuilding.categories) {
    const body = stringValue(stages[LEGACY_WORLD_STAGE_BY_CATEGORY[category.id]])
    if (!body) continue
    category.format = 'text'
    category.text = body
  }
  for (const group of LONG_CHARACTER_GROUPS) {
    const body = stringValue(stages[CHARACTER_STAGE_BY_GROUP[group.id]])
    if (!body) continue
    workspace.characters[group.id].entries = [{
      id: `legacy-${group.id}`,
      name: '旧版人物资料',
      core_profile: body,
      relationships: '',
      current_state: '',
      history: '',
    }]
  }
  workspace.plot.book_line = stringValue(stages['plot_design.book_line'])
  workspace.plot.volumes[0]!.outline = stringValue(stages['plot_design.volumes'])
  workspace.plot.arcs[0]!.timeline = stringValue(stages['plot_design.story_arcs'])
  workspace.plot.chapter_cards[0]!.outline = stringValue(stages['plot_design.chapter_cards'])
  const legacyForeshadowing = stringValue(stages['plot_design.foreshadowing'])
  if (legacyForeshadowing) {
    workspace.plot.foreshadowing = [{
      id: 'legacy-foreshadowing',
      name: '旧版伏笔',
      description: '',
      content: legacyForeshadowing,
      status: 'open',
    }]
  }

  const knownStage = workspace.plot.chapter_cards[0]!.stage_id
  const dynamicDrafts = Object.entries(stages)
    .filter(([stageId, body]) =>
      parseLegacyLongDraftStageId(stageId)
      && (stringValue(body).length > 0 || stageId !== knownStage),
    )
    .sort(([a], [b]) => a.localeCompare(b))
  if (dynamicDrafts.length > 0) {
    workspace.plot.chapter_cards = []
    workspace.chapters = {}
    const usedStageIds = new Set(
      workspace.plot.chapter_cards.map((card) => card.stage_id),
    )
    for (const [sourceStageId, body] of dynamicDrafts) {
      const parts = parseLegacyLongDraftStageId(sourceStageId)!
      const volumeNumber = Math.max(1, parts.volumeNumber)
      const arcNumber = Math.max(1, parts.arcNumber)
      const chapterNumber = Math.max(1, parts.chapterNumber)
      const stageId = parseLongDraftStageId(sourceStageId)
        && !usedStageIds.has(sourceStageId)
        ? sourceStageId
        : allocateNormalizedDraftStageId(parts, usedStageIds)
      const volumeId = `volume-${volumeNumber}`
      const arcId = `arc-${volumeNumber}-${arcNumber}`
      if (!workspace.plot.volumes.some((row) => row.id === volumeId)) {
        workspace.plot.volumes.push({
          id: volumeId,
          name: `第${volumeNumber}卷`,
          outline: '',
          order: volumeNumber,
        })
      }
      if (!workspace.plot.arcs.some((row) => row.id === arcId)) {
        workspace.plot.arcs.push({
          id: arcId,
          volume_id: volumeId,
          name: `剧情弧${arcNumber}`,
          timeline: '',
          order: arcNumber,
        })
      }
      if (!workspace.plot.chapter_cards.some((row) => row.stage_id === stageId)) {
        workspace.plot.chapter_cards.push({
          id: `chapter-card-${volumeNumber}-${arcNumber}-${chapterNumber}`,
          volume_id: volumeId,
          arc_id: arcId,
          stage_id: stageId,
          title: `第${chapterNumber}章`,
          outline: '',
          world_constraints: '',
          characters: [],
          order: chapterNumber,
        })
      }
      usedStageIds.add(stageId)
      workspace.chapters[stageId] = {
        title: workspace.plot.chapter_cards.find((row) => row.stage_id === stageId)?.title ?? '',
        body: stringValue(body),
        character_state: '',
        handoff: '',
        committed: false,
        committed_at: '',
        commit_id: '',
      }
    }
  }
  return workspace
}

export function normalizeLongWorkspace(
  raw?: unknown,
  legacyStages?: Partial<Record<string, string>> | null,
): LongWorkspace {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return migrateLegacyLongWorkspace(legacyStages)
  }
  const source = record(raw)
  const fallback = defaultLongWorkspace()
  const worldSource = record(source.worldbuilding)
  const categories = normalizeWorldCategories(
    'categories' in worldSource ? worldSource.categories : undefined,
    fallback.worldbuilding.categories,
  )

  const plotRaw = record(source.plot)
  const volumeSeen = new Set<string>()
  const volumes = ('volumes' in plotRaw ? list(plotRaw.volumes) : fallback.plot.volumes).map(
    (item, index) => {
      const value = record(item)
      return {
        id: uniqueId(value.id, 'volume', index, volumeSeen),
        name: stringValue(value.name).trim() || `第${index + 1}卷`,
        outline: stringValue(value.outline),
        order: numberValue(value.order, index + 1),
      }
    },
  ).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  const volumeIds = new Set(volumes.map((item) => item.id))

  const arcSeen = new Set<string>()
  const arcs = ('arcs' in plotRaw ? list(plotRaw.arcs) : fallback.plot.arcs).flatMap(
    (item, index) => {
      const value = record(item)
      const volumeId = stringValue(value.volume_id)
      if (!volumeIds.has(volumeId)) return []
      return [{
        id: uniqueId(value.id, 'arc', index, arcSeen),
        volume_id: volumeId,
        name: stringValue(value.name).trim() || `剧情弧${index + 1}`,
        timeline: stringValue(value.timeline),
        order: numberValue(value.order, index + 1),
      }]
    },
  ).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  const chapterRaw = record(source.chapters)
  const rawCardRows = ('chapter_cards' in plotRaw
    ? [...list(plotRaw.chapter_cards)]
    : [...fallback.plot.chapter_cards])
  const knownCardStageIds = new Set(
    rawCardRows.map((item) => stringValue(record(item).stage_id)),
  )
  for (const sourceStageId of Object.keys(chapterRaw)) {
    if (knownCardStageIds.has(sourceStageId)) continue
    const parts = parseLegacyLongDraftStageId(sourceStageId)
    if (!parts) continue
    const volumeNumber = Math.max(1, parts.volumeNumber)
    const arcNumber = Math.max(1, parts.arcNumber)
    const chapterNumber = Math.max(1, parts.chapterNumber)
    const volumeId = `volume-${volumeNumber}`
    const arcId = `arc-${volumeNumber}-${arcNumber}`
    if (!volumeIds.has(volumeId)) {
      volumes.push({
        id: volumeId,
        name: `第${volumeNumber}卷`,
        outline: '',
        order: volumeNumber,
      })
      volumeIds.add(volumeId)
    }
    if (!arcs.some((arc) => arc.id === arcId)) {
      arcs.push({
        id: arcId,
        volume_id: volumeId,
        name: `剧情弧${arcNumber}`,
        timeline: '',
        order: arcNumber,
      })
    }
    rawCardRows.push({
      id: `chapter-card-${volumeNumber}-${arcNumber}-${chapterNumber}`,
      volume_id: volumeId,
      arc_id: arcId,
      stage_id: sourceStageId,
      title: `第${chapterNumber}章`,
      outline: '',
      world_constraints: '',
      characters: [],
      order: chapterNumber,
    })
    knownCardStageIds.add(sourceStageId)
  }
  volumes.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  arcs.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  const arcById = new Map(arcs.map((item) => [item.id, item]))

  const cardSeen = new Set<string>()
  const stageSeen = new Set<string>()
  const chapterSourceStageByNormalized = new Map<string, string>()
  const normalizedStageBySource = new Map<string, string>()
  const cards = rawCardRows.flatMap((item, index) => {
    const value = record(item)
    const arcId = stringValue(value.arc_id)
    const arc = arcById.get(arcId)
    if (!arc) return []
    const sourceStageId = stringValue(value.stage_id)
    let stageId = sourceStageId
    if (!parseLongDraftStageId(stageId) || stageSeen.has(stageId)) {
      const volume = volumes.find((row) => row.id === arc.volume_id)
      const siblings = arcs.filter((row) => row.volume_id === arc.volume_id)
      stageId = buildLongDraftStageId(
        Math.max(1, volume?.order ?? 1),
        Math.max(1, siblings.findIndex((row) => row.id === arc.id) + 1),
        index + 1,
      )
      while (stageSeen.has(stageId)) {
        stageId = buildLongDraftStageId(
          Math.max(1, volume?.order ?? 1),
          Math.max(1, siblings.findIndex((row) => row.id === arc.id) + 1),
          numberValue(value.order, index + 1) + stageSeen.size + 1,
        )
      }
    }
    stageSeen.add(stageId)
    chapterSourceStageByNormalized.set(
      stageId,
      Object.prototype.hasOwnProperty.call(chapterRaw, sourceStageId)
        ? sourceStageId
        : stageId,
    )
    if (sourceStageId && !normalizedStageBySource.has(sourceStageId)) {
      normalizedStageBySource.set(sourceStageId, stageId)
    }
    return [{
      id: uniqueId(value.id, 'chapter-card', index, cardSeen),
      volume_id: arc.volume_id,
      arc_id: arc.id,
      stage_id: stageId,
      title: stringValue(value.title).trim() || `第${index + 1}章`,
      outline: stringValue(value.outline),
      world_constraints: stringValue(value.world_constraints),
      characters: list(value.characters).map(stringValue).map((item) => item.trim()).filter(Boolean),
      order: numberValue(value.order, index + 1),
    }]
  }).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

  const chapters: Record<string, LongChapter> = {}
  for (const card of cards) {
    const sourceStageId = chapterSourceStageByNormalized.get(card.stage_id) ?? card.stage_id
    const value = record(chapterRaw[sourceStageId])
    chapters[card.stage_id] = {
      title: stringValue(value.title).trim() || card.title,
      body: stringValue(
        value.body !== undefined
          ? value.body
          : legacyStages?.[sourceStageId] ?? legacyStages?.[card.stage_id],
      ),
      character_state: stringValue(value.character_state),
      handoff: stringValue(value.handoff || value.handoff_notes),
      committed: booleanValue(value.committed),
      committed_at: stringValue(value.committed_at),
      commit_id: stringValue(value.commit_id),
    }
  }

  const foreshadowSeen = new Set<string>()
  const foreshadowing = list(plotRaw.foreshadowing).map((item, index) => {
    const value = record(item)
    return {
      id: uniqueId(value.id, 'foreshadowing', index, foreshadowSeen),
      name: stringValue(value.name).trim() || `未命名伏笔${index + 1}`,
      description: stringValue(value.description),
      content: stringValue(value.content),
      status: stringValue(value.status).trim() || 'open',
    }
  })
  const ledgerRaw = record(source.ledger)
  const rawCommittedThrough = stringValue(ledgerRaw.committed_through)
  const committedThrough = rawCommittedThrough in chapters
    ? rawCommittedThrough
    : normalizedStageBySource.get(rawCommittedThrough) ?? ''
  const ledgerRows = (rawRows: unknown, prefix: string) =>
    normalizeLedgerEntries(rawRows, prefix).map((row) => ({
      ...row,
      chapter_stage_id:
        normalizedStageBySource.get(row.chapter_stage_id) ?? row.chapter_stage_id,
    }))

  return {
    schema_version: LONG_WORKSPACE_SCHEMA_VERSION,
    revision: numberValue(source.revision, 0),
    worldbuilding: { categories },
    characters: normalizeCharacters(source.characters),
    plot: {
      book_line: stringValue(plotRaw.book_line),
      volumes,
      arcs,
      chapter_cards: cards,
      foreshadowing,
    },
    chapters,
    ledger: {
      committed_through: committedThrough,
      timeline: ledgerRows(ledgerRaw.timeline, 'timeline'),
      faction_states: ledgerRows(ledgerRaw.faction_states, 'faction-state'),
      realm_states: ledgerRows(ledgerRaw.realm_states, 'realm-state'),
      foreshadowing_states: ledgerRows(
        ledgerRaw.foreshadowing_states,
        'foreshadowing-state',
      ),
      continuity_notes: ledgerRows(
        ledgerRaw.continuity_notes,
        'continuity-note',
      ),
    },
  }
}

function worldCategoryAsText(category: LongWorldbuildingCategory): string {
  if (category.format === 'text') return category.text
  const sections = category.items.map((item) => [
    `## ${item.name || '未命名条目'}`,
    item.description ? `描述：${item.description}` : '',
    item.detail,
  ].filter(Boolean).join('\n\n'))
  return [
    `# ${category.name}`,
    category.overview ? `## 所有${category.name}列表概述\n\n${category.overview}` : '',
    ...sections,
  ].filter(Boolean).join('\n\n')
}

function characterGroupAsText(group: LongCharacterGroup): string {
  return group.entries.map((item) => [
    `# ${item.name}`,
    item.core_profile ? `## 核心人设\n${item.core_profile}` : '',
    item.relationships ? `## 人物关系\n${item.relationships}` : '',
    item.current_state ? `## 当前状态\n${item.current_state}` : '',
    item.history ? `## 历史状态变化\n${item.history}` : '',
  ].filter(Boolean).join('\n\n')).join('\n\n')
}

function ledgerAsText(entries: LongLedgerEntry[]): string {
  return entries.map((entry) => [
    `## ${entry.chapter_title || entry.chapter_stage_id || '未标记章节'}`,
    entry.content,
  ].filter(Boolean).join('\n\n')).join('\n\n')
}

export function longWorkspaceToFlatStages(
  workspace: LongWorkspace,
  previous?: Partial<Record<string, string>> | null,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(previous ?? {})) {
    out[key] = String(value ?? '')
  }
  for (const key of Object.keys(out)) {
    if (
      key.startsWith('worldbuilding.') ||
      key.startsWith('character_design.') ||
      key.startsWith('plot_design.') ||
      key.startsWith('draft.') ||
      key.startsWith('continuity_ledger.')
    ) {
      delete out[key]
    }
  }
  for (const category of workspace.worldbuilding.categories) {
    out[longWorldbuildingStageId(category.id)] = worldCategoryAsText(category)
  }
  for (const group of LONG_CHARACTER_GROUPS) {
    out[CHARACTER_STAGE_BY_GROUP[group.id]] = characterGroupAsText(
      workspace.characters[group.id],
    )
  }
  out['plot_design.book_line'] = workspace.plot.book_line
  out['plot_design.volumes'] = workspace.plot.volumes.map((volume) =>
    [`# ${volume.name}`, volume.outline].filter(Boolean).join('\n\n'),
  ).join('\n\n')
  out['plot_design.story_arcs'] = orderedLongVolumes(workspace).flatMap((volume) =>
    orderedLongArcs(workspace, volume.id).map((arc) =>
      [`# ${volume.name} / ${arc.name}`, arc.timeline].filter(Boolean).join('\n\n'),
    ),
  ).join('\n\n')
  out['plot_design.chapter_cards'] = orderedLongChapterCards(workspace).map((card) => [
    `# ${card.title}`,
    card.outline,
    card.world_constraints ? `## 世界观强约束\n${card.world_constraints}` : '',
    card.characters.length ? `## 出场人物\n${card.characters.join('、')}` : '',
  ].filter(Boolean).join('\n\n')).join('\n\n')
  out['plot_design.foreshadowing'] = workspace.plot.foreshadowing.map((item) => [
    `# ${item.name}`,
    item.description,
    item.content,
    `状态：${item.status || 'open'}`,
  ].filter(Boolean).join('\n\n')).join('\n\n')
  for (const card of workspace.plot.chapter_cards) {
    out[card.stage_id] = workspace.chapters[card.stage_id]?.body ?? ''
  }
  out.draft = orderedLongVolumes(workspace).flatMap((volume) => [
    `# ${volume.name || '未命名卷'}`,
    ...orderedLongArcs(workspace, volume.id).flatMap((arc) => [
      `## ${arc.name || '未命名剧情弧'}`,
      ...orderedLongChapterCards(workspace, arc.id).map((card) => {
        const chapter = workspace.chapters[card.stage_id]
        const status = chapter?.committed
          ? '已落盘'
          : chapter?.body.trim()
            ? '已写未落盘'
            : '待写'
        return `- ${card.title || '未命名章节'}（${status}）`
      }),
    ]),
  ]).join('\n')
  out['continuity_ledger.timeline'] = ledgerAsText(workspace.ledger.timeline)
  out['continuity_ledger.character_states'] = LONG_CHARACTER_GROUPS.flatMap(
    (group) => workspace.characters[group.id].entries,
  ).map((item) => [
    `## ${item.name}`,
    item.current_state ? `### 当前状态\n${item.current_state}` : '',
    item.history ? `### 历史状态变化\n${item.history}` : '',
  ].filter(Boolean).join('\n\n')).join('\n\n')
  out['continuity_ledger.open_foreshadowing'] = ledgerAsText(
    workspace.ledger.foreshadowing_states,
  )
  out['continuity_ledger.faction_states'] = ledgerAsText(
    workspace.ledger.faction_states,
  )
  out['continuity_ledger.realm_states'] = ledgerAsText(
    workspace.ledger.realm_states,
  )
  out['continuity_ledger.continuity_notes'] = ledgerAsText(
    workspace.ledger.continuity_notes,
  )
  return out
}

/**
 * 把旧版文本编辑器或尚未升级的 AI 工具产生的 stages 变更回写到 v2。
 * 只处理与当前结构化投影不同的键，避免正常保存时反复迁移。
 */
export function syncLongWorkspaceFromFlatStages(
  rawWorkspace: LongWorkspace,
  stages?: Partial<Record<string, string>> | null,
): LongWorkspace {
  if (!stages) return rawWorkspace
  const workspace = normalizeLongWorkspace(rawWorkspace)
  const projected = longWorkspaceToFlatStages(workspace)
  let changed = false
  const next: LongWorkspace = structuredCloneSafe(workspace)

  for (const category of next.worldbuilding.categories) {
    const stageId = longWorldbuildingStageId(category.id)
    if (!(stageId in stages)) continue
    const body = stringValue(stages[stageId])
    if (body === (projected[stageId] ?? '')) continue
    category.format = 'text'
    category.text = body
    changed = true
  }

  for (const group of LONG_CHARACTER_GROUPS) {
    const stageId = CHARACTER_STAGE_BY_GROUP[group.id]
    if (!(stageId in stages)) continue
    const body = stringValue(stages[stageId])
    if (body === (projected[stageId] ?? '')) continue
    const entries = next.characters[group.id].entries
    let legacy = entries.find((entry) => entry.id === `legacy-${group.id}`)
    if (!legacy) {
      legacy = {
        id: `legacy-${group.id}`,
        name: '旧版 / AI 文本资料',
        core_profile: '',
        relationships: '',
        current_state: '',
        history: '',
      }
      entries.push(legacy)
    }
    legacy.core_profile = body
    changed = true
  }

  const syncSingleText = (
    stageId: string,
    apply: (body: string) => void,
  ) => {
    if (!(stageId in stages)) return
    const body = stringValue(stages[stageId])
    if (body === (projected[stageId] ?? '')) return
    apply(body)
    changed = true
  }
  syncSingleText('plot_design.book_line', (body) => {
    next.plot.book_line = body
  })
  syncSingleText('plot_design.volumes', (body) => {
    if (next.plot.volumes[0]) next.plot.volumes[0].outline = body
  })
  syncSingleText('plot_design.story_arcs', (body) => {
    if (next.plot.arcs[0]) next.plot.arcs[0].timeline = body
  })
  syncSingleText('plot_design.chapter_cards', (body) => {
    if (next.plot.chapter_cards[0]) next.plot.chapter_cards[0].outline = body
  })
  syncSingleText('plot_design.foreshadowing', (body) => {
    let legacy = next.plot.foreshadowing.find((item) => item.id === 'legacy-foreshadowing')
    if (!legacy) {
      legacy = {
        id: 'legacy-foreshadowing',
        name: '旧版 / AI 伏笔资料',
        description: '',
        content: '',
        status: 'open',
      }
      next.plot.foreshadowing.push(legacy)
    }
    legacy.content = body
  })

  for (const card of next.plot.chapter_cards) {
    if (!(card.stage_id in stages)) continue
    const body = stringValue(stages[card.stage_id])
    if (body === (projected[card.stage_id] ?? '')) continue
    const chapter = next.chapters[card.stage_id]
    if (chapter) chapter.body = body
    changed = true
  }

  return changed ? bumpLongWorkspace(next) : workspace
}

function structuredCloneSafe<T>(value: T): T {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value)) as T
}

/** 按章卡权威顺序生成 Book.content/导出兼容正文。 */
export function longWorkspaceCombinedDraft(workspace: LongWorkspace): string {
  return orderedLongChapterCards(workspace)
    .flatMap((card) => {
      const chapter = workspace.chapters[card.stage_id]
      const body = chapter?.body.trim() ?? ''
      if (!body) return []
      const title = chapter?.title.trim() || card.title.trim()
      return [title ? `${title}\n\n${body}` : body]
    })
    .join('\n\n')
}

export function orderedLongVolumes(workspace: LongWorkspace): LongPlotVolume[] {
  return [...workspace.plot.volumes].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

export function orderedLongArcs(workspace: LongWorkspace, volumeId?: string): LongPlotArc[] {
  return workspace.plot.arcs
    .filter((arc) => !volumeId || arc.volume_id === volumeId)
    .slice()
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

export function orderedLongChapterCards(
  workspace: LongWorkspace,
  arcId?: string,
): LongChapterCard[] {
  const volumeRank = new Map(orderedLongVolumes(workspace).map((volume, index) => [volume.id, index]))
  const arcRank = new Map<string, number>()
  for (const volume of orderedLongVolumes(workspace)) {
    orderedLongArcs(workspace, volume.id).forEach((arc, index) => arcRank.set(arc.id, index))
  }
  return workspace.plot.chapter_cards
    .filter((card) => !arcId || card.arc_id === arcId)
    .slice()
    .sort((a, b) =>
      (volumeRank.get(a.volume_id) ?? 1e9) - (volumeRank.get(b.volume_id) ?? 1e9) ||
      (arcRank.get(a.arc_id) ?? 1e9) - (arcRank.get(b.arc_id) ?? 1e9) ||
      a.order - b.order ||
      a.id.localeCompare(b.id),
    )
}

export function bumpLongWorkspace(workspace: LongWorkspace): LongWorkspace {
  return {
    ...workspace,
    schema_version: LONG_WORKSPACE_SCHEMA_VERSION,
    revision: workspace.revision + 1,
  }
}

function shortLongWorkspaceSummary(text: string, maxLength = 120): string {
  const clean = text.replace(/\s+/gu, ' ').trim()
  if (clean.length <= maxLength) return clean
  return `${clean.slice(0, maxLength)}…`
}

/**
 * 安全切换世界观分类格式：两套结构都保留，首次切换时为目标格式补一份可见内容。
 * 这样用户在格式管理弹窗或智能体工具中切换后，不会看到“内容消失”。
 */
export function setLongWorldbuildingFormat(
  workspace: LongWorkspace,
  categoryId: string,
  format: LongWorldbuildingFormat,
): LongWorkspace {
  const current = workspace.worldbuilding.categories.find(
    (category) => category.id === categoryId,
  )
  if (!current || current.format === format) return workspace

  const nextCategory: LongWorldbuildingCategory = {
    ...current,
    items: current.items.map((item) => ({ ...item })),
    format,
  }
  if (format === 'text' && !nextCategory.text.trim()) {
    nextCategory.text = worldCategoryAsText(current)
  }
  if (format === 'list' && nextCategory.items.length === 0) {
    const summary = shortLongWorkspaceSummary(nextCategory.text)
    nextCategory.overview = nextCategory.overview.trim()
      ? nextCategory.overview
      : summary || '原文本内容已转换为列表条目。'
    nextCategory.items = [{
      id: newLongWorkspaceItemId(),
      name: '原文本内容',
      description: summary,
      detail: nextCategory.text,
    }]
  }

  return bumpLongWorkspace({
    ...workspace,
    worldbuilding: {
      categories: workspace.worldbuilding.categories.map((category) =>
        category.id === categoryId ? nextCategory : category,
      ),
    },
  })
}

export function addLongWorldCategory(
  workspace: LongWorkspace,
  name = '新建分类',
): { workspace: LongWorkspace; categoryId: string } {
  const categoryId = newLongWorkspaceId('world-category')
  return {
    categoryId,
    workspace: bumpLongWorkspace({
      ...workspace,
      worldbuilding: {
        categories: [
          ...workspace.worldbuilding.categories,
          emptyWorldCategory(categoryId, name),
        ],
      },
    }),
  }
}

export function removeLongWorldCategory(
  workspace: LongWorkspace,
  categoryId: string,
): LongWorkspace {
  return bumpLongWorkspace({
    ...workspace,
    worldbuilding: {
      categories: workspace.worldbuilding.categories.filter((item) => item.id !== categoryId),
    },
  })
}

export function addLongVolume(
  workspace: LongWorkspace,
): { workspace: LongWorkspace; volumeId: string } {
  const maxOrder = Math.max(0, ...workspace.plot.volumes.map((row) => row.order))
  const order = maxOrder + 1
  const volumeId = newLongWorkspaceId('volume')
  return {
    volumeId,
    workspace: bumpLongWorkspace({
      ...workspace,
      plot: {
        ...workspace.plot,
        volumes: [
          ...workspace.plot.volumes,
          { id: volumeId, name: longDraftVolumeLabel(order), outline: '', order },
        ],
      },
    }),
  }
}

export function removeLongVolume(workspace: LongWorkspace, volumeId: string): LongWorkspace {
  const arcIds = new Set(
    workspace.plot.arcs.filter((arc) => arc.volume_id === volumeId).map((arc) => arc.id),
  )
  const removedCards = workspace.plot.chapter_cards.filter((card) => arcIds.has(card.arc_id))
  const removedStageIds = new Set(removedCards.map((card) => card.stage_id))
  const chapters = Object.fromEntries(
    Object.entries(workspace.chapters).filter(([stageId]) => !removedStageIds.has(stageId)),
  )
  return bumpLongWorkspace({
    ...workspace,
    plot: {
      ...workspace.plot,
      volumes: workspace.plot.volumes.filter((volume) => volume.id !== volumeId),
      arcs: workspace.plot.arcs.filter((arc) => arc.volume_id !== volumeId),
      chapter_cards: workspace.plot.chapter_cards.filter((card) => !arcIds.has(card.arc_id)),
    },
    chapters,
    ledger: {
      ...workspace.ledger,
      committed_through: removedStageIds.has(workspace.ledger.committed_through)
        ? ''
        : workspace.ledger.committed_through,
    },
  })
}

export function addLongArc(
  workspace: LongWorkspace,
  volumeId: string,
): { workspace: LongWorkspace; arcId: string } {
  const siblings = workspace.plot.arcs.filter((arc) => arc.volume_id === volumeId)
  const order = Math.max(0, ...siblings.map((row) => row.order)) + 1
  const arcId = newLongWorkspaceId('arc')
  return {
    arcId,
    workspace: bumpLongWorkspace({
      ...workspace,
      plot: {
        ...workspace.plot,
        arcs: [
          ...workspace.plot.arcs,
          { id: arcId, volume_id: volumeId, name: longDraftArcLabel(order), timeline: '', order },
        ],
      },
    }),
  }
}

export function removeLongArc(workspace: LongWorkspace, arcId: string): LongWorkspace {
  const removedStageIds = new Set(
    workspace.plot.chapter_cards
      .filter((card) => card.arc_id === arcId)
      .map((card) => card.stage_id),
  )
  return bumpLongWorkspace({
    ...workspace,
    plot: {
      ...workspace.plot,
      arcs: workspace.plot.arcs.filter((arc) => arc.id !== arcId),
      chapter_cards: workspace.plot.chapter_cards.filter((card) => card.arc_id !== arcId),
    },
    chapters: Object.fromEntries(
      Object.entries(workspace.chapters).filter(([stageId]) => !removedStageIds.has(stageId)),
    ),
    ledger: {
      ...workspace.ledger,
      committed_through: removedStageIds.has(workspace.ledger.committed_through)
        ? ''
        : workspace.ledger.committed_through,
    },
  })
}

export function addLongChapterCard(
  workspace: LongWorkspace,
  volumeId: string,
  arcId: string,
): { workspace: LongWorkspace; cardId: string; stageId: LongStageId } {
  const volume = workspace.plot.volumes.find((row) => row.id === volumeId)
  const arcs = orderedLongArcs(workspace, volumeId)
  const arc = arcs.find((row) => row.id === arcId)
  const siblings = workspace.plot.chapter_cards.filter((card) => card.arc_id === arcId)
  const order = Math.max(0, ...siblings.map((row) => row.order)) + 1
  let chapterNumber = order
  let stageId = buildLongDraftStageId(
    Math.max(1, volume?.order ?? 1),
    Math.max(1, arcs.findIndex((row) => row.id === arc?.id) + 1),
    Math.max(1, chapterNumber),
  )
  while (workspace.chapters[stageId]) {
    chapterNumber += 1
    stageId = buildLongDraftStageId(
      Math.max(1, volume?.order ?? 1),
      Math.max(1, arcs.findIndex((row) => row.id === arc?.id) + 1),
      chapterNumber,
    )
  }
  const cardId = newLongWorkspaceId('chapter-card')
  const title = longDraftChapterLabel(order)
  return {
    cardId,
    stageId,
    workspace: bumpLongWorkspace({
      ...workspace,
      plot: {
        ...workspace.plot,
        chapter_cards: [
          ...workspace.plot.chapter_cards,
          {
            id: cardId,
            volume_id: volumeId,
            arc_id: arcId,
            stage_id: stageId,
            title,
            outline: '',
            world_constraints: '',
            characters: [],
            order,
          },
        ],
      },
      chapters: {
        ...workspace.chapters,
        [stageId]: {
          title,
          body: '',
          character_state: '',
          handoff: '',
          committed: false,
          committed_at: '',
          commit_id: '',
        },
      },
    }),
  }
}

export function removeLongChapterCard(workspace: LongWorkspace, cardId: string): LongWorkspace {
  const card = workspace.plot.chapter_cards.find((row) => row.id === cardId)
  if (!card) return workspace
  const chapters = { ...workspace.chapters }
  delete chapters[card.stage_id]
  return bumpLongWorkspace({
    ...workspace,
    plot: {
      ...workspace.plot,
      chapter_cards: workspace.plot.chapter_cards.filter((row) => row.id !== cardId),
    },
    chapters,
    ledger: {
      ...workspace.ledger,
      committed_through:
        workspace.ledger.committed_through === card.stage_id
          ? ''
          : workspace.ledger.committed_through,
    },
  })
}

export type CommitLongChapterResult = {
  workspace: LongWorkspace
  ok: boolean
  error?: string
}

export function commitLongChapter(
  workspace: LongWorkspace,
  stageId: string,
  ledgerUpdates: LongLedgerUpdates = {},
): CommitLongChapterResult {
  const cards = orderedLongChapterCards(workspace)
  const index = cards.findIndex((card) => card.stage_id === stageId)
  const card = cards[index]
  const chapter = workspace.chapters[stageId]
  if (!card || !chapter) return { workspace, ok: false, error: '未找到当前章卡或正文。' }
  const previousUncommitted = cards.slice(0, index).find(
    (item) => !workspace.chapters[item.stage_id]?.committed,
  )
  if (previousUncommitted) {
    return {
      workspace,
      ok: false,
      error: `请先落盘前面的章节「${previousUncommitted.title}」。`,
    }
  }
  if (!chapter.body.trim() || !chapter.character_state.trim() || !chapter.handoff.trim()) {
    return {
      workspace,
      ok: false,
      error: '落盘前必须完整填写正文、人物状态和交接注意文档。',
    }
  }
  if (chapter.committed) return { workspace, ok: true }
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const commitId = newLongWorkspaceId('commit')
  const ledgerEntry = (
    prefix: string,
    content: string,
    id?: string,
  ): LongLedgerEntry => ({
    id: id?.trim() || newLongWorkspaceId(prefix),
    chapter_stage_id: stageId,
    chapter_title: card.title,
    content,
    created_at: now,
    commit_id: commitId,
  })
  const updateContent = (raw: string | LongLedgerUpdateEntry): string =>
    typeof raw === 'string'
      ? raw.trim()
      : stringValue(
          raw.content ??
            raw.description ??
            raw.detail ??
            raw.state ??
            raw.note,
        ).trim()
  const ledgerRows = (
    key: keyof Pick<
      LongLedgerUpdates,
      | 'timeline'
      | 'faction_states'
      | 'realm_states'
      | 'foreshadowing_states'
      | 'continuity_notes'
    >,
  ): LongLedgerEntry[] =>
    (ledgerUpdates[key] ?? []).flatMap((raw) => {
      const content = updateContent(raw)
      if (!content) return []
      const id = typeof raw === 'string' ? undefined : raw.id
      return [ledgerEntry(key, content, id)]
    })

  const timelineRows = ledgerRows('timeline')
  const characterUpdates = ledgerUpdates.character_updates ?? []
  const characters = Object.fromEntries(
    Object.entries(workspace.characters).map(([groupId, group]) => [
      groupId,
      {
        ...group,
        entries: group.entries.map((entry) => {
          const update = characterUpdates.find(
            (candidate) =>
              (candidate.character_id && candidate.character_id === entry.id) ||
              (candidate.id && candidate.id === entry.id) ||
              (candidate.name && candidate.name === entry.name),
          )
          if (!update) return entry
          const history =
            update.history !== undefined
              ? update.history
              : entry.history
          const historyAppend = update.history_append?.trim() ?? ''
          return {
            ...entry,
            relationships:
              update.relationships !== undefined
                ? update.relationships
                : entry.relationships,
            current_state:
              update.current_state !== undefined
                ? update.current_state
                : entry.current_state,
            history: historyAppend
              ? [history.trim(), historyAppend].filter(Boolean).join('\n\n')
              : history,
          }
        }),
      },
    ]),
  ) as LongWorkspace['characters']

  const foreshadowingUpdates = ledgerUpdates.foreshadowing_updates ?? []
  const foreshadowing = workspace.plot.foreshadowing.map((entry) => {
    const update = foreshadowingUpdates.find(
      (candidate) =>
        (candidate.foreshadowing_id && candidate.foreshadowing_id === entry.id) ||
        (candidate.id && candidate.id === entry.id) ||
        (candidate.name && candidate.name === entry.name),
    )
    if (!update) return entry
    return {
      ...entry,
      name: update.name !== undefined ? update.name : entry.name,
      description:
        update.description !== undefined
          ? update.description
          : entry.description,
      content: update.content !== undefined ? update.content : entry.content,
      status: update.status !== undefined ? update.status : entry.status,
    }
  })
  return {
    ok: true,
    workspace: bumpLongWorkspace({
      ...workspace,
      characters,
      plot: {
        ...workspace.plot,
        foreshadowing,
      },
      chapters: {
        ...workspace.chapters,
        [stageId]: {
          ...chapter,
          title: card.title,
          committed: true,
          committed_at: now,
          commit_id: commitId,
        },
      },
      ledger: {
        ...workspace.ledger,
        committed_through: stageId,
        timeline: [
          ...workspace.ledger.timeline,
          ...(timelineRows.length > 0
            ? timelineRows
            : [ledgerEntry('timeline', `《${card.title}》已完成落盘。`)]),
        ],
        faction_states: [
          ...workspace.ledger.faction_states,
          ...ledgerRows('faction_states'),
        ],
        realm_states: [
          ...workspace.ledger.realm_states,
          ...ledgerRows('realm_states'),
        ],
        foreshadowing_states: [
          ...workspace.ledger.foreshadowing_states,
          ...ledgerRows('foreshadowing_states'),
        ],
        continuity_notes: [
          ...workspace.ledger.continuity_notes,
          ...ledgerRows('continuity_notes'),
        ],
      },
    }),
  }
}
