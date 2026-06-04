export type BookType = 'short' | 'long'
export type BookStatus = 'editing' | 'completed'

// 统一短篇阶段定义
import {
  SHORT_WORKSPACE_STAGES,
  type ShortStageId,
  normalizeShortStages,
  migrateLegacyStages,
} from './workspaces/short/stages'

import { getEmbeddedPromptTemplate } from './prompt/embeddedDefaults'
import { renderPromptFromTemplateRaw } from './prompt/renderTemplate'
import {
  WORKSPACE_AGENT_IDS,
  normalizeWorkspaceAgentReadAccess,
  type WorkspaceAgentId,
  type WorkspaceAgentReadAccessConfig,
} from './workspaces/short/stageReadAccess'

export type {
  WorkspaceAgentId,
  WorkspaceAgentReadAccessConfig,
  WorkspaceAgentReadAccessEntry,
} from './workspaces/short/stageReadAccess'

export type { ShortStageId }

type BookWorkspaceSlice = {
  book_type: BookType
  categories: string[]
}

/** 所有短篇书籍共用同一套完整创作空间。 */
export function isWorkspaceShortBook(book: BookWorkspaceSlice): boolean {
  return book.book_type === 'short'
}

/** 提示词可见的分类上下文，不再影响智能体或模板选择。 */
export function resolveWorkspaceBookGenre(book: BookWorkspaceSlice): string {
  return book.categories.map((item) => item.trim()).filter(Boolean).join('、') || '未分类'
}

// ==================== 素材提示词类型 ====================
export const MATERIAL_MANAGER_AGENT_ID = 'material_manager' as const
export const MATERIAL_MANAGER_PROMPT_KIND = 'material_manager' as const
export type MaterialPromptKind = typeof MATERIAL_MANAGER_PROMPT_KIND
export const SKILL_MANAGER_AGENT_ID = 'skill_manager' as const
export const SKILL_MANAGER_PROMPT_KIND = 'skill_manager' as const
export type SkillPromptKind = typeof SKILL_MANAGER_PROMPT_KIND

// 统一阶段ID类型
export type StageId = ShortStageId

// 导出统一阶段定义
export const WORKSPACE_STAGES = SHORT_WORKSPACE_STAGES

export interface ExpertDraftSection {
  id: string
  title: string
  word_count_requirement?: string
  body: string
}

export interface ExpertDraftCharacterState {
  section_id: string
  title: string
  body: string
}

export interface ExpertDraft {
  sections: ExpertDraftSection[]
  character_states: ExpertDraftCharacterState[]
  running: boolean
  active_section_id?: string
}

export function defaultExpertDraft(): ExpertDraft {
  return {
    sections: [
      { id: 'intro', title: '导语', word_count_requirement: '', body: '' },
      { id: 'section-1', title: '第一节', word_count_requirement: '', body: '' },
    ],
    character_states: [
      { section_id: 'intro', title: '导语人物状态', body: '' },
      { section_id: 'section-1', title: '第一节人物状态', body: '' },
    ],
    running: false,
    active_section_id: '',
  }
}

function defaultExpertCharacterStateTitle(sectionTitle: string): string {
  return `${sectionTitle.trim() || '小节'}人物状态`
}

export function normalizeExpertDraft(
  raw?: Partial<ExpertDraft> | null,
  resetRuntime = false,
): ExpertDraft {
  const base = defaultExpertDraft()
  if (!raw || typeof raw !== 'object') return base

  const sections: ExpertDraftSection[] = []
  const seenSectionIds = new Set<string>()
  if (Array.isArray(raw.sections)) {
    raw.sections.forEach((item, index) => {
      if (!item || typeof item !== 'object') return
      const maybe = item as Partial<ExpertDraftSection>
      let id = String(maybe.id ?? '').trim()
      if (!id) id = index === 0 ? 'intro' : `section-${index}`
      if (seenSectionIds.has(id)) return
      seenSectionIds.add(id)
      const title =
        String(maybe.title ?? '').trim() ||
        (id === 'intro' ? '导语' : `第${sections.length}节`)
      sections.push({
        id,
        title,
        word_count_requirement: String(maybe.word_count_requirement ?? '').trim(),
        body: String(maybe.body ?? ''),
      })
    })
  }

  const normalizedSections = sections.length > 0 ? sections : base.sections
  const titleById = new Map(normalizedSections.map((s) => [s.id, s.title]))
  const states: ExpertDraftCharacterState[] = []
  const seenStateIds = new Set<string>()

  if (Array.isArray(raw.character_states)) {
    raw.character_states.forEach((item) => {
      if (!item || typeof item !== 'object') return
      const maybe = item as Partial<ExpertDraftCharacterState> & { id?: string }
      const sectionId = String(maybe.section_id ?? maybe.id ?? '').trim()
      if (!sectionId || seenStateIds.has(sectionId) || !titleById.has(sectionId)) {
        return
      }
      seenStateIds.add(sectionId)
      const sectionTitle = titleById.get(sectionId) ?? '小节'
      states.push({
        section_id: sectionId,
        title:
          String(maybe.title ?? '').trim() ||
          defaultExpertCharacterStateTitle(sectionTitle),
        body: String(maybe.body ?? ''),
      })
    })
  }

  for (const section of normalizedSections) {
    if (seenStateIds.has(section.id)) continue
    states.push({
      section_id: section.id,
      title: defaultExpertCharacterStateTitle(section.title),
      body: '',
    })
  }

  const sectionIds = new Set(normalizedSections.map((s) => s.id))
  const active = String(raw.active_section_id ?? '').trim()

  return {
    sections: normalizedSections,
    character_states: states,
    running: resetRuntime ? false : Boolean(raw.running),
    active_section_id: active && sectionIds.has(active) ? active : '',
  }
}

/** 短篇可选分类（可扩展） */
export const SHORT_GENRE_OPTIONS = ['世情', '追妻', '科幻', '悬疑'] as const

/** 获取统一阶段列表（所有短篇书籍使用同一套阶段） */
export function resolveWorkspaceStagesForBook(
  _book?: Pick<Book, 'book_type' | 'categories'>,
): typeof SHORT_WORKSPACE_STAGES {
  // 所有短篇分类统一返回 SHORT_WORKSPACE_STAGES
  void _book
  return SHORT_WORKSPACE_STAGES
}

/** 两端存储中的「全字段」工作台 stages（统一阶段键） */
export function normalizeAllBookStages(
  raw?: Partial<Record<StageId, string>> | null,
): Record<StageId, string> {
  return normalizeShortStages(raw)
}

/** 仅当前工作台在用的阶段子集（用于编辑区 state） */
export function normalizeStagesForWorkspaceBook(
  _book?: Pick<Book, 'book_type' | 'categories'>,
  raw?: Partial<Record<StageId, string>> | null,
): Record<StageId, string> {
  // _book 参数保留用于向后兼容，已不再需要
  void _book
  // 迁移旧数据
  const migrated = migrateLegacyStages(raw)
  // 归一化到统一阶段
  return normalizeShortStages(migrated)
}

/** 把部分阶段更新合并进完整存储，未出现的键保持原样 */
export function mergeStagePatchIntoAll(
  previous: Partial<Record<StageId, string>> | undefined,
  patch: Partial<Record<StageId, string>>,
): Record<StageId, string> {
  const next = normalizeAllBookStages(previous)
  // 对patch也进行迁移
  const migratedPatch = migrateLegacyStages(patch)
  for (const [k, v] of Object.entries(migratedPatch)) {
    if (k in next) {
      next[k as StageId] = String(v ?? '')
    }
  }
  return next
}

function primaryDraftStageId(
  _book?: Pick<Book, 'book_type' | 'categories'>,
): StageId {
  // 统一使用 "draft"
  void _book
  return 'draft'
}

/** @deprecated 请用 normalizeAllBookStages */
export function normalizeStages(
  raw?: Partial<Record<StageId, string>> | null,
): Record<StageId, string> {
  return normalizeAllBookStages(raw)
}

export interface BookSummary {
  id: string
  title: string
  book_type: BookType
  categories: string[]
  /** 书籍工作状态：编辑中 / 已完成 */
  status: BookStatus
  /** 本机落地目录，空表示未指定 */
  output_dir?: string
  /** 写书工作台关联的素材库 id，空表示未关联 */
  linked_material_id?: string
}

export interface Book extends BookSummary {
  content: string
  stages?: Partial<Record<StageId, string>>
  expert_draft?: ExpertDraft
  created_at?: string
  updated_at?: string
}

// ==================== 素材类型定义 ====================

export type MaterialType = 'long' | 'short'

export type MaterialStageId =
  | 'character'
  | 'intro'
  | 'gimmick'
  | 'plot_refine'
  | 'pacing'
  | 'draft_excerpt'

export const MATERIAL_STAGE_LABELS: Record<MaterialStageId, string> = {
  character: '人设素材',
  intro: '导语素材',
  gimmick: '梗素材',
  plot_refine: '剧情细化素材',
  pacing: '节奏素材',
  draft_excerpt: '正文片段',
}

export const SHORT_MATERIAL_GENRES: Record<string, string[]> = {
  '世情': ['家庭', '职场', '婚恋', '邻里', '亲子', '继承', '养老'],
  '追妻': ['甜宠', '虐恋', '重生', '穿越', '暗恋', '破镜重圆', '先婚后爱'],
  '科幻': ['未来都市', '星际', '人工智能', '赛博朋克', '末日', '时间旅行', '异星文明'],
  '悬疑': ['刑侦', '推理', '惊悚', '密室', '民俗', '心理', '反转'],
}

/** 素材大分类兼容映射（旧名称 → 新名称） */
const MATERIAL_GENRE_COMPAT: Record<string, string> = {
  '现实情感': '追妻',
  '情感': '追妻',
}

/** 将旧素材大分类名称映射为新名称 */
export function resolveMaterialParentGenre(genre: string): string {
  return MATERIAL_GENRE_COMPAT[genre] || genre
}

/** 获取指定大分类下的子分类（兼容旧名称） */
export function getMaterialSubGenres(genre: string): string[] {
  return SHORT_MATERIAL_GENRES[resolveMaterialParentGenre(genre)] || []
}

export interface MaterialSummary {
  id: string
  title: string
  material_type: MaterialType
  parent_genre?: string  // 世情/追妻（仅short时有效）
  sub_genre?: string     // 子分类
  output_dir?: string
}

export interface Material extends MaterialSummary {
  stages?: Partial<Record<MaterialStageId, string>>
  created_at?: string
  updated_at?: string
}

export function normalizeMaterialStages(
  raw?: Partial<Record<MaterialStageId, string>> | null,
): Record<MaterialStageId, string> {
  const out: Record<MaterialStageId, string> = {
    character: '',
    intro: '',
    gimmick: '',
    plot_refine: '',
    pacing: '',
    draft_excerpt: '',
  }
  if (!raw) return out
  for (const k of Object.keys(out) as MaterialStageId[]) {
    if (k in raw) out[k] = String(raw[k] ?? '')
  }
  return out
}

// ==================== 技能类型定义 ====================

export type SkillStageId =
  | 'character_design'
  | 'plot_design'
  | 'intro_design'
  | 'plot_refine'
  | 'outline'
  | 'draft'
  | 'draft_review'
  | 'format_conversion'
  | 'expert_draft_coordinator'
  | 'expert_section_writer'

export const SKILL_STAGE_LABELS: Record<SkillStageId, string> = {
  character_design: '人物设计技能',
  plot_design: '剧情设计技能',
  intro_design: '导语设计技能',
  plot_refine: '剧情细化技能',
  outline: '大纲纲要技能',
  draft: '正文技能',
  draft_review: '正文审阅技能',
  format_conversion: '格式转换技能',
  expert_draft_coordinator: '专家总控技能',
  expert_section_writer: '分节写手技能',
}

export const SKILL_STAGE_KEYS = Object.keys(SKILL_STAGE_LABELS) as SkillStageId[]

export interface SkillSummary {
  id: string
  title: string
  genre: string
  output_dir?: string
}

export interface Skill extends SkillSummary {
  stages?: Partial<Record<SkillStageId, string>>
  created_at?: string
  updated_at?: string
}

export function normalizeSkillStages(
  raw?: Partial<Record<SkillStageId, string>> | null,
): Record<SkillStageId, string> {
  const out = {} as Record<SkillStageId, string>
  for (const k of SKILL_STAGE_KEYS) {
    out[k] = raw?.[k] ?? ''
  }
  return out
}

/** 本地模型配置，由桌面壳 preferences.json 或浏览器 localStorage 提供。 */
export interface AiModelConfig {
  /** 配置项 ID，如 deepseekflash / kimi */
  id: string
  /** 显示名称，未配置时等于 id */
  label: string
  /** pi-ai provider，如 deepseek / moonshotai-cn；owner 模式下作为标识 */
  provider: string
  /** pi-ai model id，如 deepseek-v4-flash */
  model_id: string
  /** 该模型配置对应的 API Key */
  api_key: string
  /** 自定义 API 地址（owner 模式） */
  base_url?: string
  /** 底层 API 类型：openai-completions / openai-responses / anthropic-messages / google-generative-ai */
  api?: string
  /** 是否支持 Pi 的思考/推理等级选择器 */
  reasoning?: boolean
  /** 兼容旧 `.env` 的流式开关；当前 Pi 调用链暂不消费。 */
  stream?: boolean
}

export interface AiModelDefaults {
  provider: string
  model_id: string
  api_key: string
  /** 固定模型配置列表；存在时 AI 侧栏模型选择器只展示这些模型 */
  models?: AiModelConfig[]
  /** 默认选中的配置项 ID；未设置时使用 models[0] */
  default_model_id?: string
}

export interface ImageModelConfig {
  /** 图像模型 ID，如 dall-e-3 或服务商自定义名称 */
  model: string
  /** 图像模型 API Key */
  api_key: string
  /** 自定义图像 API 地址；未设置时后端使用默认地址 */
  base_url?: string
}

export interface AiModelSettings {
  text: {
    models: AiModelConfig[]
    default_model_id: string
  }
  image: ImageModelConfig | null
}

declare global {
  interface Window {
    /** API 在 pywebviewready 之后才可用 */
    pywebview?: {
      api?: {
        list_books(): Promise<BookSummary[]>
        pick_folder(): Promise<string | null>
        create_book(
          title: string,
          book_type: string,
          categories: string[],
          workspace_root?: string | null,
        ): Promise<Book>
        get_book(book_id: string): Promise<Book | null>
        save_book(
          book_id: string,
          content?: string | null,
          stages?: Record<string, string> | null,
          linked_material_id?: string | null,
          expert_draft?: ExpertDraft | null,
          title?: string | null,
          status?: BookStatus | null,
        ): Promise<Book | null>
        delete_book(book_id: string): Promise<boolean>
        /** 上次选定的工作文件夹（持久化在应用 .data/preferences.json） */
        get_workspace_root(): Promise<string | null>
        set_workspace_root(path: string | null): Promise<void>
        /** 全局创作空间智能体可读配置 */
        get_workspace_agent_read_access(): Promise<Record<string, unknown>>
        set_workspace_agent_read_access(
          config: Record<string, unknown>,
        ): Promise<void>
        /** 本地配置中的默认文字模型与 Key；未配置完整时返回 null */
        get_ai_defaults(): Promise<AiModelDefaults | null>
        /** 本地模型配置，首次为空时由 Python 从旧 .env 导入。 */
        get_ai_model_config(): Promise<AiModelSettings>
        save_ai_model_config(config: AiModelSettings): Promise<AiModelSettings>

        /** 渲染工作台系统提示词（磁盘默认 + `.data/prompt_overrides`，占位符服务端替换）。 */
        get_workspace_system_prompt(
          stage_id: string,
          context_json: string,
        ): Promise<string>
        /** 读取当前生效的共享创作空间智能体模板原文。 */
        read_workspace_agent_prompt_template(agent_id: string): Promise<string>
        save_workspace_agent_prompt_override(
          agent_id: string,
          body: string,
        ): Promise<void>
        reset_workspace_agent_prompt_override(agent_id: string): Promise<boolean>

        // ==================== 素材库 API ====================
        list_materials(): Promise<MaterialSummary[]>
        get_material(material_id: string): Promise<Material | null>
        create_material(
          title: string,
          material_type: string,
          parent_genre?: string | null,
          sub_genre?: string | null,
          workspace_root?: string | null,
        ): Promise<Material>
        save_material(
          material_id: string,
          stages?: Record<string, string> | null,
          title?: string | null,
        ): Promise<Material | null>
        delete_material(material_id: string): Promise<boolean>
        get_material_genres(): Promise<Record<string, string[]>>

        // ==================== 技能库 API ====================
        list_skills(): Promise<SkillSummary[]>
        get_skill(skill_id: string): Promise<Skill | null>
        create_skill(
          title: string,
          genre: string,
          workspace_root?: string | null,
        ): Promise<Skill>
        save_skill(
          skill_id: string,
          stages?: Record<string, string> | null,
          title?: string | null,
        ): Promise<Skill | null>
        delete_skill(skill_id: string): Promise<boolean>

        // ==================== 素材库提示词 API ====================
        get_material_system_prompt(
          material_kind: string,
          stage_id: string,
          context_json: string,
        ): Promise<string>
        read_material_prompt_template(
          material_kind: string,
          stage_id: string,
        ): Promise<string>
        save_material_prompt_override(
          material_kind: string,
          stage_id: string,
          body: string,
        ): Promise<void>
        reset_material_prompt_override(
          material_kind: string,
          stage_id: string,
        ): Promise<boolean>
        read_material_agent_prompt_template(): Promise<string>
        save_material_agent_prompt_override(body: string): Promise<void>
        reset_material_agent_prompt_override(): Promise<boolean>

        // ==================== 技能库提示词 API ====================
        get_skill_system_prompt(
          stage_id: string,
          context_json: string,
        ): Promise<string>
        read_skill_agent_prompt_template(): Promise<string>
        save_skill_agent_prompt_override(body: string): Promise<void>
        reset_skill_agent_prompt_override(): Promise<boolean>

        // ==================== 封面 API ====================
        get_book_cover(book_id: string): Promise<{ cover_data: string | null }>
        generate_book_cover(
          book_id: string,
          prompt: string,
        ): Promise<{ cover_path: string | null; success: boolean; error: string | null }>

        // ==================== 导出 API ====================
        export_docx(
          book_id: string,
          stage_id: string,
          folder_path: string,
          content: string,
          cover_data: string | null,
        ): Promise<{ success: boolean; error: string | null; path: string | null }>
      }
    }
  }
}

const MOCK_STORAGE_KEY = 'write_claw_dev_books'

/** 书架「工作文件夹」持久化键（浏览器 / pywebview 同源存储） */
export const WORKSPACE_ROOT_STORAGE_KEY = 'write_claw_workspace_root'

/** 全局创作空间智能体读取配置（浏览器开发模式 localStorage） */
export const WORKSPACE_AGENT_READ_ACCESS_STORAGE_KEY =
  'write-claw:workspace_agent_read_access'
const LEGACY_STAGE_READ_ACCESS_STORAGE_KEY = 'write-claw:stage_read_access'
const AI_MODEL_CONFIG_STORAGE_KEY = 'write-claw:ai_model_config'

/** 与 main.tsx boot 一致：桌面壳加载的打包页（含本机 HTTP + `?pywebview=1`） */
export function isPywebviewDesktopBundle(): boolean {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return window.location.protocol === 'file:' || params.get('pywebview') === '1'
}

export function getStoredWorkspaceRoot(): string | null {
  try {
    const v = localStorage.getItem(WORKSPACE_ROOT_STORAGE_KEY)
    return v?.trim() ? v.trim() : null
  } catch {
    return null
  }
}

export function setStoredWorkspaceRoot(path: string | null): void {
  try {
    if (path?.trim()) localStorage.setItem(WORKSPACE_ROOT_STORAGE_KEY, path.trim())
    else localStorage.removeItem(WORKSPACE_ROOT_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * 启动时解析工作文件夹：桌面端以 Python 持久化为准；若无则从 localStorage 读取并写回磁盘。
 * 纯浏览器开发仅使用 localStorage。
 *
 * 桌面壳里偶发首帧早于 `api` 注入：先让出 1～2 帧再取桥接；若 `get_workspace_root` 抛错则短重试（避免误显示「未选择」）。
 * 不在「无 api」时循环调用 getBridgeApi，以免重复触发长时间解析。
 */
export async function loadPersistedWorkspaceRoot(): Promise<string | null> {
  const fromLs = getStoredWorkspaceRoot()
  const desktop = isPywebviewDesktopBundle()
  if (desktop) {
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
  }

  const api = await getBridgeApi()
  if (!api?.get_workspace_root || !api?.set_workspace_root) {
    return fromLs
  }

  const attempts = desktop ? 8 : 1
  const delayMs = 100

  for (let i = 0; i < attempts; i++) {
    try {
      const fromDisk = await api.get_workspace_root()
      if (typeof fromDisk === 'string' && fromDisk.trim()) {
        const t = fromDisk.trim()
        setStoredWorkspaceRoot(t)
        return t
      }
      if (fromLs) {
        await api.set_workspace_root(fromLs)
        return fromLs
      }
      return null
    } catch {
      if (desktop && i < attempts - 1) {
        await new Promise<void>((r) => setTimeout(r, delayMs))
        continue
      }
      return fromLs
    }
  }
  return fromLs
}

/** 选择或更改工作文件夹后调用，同步 localStorage 与桌面端 preferences.json */
export async function persistWorkspaceRoot(path: string | null): Promise<void> {
  setStoredWorkspaceRoot(path)
  const api = await getBridgeApi()
  if (api?.set_workspace_root) {
    await api.set_workspace_root(path)
  }
}

function getStoredWorkspaceAgentReadAccessRaw(): unknown {
  try {
    const raw =
      localStorage.getItem(WORKSPACE_AGENT_READ_ACCESS_STORAGE_KEY) ??
      localStorage.getItem(LEGACY_STAGE_READ_ACCESS_STORAGE_KEY)
    if (!raw?.trim()) return null
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function setStoredWorkspaceAgentReadAccess(
  config: WorkspaceAgentReadAccessConfig,
): void {
  try {
    localStorage.setItem(
      WORKSPACE_AGENT_READ_ACCESS_STORAGE_KEY,
      JSON.stringify(config),
    )
  } catch {
    /* ignore */
  }
}

/** 读取全局创作空间智能体可读配置；桌面端以 preferences.json 为准。 */
export async function getWorkspaceAgentReadAccess(): Promise<WorkspaceAgentReadAccessConfig> {
  const api = await getBridgeApi()
  if (api?.get_workspace_agent_read_access) {
    try {
      const fromDisk = await api.get_workspace_agent_read_access()
      const normalized = normalizeWorkspaceAgentReadAccess(fromDisk)
      setStoredWorkspaceAgentReadAccess(normalized)
      try {
        await api.set_workspace_agent_read_access(
          normalized as unknown as Record<string, unknown>,
        )
      } catch {
        /* 读取结果仍可使用；保存失败由后续设置修改重试 */
      }
      return normalized
    } catch {
      /* fall through */
    }
  }
  const normalized = normalizeWorkspaceAgentReadAccess(
    getStoredWorkspaceAgentReadAccessRaw(),
  )
  setStoredWorkspaceAgentReadAccess(normalized)
  return normalized
}

/** 保存全局创作空间智能体可读配置，同步 localStorage 与桌面 preferences。 */
export async function saveWorkspaceAgentReadAccess(
  config: WorkspaceAgentReadAccessConfig,
): Promise<WorkspaceAgentReadAccessConfig> {
  const normalized = normalizeWorkspaceAgentReadAccess(config)
  setStoredWorkspaceAgentReadAccess(normalized)
  const api = await getBridgeApi()
  if (api?.set_workspace_agent_read_access) {
    await api.set_workspace_agent_read_access(
      normalized as unknown as Record<string, unknown>,
    )
  }
  return normalized
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeConfigId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function coerceAiBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'y', 'on', '支持', '开启'].includes(normalized)) {
    return true
  }
  if (['0', 'false', 'no', 'n', 'off', '不支持', '关闭'].includes(normalized)) {
    return false
  }
  return undefined
}

function normalizeAiModelEntry(raw: unknown): AiModelConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const provider = trimString(o.provider ?? o.model_source).toLowerCase()
  const model_id = trimString(o.model_id ?? o.modelId ?? o.model_name)
  const api_key = trimString(o.api_key ?? o.apiKey ?? o.model_key)
  const rawId = trimString(o.id) || model_id || provider
  const id = normalizeConfigId(rawId)
  if (!id || !provider || !model_id || !api_key) return null

  const out: AiModelConfig = {
    id,
    label: trimString(o.label ?? o.display_name ?? o.title) || rawId || model_id,
    provider,
    model_id,
    api_key,
  }
  const base_url = trimString(o.base_url ?? o.baseUrl ?? o.model_url)
  const api = trimString(o.api ?? o.model_like ?? o.modelLike)
  const reasoning = coerceAiBoolean(o.reasoning ?? o.model_reasoning)
  const stream = coerceAiBoolean(o.stream ?? o.model_stream)
  if (base_url) out.base_url = base_url
  if (api) out.api = api
  if (reasoning !== undefined) out.reasoning = reasoning
  if (stream !== undefined) out.stream = stream
  return out
}

function normalizeImageModelConfig(raw: unknown): ImageModelConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const model = trimString(o.model ?? o.image_model)
  const api_key = trimString(o.api_key ?? o.apiKey ?? o.image_model_key)
  if (!model || !api_key) return null
  const out: ImageModelConfig = { model, api_key }
  const base_url = trimString(
    o.base_url ?? o.baseUrl ?? o.image_model_url ?? o.image_url ?? o.image_base_url,
  )
  if (base_url) out.base_url = base_url
  return out
}

export function normalizeAiModelSettings(raw: unknown): AiModelSettings {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const text =
    source.text && typeof source.text === 'object'
      ? (source.text as Record<string, unknown>)
      : source
  const modelsRaw = Array.isArray(text.models) ? text.models : []
  const models: AiModelConfig[] = []
  const seen = new Set<string>()
  for (const item of modelsRaw) {
    const normalized = normalizeAiModelEntry(item)
    if (!normalized) continue
    const baseId = normalized.id
    let id = baseId
    let suffix = 2
    while (seen.has(id)) {
      id = `${baseId}_${suffix}`
      suffix += 1
    }
    seen.add(id)
    models.push({ ...normalized, id })
  }
  let default_model_id = normalizeConfigId(
    trimString(
      text.default_model_id ??
        text.defaultModelId ??
        source.default_model_id ??
        source.default_model,
    ),
  )
  if (!seen.has(default_model_id)) {
    default_model_id = models[0]?.id ?? ''
  }

  return {
    text: { models, default_model_id },
    image: normalizeImageModelConfig(source.image),
  }
}

function storedAiModelConfig(): AiModelSettings {
  try {
    const raw = localStorage.getItem(AI_MODEL_CONFIG_STORAGE_KEY)
    if (!raw?.trim()) return normalizeAiModelSettings(null)
    return normalizeAiModelSettings(JSON.parse(raw) as unknown)
  } catch {
    return normalizeAiModelSettings(null)
  }
}

function setStoredAiModelConfig(config: AiModelSettings): void {
  try {
    localStorage.setItem(AI_MODEL_CONFIG_STORAGE_KEY, JSON.stringify(config))
  } catch {
    /* ignore */
  }
}

export async function getAiModelConfig(): Promise<AiModelSettings> {
  const api = await getBridgeApi()
  if (api?.get_ai_model_config) {
    try {
      const normalized = normalizeAiModelSettings(await api.get_ai_model_config())
      setStoredAiModelConfig(normalized)
      return normalized
    } catch {
      /* fall through */
    }
  }
  return storedAiModelConfig()
}

export async function saveAiModelConfig(
  config: AiModelSettings,
): Promise<AiModelSettings> {
  const normalized = normalizeAiModelSettings(config)
  const api = await getBridgeApi()
  if (api?.save_ai_model_config) {
    const saved = normalizeAiModelSettings(await api.save_ai_model_config(normalized))
    setStoredAiModelConfig(saved)
    return saved
  }
  setStoredAiModelConfig(normalized)
  return normalized
}

export async function getAiModelDefaults(): Promise<AiModelDefaults | null> {
  const settings = await getAiModelConfig()
  const models = settings.text.models
  if (!models.length) return null
  const first = models[0]
  return {
    provider: first.provider,
    model_id: first.model_id,
    api_key: first.api_key,
    models,
    default_model_id: settings.text.default_model_id,
  }
}

function loadMock(): Map<string, Book> {
  try {
    const raw = localStorage.getItem(MOCK_STORAGE_KEY)
    if (!raw) return new Map()
    const arr = JSON.parse(raw) as Book[]
    return new Map(
      arr.map((b) => [
        b.id,
        {
          ...b,
          status: normalizeBookStatus(b.status),
        },
      ]),
    )
  } catch {
    return new Map()
  }
}

function saveMock(map: Map<string, Book>) {
  localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify([...map.values()]))
}

function randomId() {
  return crypto.randomUUID()
}

function normalizeBookStatus(raw: unknown): BookStatus {
  return raw === 'completed' ? 'completed' : 'editing'
}

async function mockListBooks(): Promise<BookSummary[]> {
  const map = loadMock()
  return [...map.values()]
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
    .map(({ id, title, book_type, categories, status, output_dir, linked_material_id }) => ({
      id,
      title,
      book_type,
      categories,
      status: normalizeBookStatus(status),
      output_dir,
      linked_material_id,
    }))
}

async function mockCreateBook(
  title: string,
  book_type: string,
  categories: string[],
  workspace_root?: string | null,
): Promise<Book> {
  const map = loadMock()
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const bt: BookType = book_type === 'short' ? 'short' : 'long'
  const ws = (workspace_root ?? '').trim()
  const safeName = (title.trim() || '未命名').replace(/[<>:"/\\|?*\n\r\t]/g, '_').trim() || '未命名'
  const output_dir =
    ws.length > 0
      ? `${ws.replace(/[/\\]+$/, '')}${typeof window !== 'undefined' && window.navigator.userAgent.includes('Win') ? '\\' : '/'}${safeName}`
      : undefined
  const book: Book = {
    id: randomId(),
    title: title.trim() || '未命名',
    book_type: bt,
    categories: bt === 'short' ? [...categories] : [],
    status: 'editing',
    content: '',
    output_dir,
    linked_material_id: '',
    stages: normalizeAllBookStages({}),
    expert_draft: defaultExpertDraft(),
    created_at: now,
    updated_at: now,
  }
  map.set(book.id, book)
  saveMock(map)
  return book
}

async function mockGetBook(book_id: string): Promise<Book | null> {
  const book = loadMock().get(book_id) ?? null
  if (!book) return null
  return {
    ...book,
    status: normalizeBookStatus(book.status),
    expert_draft: normalizeExpertDraft(book.expert_draft),
  }
}

async function mockSaveBook(
  book_id: string,
  options: {
    content?: string | null
    stages?: Record<string, string> | null
    linked_material_id?: string | null
    expert_draft?: ExpertDraft | null
    title?: string | null
    status?: BookStatus | null
  },
): Promise<Book | null> {
  const map = loadMock()
  const b = map.get(book_id)
  if (!b) return null
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  let next: Book = { ...b, updated_at: now }
  if (options.title != null) {
    next = { ...next, title: options.title.trim() }
  }
  if (options.stages != null) {
    const merged = mergeStagePatchIntoAll(b.stages, options.stages as Partial<Record<StageId, string>>)
    next = { ...next, stages: merged, content: merged[primaryDraftStageId(next)] ?? '' }
  } else if (options.content != null) {
    next = { ...next, content: options.content }
  }
  if (options.linked_material_id !== undefined) {
    const mid = options.linked_material_id?.trim() ?? ''
    next = { ...next, linked_material_id: mid && loadMockMaterials().has(mid) ? mid : '' }
  }
  if (options.expert_draft != null) {
    next = { ...next, expert_draft: normalizeExpertDraft(options.expert_draft) }
  }
  if (options.status != null) {
    next = { ...next, status: normalizeBookStatus(options.status) }
  }
  map.set(book_id, next)
  saveMock(map)
  return next
}

async function mockDeleteBook(book_id: string): Promise<boolean> {
  const map = loadMock()
  const ok = map.delete(book_id)
  if (ok) saveMock(map)
  return ok
}

// ==================== 素材 Mock 数据 ====================

const MOCK_MATERIALS_KEY = 'write_claw_dev_materials'

function loadMockMaterials(): Map<string, Material> {
  try {
    const raw = localStorage.getItem(MOCK_MATERIALS_KEY)
    if (!raw) return new Map()
    const arr = JSON.parse(raw) as Material[]
    return new Map(arr.map((m) => [m.id, m]))
  } catch {
    return new Map()
  }
}

function saveMockMaterials(map: Map<string, Material>) {
  localStorage.setItem(MOCK_MATERIALS_KEY, JSON.stringify([...map.values()]))
}

async function mockListMaterials(): Promise<MaterialSummary[]> {
  const map = loadMockMaterials()
  return [...map.values()]
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
    .map(({ id, title, material_type, parent_genre, sub_genre, output_dir }) => ({
      id,
      title,
      material_type,
      parent_genre,
      sub_genre,
      output_dir,
    }))
}

async function mockGetMaterial(material_id: string): Promise<Material | null> {
  return loadMockMaterials().get(material_id) ?? null
}

async function mockCreateMaterial(
  title: string,
  material_type: string,
  parent_genre?: string | null,
  sub_genre?: string | null,
): Promise<Material> {
  const map = loadMockMaterials()
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const mt: MaterialType = material_type === 'long' ? 'long' : 'short'
  const material: Material = {
    id: randomId(),
    title: title.trim() || '未命名素材',
    material_type: mt,
    parent_genre: mt === 'short' ? (parent_genre || '') : '',
    sub_genre: mt === 'short' ? (sub_genre || '') : '',
    stages: normalizeMaterialStages({}),
    created_at: now,
    updated_at: now,
  }
  map.set(material.id, material)
  saveMockMaterials(map)
  return material
}

async function mockSaveMaterial(
  material_id: string,
  stages?: Record<string, string> | null,
  title?: string,
): Promise<Material | null> {
  const map = loadMockMaterials()
  const m = map.get(material_id)
  if (!m) return null
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  let next: Material = { ...m, updated_at: now }
  if (title != null) {
    next = { ...next, title: title.trim() }
  }
  if (stages != null) {
    const normalized = normalizeMaterialStages(stages as Partial<Record<MaterialStageId, string>>)
    next = { ...next, stages: normalized }
  }
  map.set(material_id, next)
  saveMockMaterials(map)
  return next
}

async function mockDeleteMaterial(material_id: string): Promise<boolean> {
  const map = loadMockMaterials()
  const ok = map.delete(material_id)
  if (ok) saveMockMaterials(map)
  return ok
}

async function mockGetMaterialGenres(): Promise<Record<string, string[]>> {
  return { ...SHORT_MATERIAL_GENRES }
}

// ==================== 技能 Mock 数据 ====================

const MOCK_SKILLS_KEY = 'write_claw_dev_skills'

function loadMockSkills(): Map<string, Skill> {
  try {
    const raw = localStorage.getItem(MOCK_SKILLS_KEY)
    if (!raw) return new Map()
    const arr = JSON.parse(raw) as Skill[]
    return new Map(arr.map((s) => [s.id, s]))
  } catch {
    return new Map()
  }
}

function saveMockSkills(map: Map<string, Skill>) {
  localStorage.setItem(MOCK_SKILLS_KEY, JSON.stringify([...map.values()]))
}

async function mockListSkills(): Promise<SkillSummary[]> {
  const map = loadMockSkills()
  return [...map.values()]
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
    .map(({ id, title, genre, output_dir }) => ({
      id,
      title,
      genre,
      output_dir,
    }))
}

async function mockGetSkill(skill_id: string): Promise<Skill | null> {
  return loadMockSkills().get(skill_id) ?? null
}

async function mockCreateSkill(
  title: string,
  genre: string,
): Promise<Skill> {
  const map = loadMockSkills()
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const skill: Skill = {
    id: randomId(),
    title: title.trim() || '未命名技能',
    genre: SHORT_GENRE_OPTIONS.includes(genre as (typeof SHORT_GENRE_OPTIONS)[number])
      ? genre
      : SHORT_GENRE_OPTIONS[0],
    stages: normalizeSkillStages({}),
    created_at: now,
    updated_at: now,
  }
  map.set(skill.id, skill)
  saveMockSkills(map)
  return skill
}

async function mockSaveSkill(
  skill_id: string,
  stages?: Record<string, string> | null,
  title?: string,
): Promise<Skill | null> {
  const map = loadMockSkills()
  const s = map.get(skill_id)
  if (!s) return null
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  let next: Skill = { ...s, updated_at: now }
  if (title != null) {
    next = { ...next, title: title.trim() }
  }
  if (stages != null) {
    const normalized = normalizeSkillStages(stages as Partial<Record<SkillStageId, string>>)
    next = { ...next, stages: normalized }
  }
  map.set(skill_id, next)
  saveMockSkills(map)
  return next
}

async function mockDeleteSkill(skill_id: string): Promise<boolean> {
  const map = loadMockSkills()
  const ok = map.delete(skill_id)
  if (ok) saveMockSkills(map)
  return ok
}

type BridgeApi = NonNullable<typeof window.pywebview>['api']

/** 已成功拿到的 Python API，避免重复等待 */
let memoApi: BridgeApi | null = null
/** 已确认是纯浏览器（无 pywebview），避免每次列表都轮询 */
let memoBrowserOnly = false

const PYWEBVIEW_READY = 'pywebviewready'

/** 等待 pywebviewready / 首轮超时；桌面生产包给足冷启动时间 */
const BRIDGE_WAIT_MS = import.meta.env.DEV ? 2_000 : 15_000

/** pywebview 对象已出现但 api 仍晚几帧注入时，继续轮询 */
const API_ATTACH_POLL_MS = import.meta.env.DEV ? 3_000 : 15_000
const API_ATTACH_POLL_STEP_MS = 50

/** 单次桥接解析（并发调用共享同一 Promise，避免抢先返回 mock） */
let bridgeWaitSingleton: Promise<BridgeApi | undefined> | null = null

function readBridgeApi(): BridgeApi | undefined {
  return window.pywebview?.api
}

async function resolveBridgeApiOnce(): Promise<BridgeApi | undefined> {
  const read = readBridgeApi

  if (read()) {
    memoApi = read()!
    return memoApi
  }

  if (typeof window.pywebview === 'undefined') {
    for (let i = 0; i < 60; i++) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
      if (typeof window.pywebview !== 'undefined') break
    }
  }

  if (read()) {
    memoApi = read()!
    return memoApi
  }

  await new Promise<void>((resolve) => {
    const done = () => resolve()
    window.addEventListener(PYWEBVIEW_READY, () => queueMicrotask(done), { once: true })
    queueMicrotask(() => read() && done())
    setTimeout(() => read() && done(), 0)
    setTimeout(done, BRIDGE_WAIT_MS)
  })

  const pollUntil = Date.now() + API_ATTACH_POLL_MS
  while (Date.now() < pollUntil) {
    const api = read()
    if (api) {
      memoApi = api
      return api
    }
    await new Promise<void>((r) => setTimeout(r, API_ATTACH_POLL_STEP_MS))
  }

  const api = read()
  if (api) {
    memoApi = api
    return api
  }

  if (typeof window.pywebview === 'undefined') {
    memoBrowserOnly = true
  }
  return undefined
}

/**
 * 获取 pywebview 注入的 Python API。
 * 桌面壳里注入时机不定：此处单例等待 + 就绪后轮询，避免 listBooks / 工作目录等并发调用抢先误走 mock。
 */
export async function getBridgeApi(): Promise<BridgeApi | undefined> {
  if (memoApi) return memoApi
  if (memoBrowserOnly) return undefined

  if (!bridgeWaitSingleton) {
    bridgeWaitSingleton = resolveBridgeApiOnce()
  }

  try {
    const resolved = await bridgeWaitSingleton
    if (memoApi) return memoApi
    if (memoBrowserOnly) return undefined
    return resolved
  } finally {
    bridgeWaitSingleton = null
  }
}

export async function pickFolder(): Promise<string | null> {
  const api = await getBridgeApi()
  if (api?.pick_folder) return api.pick_folder()
  // 浏览器开发：用 prompt 模拟路径，取消返回 null
  const v = window.prompt('开发模式：请输入模拟文件夹路径（留空取消）', '')
  if (v == null || v.trim() === '') return null
  return v.trim()
}

export async function listBooks(): Promise<BookSummary[]> {
  const api = await getBridgeApi()
  if (api) return api.list_books()
  return mockListBooks()
}

export async function createBook(
  title: string,
  book_type: BookType,
  categories: string[],
  workspace_root?: string | null,
): Promise<Book> {
  const api = await getBridgeApi()
  if (api) return api.create_book(title, book_type, categories, workspace_root ?? null)
  return mockCreateBook(title, book_type, categories, workspace_root)
}

export async function getBook(book_id: string): Promise<Book | null> {
  const api = await getBridgeApi()
  if (api) return api.get_book(book_id)
  return mockGetBook(book_id)
}

export type SaveBookOptions = {
  content?: string | null
  stages?: Record<string, string> | null
  linked_material_id?: string | null
  expert_draft?: ExpertDraft | null
  title?: string | null
  status?: BookStatus | null
}

export async function saveBook(
  book_id: string,
  contentOrOptions?: string | SaveBookOptions,
): Promise<Book | null> {
  const api = await getBridgeApi()
  if (typeof contentOrOptions === 'string') {
    if (api) return api.save_book(book_id, contentOrOptions, null)
    return mockSaveBook(book_id, { content: contentOrOptions })
  }
  const opts = contentOrOptions ?? {}
  if (api) {
    return api.save_book(
      book_id,
      opts.content ?? null,
      opts.stages ?? null,
      opts.linked_material_id ?? undefined,
      opts.expert_draft ?? undefined,
      opts.title ?? undefined,
      opts.status ?? undefined,
    )
  }
  return mockSaveBook(book_id, opts)
}

export async function deleteBook(book_id: string): Promise<boolean> {
  const api = await getBridgeApi()
  if (api?.delete_book) return api.delete_book(book_id)
  return mockDeleteBook(book_id)
}

// ==================== 素材 Bridge 函数 ====================

export async function listMaterials(): Promise<MaterialSummary[]> {
  const api = await getBridgeApi()
  if (api?.list_materials) return api.list_materials()
  return mockListMaterials()
}

export async function getMaterial(material_id: string): Promise<Material | null> {
  const api = await getBridgeApi()
  if (api?.get_material) return api.get_material(material_id)
  return mockGetMaterial(material_id)
}

export async function createMaterial(
  title: string,
  material_type: MaterialType,
  parent_genre?: string | null,
  sub_genre?: string | null,
  workspace_root?: string | null,
): Promise<Material> {
  const api = await getBridgeApi()
  if (api?.create_material) {
    return api.create_material(title, material_type, parent_genre ?? null, sub_genre ?? null, workspace_root ?? null)
  }
  return mockCreateMaterial(title, material_type, parent_genre, sub_genre)
}

export type SaveMaterialOptions = {
  stages?: Record<string, string> | null
  title?: string
}

export async function saveMaterial(
  material_id: string,
  options?: SaveMaterialOptions,
): Promise<Material | null> {
  const api = await getBridgeApi()
  const opts = options ?? {}
  if (api?.save_material) {
    return api.save_material(material_id, opts.stages ?? null, opts.title ?? null)
  }
  return mockSaveMaterial(material_id, opts.stages, opts.title)
}

export async function deleteMaterial(material_id: string): Promise<boolean> {
  const api = await getBridgeApi()
  if (api?.delete_material) return api.delete_material(material_id)
  return mockDeleteMaterial(material_id)
}

export async function getMaterialGenres(): Promise<Record<string, string[]>> {
  const api = await getBridgeApi()
  if (api?.get_material_genres) return api.get_material_genres()
  return mockGetMaterialGenres()
}

// ==================== 技能 Bridge 函数 ====================

export async function listSkills(): Promise<SkillSummary[]> {
  const api = await getBridgeApi()
  if (api?.list_skills) return api.list_skills()
  return mockListSkills()
}

export async function getSkill(skill_id: string): Promise<Skill | null> {
  const api = await getBridgeApi()
  if (api?.get_skill) return api.get_skill(skill_id)
  return mockGetSkill(skill_id)
}

export async function createSkill(
  title: string,
  genre: string,
  workspace_root?: string | null,
): Promise<Skill> {
  const api = await getBridgeApi()
  if (api?.create_skill) {
    return api.create_skill(title, genre, workspace_root ?? null)
  }
  return mockCreateSkill(title, genre)
}

export type SaveSkillOptions = {
  stages?: Record<string, string> | null
  title?: string
}

export async function saveSkill(
  skill_id: string,
  options?: SaveSkillOptions,
): Promise<Skill | null> {
  const api = await getBridgeApi()
  const opts = options ?? {}
  if (api?.save_skill) {
    return api.save_skill(skill_id, opts.stages ?? null, opts.title ?? null)
  }
  return mockSaveSkill(skill_id, opts.stages, opts.title)
}

export async function deleteSkill(skill_id: string): Promise<boolean> {
  const api = await getBridgeApi()
  if (api?.delete_skill) return api.delete_skill(skill_id)
  return mockDeleteSkill(skill_id)
}

// ==================== 素材提示词 Bridge 函数 ====================

export async function getMaterialSystemPrompt(
  promptKind: MaterialPromptKind,
  stageId: MaterialStageId,
  input: {
    materialTitle: string
    materialType?: string
    materialGenre?: string
    stageBody: string
    allStages: Partial<Record<MaterialStageId, string>>
  },
): Promise<string> {
  const stagesObj: Record<string, string> = {}
  for (const [k, v] of Object.entries(input.allStages ?? {})) {
    stagesObj[k] = String(v ?? '')
  }

  const api = await getBridgeApi()
  if (api?.get_material_system_prompt) {
    return api.get_material_system_prompt(
      promptKind,
      stageId,
      JSON.stringify({
        material_title: input.materialTitle,
        book_title: input.materialTitle,
        material_type: input.materialType ?? '',
        material_genre: input.materialGenre ?? '',
        stage_body: input.stageBody,
        all_stages: stagesObj,
      }),
    )
  }

  const raw = await readMaterialAgentPromptTemplate()
  return renderPromptFromTemplateRaw(raw, {
    bookTitle: input.materialTitle,
    materialType: input.materialType,
    materialGenre: input.materialGenre,
    stageBody: input.stageBody,
    allStages: input.allStages,
    promptKind,
    stageId,
  })
}

export async function readMaterialAgentPromptTemplate(): Promise<string> {
  const api = await getBridgeApi()
  if (api?.read_material_agent_prompt_template) {
    const t = await api.read_material_agent_prompt_template()
    return t.endsWith('\n') ? t.slice(0, -1) : t
  }
  try {
    const ls = localStorage.getItem(
      localPromptLsKey(MATERIAL_MANAGER_PROMPT_KIND, MATERIAL_MANAGER_AGENT_ID),
    )
    if (ls != null && ls.trim() !== '')
      return ls.endsWith('\n') ? ls.slice(0, -1) : ls
  } catch {
    /* ignore */
  }
  return getEmbeddedPromptTemplate(
    MATERIAL_MANAGER_PROMPT_KIND,
    MATERIAL_MANAGER_AGENT_ID,
  )
}

export async function saveMaterialAgentPromptOverride(
  body: string,
): Promise<void> {
  const api = await getBridgeApi()
  if (api?.save_material_agent_prompt_override) {
    await api.save_material_agent_prompt_override(body)
    return
  }
  try {
    localStorage.setItem(
      localPromptLsKey(MATERIAL_MANAGER_PROMPT_KIND, MATERIAL_MANAGER_AGENT_ID),
      body,
    )
  } catch {
    console.warn('[DeepseekWrite] 无法保存素材库智能体提示词覆盖：无桌面桥接且无可用 localStorage')
  }
}

export async function resetMaterialAgentPromptOverride(): Promise<boolean> {
  const api = await getBridgeApi()
  if (api?.reset_material_agent_prompt_override) {
    return api.reset_material_agent_prompt_override()
  }
  try {
    const k = localPromptLsKey(MATERIAL_MANAGER_PROMPT_KIND, MATERIAL_MANAGER_AGENT_ID)
    const had = localStorage.getItem(k) != null
    localStorage.removeItem(k)
    return had
  } catch {
    return false
  }
}

export async function readMaterialPromptTemplate(
  promptKind: MaterialPromptKind,
  stageId: MaterialStageId,
): Promise<string> {
  void promptKind
  void stageId
  return readMaterialAgentPromptTemplate()
}

export async function saveMaterialPromptOverride(
  promptKind: MaterialPromptKind,
  stageId: MaterialStageId,
  body: string,
): Promise<void> {
  void promptKind
  void stageId
  await saveMaterialAgentPromptOverride(body)
}

export async function resetMaterialPromptOverride(
  promptKind: MaterialPromptKind,
  stageId: MaterialStageId,
): Promise<boolean> {
  void promptKind
  void stageId
  return resetMaterialAgentPromptOverride()
}

// ==================== 技能提示词 Bridge 函数 ====================

export async function getSkillSystemPrompt(
  stageId: SkillStageId,
  input: {
    skillTitle: string
    skillGenre?: string
    stageBody: string
    allStages: Partial<Record<SkillStageId, string>>
  },
): Promise<string> {
  const stagesObj: Record<string, string> = {}
  for (const [k, v] of Object.entries(input.allStages ?? {})) {
    stagesObj[k] = String(v ?? '')
  }

  const api = await getBridgeApi()
  if (api?.get_skill_system_prompt) {
    return api.get_skill_system_prompt(
      stageId,
      JSON.stringify({
        skill_title: input.skillTitle,
        book_title: input.skillTitle,
        skill_genre: input.skillGenre ?? '',
        stage_body: input.stageBody,
        all_stages: stagesObj,
      }),
    )
  }

  const raw = await readSkillAgentPromptTemplate()
  return renderPromptFromTemplateRaw(raw, {
    bookTitle: input.skillTitle,
    skillGenre: input.skillGenre,
    stageBody: input.stageBody,
    allStages: input.allStages,
    promptKind: SKILL_MANAGER_PROMPT_KIND,
    stageId,
  })
}

export async function readSkillAgentPromptTemplate(): Promise<string> {
  const api = await getBridgeApi()
  if (api?.read_skill_agent_prompt_template) {
    const t = await api.read_skill_agent_prompt_template()
    return t.endsWith('\n') ? t.slice(0, -1) : t
  }
  try {
    const ls = localStorage.getItem(
      localPromptLsKey(SKILL_MANAGER_PROMPT_KIND, SKILL_MANAGER_AGENT_ID),
    )
    if (ls != null && ls.trim() !== '')
      return ls.endsWith('\n') ? ls.slice(0, -1) : ls
  } catch {
    /* ignore */
  }
  return getEmbeddedPromptTemplate(
    SKILL_MANAGER_PROMPT_KIND,
    SKILL_MANAGER_AGENT_ID,
  )
}

export async function saveSkillAgentPromptOverride(
  body: string,
): Promise<void> {
  const api = await getBridgeApi()
  if (api?.save_skill_agent_prompt_override) {
    await api.save_skill_agent_prompt_override(body)
    return
  }
  try {
    localStorage.setItem(
      localPromptLsKey(SKILL_MANAGER_PROMPT_KIND, SKILL_MANAGER_AGENT_ID),
      body,
    )
  } catch {
    console.warn('[DeepseekWrite] 无法保存技能库智能体提示词覆盖：无桌面桥接且无可用 localStorage')
  }
}

export async function resetSkillAgentPromptOverride(): Promise<boolean> {
  const api = await getBridgeApi()
  if (api?.reset_skill_agent_prompt_override) {
    return api.reset_skill_agent_prompt_override()
  }
  try {
    const k = localPromptLsKey(SKILL_MANAGER_PROMPT_KIND, SKILL_MANAGER_AGENT_ID)
    const had = localStorage.getItem(k) != null
    localStorage.removeItem(k)
    return had
  } catch {
    return false
  }
}

const PROMPT_TEMPLATE_LS_PREFIX = 'write_claw_prompt_template_override:'
const SHARED_WORKSPACE_PROMPT_KIND = 'shared'
const LEGACY_QINGGAN_PROMPT_KIND = 'qinggan'
const SHARED_PROMPT_LS_MIGRATION_MARKER =
  'write_claw_shared_prompt_migration_from_qinggan_v1'

function localPromptLsKey(promptKind: string, stage: string): string {
  return PROMPT_TEMPLATE_LS_PREFIX + `${promptKind}:${stage}`
}

function ensureLocalSharedPromptMigrated(): void {
  try {
    if (localStorage.getItem(SHARED_PROMPT_LS_MIGRATION_MARKER)) return
    for (const agentId of WORKSPACE_AGENT_IDS) {
      const target = localPromptLsKey(SHARED_WORKSPACE_PROMPT_KIND, agentId)
      const source = localPromptLsKey(LEGACY_QINGGAN_PROMPT_KIND, agentId)
      if (localStorage.getItem(target) == null) {
        const legacy = localStorage.getItem(source)
        if (legacy != null) localStorage.setItem(target, legacy)
      }
    }
    localStorage.setItem(SHARED_PROMPT_LS_MIGRATION_MARKER, '1')
  } catch {
    /* ignore */
  }
}

/** 磁盘 / 嵌入式默认 + （浏览器）localStorage 覆盖；供集中设置页使用。 */
export async function readWorkspaceAgentPromptTemplate(
  agentId: WorkspaceAgentId,
): Promise<string> {
  const api = await getBridgeApi()
  if (api?.read_workspace_agent_prompt_template) {
    const t = await api.read_workspace_agent_prompt_template(agentId)
    return t.endsWith('\n') ? t.slice(0, -1) : t
  }
  ensureLocalSharedPromptMigrated()
  try {
    const ls = localStorage.getItem(
      localPromptLsKey(SHARED_WORKSPACE_PROMPT_KIND, agentId),
    )
    if (ls != null) return ls.endsWith('\n') ? ls.slice(0, -1) : ls
  } catch {
    /* ignore */
  }
  return getEmbeddedPromptTemplate(SHARED_WORKSPACE_PROMPT_KIND, agentId)
}

export async function saveWorkspaceAgentPromptOverride(
  agentId: WorkspaceAgentId,
  body: string,
): Promise<void> {
  const api = await getBridgeApi()
  if (api?.save_workspace_agent_prompt_override) {
    await api.save_workspace_agent_prompt_override(agentId, body)
    return
  }
  ensureLocalSharedPromptMigrated()
  try {
    localStorage.setItem(
      localPromptLsKey(SHARED_WORKSPACE_PROMPT_KIND, agentId),
      body,
    )
  } catch {
    console.warn('[DeepseekWrite] 无法保存创作空间提示词覆盖：无桌面桥接且无可用 localStorage')
  }
}

export async function resetWorkspaceAgentPromptOverride(
  agentId: WorkspaceAgentId,
): Promise<boolean> {
  const api = await getBridgeApi()
  if (api?.reset_workspace_agent_prompt_override) {
    return api.reset_workspace_agent_prompt_override(agentId)
  }
  ensureLocalSharedPromptMigrated()
  try {
    const k = localPromptLsKey(SHARED_WORKSPACE_PROMPT_KIND, agentId)
    const had = localStorage.getItem(k) != null
    localStorage.removeItem(k)
    return had
  } catch {
    return false
  }
}

export async function getBookCover(book_id: string): Promise<{ cover_data: string | null }> {
  const api = await getBridgeApi()
  if (api?.get_book_cover) {
    return api.get_book_cover(book_id)
  }
  return { cover_data: null }
}

export async function generateBookCover(
  book_id: string,
  prompt: string,
): Promise<{ cover_path: string | null; success: boolean; error: string | null }> {
  const api = await getBridgeApi()
  if (api?.generate_book_cover) {
    return api.generate_book_cover(book_id, prompt)
  }
  // 浏览器开发模式：模拟成功
  console.warn('[DeepseekWrite] 浏览器开发模式：封面生成 API 不可用，返回模拟数据')
  return { cover_path: null, success: false, error: '浏览器开发模式暂不支持封面生成' }
}

export async function exportDocx(
  book_id: string,
  stage_id: string,
  folder_path: string,
  content: string,
  cover_data: string | null,
): Promise<{ success: boolean; error: string | null; path: string | null }> {
  const api = await getBridgeApi()
  if (api?.export_docx) {
    return api.export_docx(book_id, stage_id, folder_path, content, cover_data)
  }
  // 浏览器开发模式：提供下载
  try {
    const title = content.slice(0, 20).replace(/[\\/:*?"<>|\n\r\t]/g, '_') || '未命名'
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title}.txt`
    a.click()
    URL.revokeObjectURL(url)
    return { success: true, error: null, path: null }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : '导出失败', path: null }
  }
}

export async function getWorkspaceSystemPrompt(
  stageId: StageId,
  input: {
    bookTitle: string
    bookGenre: string
    stageBody: string
    allStages: Partial<Record<StageId, string>>
    allowedWorkspaceStages: readonly StageId[]
  },
): Promise<string> {
  const stagesObj: Record<string, string> = {}
  for (const [k, v] of Object.entries(input.allStages ?? {})) {
    stagesObj[k] = String(v ?? '')
  }

  const api = await getBridgeApi()
  if (api?.get_workspace_system_prompt) {
    return api.get_workspace_system_prompt(
      stageId,
      JSON.stringify({
        book_title: input.bookTitle,
        book_genre: input.bookGenre,
        stage_body: input.stageBody,
        all_stages: stagesObj,
        allowed_workspace_stages: input.allowedWorkspaceStages,
      }),
    )
  }

  const allowed = new Set(input.allowedWorkspaceStages)
  const filteredStages = Object.fromEntries(
    Object.entries(input.allStages).filter(([id]) => allowed.has(id as StageId)),
  ) as Partial<Record<StageId, string>>
  const raw = await readWorkspaceAgentPromptTemplate(stageId)
  return renderPromptFromTemplateRaw(raw, {
    bookTitle: input.bookTitle,
    bookGenre: input.bookGenre,
    stageBody: input.stageBody,
    allStages: filteredStages,
    promptKind: 'workspace',
    stageId,
  })
}
