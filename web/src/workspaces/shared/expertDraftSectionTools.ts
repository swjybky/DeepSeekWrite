import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from 'typebox'

import type { ExpertDraft, ExpertDraftSection } from '../../bridge'
import { currentWordCountLine, defineTool, textBlock } from './piToolkit'
import {
  applyTextSpanReplacement,
  normalizeNewlines,
  resolveReplacementSpan,
} from './textReplaceMatch'

export type ExpertDraftSectionContentField = 'body' | 'character_state'

/** 优先读当前文本编辑框；读不到时由工具内部回退到 getDraft 已保存内容。 */
export type GetExpertDraftSectionContent = (
  sectionId: string,
  field: ExpertDraftSectionContentField,
) => string | undefined

export type ExpertDraftUpdater = (updater: (draft: ExpertDraft) => ExpertDraft) => void

const MAX_EXPERT_DRAFT_TEXT_REPLACE_CHARS = 2400

type ExpertDraftTextReplacement = {
  original_text: string
  new_text: string
}

function replaceExpertDraftText(input: {
  currentBody: string
  replacements: ExpertDraftTextReplacement[]
}): { next: string; count: number; flexibleCount: number } | { error: string } {
  if (input.replacements.length === 0) return { error: 'replacements 不能为空。' }

  let next = normalizeNewlines(input.currentBody)
  let flexibleCount = 0
  for (const [index, replacement] of input.replacements.entries()) {
    const itemName = `第 ${index + 1} 个片段`
    const originalText = normalizeNewlines(replacement.original_text)
    const newText = normalizeNewlines(replacement.new_text)
    if (!originalText.trim()) {
      return { error: `${itemName}的 original_text 不能为空。` }
    }
    if (originalText.length > MAX_EXPERT_DRAFT_TEXT_REPLACE_CHARS) {
      return {
        error:
          `${itemName}的 original_text 过长（${originalText.length} 字符）。请只传需要替换的小段原文。`,
      }
    }
    if (newText.length > MAX_EXPERT_DRAFT_TEXT_REPLACE_CHARS) {
      return {
        error:
          `${itemName}的 new_text 过长（${newText.length} 字符）。请拆成多个小段替换。`,
      }
    }

    const resolved = resolveReplacementSpan(next, originalText, itemName)
    if (resolved.kind === 'error') {
      return { error: resolved.message }
    }
    if (resolved.usedFlexibleMatch) {
      flexibleCount += 1
    }

    next = applyTextSpanReplacement(next, resolved.span, newText)
  }

  return { next, count: input.replacements.length, flexibleCount }
}

/** 将模型常见变体（section_1、section1）归一化为 section-1 等标准 id */
function canonicalizeSectionId(raw: string): string {
  const trimmed = String(raw ?? '').trim()
  const numbered = trimmed.match(/^section[_-]?(\d+)$/i)
  if (numbered) return `section-${numbered[1]}`
  return trimmed
}

function sectionIdMatchesExpected(raw: string, expectedSectionId: string): boolean {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return false
  if (trimmed === expectedSectionId) return true
  return canonicalizeSectionId(trimmed) === canonicalizeSectionId(expectedSectionId)
}

export function resolveExpertDraftSection(
  draft: ExpertDraft,
  rawSectionId: string,
): ExpertDraftSection | undefined {
  const trimmed = String(rawSectionId ?? '').trim()
  if (!trimmed) return undefined
  const direct = draft.sections.find((section) => section.id === trimmed)
  if (direct) return direct
  const canonical = canonicalizeSectionId(trimmed)
  return draft.sections.find(
    (section) =>
      section.id === canonical ||
      canonicalizeSectionId(section.id) === canonical,
  )
}

function readExpertDraftSectionField(
  sectionId: string,
  field: ExpertDraftSectionContentField,
  getDraft: () => ExpertDraft,
  getRendered?: GetExpertDraftSectionContent,
): { text: string; source: 'editor' | 'saved' } {
  const section = resolveExpertDraftSection(getDraft(), sectionId)
  if (!section) return { text: '', source: 'saved' }
  const resolvedId = section.id

  try {
    const rendered = getRendered?.(resolvedId, field)
    if (rendered !== undefined) {
      return { text: rendered, source: 'editor' }
    }
  } catch {
    /* fallback below */
  }

  const draft = getDraft()
  if (field === 'body') {
    const saved =
      draft.sections.find((item) => item.id === resolvedId)?.body ?? ''
    return { text: saved, source: 'saved' }
  }
  const saved =
    draft.character_states.find((item) => item.section_id === resolvedId)
      ?.body ?? ''
  return { text: saved, source: 'saved' }
}

function replaceSectionBody(
  draft: ExpertDraft,
  sectionId: string,
  body: string,
): ExpertDraft {
  return {
    ...draft,
    sections: draft.sections.map((section) =>
      section.id === sectionId ? { ...section, body } : section,
    ),
  }
}

function replaceSectionTitleAndBody(
  draft: ExpertDraft,
  sectionId: string,
  title: string,
  body: string,
): ExpertDraft {
  const previousSection = draft.sections.find(
    (section) => section.id === sectionId,
  )
  const previousDefaultStateTitle = previousSection
    ? `${previousSection.title.trim() || '小节'}人物状态`
    : ''
  const nextDefaultStateTitle = `${title.trim() || '小节'}人物状态`
  return {
    ...draft,
    sections: draft.sections.map((section) =>
      section.id === sectionId ? { ...section, title, body } : section,
    ),
    character_states: draft.character_states.map((state) =>
      state.section_id === sectionId &&
      state.title === previousDefaultStateTitle
        ? { ...state, title: nextDefaultStateTitle }
        : state,
    ),
  }
}

function replaceCharacterState(
  draft: ExpertDraft,
  sectionId: string,
  body: string,
): ExpertDraft {
  const title =
    draft.character_states.find((s) => s.section_id === sectionId)?.title ||
    `${draft.sections.find((s) => s.id === sectionId)?.title || '小节'}人物状态`
  const exists = draft.character_states.some((s) => s.section_id === sectionId)
  return {
    ...draft,
    character_states: exists
      ? draft.character_states.map((state) =>
          state.section_id === sectionId ? { ...state, body } : state,
        )
      : [...draft.character_states, { section_id: sectionId, title, body }],
  }
}

type ExpertDraftSectionEditScope = 'section_writer' | 'coordinator'

export type ExpertDraftSectionEditToolsInput = {
  getDraft: () => ExpertDraft
  getRenderedSectionContent?: GetExpertDraftSectionContent
  updateDraft: ExpertDraftUpdater
  /** 分节写手模式下锁定为当前小节；总控模式可修改任意小节 */
  scope: ExpertDraftSectionEditScope
  restrictToSectionId?: string
  restrictToSectionTitle?: string
  onSectionBodyWritten?: (text: string) => void
  onCharacterStateWritten?: (text: string) => void
  /** 写入后同步小节 textarea DOM，避免连续工具调用读到旧值 */
  syncExpertDraftSectionField?: (
    sectionId: string,
    field: ExpertDraftSectionContentField,
    body: string,
  ) => void
  /** 总控智能体只需局部替换，整段写入由 create_* 工具负责 */
  includeWriteTools?: boolean
}

function resolveEditableSection(
  input: ExpertDraftSectionEditToolsInput,
  rawSectionId: string,
  action: '替换' | '写入',
): { section: ExpertDraftSection } | { error: string } {
  const { restrictToSectionId, restrictToSectionTitle, getDraft } = input
  if (input.scope === 'section_writer' && restrictToSectionId) {
    if (!sectionIdMatchesExpected(rawSectionId, restrictToSectionId)) {
      return {
        error: `未${action}：当前只能修改 ${restrictToSectionTitle}（${restrictToSectionId}）。`,
      }
    }
    const section = resolveExpertDraftSection(getDraft(), restrictToSectionId)
    if (!section) {
      return { error: `未找到小节「${restrictToSectionId}」。` }
    }
    return { section }
  }

  const section = resolveExpertDraftSection(getDraft(), rawSectionId)
  if (!section) {
    const available = getDraft()
      .sections.map((item) => `${item.title}（${item.id}）`)
      .join('、')
    return {
      error: `未找到小节「${rawSectionId}」。当前列表：${available || '（空）'}`,
    }
  }
  return { section }
}

function sectionScopeLabel(scope: ExpertDraftSectionEditScope): string {
  return scope === 'section_writer' ? '当前小节' : '指定小节'
}

export function buildReadExpertDraftSectionTool(input: {
  bookTitle: string
  getDraft: () => ExpertDraft
  getRenderedSectionContent?: GetExpertDraftSectionContent
}): AgentTool {
  const { bookTitle, getDraft, getRenderedSectionContent } = input

  return defineTool({
    name: 'read_expert_draft_section',
    label: '读取其它小节',
    description:
      '读取正文编写专家模式中指定小节的正文和人物状态。优先读取当前文本编辑框中的内容；该小节未在当前文本编辑框中打开时，回退到已加载/已保存的小节内容。每次只读一个小节。',
    parameters: Type.Object({
      section_id: Type.String({
        description: '目标小节 id，如 intro、section-1、section-2',
      }),
      include_character_state: Type.Optional(
        Type.Boolean({
          description: '是否同时返回人物状态，默认 true',
        }),
      ),
    }),
    execute: async (_id, params) => {
      const section = resolveExpertDraftSection(getDraft(), params.section_id)
      if (!section) {
        const available = getDraft()
          .sections.map((item) => `${item.title}（${item.id}）`)
          .join('、')
        return textBlock(
          `未找到小节「${params.section_id}」。当前列表：${available || '（空）'}`,
        )
      }

      const includeState = params.include_character_state !== false
      const bodyResult = readExpertDraftSectionField(
        section.id,
        'body',
        getDraft,
        getRenderedSectionContent,
      )
      const body = bodyResult.text.trim()
      const bodySource =
        bodyResult.source === 'editor' ? '当前文本编辑框' : '已保存内容'
      const header = `书名：《${bookTitle}》\n【${section.title}】（${section.id}）\n正文来源：${bodySource}`
      const wordCount = currentWordCountLine(body)

      if (!includeState) {
        if (!body) {
          return textBlock(`${header}\n${wordCount}\n\n该小节正文当前为空。`)
        }
        return textBlock(`${header}\n${wordCount}\n\n${body}`)
      }

      const stateResult = readExpertDraftSectionField(
        section.id,
        'character_state',
        getDraft,
        getRenderedSectionContent,
      )
      const stateBody = stateResult.text.trim()
      const stateTitle =
        getDraft().character_states.find(
          (item) => item.section_id === section.id,
        )?.title || `${section.title}人物状态`
      const stateSource =
        stateResult.source === 'editor' ? '当前文本编辑框' : '已保存内容'

      const parts = [header]
      parts.push(`\n## 正文\n${wordCount}\n${body || '（空）'}`)
      parts.push(
        `\n## ${stateTitle}\n人物状态来源：${stateSource}\n${stateBody || '（空）'}`,
      )
      const wordRequirement = String(section.word_count_requirement ?? '').trim()
      if (wordRequirement) {
        parts.push(`\n## 字数要求\n${wordRequirement}`)
      }
      return textBlock(parts.join('\n'))
    },
  })
}

export function buildExpertDraftSectionEditTools(
  input: ExpertDraftSectionEditToolsInput,
): AgentTool[] {
  const {
    getDraft,
    getRenderedSectionContent,
    updateDraft,
    scope,
    onSectionBodyWritten,
    onCharacterStateWritten,
    syncExpertDraftSectionField,
  } = input
  const sectionLabel = sectionScopeLabel(scope)
  const includeWriteTools = input.includeWriteTools !== false

  const replaceSectionBodyTool = defineTool({
      name: 'replace_section_body_text',
      label: '替换章节信息',
      description:
        `编辑替换工具：可直接替换${sectionLabel}的章节名称或正文片段。修改章节名时，把 read_expert_draft_section 返回的当前章节名称原样放入 original_text，把新章节名放入 new_text，章节树与合并正文会同步更新。正文已有内容时也必须优先使用本工具，不要调用 write_section_body 整段覆盖，也不要重新启动 start_expert_writing，除非用户明确要求重写/重跑小节。每项只替换章节名或一个正文小段，不要把整节正文作为 original_text 或 new_text。`,
      parameters: Type.Object({
        section_id: Type.String({
          description:
            scope === 'section_writer' ? '当前小节 id' : '目标小节 id',
        }),
        replacements: Type.Array(
          Type.Object({
            original_text: Type.String({
              maxLength: MAX_EXPERT_DRAFT_TEXT_REPLACE_CHARS,
              description:
                '要被替换的当前章节名称或正文原文片段。须来自 read_expert_draft_section 的返回内容；替换章节名时直接填写当前章节名称。',
            }),
            new_text: Type.String({
              maxLength: MAX_EXPERT_DRAFT_TEXT_REPLACE_CHARS,
              description:
                '替换后的新章节名称或正文片段。替换章节名时只填写新名称且不要换行；替换正文时只放对应片段的新内容。',
            }),
          }),
          {
            minItems: 1,
            maxItems: 20,
            description:
              '需要替换的小节正文片段列表。每项都用 original_text 精确定位，再用 new_text 替换。',
          },
        ),
      }),
      execute: async (_id, params) => {
        const resolved = resolveEditableSection(input, params.section_id, '替换')
        if ('error' in resolved) return textBlock(resolved.error)
        const { section } = resolved
        const currentBody = readExpertDraftSectionField(
          section.id,
          'body',
          getDraft,
          getRenderedSectionContent,
        ).text
        let nextTitle = section.title
        const bodyReplacements: ExpertDraftTextReplacement[] = []
        let titleReplaceCount = 0
        for (const replacement of params.replacements) {
          const originalText = normalizeNewlines(
            replacement.original_text,
          ).trim()
          const newText = normalizeNewlines(replacement.new_text).trim()
          if (originalText === nextTitle.trim() && !originalText.includes('\n')) {
            if (!newText) return textBlock('未替换：新章节名称不能为空。')
            if (newText.includes('\n')) {
              return textBlock('未替换：章节名称不能包含换行。')
            }
            nextTitle = newText
            titleReplaceCount += 1
          } else {
            bodyReplacements.push(replacement)
          }
        }
        if (!currentBody.trim() && bodyReplacements.length > 0) {
          return textBlock(
            scope === 'coordinator'
              ? `当前「${section.title}」正文为空。请使用 initialize_expert_draft 初始化或填入 body，或调用 start_expert_writing 启动分节写作。`
              : `当前「${section.title}」正文为空，请使用 write_section_body 写入完整正文。`,
          )
        }
        const result =
          bodyReplacements.length > 0
            ? replaceExpertDraftText({
                currentBody,
                replacements: bodyReplacements,
              })
            : { next: currentBody, count: 0, flexibleCount: 0 }
        if ('error' in result) return textBlock(`未替换：${result.error}`)

        if (bodyReplacements.length > 0) {
          onSectionBodyWritten?.(result.next)
          syncExpertDraftSectionField?.(section.id, 'body', result.next)
        }
        updateDraft((draft) =>
          replaceSectionTitleAndBody(draft, section.id, nextTitle, result.next),
        )
        const flexibleNote =
          result.flexibleCount > 0
            ? `（其中 ${result.flexibleCount} 处经引号/标点归一化后定位）`
            : ''
        const changedParts = [
          titleReplaceCount > 0 ? `章节名 ${titleReplaceCount} 处` : '',
          result.count > 0 ? `正文 ${result.count} 个片段` : '',
        ].filter(Boolean)
        return textBlock(
          `已替换「${section.title}」的${changedParts.join('、')}${flexibleNote}。`,
        )
      },
      executionMode: 'sequential',
    })

  const writeSectionBodyTool = defineTool({
      name: 'write_section_body',
      label: '写入正文',
      description:
        `覆盖写入工具：只在${sectionLabel}正文为空白时，用它写入完整干净正文。正文已有内容时，请使用 replace_section_body_text 做编辑替换；只有用户明确要求整体覆盖、重新生成或重写本小节时，才允许设置 allow_overwrite_existing=true 后覆盖。`,
      parameters: Type.Object({
        section_id: Type.String({
          description:
            scope === 'section_writer' ? '当前小节 id' : '目标小节 id',
        }),
        text: Type.String({ description: '小节干净正文，不含思考过程' }),
        allow_overwrite_existing: Type.Optional(
          Type.Boolean({
            description:
              '默认 false。只有用户明确要求整体覆盖、重新生成或重写本小节时才设为 true；普通修改必须使用 replace_section_body_text。',
          }),
        ),
      }),
      execute: async (_id, params) => {
        const resolved = resolveEditableSection(input, params.section_id, '写入')
        if ('error' in resolved) return textBlock(resolved.error)
        const { section } = resolved
        const text = params.text.trim()
        if (!text) return textBlock('未写入：正文为空。')
        const currentBody = readExpertDraftSectionField(
          section.id,
          'body',
          getDraft,
          getRenderedSectionContent,
        ).text.trim()
        if (currentBody && params.allow_overwrite_existing !== true) {
          return textBlock(
            `未写入：「${section.title}」正文已有内容。请使用 replace_section_body_text 按原文片段进行编辑替换；只有用户明确要求整体覆盖/重新生成时，才可允许覆盖写入。`,
          )
        }
        onSectionBodyWritten?.(text)
        syncExpertDraftSectionField?.(section.id, 'body', text)
        updateDraft((draft) => replaceSectionBody(draft, section.id, text))
        return textBlock(`已覆盖写入「${section.title}」正文。`)
      },
      executionMode: 'sequential',
    })

  const replaceCharacterStateTool = defineTool({
      name: 'replace_character_state_text',
      label: '替换人物状态片段',
      description:
        `编辑替换工具：${sectionLabel}人物状态已有内容时，使用本工具修改人物状态片段，不要调用 write_character_state 整段覆盖。先调用 read_expert_draft_section 读取目标小节人物状态，从返回内容中原样复制待改片段到 original_text。`,
      parameters: Type.Object({
        section_id: Type.String({
          description:
            scope === 'section_writer' ? '当前小节 id' : '目标小节 id',
        }),
        replacements: Type.Array(
          Type.Object({
            original_text: Type.String({
              maxLength: MAX_EXPERT_DRAFT_TEXT_REPLACE_CHARS,
              description:
                '要被替换的人物状态原文片段，须来自 read_expert_draft_section 的返回内容。',
            }),
            new_text: Type.String({
              maxLength: MAX_EXPERT_DRAFT_TEXT_REPLACE_CHARS,
              description: '替换后的人物状态片段，不要放整段人物状态。',
            }),
          }),
          { minItems: 1, maxItems: 20 },
        ),
      }),
      execute: async (_id, params) => {
        const resolved = resolveEditableSection(input, params.section_id, '替换')
        if ('error' in resolved) return textBlock(resolved.error)
        const { section } = resolved
        const currentState = readExpertDraftSectionField(
          section.id,
          'character_state',
          getDraft,
          getRenderedSectionContent,
        ).text
        if (!currentState.trim()) {
          return textBlock(
            scope === 'coordinator'
              ? `当前「${section.title}」人物状态为空。请使用 create_character_state_sections 初始化或填入 body。`
              : `当前「${section.title}」人物状态为空，请使用 write_character_state 写入。`,
          )
        }
        const result = replaceExpertDraftText({
          currentBody: currentState,
          replacements: params.replacements,
        })
        if ('error' in result) return textBlock(`未替换：${result.error}`)

        onCharacterStateWritten?.(result.next)
        syncExpertDraftSectionField?.(section.id, 'character_state', result.next)
        updateDraft((draft) =>
          replaceCharacterState(draft, section.id, result.next),
        )
        const flexibleNote =
          result.flexibleCount > 0
            ? `（其中 ${result.flexibleCount} 处经引号/标点归一化后定位）`
            : ''
        return textBlock(
          `已替换「${section.title}」人物状态 ${result.count} 个片段${flexibleNote}。`,
        )
      },
      executionMode: 'sequential',
    })

  const writeCharacterStateTool = defineTool({
      name: 'write_character_state',
      label: '写入人物状态',
      description:
        `覆盖写入工具：只在${sectionLabel}人物状态为空白时，用它写入人物状态。人物状态已有内容时，请使用 replace_character_state_text 做编辑替换；只有用户明确要求整体覆盖人物状态时，才允许设置 allow_overwrite_existing=true 后覆盖。`,
      parameters: Type.Object({
        section_id: Type.String({
          description:
            scope === 'section_writer' ? '当前小节 id' : '目标小节 id',
        }),
        text: Type.String({
          description: '小节结束时的人物状态、关系变化、冲突推进与接续点',
        }),
        allow_overwrite_existing: Type.Optional(
          Type.Boolean({
            description:
              '默认 false。只有用户明确要求整体覆盖人物状态时才设为 true；普通修改必须使用 replace_character_state_text。',
          }),
        ),
      }),
      execute: async (_id, params) => {
        const resolved = resolveEditableSection(input, params.section_id, '写入')
        if ('error' in resolved) return textBlock(resolved.error)
        const { section } = resolved
        const text = params.text.trim()
        if (!text) return textBlock('未写入：人物状态为空。')
        const currentState = readExpertDraftSectionField(
          section.id,
          'character_state',
          getDraft,
          getRenderedSectionContent,
        ).text.trim()
        if (currentState && params.allow_overwrite_existing !== true) {
          return textBlock(
            `未写入：「${section.title}」人物状态已有内容。请使用 replace_character_state_text 按原文片段进行编辑替换；只有用户明确要求整体覆盖时，才可允许覆盖写入。`,
          )
        }
        onCharacterStateWritten?.(text)
        syncExpertDraftSectionField?.(section.id, 'character_state', text)
        updateDraft((draft) => replaceCharacterState(draft, section.id, text))
        return textBlock(`已覆盖写入「${section.title}」人物状态。`)
      },
      executionMode: 'sequential',
    })

  const tools: AgentTool[] = [replaceSectionBodyTool, replaceCharacterStateTool]
  if (includeWriteTools) {
    tools.splice(1, 0, writeSectionBodyTool)
    tools.push(writeCharacterStateTool)
  }
  return tools
}

export function readExpertDraftSectionBody(
  sectionId: string,
  getDraft: () => ExpertDraft,
  getRendered?: GetExpertDraftSectionContent,
): { text: string; source: 'editor' | 'saved' } {
  return readExpertDraftSectionField(sectionId, 'body', getDraft, getRendered)
}

export function applyExpertDraftSectionBodyReplacements(
  currentBody: string,
  replacements: ExpertDraftTextReplacement[],
): { next: string; count: number; flexibleCount: number } | { error: string } {
  return replaceExpertDraftText({ currentBody, replacements })
}

export function updateExpertDraftSectionBody(
  draft: ExpertDraft,
  sectionId: string,
  body: string,
): ExpertDraft {
  return replaceSectionBody(draft, sectionId, body)
}

export type ExpertDraftBodyReplacement = ExpertDraftTextReplacement
