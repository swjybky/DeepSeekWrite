import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import type { Skill, SkillStageId } from '../../bridge'
import { defineTool, textBlock } from '../shared/piToolkit'

export const LOADABLE_SKILL_STAGE_IDS = [
  'character_design',
  'plot_design',
  'outline',
  'draft',
  'expert_section_writer',
] as const satisfies readonly SkillStageId[]

const LOADABLE_SKILL_STAGE_LABELS: Record<SkillStageId, string> = {
  character_design: '人物设计技能',
  plot_design: '剧情技能',
  outline: '大纲技能',
  draft: '正文专家编写技能',
  expert_section_writer: '分节写手技能',
}

export type LoadableSkill = {
  id: string
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
): LoadableSkill[] {
  const effectiveStageId = resolveLoadableSkillStageId(stageId)
  if (!linkedSkill || !effectiveStageId) return []
  const entries = linkedSkill.stages?.[effectiveStageId] ?? []
  return entries.flatMap((entry) => {
    const body = String(entry.body ?? '')
    const meta = parseSkillFrontMatter(body)
    if (!meta) return []
    return [
      {
        id: entry.id,
        stageId: effectiveStageId,
        name: meta.name,
        description: meta.description,
        body,
      },
    ]
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
): string {
  const effectiveStageId = resolveLoadableSkillStageId(stageId)
  const skills = getLoadableSkillsForStage(linkedSkill, stageId)
  if (!linkedSkill || skills.length === 0) return prompt

  const rows = skills
    .map((skill) => `| ${markdownCell(skill.name)} | ${markdownCell(skill.description)} |`)
    .join('\n')

  return `${prompt.trimEnd()}

---

# 可加载技能
已绑定技能库：《${linkedSkill.title || '未命名技能库'}》
当前阶段：${stageLabel(stageId)}（${effectiveStageId ?? stageId}）

如需使用下列技能，必须调用工具 load_skill，并传入当前阶段 stage_id 与精确的 skill_name。缺少 front matter 的技能不会出现在此列表中，也不能加载。同一阶段重名技能需重命名后才能加载。

| 技能名 | 描述 |
|---|---|
${rows}`
}

export function buildLoadSkillTool(input: {
  linkedSkill?: Skill | null
  currentStageId: string
}): AgentTool {
  const effectiveStageId = resolveLoadableSkillStageId(input.currentStageId)
  return defineTool({
    name: 'load_skill',
    label: '加载技能',
    description:
      '加载当前书籍绑定技能库中指定阶段、指定技能名的完整技能内容。只允许加载当前智能体阶段的技能。',
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
      if (!input.linkedSkill) {
        return textBlock('当前书籍尚未绑定技能库，无法加载技能。')
      }

      const skills = getLoadableSkillsForStage(input.linkedSkill, currentStageId)
      if (skills.length === 0) {
        return textBlock(
          `已绑定技能库《${input.linkedSkill.title || '未命名技能库'}》，但「${stageLabel(currentStageId)}」暂无可加载技能。请确认技能正文开头包含 name 和 description front matter。`,
        )
      }

      const matches = skills.filter((skill) => skill.name === skillName)
      if (matches.length === 0) {
        const names = skills.map((skill) => `「${skill.name}」`).join('、')
        return textBlock(`未找到技能「${skillName}」。当前可加载：${names}。`)
      }
      if (matches.length > 1) {
        return textBlock(
          `技能「${skillName}」在「${stageLabel(currentStageId)}」中出现 ${matches.length} 次。请先在技能库中重命名，避免加载歧义。`,
        )
      }

      const skill = matches[0]!
      return textBlock(skill.body)
    },
  })
}
