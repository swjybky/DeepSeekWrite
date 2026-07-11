import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import type { SkillManagerSkill } from '../../bridge'
import { defineTool, textBlock } from '../shared/piToolkit'

function markdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()
}

export function appendSkillManagerSkillsToPrompt(
  prompt: string,
  skills: readonly SkillManagerSkill[],
): string {
  if (skills.length === 0) return prompt
  const rows = skills
    .map(
      (skill) =>
        `| ${markdownCell(skill.name)} | ${markdownCell(skill.description)} |`,
    )
    .join('\n')
  return `${prompt.trimEnd()}

---

# 可加载的技能库管理技能

当用户请求与下列管理技能的描述匹配，并且本轮上下文尚未包含同名的「【已加载技能：技能名】」时，必须先调用 \`load_skill\`，传入精确的 \`skill_name\`，再依照加载的正文执行。
如果上下文已经出现同名已加载技能，禁止重复调用。管理技能只提供工作方法；创建、更新和保存技能条目仍必须调用当前技能库的业务工具，工具成功前不得声称已经写入。

| 技能名 | 适用场景 |
|---|---|
${rows}`
}

export function buildSkillManagerLoadSkillTool(
  skills: readonly SkillManagerSkill[],
): AgentTool {
  return defineTool({
    name: 'load_skill',
    label: '加载管理技能',
    description:
      '按技能名加载技能库管理方法的完整正文。仅在本轮上下文尚未包含同名「【已加载技能：...】」时调用。',
    parameters: Type.Object({
      skill_name: Type.String({
        description: '系统提示词“可加载的技能库管理技能”列表中的精确技能名',
      }),
    }),
    execute: async (_toolCallId, params) => {
      const name = String(params.skill_name ?? '').trim()
      if (!name) return textBlock('未加载：skill_name 不能为空。')
      if (skills.length === 0) return textBlock('当前没有可加载的技能库管理技能。')
      const matches = skills.filter((skill) => skill.name === name)
      if (matches.length === 0) {
        return textBlock(
          `未找到管理技能「${name}」。当前可加载：${skills
            .map((skill) => `「${skill.name}」`)
            .join('、')}。`,
        )
      }
      if (matches.length > 1) {
        return textBlock(`管理技能「${name}」存在重名，请先在技能库设置中修正。`)
      }
      const skill = matches[0]!
      return textBlock(`【已加载技能：${skill.name}】\n\n${skill.body}`)
    },
  })
}
