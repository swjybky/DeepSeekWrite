import { Agent } from '@earendil-works/pi-agent-core'
import type { AgentTool, ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import { ApiKeyPromptDialog } from '@earendil-works/pi-web-ui'
import { Type } from 'typebox'

import {
  readWorkspaceAgentPromptTemplate,
  type Material,
  type MaterialKind,
  type MemoryEntry,
  type Skill,
  type SkillKind,
} from '../../bridge'
import {
  createWorkspaceModelApiKeyResolver,
  resolveWorkspaceModelApiKey,
} from '../../pi/resolveWorkspaceChatModel'
import { convertToLlmWithSkillAsUser } from '../../pi/skillMessageTransform'
import { createMemoryAwareConvertToLlm } from '../../pi/memoryMessageTransform'
import { createPiSessionId } from '../../pi/sessionId'
import { ensurePiAppStorage } from '../../pi/setupPiWorkspace'
import {
  getPreferredWorkspaceThinkingLevel,
  resolvePreferredWorkspaceChatModel,
} from '../../pi/workspaceChatPreferences'
import { createWorkspaceStreamFn } from '../../pi/workspaceStreamFn'
import { buildQueryLinkedMaterialEntriesTool } from '../shared/linkedMaterialQueryTools'
import { appendReadableLinkedMaterialsToPrompt } from '../shared/linkedMaterialPrompt'
import { defineTool, textBlock } from '../shared/piToolkit'
import {
  appendLoadableSkillsToPrompt,
  buildLoadSkillTool,
} from '../short/loadSkill'
import type { WorkspaceAgentReadAccessEntry } from '../shared/readAccess'
import {
  bumpLongWorkspace,
  longWorkspaceToFlatStages,
  orderedLongArcs,
  orderedLongChapterCards,
  orderedLongVolumes,
  type LongChapter,
  type LongChapterCard,
  type LongWorkspace,
} from './longWorkspace'
import {
  buildReadWorkspaceContentTool,
  buildSearchWorkspaceTextTool,
  type LongWorkspaceStageAgentContext,
} from './stageAgents'
import { EXPERT_SECTION_WRITER_AGENT_ID } from './stageReadAccess'
import { buildLongStructuredQueryTools } from './structuredQueryTools'

export type LongWorkspaceUpdater = (
  updater: (workspace: LongWorkspace) => LongWorkspace,
) => void

export type LongChapterWriterCallbacks = {
  onChapterStart?: (info: {
    agent: Agent
    stageId: string
    title: string
    index: number
    count: number
  }) => void | Promise<void>
  onRunFinish?: (info: { aborted: boolean }) => void | Promise<void>
}

export type RunLongChapterWriterOptions = {
  bookId: string
  bookTitle: string
  bookGenre: string
  stageIds: string[]
  getWorkspace: () => LongWorkspace
  updateWorkspace: LongWorkspaceUpdater
  linkedMaterial?: Material | null
  linkedMaterialsByKind?: Partial<Record<MaterialKind, Material[]>>
  linkedSkill?: Skill | null
  linkedSkillsByKind?: Partial<Record<SkillKind, Skill[]>>
  bookMemories?: MemoryEntry[]
  userMemories?: MemoryEntry[]
  readAccess: WorkspaceAgentReadAccessEntry
  userWritingPrompt?: string
  model?: Model<Api>
  thinkingLevel?: ThinkingLevel
  signal?: AbortSignal
  callbacks?: LongChapterWriterCallbacks
  onError?: (message: string) => void
}

function chapterContext(
  workspace: LongWorkspace,
  stageId: string,
): {
  card: LongChapterCard
  chapter: LongChapter
  volumeName: string
  arcName: string
  arcTimeline: string
  previousHandoff: string
  previousCharacterState: string
} | null {
  const cards = orderedLongChapterCards(workspace)
  const cardIndex = cards.findIndex((item) => item.stage_id === stageId)
  const card = cards[cardIndex]
  const chapter = workspace.chapters[stageId]
  if (!card || !chapter) return null
  const volume = workspace.plot.volumes.find((item) => item.id === card.volume_id)
  const arc = workspace.plot.arcs.find((item) => item.id === card.arc_id)
  const previousCard = cardIndex > 0 ? cards[cardIndex - 1] : undefined
  return {
    card,
    chapter,
    volumeName: volume?.name || '未命名卷',
    arcName: arc?.name || '未命名剧情弧',
    arcTimeline: arc?.timeline || '',
    previousHandoff: previousCard
      ? workspace.chapters[previousCard.stage_id]?.handoff ?? ''
      : '',
    previousCharacterState: previousCard
      ? workspace.chapters[previousCard.stage_id]?.character_state ?? ''
      : '',
  }
}

function buildChapterContextText(
  workspace: LongWorkspace,
  stageId: string,
): string {
  const context = chapterContext(workspace, stageId)
  if (!context) return '当前章节没有章卡，禁止开始写作。'
  const { card, chapter } = context
  const namedCharacters = new Set(card.characters)
  const characterRows = Object.values(workspace.characters)
    .flatMap((group) => group.entries)
    .filter(
      (character) =>
        namedCharacters.size === 0 ||
        namedCharacters.has(character.id) ||
        namedCharacters.has(character.name),
    )
    .map((character) =>
      [
        `### ${character.name}`,
        character.core_profile ? `核心人设：${character.core_profile}` : '',
        character.relationships ? `人物关系：${character.relationships}` : '',
        character.current_state ? `当前状态：${character.current_state}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )

  return [
    `# 单章写作任务：${card.title}`,
    `所属结构：${context.volumeName} / ${context.arcName}`,
    `章节 stage_id：${stageId}`,
    '',
    '## 章纲',
    card.outline || '（章纲为空，必须停止并报告，不得自行补写）',
    '',
    '## 世界观强约束',
    card.world_constraints || '（无额外强约束）',
    '',
    '## 剧情弧时间线安排',
    context.arcTimeline || '（暂无）',
    '',
    '## 出场人物档案',
    characterRows.join('\n\n') || '（章卡未指定出场人物）',
    '',
    '## 上一章交接注意',
    context.previousHandoff || '（这是首章或上一章暂无交接）',
    '',
    '## 上一章结束人物状态',
    context.previousCharacterState || '（这是首章或上一章暂无人物状态）',
    '',
    '## 当前已有三个区块',
    `正文：${chapter.body.trim() ? '已有内容；除非用户要求重写，否则在此基础上继续' : '空'}`,
    `人物状态：${chapter.character_state.trim() ? '已有内容' : '空'}`,
    `交接注意：${chapter.handoff.trim() ? '已有内容' : '空'}`,
  ].join('\n')
}

function updateChapterField(
  options: RunLongChapterWriterOptions,
  stageId: string,
  field: 'body' | 'character_state' | 'handoff',
  text: string,
): boolean {
  let changed = false
  options.updateWorkspace((workspace) => {
    const chapter = workspace.chapters[stageId]
    if (!chapter) return workspace
    changed = true
    return bumpLongWorkspace({
      ...workspace,
      chapters: {
        ...workspace.chapters,
        [stageId]: {
          ...chapter,
          [field]: text,
          committed: false,
          committed_at: '',
          commit_id: '',
        },
      },
    })
  })
  return changed
}

function buildWriterTools(
  options: RunLongChapterWriterOptions,
  stageId: string,
  written: { body: boolean; characterState: boolean; handoff: boolean },
): AgentTool[] {
  const getFlatStages = () => longWorkspaceToFlatStages(options.getWorkspace())
  const stageCtx: LongWorkspaceStageAgentContext = {
    bookTitle: options.bookTitle,
    stageId,
    stageBody: getFlatStages()[stageId] ?? '',
    getCurrentStageBody: (target) => getFlatStages()[target] ?? '',
    allStages: getFlatStages(),
    longWorkspace: options.getWorkspace(),
    getLongWorkspace: options.getWorkspace,
    allowedWorkspaceStages: options.readAccess.workspace,
  }
  const tools: AgentTool[] = [
    buildReadWorkspaceContentTool(stageCtx),
    buildSearchWorkspaceTextTool(stageCtx),
    ...buildLongStructuredQueryTools(stageCtx),
    defineTool({
      name: 'read_current_chapter_card',
      label: '读取当前章卡与写作上下文',
      description:
        '读取正文管理智能体分配给你的当前单章章卡、强约束、出场人物、剧情弧时间线和上一章交接。',
      parameters: Type.Object({}),
      execute: async () => textBlock(buildChapterContextText(options.getWorkspace(), stageId)),
    }),
    defineTool({
      name: 'write_long_chapter_body',
      label: '写入长篇章节正文',
      description: '覆盖写入当前单章的“正文”区块。一次只写当前章节。',
      parameters: Type.Object({
        text: Type.String({ minLength: 1, description: '完整、干净、可直接保存的本章正文。' }),
      }),
      execute: async (_toolCallId, params) => {
        const text = String(params.text ?? '').trim()
        if (!text) return textBlock('未写入：正文为空。')
        if (!updateChapterField(options, stageId, 'body', text)) {
          return textBlock('未写入：当前章数据不存在。')
        }
        written.body = true
        return textBlock('已写入当前章“正文”区块。')
      },
    }),
    defineTool({
      name: 'write_long_chapter_character_state',
      label: '写入章末人物状态',
      description:
        '覆盖写入当前章的“人物状态”区块；记录章末地点、时间、心理、已知信息、物品、伤病、立场与关系变化。',
      parameters: Type.Object({
        text: Type.String({ minLength: 1, description: '本章结束时完整人物状态。' }),
      }),
      execute: async (_toolCallId, params) => {
        const text = String(params.text ?? '').trim()
        if (!text) return textBlock('未写入：人物状态为空。')
        if (!updateChapterField(options, stageId, 'character_state', text)) {
          return textBlock('未写入：当前章数据不存在。')
        }
        written.characterState = true
        return textBlock('已写入当前章“人物状态”区块。')
      },
    }),
    defineTool({
      name: 'write_long_chapter_handoff',
      label: '写入交接注意文档',
      description:
        '覆盖写入当前章的“交接注意文档”区块，供下一章承接场景、时间、视角、悬念和连续性。',
      parameters: Type.Object({
        text: Type.String({ minLength: 1, description: '面向下一章的完整交接注意文档。' }),
      }),
      execute: async (_toolCallId, params) => {
        const text = String(params.text ?? '').trim()
        if (!text) return textBlock('未写入：交接注意文档为空。')
        if (!updateChapterField(options, stageId, 'handoff', text)) {
          return textBlock('未写入：当前章数据不存在。')
        }
        written.handoff = true
        return textBlock('已写入当前章“交接注意文档”区块。')
      },
    }),
  ]

  if (options.readAccess.material.length > 0) {
    tools.splice(
      2,
      0,
      buildQueryLinkedMaterialEntriesTool(
        {
          linkedMaterial: options.linkedMaterial,
          linkedMaterialsByKind: options.linkedMaterialsByKind,
        },
        options.readAccess.material as MaterialKind[],
      ),
    )
  }
  tools.splice(
    options.readAccess.material.length > 0 ? 3 : 2,
    0,
    buildLoadSkillTool({
      linkedSkill: options.linkedSkill,
      linkedSkillsByKind: options.linkedSkillsByKind,
      allowedSkillKinds: options.readAccess.skill as SkillKind[] | undefined,
      currentStageId: EXPERT_SECTION_WRITER_AGENT_ID,
    }),
  )
  return tools
}

async function ensureModelApiKey(model: Model<Api>): Promise<boolean> {
  const existing = await resolveWorkspaceModelApiKey(model)
  if (existing) return true
  if (!(await ApiKeyPromptDialog.prompt(model.provider))) return false
  return Boolean(await resolveWorkspaceModelApiKey(model, model.provider))
}

function normalizeTargetStageIds(options: RunLongChapterWriterOptions): string[] {
  const requested = new Set(options.stageIds.map((item) => item.trim()).filter(Boolean))
  const workspace = options.getWorkspace()
  return orderedLongChapterCards(workspace)
    .map((card) => card.stage_id)
    .filter(
      (stageId) =>
        requested.has(stageId) && !workspace.chapters[stageId]?.committed,
    )
}

export function chapterStageIdsForWritingScope(
  workspace: LongWorkspace,
  input: {
    scope: 'chapter' | 'arc' | 'volume'
    chapterStageId?: string
    arcId?: string
    volumeId?: string
  },
): string[] {
  if (input.scope === 'chapter') {
    return orderedLongChapterCards(workspace)
      .filter((card) => card.stage_id === input.chapterStageId)
      .map((card) => card.stage_id)
  }
  if (input.scope === 'arc') {
    return orderedLongChapterCards(workspace, input.arcId).map((card) => card.stage_id)
  }
  const arcIds = new Set(
    orderedLongArcs(workspace, input.volumeId).map((arc) => arc.id),
  )
  return orderedLongChapterCards(workspace)
    .filter((card) => arcIds.has(card.arc_id))
    .map((card) => card.stage_id)
}

export async function runLongChapterWriter(
  options: RunLongChapterWriterOptions,
): Promise<boolean> {
  let aborted = false
  try {
    await ensurePiAppStorage()
    const model = options.model ?? (await resolvePreferredWorkspaceChatModel())
    if (!(await ensureModelApiKey(model))) {
      options.onError?.('长篇写手未启动：缺少当前模型 API Key。')
      return false
    }
    const stageIds = normalizeTargetStageIds(options)
    if (stageIds.length === 0) {
      options.onError?.('没有可写章节：请先在剧情阶段创建章卡。')
      return false
    }
    const rawTemplate = await readWorkspaceAgentPromptTemplate(
      EXPERT_SECTION_WRITER_AGENT_ID,
      'long',
    )
    const template = appendLoadableSkillsToPrompt(
      appendReadableLinkedMaterialsToPrompt(
        rawTemplate,
        options.linkedMaterialsByKind,
        options.readAccess.material as MaterialKind[],
      ),
      options.linkedSkill,
      EXPERT_SECTION_WRITER_AGENT_ID,
      options.linkedSkillsByKind,
      options.readAccess.skill as SkillKind[] | undefined,
    )
    let activeTitle = ''
    let activeStageId = ''
    let activeIndex = 0
    const runId = Date.now()

    for (const [index, stageId] of stageIds.entries()) {
      if (options.signal?.aborted) {
        aborted = true
        return false
      }
      const context = chapterContext(options.getWorkspace(), stageId)
      if (!context) {
        options.onError?.(`章节 ${stageId} 缺少章卡，已停止批次。`)
        return false
      }
      if (!context.card.outline.trim()) {
        options.onError?.(`「${context.card.title}」章卡的章纲为空，已停止批次。`)
        return false
      }
      activeTitle = context.card.title
      activeStageId = stageId
      activeIndex = index
      const written = { body: false, characterState: false, handoff: false }
      const tools = buildWriterTools(options, stageId, written)
      const systemPrompt = `${template.trim()}\n\n${buildChapterContextText(
        options.getWorkspace(),
        stageId,
      )}`
      let agent!: Agent
      agent = new Agent({
          sessionId: createPiSessionId(
            'long-chapter-writer',
            options.bookId,
            'shared',
            runId,
          ),
          convertToLlm: createMemoryAwareConvertToLlm(
            convertToLlmWithSkillAsUser,
            () => ({
              bookTitle: options.bookTitle,
              bookType: 'long',
              bookGenre: options.bookGenre,
              currentLocation: {
                kind: 'section',
                sectionTitle: activeTitle,
                sectionOrdinal: activeIndex + 1,
              },
              currentSectionId: activeStageId,
              bookMemories: options.bookMemories,
              userMemories: options.userMemories,
            }),
          ),
          getApiKey: createWorkspaceModelApiKeyResolver(
            () => agent?.state.model ?? model,
          ),
          streamFn: createWorkspaceStreamFn(),
          toolExecution: 'sequential',
          initialState: {
            systemPrompt,
            model,
            thinkingLevel:
              options.thinkingLevel ?? getPreferredWorkspaceThinkingLevel(),
            messages: [],
            tools,
          },
        })
      const abortAgent = () => agent.abort()
      options.signal?.addEventListener('abort', abortAgent, { once: true })
      try {
        await options.callbacks?.onChapterStart?.({
          agent,
          stageId,
          title: context.card.title,
          index,
          count: stageIds.length,
        })
        const extra = options.userWritingPrompt?.trim()
        await agent.prompt(
          [
            `请编写当前单章「${context.card.title}」。`,
            '必须依次调用 write_long_chapter_body、write_long_chapter_character_state、write_long_chapter_handoff 写回三个区块；不要只在聊天中输出正文。',
            extra ? `用户补充要求：${extra}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        )
        if (options.signal?.aborted) {
          aborted = true
          return false
        }
        if (!written.body || !written.characterState || !written.handoff) {
          await agent.prompt(
            [
              '上一轮没有完整写回三个区块。不要解释，立即补齐缺失工具调用：',
              written.body ? '- 正文已写回，不要重复。' : '- 调用 write_long_chapter_body。',
              written.characterState
                ? '- 人物状态已写回，不要重复。'
                : '- 调用 write_long_chapter_character_state。',
              written.handoff
                ? '- 交接注意已写回，不要重复。'
                : '- 调用 write_long_chapter_handoff。',
            ].join('\n'),
          )
        }
        const after = options.getWorkspace().chapters[stageId]
        if (
          !after?.body.trim() ||
          !after.character_state.trim() ||
          !after.handoff.trim()
        ) {
          options.onError?.(`「${context.card.title}」未完整写回三个区块，已停止批次。`)
          return false
        }
      } catch (error) {
        if (options.signal?.aborted) {
          aborted = true
          return false
        }
        options.onError?.(
          error instanceof Error
            ? `长篇写手失败：${error.message}`
            : '长篇写手失败。',
        )
        return false
      } finally {
        options.signal?.removeEventListener('abort', abortAgent)
      }
    }
    return true
  } catch (error) {
    if (options.signal?.aborted) {
      aborted = true
      return false
    }
    options.onError?.(
      error instanceof Error
        ? `长篇写手启动失败：${error.message}`
        : '长篇写手启动失败。',
    )
    return false
  } finally {
    try {
      await options.callbacks?.onRunFinish?.({
        aborted: aborted || Boolean(options.signal?.aborted),
      })
    } catch {
      /* 展示清理失败不影响正文数据 */
    }
  }
}

export function describeLongWritingTargets(workspace: LongWorkspace): string {
  const rows: string[] = []
  for (const volume of orderedLongVolumes(workspace)) {
    rows.push(`- ${volume.name}（volume_id=${volume.id}）`)
    for (const arc of orderedLongArcs(workspace, volume.id)) {
      rows.push(`  - ${arc.name}（arc_id=${arc.id}）`)
      for (const card of orderedLongChapterCards(workspace, arc.id)) {
        const chapter = workspace.chapters[card.stage_id]
        rows.push(
          `    - ${card.title}（chapter_stage_id=${card.stage_id}，${
            chapter?.committed ? '已落盘' : chapter?.body.trim() ? '已写未落盘' : '待写'
          }）`,
        )
      }
    }
  }
  return rows.join('\n') || '（剧情阶段尚未创建卷、剧情弧和章卡）'
}
