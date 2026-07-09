import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import type { Skill, SkillKind, SkillStageId } from '../../bridge'
import { SKILL_KIND_KEYS, SKILL_KIND_LABELS } from '../../bridge'
import { defineTool, textBlock } from '../shared/piToolkit'

export const LOADABLE_SKILL_STAGE_IDS = [
  'character_design',
  'plot_design',
  'outline',
  'draft',
  'expert_section_writer',
] as const satisfies readonly SkillStageId[]

const LOADABLE_SKILL_STAGE_LABELS: Record<SkillStageId, string> = {
  character_design: '人物技能',
  plot_design: '剧情技能',
  outline: '大纲技能',
  draft: '正文专家编写技能',
  expert_section_writer: '分节写手技能',
}

export type LoadableSkill = {
  id: string
  libraryId: string
  libraryTitle: string
  skillKind: SkillKind
  stageId: SkillStageId
  name: string
  description: string
  body: string
}

const FRONT_MATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

function isLoadableSkillStageId(raw: string): raw is SkillStageId {
  return (LOADABLE_SKILL_STAGE_IDS as readonly string[]).includes(raw)
}

function resolveLoadableSkillStageId(raw: string): SkillStageId | null {
  if (raw === 'expert_draft_coordinator') return 'draft'
  if (raw === 'intro_design' || raw === 'plot_refine') return 'plot_design'
  if (isLoadableSkillStageId(raw)) return raw
  return null
}

function matchingSkillKindForStage(stageId: SkillStageId): SkillKind | null {
  if (stageId === 'plot_design' || stageId === 'outline') return 'plot'
  if (stageId === 'draft' || stageId === 'expert_section_writer') return 'style'
  return null
}

function skillKindsForStage(stageId: SkillStageId): SkillKind[] {
  const kinds: SkillKind[] = ['general']
  const matched = matchingSkillKindForStage(stageId)
  if (matched) kinds.push(matched)
  kinds.push('other')
  return [...new Set(kinds)]
}

function hasLinkedSkillsByKind(
  linkedSkillsByKind?: Partial<Record<SkillKind, Skill[]>>,
): boolean {
  return Boolean(
    linkedSkillsByKind &&
      SKILL_KIND_KEYS.some((kind) => (linkedSkillsByKind[kind]?.length ?? 0) > 0),
  )
}

function linkedSkillsForStage(
  linkedSkill: Skill | null | undefined,
  stageId: SkillStageId,
  linkedSkillsByKind?: Partial<Record<SkillKind, Skill[]>>,
): Skill[] {
  if (hasLinkedSkillsByKind(linkedSkillsByKind)) {
    const byId = new Map<string, Skill>()
    for (const kind of skillKindsForStage(stageId)) {
      for (const skill of linkedSkillsByKind?.[kind] ?? []) {
        if (skill?.id) byId.set(skill.id, skill)
      }
    }
    return [...byId.values()]
  }
  return linkedSkill ? [linkedSkill] : []
}

function cleanFrontMatterValue(raw: string): string {
  const value = raw.trim()
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1).trim()
    }
  }
  return value
}

export function parseSkillFrontMatter(
  body: string,
): { name: string; description: string } | null {
  const text = body.replace(/^\uFEFF/, '')
  const match = FRONT_MATTER_RE.exec(text)
  if (!match) return null

  const fields: Partial<Record<'name' | 'description', string>> = {}
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const row = /^\s*(name|description)\s*:\s*(.*?)\s*$/.exec(line)
    if (!row) continue
    const key = row[1]
    if (key !== 'name' && key !== 'description') continue
    fields[key] = cleanFrontMatterValue(row[2] ?? '')
  }

  const name = fields.name?.trim() ?? ''
  const description = fields.description?.trim() ?? ''
  if (!name || !description) return null
  return { name, description }
}

export function getLoadableSkillsForStage(
  linkedSkill: Skill | null | undefined,
  stageId: string,
  linkedSkillsByKind?: Partial<Record<SkillKind, Skill[]>>,
): LoadableSkill[] {
  const effectiveStageId = resolveLoadableSkillStageId(stageId)
  if (!effectiveStageId) return []
  return linkedSkillsForStage(
    linkedSkill,
    effectiveStageId,
    linkedSkillsByKind,
  ).flatMap((skill) => {
    const entries = skill.stages?.[effectiveStageId] ?? []
    return entries.flatMap((entry) => {
      const body = String(entry.body ?? '')
      const meta = parseSkillFrontMatter(body)
      if (!meta) return []
      return [
        {
          id: entry.id,
          libraryId: skill.id,
          libraryTitle: skill.title || '未命名技能库',
          skillKind: skill.skill_kind ?? 'general',
          stageId: effectiveStageId,
          name: meta.name,
          description: meta.description,
          body,
        },
      ]
    })
  })
}

function markdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()
}

function stageLabel(stageId: string): string {
  const effectiveStageId = resolveLoadableSkillStageId(stageId)
  return effectiveStageId
    ? LOADABLE_SKILL_STAGE_LABELS[effectiveStageId]
    : stageId
}

export function appendLoadableSkillsToPrompt(
  prompt: string,
  linkedSkill: Skill | null | undefined,
  stageId: string,
  linkedSkillsByKind?: Partial<Record<SkillKind, Skill[]>>,
): string {
  const effectiveStageId = resolveLoadableSkillStageId(stageId)
  const skills = getLoadableSkillsForStage(
    linkedSkill,
    stageId,
    linkedSkillsByKind,
  )
  if (skills.length === 0) return prompt

  const rows = skills
    .map(
      (skill) =>
        `| ${markdownCell(skill.libraryTitle)} | ${markdownCell(SKILL_KIND_LABELS[skill.skillKind] ?? skill.skillKind)} | ${markdownCell(skill.name)} | ${markdownCell(skill.description)} |`,
    )
    .join('\n')

  return `${prompt.trimEnd()}

---

# 可加载技能
已绑定技能库分类：通用技能库 + 当前阶段匹配分类 + 其他技能库
当前阶段：${stageLabel(stageId)}（${effectiveStageId ?? stageId}）

如需使用下列技能，且本轮上下文中尚未出现「【已加载技能：技能名】」或「【已加载技能内容】」，必须调用工具 load_skill，并传入当前阶段 stage_id 与精确的 skill_name。
如果用户通过 / 技能快捷机制选择了技能，用户消息会包含上述标记并附带完整技能正文；这表示技能已经加载，本轮禁止再次调用 load_skill 加载同名技能，直接使用已加载正文回答或执行。
缺少 front matter 的技能不会出现在此列表中，也不能加载。跨技能库或同一阶段重名技能需重命名后才能加载。

| 技能库 | 分类 | 技能名 | 描述 |
|---|---|---|---|
${rows}`
}

export function buildLoadSkillTool(input: {
  linkedSkill?: Skill | null
  linkedSkillsByKind?: Partial<Record<SkillKind, Skill[]>>
  currentStageId: string
}): AgentTool {
  const effectiveStageId = resolveLoadableSkillStageId(input.currentStageId)
  return defineTool({
    name: 'load_skill',
    label: '加载技能',
    description:
      '加载当前书籍绑定技能库中指定阶段、指定技能名的完整技能内容。只允许加载当前智能体阶段的技能。仅当当前上下文尚未包含「【已加载技能：...】」或「【已加载技能内容】」时调用；如果用户已通过 / 技能快捷机制注入技能正文，禁止重复调用本工具，直接使用上下文中的技能内容。',
    parameters: Type.Object({
      stage_id: Type.String({
        description: `当前智能体阶段 ID，必须传 ${effectiveStageId ?? input.currentStageId}`,
      }),
      skill_name: Type.String({
        description: '系统提示词“可加载技能”列表中的技能名，必须精确匹配',
      }),
    }),
    execute: async (_toolCallId, params) => {
      const requestedStageId = String(params.stage_id ?? '').trim()
      const skillName = String(params.skill_name ?? '').trim()
      const currentStageId = effectiveStageId ?? input.currentStageId

      if (requestedStageId !== currentStageId) {
        return textBlock(
          `当前智能体只能加载「${stageLabel(currentStageId)}」（${currentStageId}）的技能，不能加载 ${requestedStageId || '空阶段'}。`,
        )
      }
      if (!skillName) {
        return textBlock('未加载：skill_name 不能为空。')
      }
      if (
        !input.linkedSkill &&
        !hasLinkedSkillsByKind(input.linkedSkillsByKind)
      ) {
        return textBlock('当前书籍尚未绑定技能库，无法加载技能。')
      }

      const skills = getLoadableSkillsForStage(
        input.linkedSkill,
        currentStageId,
        input.linkedSkillsByKind,
      )
      if (skills.length === 0) {
        return textBlock(
          `已绑定技能库，但「${stageLabel(currentStageId)}」暂无可加载技能。请确认技能正文开头包含 name 和 description front matter，并且技能库分类适用于当前阶段。`,
        )
      }

      const matches = skills.filter((skill) => skill.name === skillName)
      if (matches.length === 0) {
        const names = skills.map((skill) => `「${skill.name}」`).join('、')
        return textBlock(`未找到技能「${skillName}」。当前可加载：${names}。`)
      }
      if (matches.length > 1) {
        const sources = matches
          .map((skill) => `《${skill.libraryTitle}》/${SKILL_KIND_LABELS[skill.skillKind] ?? skill.skillKind}`)
          .join('、')
        return textBlock(
          `技能「${skillName}」在「${stageLabel(currentStageId)}」中出现 ${matches.length} 次：${sources}。请先在技能库中重命名，避免加载歧义。`,
        )
      }

      const skill = matches[0]!
      return textBlock(skill.body)
    },
  })
}
