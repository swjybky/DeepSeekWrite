/**
 * DeepSeekWrite 工作台工具在 Pi ChatPanel 中的折叠式展示。
 * 默认一行中文摘要，点击可展开 Input / Output 详情。
 */
import type { ToolResultMessage } from '@earendil-works/pi-ai'
import { icon } from '@mariozechner/mini-lit'
import { html, type TemplateResult } from 'lit'
import { createRef, ref } from 'lit/directives/ref.js'
import {
  ChevronUp,
  ChevronsUpDown,
  Loader,
  ScrollText,
  Wrench,
} from 'lucide'
import {
  registerToolRenderer,
  type ToolRenderer,
} from '@earendil-works/pi-web-ui'

import {
  MATERIAL_STAGE_LABELS,
  SKILL_STAGE_LABELS,
} from '../bridge/libraryDomain'
import { LEARNING_STAGE_LABELS } from '../bridge/learningImitationClient'
import { LONG_STAGE_LABELS } from '../workspaces/long/stages'
import { SCRIPT_STAGE_LABELS } from '../workspaces/script/stages'
import { SHORT_STAGE_LABELS } from '../workspaces/short/stages'

const DEEPSEEKWRITE_TOOL_NAMES = [
  'load_skill',
  'read_workspace_content',
  'search_workspace_text',
  'list_worldbuilding',
  'query_worldbuilding',
  'query_worldbuilding_item',
  'query_worldbuilding_text',
  'list_long_characters',
  'query_long_character',
  'query_long_plot_structure',
  'query_long_chapter_card',
  'find_next_long_chapter',
  'manage_worldbuilding_category',
  'write_worldbuilding_list',
  'write_worldbuilding_text',
  'manage_long_character',
  'write_long_book_line',
  'manage_long_volume',
  'manage_long_arc',
  'manage_long_chapter_card',
  'manage_long_foreshadowing',
  'start_long_writing',
  'query_linked_material_entries',
  'search_linked_materials',
  'read_linked_material_content',
  'switch_storyline_stage',
  'copy_stage_to_format_conversion',
  'global_text_replace',
  'replace_current_stage_text',
  'write_workspace_editor',
  'update_long_story_ledger',
  'list_material_entries',
  'read_material_entry',
  'search_material_entries',
  'create_material_entry',
  'edit_material_entry',
  'write_material_overview',
  'read_material_content',
  'write_material_editor',
  'read_skill_content',
  'write_skill_editor',
  'list_skill_entries',
  'read_skill_entry',
  'search_skill_entries',
  'create_skill_entry',
  'edit_skill_entry',
  'write_skill_overview',
  'create_draft_sections',
  'create_character_state_sections',
  'initialize_expert_draft',
  'edit_expert_draft_section',
  'write_single_expert_section',
  'start_expert_writing',
  'read_expert_draft_section',
  'replace_section_body_text',
  'write_section_body',
  'replace_character_state_text',
  'write_character_state',
  'narrative_template',
  'logline_expansion_prompts',
  'scene_structure_hint',
  'causality_question_cards',
  'outline_hierarchy_scan',
  'chapter_placeholder_grid',
  'manuscript_metrics',
  'editorial_rubric',
  'line_level_quick_scan',
  'list_learning_documents',
  'read_learning_document',
  'search_learning_documents',
  'write_learning_result',
] as const

type DeepSeekWriteToolName = (typeof DEEPSEEKWRITE_TOOL_NAMES)[number]

type ToolRenderState = 'inprogress' | 'complete' | 'error'

let registered = false

function pickString(
  params: Record<string, unknown> | undefined,
  ...keys: string[]
): string {
  if (!params) return ''
  for (const key of keys) {
    const value = params[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function resolveStageLabel(stageId: string): string {
  if (!stageId) return ''
  const maps: Record<string, string>[] = [
    SHORT_STAGE_LABELS,
    SCRIPT_STAGE_LABELS,
    LONG_STAGE_LABELS,
    MATERIAL_STAGE_LABELS,
    SKILL_STAGE_LABELS,
    LEARNING_STAGE_LABELS,
  ]
  for (const map of maps) {
    if (stageId in map) return map[stageId as keyof typeof map]
  }
  return stageId
}

function truncate(text: string, max = 48): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

function summarizeToolCall(
  toolName: DeepSeekWriteToolName,
  params: Record<string, unknown> | undefined,
  done: boolean,
): string {
  const verb = (pending: string, finished: string) => (done ? finished : pending)

  switch (toolName) {
    case 'load_skill': {
      const skill = pickString(params, 'skill_name')
      return skill
        ? verb('正在加载技能', '已加载技能') + `「${skill}」`
        : verb('正在加载技能', '已加载技能')
    }
    case 'read_workspace_content': {
      const stageId = pickString(params, 'stage_id')
      const label = resolveStageLabel(stageId)
      return label
        ? verb('正在读取', '已读取') + `「${label}」`
        : verb('正在读取创作阶段', '已读取创作阶段')
    }
    case 'search_workspace_text': {
      const query = pickString(params, 'query', 'search_text', 'text')
      return query
        ? verb('正在搜索', '已搜索') + `「${truncate(query)}」`
        : verb('正在搜索创作文本', '已搜索创作文本')
    }
    case 'list_worldbuilding':
      return verb('正在列出世界观分类', '已列出世界观分类')
    case 'query_worldbuilding': {
      const category = pickString(params, 'category_name')
      return category
        ? verb('正在查询世界观概述', '已查询世界观概述') + `「${category}」`
        : verb('正在查询世界观概述', '已查询世界观概述')
    }
    case 'query_worldbuilding_item': {
      const category = pickString(params, 'category_name')
      const item = pickString(params, 'item_name')
      const target = [category, item].filter(Boolean).join(' / ')
      return target
        ? verb('正在查询世界观条目', '已查询世界观条目') + `「${target}」`
        : verb('正在查询世界观条目', '已查询世界观条目')
    }
    case 'query_worldbuilding_text': {
      const category = pickString(params, 'category_name')
      return category
        ? verb('正在读取世界观文本', '已读取世界观文本') + `「${category}」`
        : verb('正在读取世界观文本', '已读取世界观文本')
    }
    case 'list_long_characters':
      return verb('正在列出长篇人物', '已列出长篇人物')
    case 'query_long_character': {
      const character = pickString(params, 'character_name')
      return character
        ? verb('正在查询人物档案', '已查询人物档案') + `「${character}」`
        : verb('正在查询人物档案', '已查询人物档案')
    }
    case 'query_long_plot_structure':
      return verb('正在查询长篇剧情结构', '已查询长篇剧情结构')
    case 'query_long_chapter_card': {
      const chapter = pickString(params, 'chapter_name')
      return chapter
        ? verb('正在查询章卡', '已查询章卡') + `「${chapter}」`
        : verb('正在查询章卡', '已查询章卡')
    }
    case 'find_next_long_chapter':
      return verb('正在判断下一章节', '已判断下一章节')
    case 'manage_worldbuilding_category': {
      const target = pickString(params, 'name', 'category_id')
      return target
        ? verb('正在维护世界观分类', '已维护世界观分类') + `「${truncate(target)}」`
        : verb('正在维护世界观分类', '已维护世界观分类')
    }
    case 'write_worldbuilding_list': {
      const target = pickString(params, 'name', 'item_id', 'category_id')
      return target
        ? verb('正在更新世界观列表', '已更新世界观列表') + `「${truncate(target)}」`
        : verb('正在更新世界观列表', '已更新世界观列表')
    }
    case 'write_worldbuilding_text':
      return verb('正在更新世界观文本', '已更新世界观文本')
    case 'manage_long_character': {
      const target = pickString(params, 'name', 'character_id')
      return target
        ? verb('正在维护人物档案', '已维护人物档案') + `「${truncate(target)}」`
        : verb('正在维护人物档案', '已维护人物档案')
    }
    case 'write_long_book_line':
      return verb('正在更新全书线', '已更新全书线')
    case 'manage_long_volume': {
      const target = pickString(params, 'name', 'volume_id')
      return target
        ? verb('正在维护分卷', '已维护分卷') + `「${truncate(target)}」`
        : verb('正在维护分卷', '已维护分卷')
    }
    case 'manage_long_arc': {
      const target = pickString(params, 'name', 'arc_id')
      return target
        ? verb('正在维护剧情弧', '已维护剧情弧') + `「${truncate(target)}」`
        : verb('正在维护剧情弧', '已维护剧情弧')
    }
    case 'manage_long_chapter_card': {
      const target = pickString(params, 'title', 'card_id')
      return target
        ? verb('正在维护章卡', '已维护章卡') + `「${truncate(target)}」`
        : verb('正在维护章卡', '已维护章卡')
    }
    case 'manage_long_foreshadowing': {
      const target = pickString(params, 'name', 'foreshadowing_id')
      return target
        ? verb('正在维护伏笔', '已维护伏笔') + `「${truncate(target)}」`
        : verb('正在维护伏笔', '已维护伏笔')
    }
    case 'start_long_writing': {
      const scope = pickString(params, 'scope')
      const target = pickString(
        params,
        'chapter_stage_id',
        'arc_id',
        'volume_id',
      )
      const scopeLabel =
        scope === 'chapter' ? '单章' : scope === 'arc' ? '剧情弧' : '分卷'
      return target
        ? verb('正在启动长篇写作', '已启动长篇写作') + `「${scopeLabel} · ${target}」`
        : verb('正在启动长篇写作', '已启动长篇写作')
    }
    case 'query_linked_material_entries': {
      const mode = pickString(params, 'mode')
      const query = pickString(params, 'query')
      const entryName = pickString(params, 'entry_name')
      if (mode === 'read') {
        return entryName
          ? verb('正在读取关联素材条目', '已读取关联素材条目') + `「${truncate(entryName)}」`
          : verb('正在读取关联素材条目', '已读取关联素材条目')
      }
      if (mode === 'list') {
        return entryName
          ? verb('正在列出关联素材条目', '已列出关联素材条目') + `「${truncate(entryName)}」`
          : verb('正在列出关联素材条目', '已列出关联素材条目')
      }
      return query
        ? verb('正在查询关联素材条目', '已查询关联素材条目') + `「${truncate(query)}」`
        : verb('正在查询关联素材条目', '已查询关联素材条目')
    }
    case 'read_linked_material_content': {
      const stageId = pickString(params, 'stage_id')
      const label = resolveStageLabel(stageId)
      return label
        ? verb('正在读取关联素材', '已读取关联素材') + `「${label}」`
        : verb('正在读取关联素材', '已读取关联素材')
    }
    case 'search_linked_materials': {
      const query = pickString(params, 'query')
      const kind = pickString(params, 'material_kind')
      const label = kind || '素材'
      return query
        ? verb('正在查询关联素材', '已查询关联素材') + `「${label} · ${truncate(query)}」`
        : verb('正在查询关联素材', '已查询关联素材') + `「${label}」`
    }
    case 'switch_storyline_stage': {
      const stageId = pickString(params, 'target_stage_id', 'stage_id')
      const label = resolveStageLabel(stageId)
      return label
        ? verb('正在切换剧情方向', '已切换剧情方向') + `「${label}」`
        : verb('正在切换剧情方向', '已切换剧情方向')
    }
    case 'copy_stage_to_format_conversion':
      return verb('正在复制到格式转换', '已复制到格式转换')
    case 'global_text_replace':
      return verb('正在全局替换文本', '已完成全局替换')
    case 'replace_current_stage_text':
      return verb('正在替换当前阶段文本', '已替换当前阶段文本')
    case 'write_workspace_editor': {
      const stageId = pickString(params, 'target_stage_id', 'stage_id')
      const label = resolveStageLabel(stageId)
      const mode = pickString(params, 'mode')
      const modeHint =
        mode === 'append' ? '（追加）' : mode === 'replace' ? '（覆盖）' : ''
      return label
        ? verb('正在写入', '已写入') + `「${label}」编辑区${modeHint}`
          : verb('正在写入编辑区', '已写入编辑区') + modeHint
    }
    case 'update_long_story_ledger': {
      const source = pickString(params, 'source_label')
      return source
        ? verb('正在更新长篇状态账本', '已更新长篇状态账本') + `「${source}」`
        : verb('正在更新长篇状态账本', '已更新长篇状态账本')
    }
    case 'list_material_entries':
      return verb('正在列出素材条目', '已列出素材条目')
    case 'read_material_entry': {
      const name = pickString(params, 'name')
      return name
        ? verb('正在读取素材条目', '已读取素材条目') + `「${name}」`
        : verb('正在读取素材条目', '已读取素材条目')
    }
    case 'search_material_entries':
      return verb('正在搜索素材内容', '已搜索素材内容')
    case 'create_material_entry': {
      const title = pickString(params, 'title')
      return title
        ? verb('正在创建素材条目', '已创建素材条目') + `「${title}」`
        : verb('正在创建素材条目', '已创建素材条目')
    }
    case 'edit_material_entry': {
      const name = pickString(params, 'name')
      return name
        ? verb('正在修改素材条目', '已修改素材条目') + `「${name}」`
        : verb('正在修改素材条目', '已修改素材条目')
    }
    case 'write_material_overview':
      return verb('正在写入素材概览', '已写入素材概览')
    case 'read_material_content': {
      const stageId = pickString(params, 'stage_id')
      const label = resolveStageLabel(stageId)
      return label
        ? verb('正在读取素材', '已读取素材') + `「${label}」`
        : verb('正在读取素材', '已读取素材')
    }
    case 'write_material_editor': {
      const mode = pickString(params, 'mode')
      const modeHint =
        mode === 'append' ? '（追加）' : mode === 'replace' ? '（覆盖）' : ''
      return verb('正在写入素材编辑区', '已写入素材编辑区') + modeHint
    }
    case 'read_skill_content':
      return verb('正在读取技能内容', '已读取技能内容')
    case 'write_skill_editor': {
      const mode = pickString(params, 'mode')
      const modeHint =
        mode === 'append' ? '（追加）' : mode === 'replace' ? '（覆盖）' : ''
      return verb('正在写入技能编辑区', '已写入技能编辑区') + modeHint
    }
    case 'list_skill_entries':
      return verb('正在列出技能条目', '已列出技能条目')
    case 'read_skill_entry': {
      const title = pickString(params, 'title')
      return title
        ? verb('正在读取技能条目', '已读取技能条目') + `「${title}」`
        : verb('正在读取技能条目', '已读取技能条目')
    }
    case 'search_skill_entries':
      return verb('正在搜索技能内容', '已搜索技能内容')
    case 'create_skill_entry': {
      const title = pickString(params, 'title')
      return title
        ? verb('正在创建技能条目', '已创建技能条目') + `「${title}」`
        : verb('正在创建技能条目', '已创建技能条目')
    }
    case 'edit_skill_entry': {
      const title = pickString(params, 'title')
      return title
        ? verb('正在修改技能条目', '已修改技能条目') + `「${title}」`
        : verb('正在修改技能条目', '已修改技能条目')
    }
    case 'write_skill_overview':
      return verb('正在写入技能概览', '已写入技能概览')
    case 'create_draft_sections': {
      const sections = params?.sections
      const count = Array.isArray(sections) ? sections.length : 0
      return count > 0
        ? verb('正在创建正文小节', '已创建正文小节') + `（${count} 节）`
        : verb('正在创建正文小节', '已创建正文小节')
    }
    case 'create_character_state_sections': {
      const items = params?.items
      const count = Array.isArray(items) ? items.length : 0
      return count > 0
        ? verb('正在创建人物状态', '已创建人物状态') + `（${count} 项）`
        : verb('正在创建人物状态列表', '已创建人物状态列表')
    }
    case 'initialize_expert_draft': {
      const sections = params?.sections
      const count = Array.isArray(sections) ? sections.length : 0
      return count > 0
        ? verb('正在初始化正文', '已初始化正文') + `（${count} 节）`
        : verb('正在初始化正文', '已初始化正文')
    }
    case 'edit_expert_draft_section': {
      if (!done) {
        return '正在编辑正文'
      }
      return '已编辑正文'
    }
    case 'write_single_expert_section': {
      const sectionId = pickString(params, 'section_id')
      return sectionId
        ? verb('正在启动单章写作', '已启动单章写作') + `「${sectionId}」`
        : verb('正在启动单章写作', '已启动单章写作')
    }
    case 'start_expert_writing':
      return verb('正在启动专家分节写作', '已启动专家分节写作')
    case 'read_expert_draft_section': {
      const sectionId = pickString(params, 'section_id')
      return sectionId
        ? verb('正在读取分节', '已读取分节') + `「${sectionId}」`
        : verb('正在读取专家分节', '已读取专家分节')
    }
    case 'replace_section_body_text':
      return verb('正在替换正文片段', '正文片段已替换')
    case 'write_section_body':
      return verb('正在写入正文', '正文已写入')
    case 'replace_character_state_text':
      return verb('正在替换人物状态片段', '人物状态片段已替换')
    case 'write_character_state':
      return verb('正在写入人物状态', '人物状态已写入')
    case 'narrative_template': {
      const kind = pickString(params, 'kind')
      return kind
        ? verb('正在获取叙事模版', '已获取叙事模版') + `「${kind}」`
        : verb('正在获取叙事模版', '已获取叙事模版')
    }
    case 'logline_expansion_prompts':
      return verb('正在扩展创意 logline', '已扩展创意 logline')
    case 'scene_structure_hint':
      return verb('正在分析场次结构', '已分析场次结构')
    case 'causality_question_cards':
      return verb('正在获取因果追问卡', '已获取因果追问卡')
    case 'outline_hierarchy_scan':
      return verb('正在扫描大纲层级', '已扫描大纲层级')
    case 'chapter_placeholder_grid': {
      const count = params?.chapter_count
      return typeof count === 'number' && count > 0
        ? verb('正在生成分章占位格', '已生成分章占位格') + `（${count} 章）`
        : verb('正在生成分章占位格', '已生成分章占位格')
    }
    case 'manuscript_metrics':
      return verb('正在统计稿件指标', '已统计稿件指标')
    case 'editorial_rubric':
      return verb('正在获取编审量表', '已获取编审量表')
    case 'line_level_quick_scan':
      return verb('正在进行行文快扫', '已完成行文快扫')
    case 'list_learning_documents':
      return verb('正在列出学习样本', '已列出学习样本')
    case 'read_learning_document': {
      const documentId = pickString(params, 'document_id')
      const chunkIndex = params?.chunk_index
      const chunkHint =
        typeof chunkIndex === 'number' && chunkIndex > 0
          ? `（第 ${chunkIndex} 块）`
          : ''
      return documentId
        ? verb('正在读取学习样本', '已读取学习样本')
          + `「${truncate(documentId, 24)}」${chunkHint}`
        : verb('正在读取学习样本', '已读取学习样本')
    }
    case 'search_learning_documents': {
      const query = pickString(params, 'query', 'search_text', 'text')
      return query
        ? verb('正在搜索学习样本', '已搜索学习样本')
          + `「${truncate(query)}」`
        : verb('正在搜索学习样本', '已搜索学习样本')
    }
    case 'write_learning_result': {
      const mode = pickString(params, 'mode')
      const modeHint =
        mode === 'append' ? '（追加）' : mode === 'replace' ? '（覆盖）' : ''
      return verb('正在写入学习结果预览', '已写入学习结果预览') + modeHint
    }
    default:
      return done ? '工具调用完成' : '正在调用工具'
  }
}

function formatParamsJson(params: unknown): string {
  if (params == null) return ''
  if (typeof params === 'string') {
    try {
      return JSON.stringify(JSON.parse(params), null, 2)
    } catch {
      return params
    }
  }
  try {
    return JSON.stringify(params, null, 2)
  } catch {
    return String(params)
  }
}

function getTextOutput(result: ToolResultMessage | undefined): string {
  if (!result) return ''
  return (
    result.content
      ?.filter((chunk) => chunk.type === 'text')
      .map((chunk) => chunk.text)
      .join('\n') ?? ''
  )
}

function formatOutputBlock(text: string): { code: string; language: string } {
  if (!text) return { code: '（无输出）', language: 'text' }
  try {
    return {
      code: JSON.stringify(JSON.parse(text), null, 2),
      language: 'json',
    }
  } catch {
    return { code: text, language: 'text' }
  }
}

function resolveRenderState(
  result: ToolResultMessage | undefined,
  isStreaming: boolean | undefined,
): ToolRenderState {
  if (result) return result.isError ? 'error' : 'complete'
  if (isStreaming) return 'inprogress'
  return 'complete'
}

function renderThemedToolIcon(state: ToolRenderState): TemplateResult {
  const stateClass =
    state === 'complete'
      ? 'deepseekwrite-tool-icon--complete'
      : state === 'error'
        ? 'deepseekwrite-tool-icon--error'
        : 'deepseekwrite-tool-icon--progress'

  return html`
    <span class="deepseekwrite-tool-icon inline-block ${stateClass}">
      <span class="deepseekwrite-tool-glyph deepseekwrite-tool-glyph--classic"
        >${icon(ScrollText, 'sm')}</span
      >
      <span class="deepseekwrite-tool-glyph deepseekwrite-tool-glyph--modern"
        >${icon(Wrench, 'sm')}</span
      >
    </span>
  `
}

function renderDeepSeekWriteToolHeader(
  state: ToolRenderState,
  text: string,
): TemplateResult {
  if (state === 'inprogress') {
    return html`
      <div
        class="deepseekwrite-tool-header flex items-center justify-between gap-2 text-sm"
      >
        <div class="flex items-center gap-2 min-w-0">
          ${renderThemedToolIcon(state)}
          <span class="deepseekwrite-tool-summary truncate">${text}</span>
        </div>
        <span class="deepseekwrite-tool-spinner inline-block animate-spin"
          >${icon(Loader, 'sm')}</span
        >
      </div>
    `
  }

  return html`
    <div class="deepseekwrite-tool-header flex items-center gap-2 text-sm">
      ${renderThemedToolIcon(state)}
      <span class="deepseekwrite-tool-summary">${text}</span>
    </div>
  `
}

function renderDeepSeekWriteCollapsibleHeader(
  state: ToolRenderState,
  text: string,
  contentRef: ReturnType<typeof createRef<HTMLDivElement>>,
  chevronRef: ReturnType<typeof createRef<HTMLElement>>,
  defaultExpanded = false,
): TemplateResult {
  const toggleContent = (event: Event) => {
    event.preventDefault()
    const content = contentRef.value
    const chevron = chevronRef.value
    if (!content || !chevron) return

    const isCollapsed = content.classList.contains('max-h-0')
    if (isCollapsed) {
      content.classList.remove('max-h-0')
      content.classList.add('max-h-[2000px]', 'mt-3')
      chevron.querySelector('.chevron-up')?.classList.remove('hidden')
      chevron.querySelector('.chevrons-up-down')?.classList.add('hidden')
    } else {
      content.classList.remove('max-h-[2000px]', 'mt-3')
      content.classList.add('max-h-0')
      chevron.querySelector('.chevron-up')?.classList.add('hidden')
      chevron.querySelector('.chevrons-up-down')?.classList.remove('hidden')
    }
  }

  return html`
    <button
      type="button"
      @click=${toggleContent}
      class="deepseekwrite-tool-header-btn flex items-center justify-between gap-2 text-sm w-full text-left transition-colors cursor-pointer"
    >
      <div class="flex items-center gap-2 min-w-0">
        ${state === 'inprogress'
          ? html`<span class="deepseekwrite-tool-spinner inline-block animate-spin"
              >${icon(Loader, 'sm')}</span
            >`
          : ''}
        ${renderThemedToolIcon(state)}
        <span class="deepseekwrite-tool-summary truncate">${text}</span>
      </div>
      <span class="deepseekwrite-tool-chevron inline-block" ${ref(chevronRef)}>
        <span class="chevron-up ${defaultExpanded ? '' : 'hidden'}"
          >${icon(ChevronUp, 'sm')}</span
        >
        <span class="chevrons-up-down ${defaultExpanded ? 'hidden' : ''}"
          >${icon(ChevronsUpDown, 'sm')}</span
        >
      </span>
    </button>
  `
}

function renderToolDetails(
  params: Record<string, unknown> | undefined,
  result: ToolResultMessage | undefined,
): ReturnType<typeof html> {
  const paramsJson = formatParamsJson(params)
  const output = formatOutputBlock(getTextOutput(result))
  const hasParams = Boolean(paramsJson && paramsJson !== '{}' && paramsJson !== 'null')

  return html`
    <div class="space-y-3">
      ${hasParams
        ? html`
            <div>
              <div class="text-xs font-medium mb-1 text-muted-foreground">输入</div>
              <code-block .code=${paramsJson} language="json"></code-block>
            </div>
          `
        : ''}
      <div>
        <div class="text-xs font-medium mb-1 text-muted-foreground">输出</div>
        <code-block .code=${output.code} language=${output.language}></code-block>
      </div>
    </div>
  `
}

class DeepSeekWriteToolRenderer implements ToolRenderer {
  private readonly toolName: DeepSeekWriteToolName

  constructor(toolName: DeepSeekWriteToolName) {
    this.toolName = toolName
  }

  render(
    params: Record<string, unknown> | undefined,
    result: ToolResultMessage | undefined,
    isStreaming?: boolean,
  ) {
    const state = resolveRenderState(result, isStreaming)
    const done = state !== 'inprogress'
    const summary = summarizeToolCall(this.toolName, params, done)

    if (state === 'inprogress') {
      return {
        content: html`<div>${renderDeepSeekWriteToolHeader(state, summary)}</div>`,
        isCustom: false,
      }
    }

    const contentRef = createRef<HTMLDivElement>()
    const chevronRef = createRef<HTMLElement>()
    const paramsJson = formatParamsJson(params)
    const hasDetails =
      (paramsJson !== '' && paramsJson !== '{}' && paramsJson !== 'null') ||
      Boolean(result)

    if (!hasDetails) {
      return {
        content: html`<div>${renderDeepSeekWriteToolHeader(state, summary)}</div>`,
        isCustom: false,
      }
    }

    return {
      content: html`
        <div>
          ${renderDeepSeekWriteCollapsibleHeader(
            state,
            summary,
            contentRef,
            chevronRef,
            false,
          )}
          <div
            ${ref(contentRef)}
            class="max-h-0 overflow-hidden transition-all duration-300 space-y-3"
          >
            ${renderToolDetails(params, result)}
          </div>
        </div>
      `,
      isCustom: false,
    }
  }
}

export function registerDeepSeekWriteToolRenderers(): void {
  if (registered) return
  registered = true
  for (const toolName of DEEPSEEKWRITE_TOOL_NAMES) {
    registerToolRenderer(toolName, new DeepSeekWriteToolRenderer(toolName))
  }
}
