import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import { Type } from 'typebox'

import type { MemoryEntry } from '../../bridge'
import { defineTool, textBlock } from '../shared/piToolkit'
import { waitForLongLedgerChatAgent } from './ledgerChatAgentRegistry'
import {
  orderedLongChapterCards,
  type LongCharacterLedgerUpdate,
  type LongForeshadowingLedgerUpdate,
  type LongLedgerUpdates,
  type LongWorkspace,
} from './longWorkspace'

export type LongLedgerCharacterUpdate = LongCharacterLedgerUpdate
export type LongLedgerForeshadowingUpdate = LongForeshadowingLedgerUpdate
export type { LongLedgerUpdates }

export type RunLongLedgerAgentOptions = {
  bookId: string
  bookTitle: string
  bookGenre: string
  stageId: string
  getWorkspace: () => LongWorkspace
  commitChapter: (updates: LongLedgerUpdates) => Promise<boolean>
  bookMemories?: MemoryEntry[]
  userMemories?: MemoryEntry[]
  model?: Model<Api>
  thinkingLevel?: ThinkingLevel
  signal?: AbortSignal
  onError?: (message: string) => void
}

export type LongChapterCommitPreflight = {
  ok: boolean
  error?: string
}

export function validateLongChapterCommit(
  workspace: LongWorkspace,
  stageId: string,
): LongChapterCommitPreflight {
  const cards = orderedLongChapterCards(workspace)
  const index = cards.findIndex((card) => card.stage_id === stageId)
  const card = cards[index]
  const chapter = workspace.chapters[stageId]
  if (!card || !chapter) {
    return { ok: false, error: '当前章节没有对应章卡，无法落盘。' }
  }
  if (chapter.committed) {
    return { ok: false, error: `「${card.title}」已经落盘，无需重复处理。` }
  }
  const previous = cards
    .slice(0, index)
    .find((item) => !workspace.chapters[item.stage_id]?.committed)
  if (previous) {
    return { ok: false, error: `请先落盘前面的章节「${previous.title}」。` }
  }
  const missing = [
    chapter.body.trim() ? '' : '正文',
    chapter.character_state.trim() ? '' : '人物状态',
    chapter.handoff.trim() ? '' : '交接注意文档',
  ].filter(Boolean)
  if (missing.length > 0) {
    return {
      ok: false,
      error: `本章缺少${missing.join('、')}，补齐三个区块后才能落盘。`,
    }
  }
  return { ok: true }
}

function buildLedgerContext(workspace: LongWorkspace, stageId: string): string {
  const card = workspace.plot.chapter_cards.find((item) => item.stage_id === stageId)
  const chapter = workspace.chapters[stageId]
  if (!card || !chapter) return '（当前章节或章卡不存在）'
  const characters = Object.values(workspace.characters)
    .flatMap((group) => group.entries)
    .map((character) =>
      [
        `- ${character.name}（character_id=${character.id}）`,
        character.relationships ? `  当前关系：${character.relationships}` : '',
        character.current_state ? `  当前状态：${character.current_state}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
  const foreshadowing = workspace.plot.foreshadowing.map(
    (item) =>
      `- ${item.name}（foreshadowing_id=${item.id}，status=${item.status || 'open'}）：${
        item.description || item.content || '暂无描述'
      }`,
  )
  return [
    `# 待落盘章节：${card.title}`,
    `chapter_stage_id=${stageId}`,
    '',
    '## 章卡',
    card.outline,
    card.world_constraints ? `世界观强约束：${card.world_constraints}` : '',
    card.characters.length ? `出场人物：${card.characters.join('、')}` : '',
    '',
    '## 正文',
    chapter.body,
    '',
    '## 章末人物状态（写手提交）',
    chapter.character_state,
    '',
    '## 交接注意文档',
    chapter.handoff,
    '',
    '## 人物阶段现有记录',
    characters.join('\n') || '（暂无人物）',
    '',
    '## 伏笔阶段现有记录',
    foreshadowing.join('\n') || '（暂无伏笔）',
  ]
    .filter((value) => value !== '')
    .join('\n')
}

const characterUpdateSchema = Type.Object({
  character_id: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  relationships: Type.Optional(Type.String()),
  current_state: Type.Optional(Type.String()),
  history: Type.Optional(Type.String()),
  history_append: Type.Optional(Type.String()),
})

const foreshadowingUpdateSchema = Type.Object({
  foreshadowing_id: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  content: Type.Optional(Type.String()),
  status: Type.Optional(Type.String()),
})

export async function runLongLedgerAgent(
  options: RunLongLedgerAgentOptions,
): Promise<boolean> {
  const preflight = validateLongChapterCommit(options.getWorkspace(), options.stageId)
  if (!preflight.ok) {
    options.onError?.(preflight.error ?? '当前章节无法落盘。')
    return false
  }
  // 状态账本各叶子节点各自拥有独立 ChatPanel。落盘过程统一显示在
  // “时间线”会话，不能按 bookId 随机取到最后挂载的隐藏叶子 Agent。
  const agent = await waitForLongLedgerChatAgent(
    options.bookId,
    'continuity_ledger.timeline',
  )
  if (!agent) {
    options.onError?.('状态账本智能体对话尚未就绪，本章未落盘。')
    return false
  }
  let committed = false
  const applyTool = defineTool({
    name: 'commit_long_chapter_state',
    label: '原子落盘并流转状态',
    description:
      '提交当前章节的结构化状态变化，并原子执行章节落盘。只能调用一次；后端会再次校验章卡、三个区块和前章顺序。',
    parameters: Type.Object({
      timeline: Type.Array(Type.String(), {
        description: '本章已经发生的章节时间线事实。',
      }),
      faction_states: Type.Array(Type.String(), {
        description: '本章造成的势力实时变化；没有则传空数组。',
      }),
      realm_states: Type.Array(Type.String(), {
        description: '本章造成的境界/修为实时变化；没有则传空数组。',
      }),
      foreshadowing_states: Type.Array(Type.String(), {
        description: '本章新增、推进、回收或仍待处理的伏笔状态。',
      }),
      continuity_notes: Type.Array(Type.String(), {
        description: '后续章节必须保持一致的事实和交接注意。',
      }),
      character_updates: Type.Array(characterUpdateSchema, {
        description:
          '按 character_id 或精确 name 定位人物，同步人物关系、当前状态，并用 history_append 追加历史变化。',
      }),
      foreshadowing_updates: Type.Array(foreshadowingUpdateSchema, {
        description:
          '按 foreshadowing_id 或精确 name 更新伏笔名称、描述、内容、状态。',
      }),
    }),
    execute: async (_toolCallId, params) => {
      if (committed) return textBlock('当前章节已经在本轮成功落盘，禁止重复提交。')
      const updates: LongLedgerUpdates = {
        timeline: (params.timeline ?? []).map(String),
        faction_states: (params.faction_states ?? []).map(String),
        realm_states: (params.realm_states ?? []).map(String),
        foreshadowing_states: (params.foreshadowing_states ?? []).map(String),
        continuity_notes: (params.continuity_notes ?? []).map(String),
        character_updates: params.character_updates ?? [],
        foreshadowing_updates: params.foreshadowing_updates ?? [],
      }
      try {
        committed = await options.commitChapter(updates)
        return textBlock(
          committed
            ? '章节、人物状态、伏笔和状态账本已原子落盘。'
            : '落盘失败：后端未确认提交。',
        )
      } catch (error) {
        return textBlock(
          `落盘失败：${error instanceof Error ? error.message : '未知错误'}`,
        )
      }
    },
  })

  const previousTools = agent.state.tools
  agent.state.tools = [
    ...previousTools.filter((tool) => tool.name !== applyTool.name),
    applyTool,
  ]
  const abortAgent = () => agent.abort()
  options.signal?.addEventListener('abort', abortAgent, { once: true })
  try {
    await agent.prompt(
      `请显式执行本章落盘。分析已经发生的事实，整理人物关系/当前状态/历史变化、时间线、势力、境界、伏笔和连续性更新，然后必须调用 commit_long_chapter_state 完成原子落盘。不要只给文字建议。\n\n${buildLedgerContext(options.getWorkspace(), options.stageId)}`,
    )
    if (!committed && !options.signal?.aborted) {
      await agent.prompt(
        '上一轮没有成功落盘。不要解释，立即调用 commit_long_chapter_state；没有变化的数组传空数组。',
      )
    }
    if (!committed && !options.signal?.aborted) {
      options.onError?.('状态账本智能体没有完成专用落盘工具调用，本章仍未落盘。')
    }
    return committed
  } catch (error) {
    if (!options.signal?.aborted) {
      options.onError?.(
        error instanceof Error
          ? `状态账本智能体运行失败：${error.message}`
          : '状态账本智能体运行失败。',
      )
    }
    return false
  } finally {
    agent.state.tools = previousTools
    options.signal?.removeEventListener('abort', abortAgent)
  }
}
