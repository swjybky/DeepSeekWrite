import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Agent } from '@earendil-works/pi-agent-core'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import {
  ApiKeyPromptDialog,
  ChatPanel,
  ModelSelector,
} from '@earendil-works/pi-web-ui'
import { memo, useEffect, useRef, useState } from 'react'
import type {
  Material,
  MaterialKind,
  MaterialKindWithMixed,
  MaterialStageEntry,
  BookType,
  LongWorkspace,
  MemoryEntry,
  StageId,
  MaterialStageId,
  MaterialType,
  MaterialPromptKind,
  Skill,
  SkillKind,
  SkillManagerSkill,
  SkillStageEntry,
  SkillType,
  SkillStageId,
  WorkspaceAgentReadAccessConfig,
  AiChatHistoryMetadata,
  AiChatHistoryScope,
} from '../bridge'
import {
  deleteAiChatSession,
  getAiChatSession,
  getWorkspaceSystemPrompt,
  getMaterialSystemPrompt,
  getSkillSystemPrompt,
  readSkillManagerSkills,
  listAiChatSessions,
  saveAiChatSession,
} from '../bridge'
import { ensurePiAppStorage } from '../pi/setupPiWorkspace'
import {
  createWorkspaceModelApiKeyResolver,
  openWorkspaceConfiguredModelSelector,
  syncWorkspaceModelButtonLabel,
} from '../pi/resolveWorkspaceChatModel'
import { createPiSessionId } from '../pi/sessionId'
import {
  type ApplyToStageEditorPayload,
  getWorkspaceStageAdditionalTools,
} from '../pi/workspaceStageAgents'
import type { StartLongWriting } from '../workspaces/long/stageAgents'
import { registerLongLedgerChatAgent } from '../workspaces/long/ledgerChatAgentRegistry'
import {
  bindWorkspaceChatPreferences,
  getPreferredWorkspaceThinkingLevel,
  resolvePreferredWorkspaceChatModel,
} from '../pi/workspaceChatPreferences'
import { createWorkspaceStreamFn } from '../pi/workspaceStreamFn'
import { convertToLlmWithSkillAsUser } from '../pi/skillMessageTransform'
import { refreshChatPanelTranscript } from '../pi/chatPanelTranscript'
import {
  createMemoryAwareConvertToLlm,
  type WorkspaceRuntimeLocation,
} from '../pi/memoryMessageTransform'
import { captureBookMemoryFromMessages } from '../pi/memoryCapture'
import {
  getLoadableSkillsForStage as getShortLoadableSkillsForStage,
} from '../workspaces/short/loadSkill'
import {
  getLoadableSkillsForStage as getScriptLoadableSkillsForStage,
} from '../workspaces/script/loadSkill'
import {
  EXPERT_DRAFT_COORDINATOR_AGENT_ID,
  resolveWorkspaceAgentReadAccess,
  type WorkspaceAgentId,
} from '../workspaces/short/stageReadAccess'
import {
  resolveWorkspaceAgentReadAccess as resolveScriptWorkspaceAgentReadAccess,
} from '../workspaces/script/stageReadAccess'
import {
  resolveWorkspaceAgentReadAccess as resolveLongWorkspaceAgentReadAccess,
} from '../workspaces/long/stageReadAccess'
import {
  SHORT_WORKSPACE_CONTENT_STAGES,
  SHORT_WORKSPACE_STAGES,
} from '../workspaces/short/stages'
import {
  SCRIPT_WORKSPACE_CONTENT_STAGES,
  SCRIPT_WORKSPACE_STAGES,
} from '../workspaces/script/stages'
import {
  isLongStageId,
  longRootStageIdForStage,
  longStageLabel,
} from '../workspaces/long/stages'
import {
  bumpLongWorkspace,
  normalizeLongWorkspace,
} from '../workspaces/long/longWorkspace'
import {
  configureWorkspaceAttachmentOptions,
  getWorkspaceAgentInterface as getAgentInterface,
  installWorkspaceSendValidationGuard,
  validateWorkspaceAttachmentsBeforeSend,
} from './workspaceAttachmentSupport'
import { useAppDialog } from './useAppDialog'
import { AiChatHistoryMenu } from './AiChatHistoryMenu'
import {
  configureQuickSkillInput,
  disposeQuickSkillInput,
  type QuickLoadableSkill,
} from './workspaceQuickSkillInput'

const ARTIFACTS_TOOL_NAME = 'artifacts'
const SHORT_BOOK_CONTENT_STAGE_IDS = new Set<string>(
  SHORT_WORKSPACE_CONTENT_STAGES.map((stage) => stage.id),
)
const SCRIPT_BOOK_CONTENT_STAGE_IDS = new Set<string>(
  SCRIPT_WORKSPACE_CONTENT_STAGES.map((stage) => stage.id),
)

function isBookContentStageTarget(
  bookType: BookType | undefined,
  stageId: string,
): boolean {
  if (bookType === 'long') return isLongStageId(stageId)
  if (bookType === 'script') return SCRIPT_BOOK_CONTENT_STAGE_IDS.has(stageId)
  return SHORT_BOOK_CONTENT_STAGE_IDS.has(stageId)
}

function resolveBookRuntimeLocation(
  props: Pick<Props, 'bookType' | 'stageId' | 'activeStageContentId'>,
): WorkspaceRuntimeLocation | undefined {
  if (props.bookType === 'long') {
    const rootId = longRootStageIdForStage(props.stageId)
    const rootLabel =
      rootId === 'worldbuilding'
        ? '世界观'
        : rootId === 'character_design'
          ? '人物'
          : rootId === 'plot_design'
            ? '剧情'
            : rootId === 'continuity_ledger'
              ? '状态账本'
              : '正文'
    return {
      kind: 'stage',
      stageLabel: rootLabel,
      stageDetailLabel: longStageLabel(props.stageId),
    }
  }
  if (props.bookType !== 'short' && props.bookType !== 'script') return undefined
  const visibleStages =
    props.bookType === 'script' ? SCRIPT_WORKSPACE_STAGES : SHORT_WORKSPACE_STAGES
  const contentStages =
    props.bookType === 'script'
      ? SCRIPT_WORKSPACE_CONTENT_STAGES
      : SHORT_WORKSPACE_CONTENT_STAGES
  const stageLabel =
    visibleStages.find((stage) => stage.id === props.stageId)?.label ??
    contentStages.find((stage) => stage.id === props.stageId)?.label ??
    String(props.stageId)
  if (props.stageId !== 'plot_design') {
    return { kind: 'stage', stageLabel }
  }
  const activeContentId = props.activeStageContentId ?? props.stageId
  const stageDetailLabel = contentStages.find(
    (stage) => stage.id === activeContentId,
  )?.label
  return { kind: 'stage', stageLabel, stageDetailLabel }
}

function resolvePromptReadAccess(
  bookType: BookType | undefined,
  config: WorkspaceAgentReadAccessConfig | null | undefined,
  agentId: WorkspaceAgentId | string,
) {
  if (bookType === 'long') {
    return resolveLongWorkspaceAgentReadAccess(config, agentId)
  }
  return bookType === 'script'
    ? resolveScriptWorkspaceAgentReadAccess(
        config,
        agentId as Parameters<typeof resolveScriptWorkspaceAgentReadAccess>[1],
      )
    : resolveWorkspaceAgentReadAccess(config, agentId as WorkspaceAgentId)
}

function resolvePromptAllowedWorkspaceStages(
  bookType: BookType | undefined,
  config: WorkspaceAgentReadAccessConfig | null | undefined,
  agentId: WorkspaceAgentId | string,
  currentStageId: StageId,
): readonly StageId[] {
  const workspace = resolvePromptReadAccess(bookType, config, agentId)
    .workspace as readonly StageId[]
  return bookType === 'long'
    ? [...new Set([...workspace, currentStageId])]
    : workspace
}

function resolvePromptAllowedMaterialKinds(
  bookType: BookType | undefined,
  config: WorkspaceAgentReadAccessConfig | null | undefined,
  agentId: WorkspaceAgentId | string,
): readonly MaterialKind[] {
  return resolvePromptReadAccess(bookType, config, agentId)
    .material as readonly MaterialKind[]
}

function resolvePromptAllowedSkillKinds(
  bookType: BookType | undefined,
  config: WorkspaceAgentReadAccessConfig | null | undefined,
  agentId: WorkspaceAgentId | string,
): readonly SkillKind[] {
  return (resolvePromptReadAccess(bookType, config, agentId).skill ??
    []) as readonly SkillKind[]
}

function hasUserMessage(messages: AgentMessage[]): boolean {
  return messages.some(
    (message) =>
      message &&
      typeof message === 'object' &&
      (message as { role?: unknown }).role === 'user',
  )
}

function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setOut(value), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return out
}

function resolveCurrentStageBody(
  props: Pick<Props, 'stageId' | 'activeStageContentId' | 'stageBody' | 'getCurrentStageBody'>,
): string {
  const contentStageId = props.activeStageContentId ?? props.stageId
  return props.getCurrentStageBody?.(contentStageId) ?? props.stageBody
}

function readLiveWorkspaceStageBodyFromProps(
  props: Pick<
    Props,
    'stageId' | 'activeStageContentId' | 'stageBody' | 'getCurrentStageBody' | 'allStages'
  >,
  stageId?: StageId | MaterialStageId | SkillStageId,
): string {
  const contentStageId = stageId ?? props.activeStageContentId ?? props.stageId
  return (
    props.getCurrentStageBody?.(contentStageId) ??
    (contentStageId === (props.activeStageContentId ?? props.stageId)
      ? props.stageBody
      : props.allStages[contentStageId] ?? '') ??
    ''
  )
}

function mergeLiveStagesFromProps(
  props: Pick<
    Props,
    'stageId' | 'activeStageContentId' | 'stageBody' | 'getCurrentStageBody' | 'allStages'
  >,
): Partial<Record<StageId | MaterialStageId | SkillStageId, string>> {
  const contentStageId = props.activeStageContentId ?? props.stageId
  return {
    ...props.allStages,
    [contentStageId]: readLiveWorkspaceStageBodyFromProps(props, contentStageId),
  }
}

function mergeCurrentStageIntoAllStages(
  props: Pick<Props, 'stageId' | 'activeStageContentId' | 'allStages' | 'stageBody' | 'getCurrentStageBody'>,
): Partial<Record<StageId | MaterialStageId | SkillStageId, string>> {
  return mergeLiveStagesFromProps(props)
}

/** 若当前 tools 里仍有 Pi 注入的 artifacts，则固定放在最前；否则仅返回阶段附加工具。 */
function mergeAgentToolsPreservingArtifacts(
  agentTools: AgentTool[],
  additional: AgentTool[],
): AgentTool[] {
  const art = agentTools.find((t) => t.name === ARTIFACTS_TOOL_NAME)
  return art ? [art, ...additional] : additional
}

function linkedMaterialsFingerprint(
  value: Partial<Record<MaterialKind, Material[]>> | undefined,
): string {
  if (!value) return ''
  return Object.entries(value)
    .flatMap(([kind, materials]) =>
      (materials ?? []).map((material) => [
        kind,
        material.id,
        material.updated_at ?? '',
        material.overview ?? '',
        material.stages,
        material.stage_items,
      ]),
    )
    .map((item) => JSON.stringify(item))
    .join('|')
}

function linkedSkillsFingerprint(
  value: Partial<Record<SkillKind, Skill[]>> | undefined,
): string {
  if (!value) return ''
  return Object.entries(value)
    .flatMap(([kind, skills]) =>
      (skills ?? []).map((skill) => [
        kind,
        skill.id,
        skill.updated_at ?? '',
        skill.skill_kind ?? '',
        skill.overview ?? '',
        skill.stages,
      ]),
    )
    .map((item) => JSON.stringify(item))
    .join('|')
}

function materialStageItemsFingerprint(
  value: Partial<Record<MaterialStageId, MaterialStageEntry[]>> | undefined,
): string {
  if (!value) return ''
  return Object.entries(value)
    .flatMap(([stageId, entries]) =>
      (entries ?? []).map((entry) => [
        stageId,
        entry.id,
        entry.title,
        entry.body,
        entry.updated_at ?? '',
      ]),
    )
    .map((item) => JSON.stringify(item))
    .join('|')
}

function skillStageItemsFingerprint(
  value: Partial<Record<SkillStageId, SkillStageEntry[]>> | undefined,
): string {
  if (!value) return ''
  return Object.entries(value)
    .flatMap(([stageId, entries]) =>
      (entries ?? []).map((entry) => [
        stageId,
        entry.id,
        entry.title,
        entry.body,
        entry.updated_at ?? '',
      ]),
    )
    .map((item) => JSON.stringify(item))
    .join('|')
}

type Props = {
  /** 书籍/素材 id；与 workstation、stageId 一起构成会话 id */
  sessionBookId: string
  /**
   * 同一阶段内「新建对话」时递增；与 sessionBookId 等一并写入 `sessionId`，并应由上层
   * 用 `key` 重建本组件以挂载全新的 Agent / ChatPanel。
   * @default 0
   */
  sessionEpoch?: number
  /** 素材库提示词目录；创作空间/技能库共享提示词时不传。 */
  promptKind?: MaterialPromptKind
  /** 书籍创作空间类型；素材/技能模式不使用。 */
  bookType?: BookType
  bookTitle: string
  /** 素材库智能体可见的素材类型上下文。 */
  materialType?: string
  materialTypeKey?: MaterialType
  materialKind?: MaterialKindWithMixed
  materialEntryKind?: MaterialKind
  /** 素材库智能体可见的素材分类上下文。 */
  materialGenre?: string
  materialOverview?: string
  currentEntryTitle?: string
  materialStageItems?: Partial<Record<MaterialStageId, MaterialStageEntry[]>>
  getMaterialStageItems?: () => Partial<Record<MaterialStageId, MaterialStageEntry[]>>
  getMaterialOverview?: () => string
  selectMaterialEntry?: (stageId: MaterialStageId, entryId: string) => void
  createMaterialEntry?: (input: {
    stageId: MaterialStageId
    title: string
    body: string
  }) => MaterialStageEntry | null
  editMaterialEntry?: (input: {
    stageId: MaterialStageId
    entryId: string
    title?: string
    body?: string
  }) => boolean
  writeMaterialOverview?: (text: string) => void
  skillKind?: SkillKind
  skillOverview?: string
  skillStageItems?: Partial<Record<SkillStageId, SkillStageEntry[]>>
  getSkillStages?: () => Partial<Record<SkillStageId, SkillStageEntry[]>>
  getSkillOverview?: () => string
  selectSkillEntry?: (stageId: SkillStageId, entryId: string) => void
  createSkillEntry?: (input: {
    stageId: SkillStageId
    title: string
    body: string
  }) => SkillStageEntry | null
  editSkillEntry?: (input: {
    stageId: SkillStageId
    entryId: string
    title?: string
    body?: string
  }) => boolean
  writeSkillOverview?: (text: string) => void
  /** 创作空间共享模板可见的书籍分类上下文。 */
  bookGenre?: string
  stageId: StageId | MaterialStageId | SkillStageId
  activeStageContentId?: StageId | MaterialStageId | SkillStageId
  stageBody: string
  getCurrentStageBody?: (
    stageId?: StageId | MaterialStageId | SkillStageId,
  ) => string | undefined
  /** 各阶段全文，用于提示词中的交叉参考 */
  allStages: Partial<Record<StageId | MaterialStageId | SkillStageId, string>>
  /** 长篇 v2 权威结构，仅供长篇智能体只读查询工具使用。 */
  longWorkspace?: LongWorkspace | null
  /** 直接读取书籍会话中的最新长篇结构，避免连续工具调用使用过期 props。 */
  getLongWorkspaceForBook?: (bookId: string) => LongWorkspace | null | undefined
  /** 将结构化长篇变更写回对应书籍会话。 */
  replaceLongWorkspaceForBook?: (
    bookId: string,
    workspace: LongWorkspace,
  ) => boolean | void | Promise<boolean | void>
  /** 长篇正文管理智能体的自动写作调度回调。 */
  startLongWriting?: StartLongWriting
  /** 正文管理智能体启动的当前章节写手；绑定后实时展示同一个 Agent 的执行过程。 */
  externalAgent?: Agent
  externalAgentRevision?: number
  bookMemories?: MemoryEntry[]
  userMemories?: MemoryEntry[]
  bookMemoryAutoCaptureEnabled?: boolean
  onBookMemoriesCaptured?: (
    bookId: string,
    memories: MemoryEntry[],
  ) => void | Promise<void>
  /** 当前书籍关联的素材库；前期设计阶段会将其暴露为 AI 工具可读取内容 */
  linkedMaterial?: Material | null
  linkedMaterialsByKind?: Partial<Record<MaterialKind, Material[]>>
  /** 当前书籍绑定的技能库；书籍工作台智能体可按阶段加载技能 */
  linkedSkill?: Skill | null
  linkedSkillsByKind?: Partial<Record<SkillKind, Skill[]>>
  skillType?: SkillType
  /** 全局创作空间智能体可读配置（仅书籍短篇工作台） */
  workspaceAgentReadAccess?: WorkspaceAgentReadAccessConfig | null
  /**
   * Pi `ChatPanel` 无法在内部关闭，仍会把 `artifacts` 塞进 `agent.state.tools`。
   * 为 `false` 时在 `setAgent` 之后从状态中移除该工具，阶段更新时也仅同步业务工具。
   * @default true
   */
  includePiArtifacts?: boolean
  /** 素材库侧栏「编辑提示词」保存后递增，强制重新拉取模板并刷新 systemPrompt */
  promptRevision?: number
  /** 供「写入当前文本编辑框」工具调用：写入当前阶段文本框 */
  applyToStageEditor?: (payload: ApplyToStageEditorPayload) => void
  /** 剧情父阶段专用：切换左侧剧情子方向。 */
  selectPlotChildStage?: (stageId: StageId) => void
  /** 供工具调用后请求上层保存（如阶段复制后自动落盘） */
  onRequestSave?: () => void | Promise<void>
  /**
   * 是否暂停实时更新（非激活阶段使用）。为 true 时跳过提示词重新加载和工具更新，
   * 减少后台计算开销，但保留对话状态。
   * @default false
   */
  isPaused?: boolean
  /**
   * 工作台类型：书籍工作台、素材库工作台或技能库工作台。
   * 素材/技能模式下使用各自提示词管线。
   * @default 'book'
   */
  workspaceType?: 'book' | 'material' | 'skill'
  chatHistoryScope?: AiChatHistoryScope
  historyPortalTargetId?: string
  externalPromptRequest?: {
    id: number
    prompt: string
  } | null
  onExternalPromptRequestHandled?: (id: number) => void
}

function resolveQuickLoadableSkills(
  props: Props,
  workspaceType: Props['workspaceType'],
): QuickLoadableSkill[] {
  if (workspaceType !== 'book') return []
  if (props.bookType === 'script') {
    const agentId = (props.stageId === 'draft'
      ? EXPERT_DRAFT_COORDINATOR_AGENT_ID
      : props.stageId) as WorkspaceAgentId
    return getScriptLoadableSkillsForStage(
      props.linkedSkill,
      props.stageId,
      props.linkedSkillsByKind,
      resolvePromptAllowedSkillKinds(
        props.bookType,
        props.workspaceAgentReadAccess,
        agentId,
      ),
    )
  }
  const agentId = (props.stageId === 'draft'
    ? EXPERT_DRAFT_COORDINATOR_AGENT_ID
    : props.stageId) as WorkspaceAgentId
  return getShortLoadableSkillsForStage(
    props.linkedSkill,
    props.stageId,
    props.linkedSkillsByKind,
    resolvePromptAllowedSkillKinds(
      props.bookType,
      props.workspaceAgentReadAccess,
      agentId,
    ),
  )
}

type WritableStageId = StageId | MaterialStageId | SkillStageId
type StreamingWriteState = {
  toolCallId: string
  toolName: string
  accumulatedText: string
  hasCleared: boolean
  targetStageId?: WritableStageId
  targetStageIdExplicit: boolean
  originalStageBodies: Record<string, string>
}

type LongStructuredStreamingWriteState = {
  toolCallId: string
  toolName: 'write_worldbuilding_text' | 'write_long_book_line'
  accumulatedText: string
  hasWritten: boolean
  originalText?: string
  targetKey?: string
  latestWorkspace?: LongWorkspace
}

function targetStageIdFromArgs(args: unknown): WritableStageId | undefined {
  if (!args || typeof args !== 'object') return undefined
  const raw = (args as Record<string, unknown>).target_stage_id
  const stageId = String(raw ?? '').trim()
  return stageId ? (stageId as WritableStageId) : undefined
}

function WorkspaceAiChatInner({
  includePiArtifacts = true,
  sessionEpoch = 0,
  promptRevision = 0,
  isPaused = false,
  workspaceType = 'book',
  ...props
}: Props) {
  const { alert: showAlert, confirm, dialog } = useAppDialog()
  const hostRef = useRef<HTMLDivElement>(null)
  const agentRef = useRef<Agent | null>(null)
  const chatPanelRef = useRef<ChatPanel | null>(null)
  const [chatReady, setChatReady] = useState(false)
  const [historySessions, setHistorySessions] = useState<AiChatHistoryMetadata[]>([])
  const [activeHistorySessionId, setActiveHistorySessionId] = useState('')
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyDisabled, setHistoryDisabled] = useState(false)
  const propsLatestRef = useRef(props)
  const isPausedRef = useRef(isPaused)
  const promptPullSeqRef = useRef(0)
  const skillManagerSkillsRef = useRef<SkillManagerSkill[]>([])
  const activeHistorySessionIdRef = useRef('')
  const blankHistoryNonceRef = useRef(0)
  const historySaveSeqRef = useRef(0)
  const handledExternalPromptRequestIdRef = useRef<number | null>(null)

  /** 已流式同步到编辑器的 tool call id 集合 */
  const streamedToolCallIdsRef = useRef<Set<string>>(new Set())
  /** 当前正在流式写入编辑器的 tool call 状态 */
  const streamingWriteRef = useRef<StreamingWriteState | null>(null)
  const longStructuredStreamingWriteRef =
    useRef<LongStructuredStreamingWriteState | null>(null)
  const pendingPlotChildStageRef = useRef<StageId | null>(null)

  const resolveDefaultStreamingWriteTargetStageId = (): WritableStageId => {
    const p = propsLatestRef.current
    if (
      workspaceType === 'book' &&
      p.bookType !== 'long' &&
      p.stageId === 'plot_design'
    ) {
      return (
        pendingPlotChildStageRef.current ??
        p.activeStageContentId ??
        p.stageId
      ) as WritableStageId
    }
    return (p.activeStageContentId ?? p.stageId) as WritableStageId
  }

  const resolveStreamingTargetStageIdFromArgs = (
    args: unknown,
  ): WritableStageId | undefined => {
    const targetStageId = targetStageIdFromArgs(args)
    if (!targetStageId) return undefined
    const p = propsLatestRef.current
    if (workspaceType === 'book') {
      return isBookContentStageTarget(p.bookType, String(targetStageId))
        ? targetStageId
        : undefined
    }
    return targetStageId
  }

  const sameWritableStageId = (
    left: WritableStageId | undefined,
    right: WritableStageId | undefined,
  ) => String(left ?? '') === String(right ?? '')

  const snapshotStreamingStageBody = (
    state: StreamingWriteState,
    stageId: WritableStageId | undefined,
  ) => {
    if (!stageId) return
    const key = String(stageId)
    if (key in state.originalStageBodies) return
    state.originalStageBodies[key] = readLiveWorkspaceStageBodyFromProps(
      propsLatestRef.current,
      stageId,
    )
  }

  const streamLongStructuredText = (
    state: LongStructuredStreamingWriteState,
    args: Record<string, unknown>,
  ) => {
    if (args.mode !== 'replace' || !Object.prototype.hasOwnProperty.call(args, 'text')) {
      return
    }
    const p = propsLatestRef.current
    if (p.bookType !== 'long' || !p.replaceLongWorkspaceForBook) return
    const current =
      state.latestWorkspace ??
      p.getLongWorkspaceForBook?.(p.sessionBookId) ??
      p.longWorkspace
    if (!current) return

    const targetKey = state.toolName === 'write_long_book_line'
      ? 'plot_design.book_line'
      : String(args.category_id ?? '').trim()
    if (!targetKey) return

    const next = normalizeLongWorkspace(current)
    let existing: string
    if (state.toolName === 'write_long_book_line') {
      existing = next.plot.book_line
    } else {
      const category = next.worldbuilding.categories.find(
        (row) => row.id === targetKey,
      )
      if (!category || category.format !== 'text') return
      existing = category.text
    }

    if (state.targetKey !== targetKey) {
      state.targetKey = targetKey
      state.originalText = existing
      state.accumulatedText = ''
      state.latestWorkspace = undefined
    }
    const originalText = state.originalText ?? existing
    state.originalText = originalText
    if (originalText.trim() && args.allow_overwrite_existing !== true) return

    const text = String(args.text ?? '')
    if (text === state.accumulatedText && state.hasWritten) return
    if (state.toolName === 'write_long_book_line') {
      next.plot.book_line = text
    } else {
      const category = next.worldbuilding.categories.find(
        (row) => row.id === targetKey,
      )
      if (!category) return
      category.text = text
    }
    const updated = bumpLongWorkspace(next)
    state.accumulatedText = text
    state.hasWritten = true
    state.latestWorkspace = updated
    p.replaceLongWorkspaceForBook(p.sessionBookId, updated)
  }

  const restoreStreamingStageBody = (
    state: StreamingWriteState,
    stageId: WritableStageId | undefined,
  ) => {
    if (!stageId) return
    const key = String(stageId)
    if (!(key in state.originalStageBodies)) return
    propsLatestRef.current.applyToStageEditor?.({
      text: state.originalStageBodies[key],
      mode: 'replace',
      targetStageId: stageId,
      preserveWhitespace: true,
    })
  }

  const migrateStreamingWriteTarget = (
    state: StreamingWriteState,
    nextTargetStageId: WritableStageId | undefined,
  ) => {
    if (!nextTargetStageId) return
    if (sameWritableStageId(state.targetStageId, nextTargetStageId)) {
      state.targetStageId = nextTargetStageId
      return
    }

    restoreStreamingStageBody(state, state.targetStageId)
    snapshotStreamingStageBody(state, nextTargetStageId)
    state.targetStageId = nextTargetStageId

    if (state.hasCleared || state.accumulatedText.length > 0) {
      propsLatestRef.current.applyToStageEditor?.({
        text: state.accumulatedText,
        mode: 'replace',
        targetStageId: nextTargetStageId,
        preserveWhitespace: true,
      })
      state.hasCleared = true
    }
  }

  useEffect(() => {
    propsLatestRef.current = props
    pendingPlotChildStageRef.current = null
  }, [props])

  useEffect(() => {
    isPausedRef.current = isPaused
  }, [isPaused])

  useEffect(() => {
    const externalAgent = props.externalAgent
    const chatPanel = chatPanelRef.current
    if (!externalAgent || !chatPanel || !chatReady) return
    void chatPanel.setAgent(externalAgent, {
      onApiKeyRequired: async (provider: string) =>
        ApiKeyPromptDialog.prompt(provider),
      onModelSelect: async () => {
        const selectModel = (model: typeof externalAgent.state.model) => {
          externalAgent.state.model = model
          chatPanel.requestUpdate?.()
        }
        const handled = await openWorkspaceConfiguredModelSelector(
          externalAgent.state.model,
          selectModel,
        )
        if (!handled) ModelSelector.open(externalAgent.state.model, selectModel)
      },
    }).then(() => refreshChatPanelTranscript(chatPanel, externalAgent))
  }, [chatReady, props.externalAgent, props.externalAgentRevision])

  const debouncedBody = useDebounced(props.stageBody, 600)
  const externalPromptRequest = props.externalPromptRequest
  const onExternalPromptRequestHandled = props.onExternalPromptRequestHandled

  const resolvePiSessionId = (historyKey?: string) => {
    const p = propsLatestRef.current
    return createPiSessionId(
      'workspace',
      p.sessionBookId,
      workspaceType === 'skill'
        ? `skill_${p.skillType ?? 'short'}_manager`
        : workspaceType === 'material'
          ? `material_${p.materialTypeKey ?? 'short'}_manager`
          : p.bookType === 'script'
            ? 'script_shared'
            : p.bookType === 'long'
              ? 'long_shared'
              : 'shared',
      workspaceType === 'material' || workspaceType === 'skill'
        ? undefined
        : p.stageId,
      p.chatHistoryScope
        ? historyKey || `blank_${sessionEpoch}_${blankHistoryNonceRef.current}`
        : sessionEpoch > 0
          ? sessionEpoch
          : undefined,
    )
  }

  const refreshHistorySessions = async () => {
    const scope = propsLatestRef.current.chatHistoryScope
    if (!scope) {
      setHistorySessions([])
      return []
    }
    const sessions = await listAiChatSessions(scope)
    setHistorySessions(sessions)
    return sessions
  }

  const persistHistoryFromAgent = async (agent: Agent) => {
    const scope = propsLatestRef.current.chatHistoryScope
    if (!scope || !hasUserMessage(agent.state.messages)) return
    const seq = ++historySaveSeqRef.current
    const saved = await saveAiChatSession({
      id: activeHistorySessionIdRef.current,
      scope,
      messages: agent.state.messages,
      model: agent.state.model,
      thinking_level: agent.state.thinkingLevel,
    })
    if (!saved || seq !== historySaveSeqRef.current) return
    activeHistorySessionIdRef.current = saved.id
    setActiveHistorySessionId(saved.id)
    agent.sessionId = resolvePiSessionId(saved.id)
    await refreshHistorySessions()
  }

  const captureMemoryFromAgent = (agent: Agent) => {
    const p = propsLatestRef.current
    if (
      workspaceType !== 'book' ||
      (p.bookType !== 'short' && p.bookType !== 'script' && p.bookType !== 'long') ||
      !p.bookMemoryAutoCaptureEnabled ||
      !p.onBookMemoriesCaptured
    ) {
      return
    }
    const messages = agent.state.messages.slice()
    const bookMemories = [...(p.bookMemories ?? [])]
    const userMemories = [...(p.userMemories ?? [])]
    void (async () => {
      try {
        const next = await captureBookMemoryFromMessages({
          bookId: p.sessionBookId,
          bookTitle: p.bookTitle,
          bookType: p.bookType,
          messages,
          bookMemories,
          userMemories,
        })
        if (next) await p.onBookMemoriesCaptured?.(p.sessionBookId, next)
      } catch (error) {
        console.warn('[DeepWrite memory] capture skipped:', error)
      }
    })()
  }

  const applyHistorySession = async (sessionId: string) => {
    const agent = agentRef.current
    if (!agent) return
    if (agent.state.isStreaming) {
      await showAlert({
        title: '当前对话正在运行',
        message: '请等本轮回复结束后再切换历史对话。',
      })
      return
    }
    setHistoryLoading(true)
    try {
      const session = await getAiChatSession(sessionId)
      if (!session) return
      agent.state.messages = session.messages
      if (session.model) agent.state.model = session.model
      if (session.thinking_level) {
        agent.state.thinkingLevel = session.thinking_level as typeof agent.state.thinkingLevel
      }
      activeHistorySessionIdRef.current = session.id
      setActiveHistorySessionId(session.id)
      agent.sessionId = resolvePiSessionId(session.id)
      refreshChatPanelTranscript(chatPanelRef.current, agent)
      await refreshHistorySessions()
    } finally {
      setHistoryLoading(false)
    }
  }

  const deleteHistorySession = async (sessionId: string) => {
    const ok = await confirm({
      title: '删除历史对话',
      message: '删除后无法恢复，确定要删除这条历史对话吗？',
      confirmText: '删除',
      cancelText: '取消',
      variant: 'danger',
    })
    if (!ok) return
    await deleteAiChatSession(sessionId)
    if (activeHistorySessionIdRef.current === sessionId) {
      const agent = agentRef.current
      activeHistorySessionIdRef.current = ''
      setActiveHistorySessionId('')
      if (agent) {
        agent.state.messages = []
        agent.sessionId = resolvePiSessionId()
        refreshChatPanelTranscript(chatPanelRef.current, agent)
      }
    }
    await refreshHistorySessions()
  }

  useEffect(() => {
    let cancelled = false
    let unsubscribeMessagesRefresh: (() => void) | undefined
    let unsubscribePreferences: (() => void) | undefined
    let unregisterLedgerChatAgent: (() => void) | undefined
    let postAgentEndRaf = 0

    let resizeObserver: ResizeObserver | undefined

    ;(async () => {
      try {
        await ensurePiAppStorage()
      } catch (e) {
        console.warn('[DeepWrite·AI面板] Pi 存储初始化失败，将重试:', e)
        await new Promise((r) => window.setTimeout(r, 500))
        if (cancelled) return
        try {
          await ensurePiAppStorage()
        } catch (e2) {
          console.error('[DeepWrite·AI面板] Pi 存储初始化最终失败:', e2)
          return
        }
      }
      if (cancelled) return
      try {
        skillManagerSkillsRef.current =
          workspaceType === 'skill' ? await readSkillManagerSkills() : []
      } catch (error) {
        skillManagerSkillsRef.current = []
        console.warn('[DeepWrite·AI面板] 技能库管理技能加载失败:', error)
      }
      if (cancelled) return
      const initialModel = await resolvePreferredWorkspaceChatModel()
      const root = hostRef.current
      if (cancelled || !root) return

      const chatPanel = new ChatPanel()
      chatPanelRef.current = chatPanel
      chatPanel.style.flex = '1'
      chatPanel.style.minHeight = '0'
      root.appendChild(chatPanel)

      const nudgePiLayout = () => {
        const panel = chatPanelRef.current
        if (!panel || cancelled) return
        const h = root.getBoundingClientRect().height
        if (h > 0) {
          panel.style.height = `${Math.round(h)}px`
        }
        panel.requestUpdate?.()
        const iface = panel.querySelector(
          'agent-interface',
        ) as (HTMLElement & { requestUpdate?: () => void }) | null
        iface?.requestUpdate?.()
        syncWorkspaceModelButtonLabel(panel, agentRef.current?.state.model)
      }

      resizeObserver = new ResizeObserver(() => {
        if (cancelled) return
        requestAnimationFrame(nudgePiLayout)
      })
      resizeObserver.observe(root)

      const ctxTools = (): AgentTool[] => {
        const rawLatest = propsLatestRef.current
        const pendingPlotChildStage =
          workspaceType === 'book' &&
          rawLatest.bookType !== 'long' &&
          rawLatest.stageId === 'plot_design'
            ? pendingPlotChildStageRef.current
            : null
        const latest = pendingPlotChildStage
          ? {
              ...rawLatest,
              activeStageContentId: pendingPlotChildStage,
            }
          : rawLatest
        return getWorkspaceStageAdditionalTools({
          bookTitle: latest.bookTitle,
          bookType: latest.bookType,
          materialTypeKey: latest.materialTypeKey,
          materialKind: latest.materialKind,
          materialEntryKind: latest.materialEntryKind,
          materialOverview: latest.getMaterialOverview?.() ?? latest.materialOverview,
          currentEntryTitle: latest.currentEntryTitle,
          materialStageItems: latest.getMaterialStageItems?.() ?? latest.materialStageItems,
          getMaterialStageItems: latest.getMaterialStageItems,
          getMaterialOverview: latest.getMaterialOverview,
          selectMaterialEntry: latest.selectMaterialEntry,
          createMaterialEntry: latest.createMaterialEntry,
          editMaterialEntry: latest.editMaterialEntry,
          writeMaterialOverview: latest.writeMaterialOverview,
          skillType: latest.skillType,
          skillKind: latest.skillKind,
          skillManagerSkills: skillManagerSkillsRef.current,
          skillOverview: latest.getSkillOverview?.() ?? latest.skillOverview,
          skillStageItems: latest.getSkillStages?.() ?? latest.skillStageItems,
          getSkillStages: latest.getSkillStages,
          getSkillOverview: latest.getSkillOverview,
          selectSkillEntry: latest.selectSkillEntry,
          createSkillEntry: latest.createSkillEntry,
          editSkillEntry: latest.editSkillEntry,
          writeSkillOverview: latest.writeSkillOverview,
          workspaceType,
          promptKind: latest.promptKind,
          stageId: latest.stageId,
          activeStageContentId: latest.activeStageContentId,
          stageBody: readLiveWorkspaceStageBodyFromProps(latest),
          getCurrentStageBody: (stageId) =>
            readLiveWorkspaceStageBodyFromProps(
              pendingPlotChildStage
                ? {
                    ...propsLatestRef.current,
                    activeStageContentId: pendingPlotChildStage,
                  }
                : propsLatestRef.current,
              stageId,
            ),
          getDefaultWriteStageId: () => {
            const p = propsLatestRef.current
            if (
              workspaceType === 'book' &&
              p.bookType !== 'long' &&
              p.stageId === 'plot_design' &&
              pendingPlotChildStageRef.current
            ) {
              return pendingPlotChildStageRef.current
            }
            return (p.activeStageContentId ?? p.stageId) as StageId
          },
          allStages: mergeLiveStagesFromProps(latest),
          longWorkspace: latest.longWorkspace,
          getLongWorkspace: () => {
            const live = propsLatestRef.current
            return (
              live.getLongWorkspaceForBook?.(live.sessionBookId) ??
              live.longWorkspace
            )
          },
          replaceLongWorkspace: latest.replaceLongWorkspaceForBook
            ? (workspace) =>
                latest.replaceLongWorkspaceForBook?.(
                  latest.sessionBookId,
                  workspace,
                )
            : undefined,
          startLongWriting: latest.startLongWriting,
          linkedMaterial: latest.linkedMaterial,
          linkedMaterialsByKind: latest.linkedMaterialsByKind,
          linkedSkill: latest.linkedSkill,
          linkedSkillsByKind: latest.linkedSkillsByKind,
          workspaceAgentReadAccess: latest.workspaceAgentReadAccess,
          applyToStageEditor: latest.applyToStageEditor,
          selectPlotChildStage: latest.selectPlotChildStage
            ? (stageId) => {
                pendingPlotChildStageRef.current = stageId
                latest.selectPlotChildStage?.(stageId)
              }
            : undefined,
          onRequestSave: latest.onRequestSave,
          isToolCallStreamed: (id) => streamedToolCallIdsRef.current.has(id),
        })
      }

      const systemPromptInitial =
        workspaceType === 'skill'
          ? await getSkillSystemPrompt(
              props.stageId as SkillStageId,
              {
               skillTitle: props.bookTitle,
                skillType: props.skillType ?? 'short',
                skillKind: props.skillKind ?? 'general',
                skillOverview: props.getSkillOverview?.() ?? props.skillOverview,
                currentEntryTitle: props.currentEntryTitle,
                stageBody: resolveCurrentStageBody(props),
                allStages: mergeCurrentStageIntoAllStages(props) as Partial<Record<SkillStageId, string>>,
              },
              skillManagerSkillsRef.current,
            )
          : workspaceType === 'material'
            ? await getMaterialSystemPrompt(
              props.promptKind as MaterialPromptKind,
              props.stageId as MaterialStageId,
              {
                materialTitle: props.bookTitle,
                materialTypeKey: props.materialTypeKey ?? 'short',
                materialType: props.materialType,
                materialGenre: props.materialGenre,
                materialKind: props.materialEntryKind,
                materialOverview: props.getMaterialOverview?.() ?? props.materialOverview,
                currentEntryTitle: props.currentEntryTitle,
                stageBody: resolveCurrentStageBody(props),
                allStages: mergeCurrentStageIntoAllStages(props) as Partial<Record<MaterialStageId, string>>,
              },
            )
            : await getWorkspaceSystemPrompt(
              props.stageId as StageId,
              {
                workspaceType: props.bookType ?? 'short',
                bookTitle: props.bookTitle,
                bookGenre: props.bookGenre ?? '未分类',
                stageBody: resolveCurrentStageBody(props),
                allStages: mergeCurrentStageIntoAllStages(props) as Partial<Record<StageId, string>>,
                allowedWorkspaceStages: resolvePromptAllowedWorkspaceStages(
                  props.bookType,
                  props.workspaceAgentReadAccess,
                  (props.bookType !== 'long' && props.stageId === 'draft'
                    ? EXPERT_DRAFT_COORDINATOR_AGENT_ID
                    : props.stageId) as WorkspaceAgentId,
                  props.stageId as StageId,
                ),
                allowedMaterialKinds: resolvePromptAllowedMaterialKinds(
                  props.bookType,
                  props.workspaceAgentReadAccess,
                  (props.bookType !== 'long' && props.stageId === 'draft'
                    ? EXPERT_DRAFT_COORDINATOR_AGENT_ID
                    : props.stageId) as WorkspaceAgentId,
                ),
                allowedSkillKinds: resolvePromptAllowedSkillKinds(
                  props.bookType,
                  props.workspaceAgentReadAccess,
                  (props.bookType !== 'long' && props.stageId === 'draft'
                    ? EXPERT_DRAFT_COORDINATOR_AGENT_ID
                    : props.stageId) as WorkspaceAgentId,
                ),
                linkedMaterialsByKind: props.linkedMaterialsByKind,
                linkedSkill: props.linkedSkill,
                linkedSkillsByKind: props.linkedSkillsByKind,
              },
            )
      if (cancelled || !hostRef.current) return

      const effectiveModel = initialModel
      const effectiveThinkingLevel = getPreferredWorkspaceThinkingLevel()
      const historyScope = props.chatHistoryScope
      if (historyScope) {
        setHistoryLoading(true)
        try {
          const sessions = await listAiChatSessions(historyScope)
          if (cancelled) return
          setHistorySessions(sessions)
        } finally {
          if (!cancelled) setHistoryLoading(false)
        }
      }
      activeHistorySessionIdRef.current = ''
      setActiveHistorySessionId('')

      const sessionId = resolvePiSessionId()

      const agent = new Agent({
        sessionId,
        // 工作台工具包含“读取最新状态 -> 整体写回”的变更工具。
        // 同一轮并行执行会让它们基于同一旧快照互相覆盖，因此统一串行。
        toolExecution: 'sequential',
        convertToLlm: createMemoryAwareConvertToLlm(
          convertToLlmWithSkillAsUser,
          () => {
            const latest = propsLatestRef.current
            return {
              bookTitle: latest.bookTitle,
              bookType: latest.bookType,
              bookGenre: latest.bookGenre,
              currentLocation:
                workspaceType === 'book'
                  ? resolveBookRuntimeLocation(latest)
                  : undefined,
              bookMemories: workspaceType === 'book' ? latest.bookMemories : [],
              userMemories: workspaceType === 'book' ? latest.userMemories : [],
            }
          },
        ),
        getApiKey: createWorkspaceModelApiKeyResolver(
          () => agentRef.current?.state.model ?? effectiveModel,
        ),
        streamFn: createWorkspaceStreamFn(),
        initialState: {
          systemPrompt: systemPromptInitial,
          model: effectiveModel,
          thinkingLevel: effectiveThinkingLevel,
          messages: [],
          tools: [],
        },
      })
      agentRef.current = agent
      if (
        props.bookType === 'long' &&
        longRootStageIdForStage(String(props.stageId)) === 'continuity_ledger'
      ) {
        unregisterLedgerChatAgent = registerLongLedgerChatAgent(
          props.sessionBookId,
          String(props.stageId),
          agent,
        )
      }
      unsubscribePreferences = bindWorkspaceChatPreferences(agent, () => {
        nudgePiLayout()
        chatPanel.requestUpdate?.()
        requestAnimationFrame(nudgePiLayout)
      })

      // pi-agent-core mutates `messages` in place; pi-web-ui's Lit `message-list`
      // only re-renders when the array reference changes. Without this, turns after
      // tool calls (final assistant text) never appear once streaming clears.
      //
      // `agent_end` is dispatched before `finishRun()` clears `state.isStreaming`.
      // AgentInterface may render once with isStreaming still true and never refresh,
      // so the stop button stays visible — reflow after the next frame when idle.
      unsubscribeMessagesRefresh = agent.subscribe(async (ev) => {
        if (ev.type === 'agent_start') {
          setHistoryDisabled(true)
        }
        if (ev.type === 'message_start') {
          if (ev.message.role === 'assistant') {
            streamedToolCallIdsRef.current.clear()
            streamingWriteRef.current = null
            longStructuredStreamingWriteRef.current = null
          }
        }

        if (ev.type === 'message_update') {
          const ame = ev.assistantMessageEvent
          const apply = propsLatestRef.current.applyToStageEditor
          if (!apply) return

          if (ame.type === 'toolcall_start') {
            const block = ame.partial.content[ame.contentIndex]
            if (block?.type === 'toolCall') {
              const isWriteTool =
                block.name === 'write_workspace_editor' ||
                block.name === 'write_material_editor' ||
                block.name === 'write_skill_editor'
              if (isWriteTool) {
                const args = block.arguments as Record<string, unknown> | undefined
                const targetStageId = resolveStreamingTargetStageIdFromArgs(args)
                streamingWriteRef.current = {
                  toolCallId: block.id,
                  toolName: block.name,
                  accumulatedText: '',
                  hasCleared: false,
                  targetStageId:
                    targetStageId ?? resolveDefaultStreamingWriteTargetStageId(),
                  targetStageIdExplicit: Boolean(targetStageId),
                  originalStageBodies: {},
                }
              }
              if (
                block.name === 'write_worldbuilding_text' ||
                block.name === 'write_long_book_line'
              ) {
                longStructuredStreamingWriteRef.current = {
                  toolCallId: block.id,
                  toolName: block.name,
                  accumulatedText: '',
                  hasWritten: false,
                }
              }
            }
          }

          if (ame.type === 'toolcall_delta') {
            const block = ame.partial.content[ame.contentIndex]
            if (
              block?.type === 'toolCall' &&
              longStructuredStreamingWriteRef.current &&
              block.id === longStructuredStreamingWriteRef.current.toolCallId
            ) {
              streamLongStructuredText(
                longStructuredStreamingWriteRef.current,
                (block.arguments || {}) as Record<string, unknown>,
              )
            }
            if (
              block?.type === 'toolCall' &&
              streamingWriteRef.current &&
                block.id === streamingWriteRef.current.toolCallId
            ) {
              const args = (block.arguments || {}) as Record<string, unknown>
              const text = String(args.text ?? '')
              const mode = args.mode as 'replace' | 'append' | undefined
              const effectiveMode =
                streamingWriteRef.current.toolName === 'write_workspace_editor' && !mode
                  ? 'replace'
                  : mode
              const targetStageId = resolveStreamingTargetStageIdFromArgs(args)
              if (targetStageId) {
                migrateStreamingWriteTarget(
                  streamingWriteRef.current,
                  targetStageId,
                )
                streamingWriteRef.current.targetStageIdExplicit = true
              }
              const effectiveTargetStageId =
                streamingWriteRef.current.targetStageId

              if (effectiveMode === 'replace' && !streamingWriteRef.current.hasCleared) {
                snapshotStreamingStageBody(
                  streamingWriteRef.current,
                  effectiveTargetStageId,
                )
                streamingWriteRef.current.hasCleared = true
                streamingWriteRef.current.accumulatedText = ''
                apply({
                  text: '',
                  mode: 'replace',
                  targetStageId: effectiveTargetStageId || undefined,
                  preserveWhitespace: true,
                })
              }

              const prev = streamingWriteRef.current.accumulatedText
              if (text.length > prev.length && text.startsWith(prev)) {
                const delta = text.slice(prev.length)
                streamingWriteRef.current.accumulatedText = text
                snapshotStreamingStageBody(
                  streamingWriteRef.current,
                  effectiveTargetStageId,
                )
                apply({
                  text: delta,
                  mode: 'append_token',
                  targetStageId: effectiveTargetStageId || undefined,
                })
              } else if (text !== prev) {
                streamingWriteRef.current.accumulatedText = text
                snapshotStreamingStageBody(
                  streamingWriteRef.current,
                  effectiveTargetStageId,
                )
                apply({
                  text: text,
                  mode: 'replace',
                  targetStageId: effectiveTargetStageId || undefined,
                  preserveWhitespace: true,
                })
              }
            }
          }

          if (ame.type === 'toolcall_end') {
            const tc = ame.toolCall
            if (
              tc &&
              longStructuredStreamingWriteRef.current &&
              tc.id === longStructuredStreamingWriteRef.current.toolCallId
            ) {
              const state = longStructuredStreamingWriteRef.current
              const finalArgs = (tc as { arguments?: unknown }).arguments
              if (finalArgs && typeof finalArgs === 'object') {
                streamLongStructuredText(
                  state,
                  finalArgs as Record<string, unknown>,
                )
              }
              if (state.hasWritten) streamedToolCallIdsRef.current.add(tc.id)
              longStructuredStreamingWriteRef.current = null
            }
            if (
              tc &&
              streamingWriteRef.current &&
              tc.id === streamingWriteRef.current.toolCallId
            ) {
              const finalTargetStageId = resolveStreamingTargetStageIdFromArgs(
                (tc as { arguments?: unknown }).arguments,
              )
              if (finalTargetStageId) {
                migrateStreamingWriteTarget(
                  streamingWriteRef.current,
                  finalTargetStageId,
                )
                streamingWriteRef.current.targetStageIdExplicit = true
              }
              const didStream =
                streamingWriteRef.current.hasCleared ||
                streamingWriteRef.current.accumulatedText.length > 0
              if (didStream) streamedToolCallIdsRef.current.add(tc.id)
              const targetStageId = streamingWriteRef.current.targetStageId
              streamingWriteRef.current = null
              if (didStream) {
                apply({ text: '', mode: 'streaming_end', targetStageId })
              }
            }
          }
        }

        if (ev.type === 'message_end') {
          if (ev.message.role === 'user') {
            window.setTimeout(() => captureMemoryFromAgent(agent), 0)
          }
          // 清理未完成的流式写入
          if (streamingWriteRef.current) {
            const didStream =
              streamingWriteRef.current.hasCleared ||
              streamingWriteRef.current.accumulatedText.length > 0
            if (didStream) {
              streamedToolCallIdsRef.current.add(streamingWriteRef.current.toolCallId)
            }
            const targetStageId = streamingWriteRef.current.targetStageId
            streamingWriteRef.current = null
            if (didStream) {
              propsLatestRef.current.applyToStageEditor?.({
                text: '',
                mode: 'streaming_end',
                targetStageId,
              })
            }
          }
          if (longStructuredStreamingWriteRef.current) {
            if (longStructuredStreamingWriteRef.current.hasWritten) {
              streamedToolCallIdsRef.current.add(
                longStructuredStreamingWriteRef.current.toolCallId,
              )
            }
            longStructuredStreamingWriteRef.current = null
          }
          agent.state.messages = agent.state.messages.slice()
        }
        if (ev.type === 'agent_end') {
          try {
            await persistHistoryFromAgent(agent)
          } finally {
            setHistoryDisabled(false)
          }
          cancelAnimationFrame(postAgentEndRaf)
          postAgentEndRaf = requestAnimationFrame(() => {
            postAgentEndRaf = 0
            if (cancelled) return
            const iface = chatPanelRef.current?.querySelector('agent-interface') as
              | (HTMLElement & { requestUpdate?: () => void })
              | null
              | undefined
            iface?.requestUpdate?.()
          })
        }
      })

      await chatPanel.setAgent(agent, {
        onBeforeSend: async () => {
          await validateWorkspaceAttachmentsBeforeSend(
            chatPanel,
            agent.state.model,
            showAlert,
          )
        },
        onApiKeyRequired: async (provider: string) =>
          ApiKeyPromptDialog.prompt(provider),
        onModelSelect: async () => {
          const selectModel = (model: typeof agent.state.model) => {
            agent.state.model = model
            nudgePiLayout()
            requestAnimationFrame(nudgePiLayout)
          }
          const handled = await openWorkspaceConfiguredModelSelector(
            agent.state.model,
            selectModel,
          )
          if (!handled) {
            ModelSelector.open(agent.state.model, selectModel)
          }
        },
        toolsFactory: ctxTools,
      })
      installWorkspaceSendValidationGuard(chatPanel)
      configureWorkspaceAttachmentOptions(chatPanel, showAlert)
      configureQuickSkillInput(chatPanel, {
        getSkills: () =>
          resolveQuickLoadableSkills(propsLatestRef.current, workspaceType),
        isEnabled: () => !isPausedRef.current,
      })

      if (!includePiArtifacts) {
        agent.state.tools = (agent.state.tools ?? []).filter(
          (t) => t.name !== ARTIFACTS_TOOL_NAME,
        )
      }

      if (!cancelled) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (!cancelled) nudgePiLayout()
            window.dispatchEvent(new Event('resize'))
          })
        })
        setChatReady(true)
      }
    })()

    const streamedIdsSnapshot = streamedToolCallIdsRef.current

    return () => {
      cancelled = true
      agentRef.current?.abort()
      cancelAnimationFrame(postAgentEndRaf)
      resizeObserver?.disconnect()
      resizeObserver = undefined
      setChatReady(false)
      setHistoryDisabled(false)
      unsubscribeMessagesRefresh?.()
      unsubscribePreferences?.()
      unregisterLedgerChatAgent?.()
      agentRef.current = null
      disposeQuickSkillInput(chatPanelRef.current)
      chatPanelRef.current?.remove()
      chatPanelRef.current = null
      if (streamingWriteRef.current) {
        const targetStageId = streamingWriteRef.current.targetStageId
        propsLatestRef.current.applyToStageEditor?.({
          text: '',
          mode: 'streaming_end',
          targetStageId,
        })
        streamingWriteRef.current = null
      }
      longStructuredStreamingWriteRef.current = null
      streamedIdsSnapshot.clear()
    }

    // 仅挂载时初始化；换书由上层 key 重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // 暂停状态下跳过提示词更新，减少后台计算
    if (isPaused || !chatReady || !agentRef.current) return
    const seq = ++promptPullSeqRef.current
    ;(async () => {
      const p = propsLatestRef.current
      const contentStageId = p.activeStageContentId ?? p.stageId
      const latestStageBody = readLiveWorkspaceStageBodyFromProps(p, contentStageId)
      const latestAllStages = mergeLiveStagesFromProps(p)
      const nextPrompt =
        workspaceType === 'skill'
          ? await getSkillSystemPrompt(
              p.stageId as SkillStageId,
              {
               skillTitle: p.bookTitle,
                skillType: p.skillType ?? 'short',
                skillKind: p.skillKind ?? 'general',
                skillOverview: p.getSkillOverview?.() ?? p.skillOverview,
                currentEntryTitle: p.currentEntryTitle,
               stageBody: latestStageBody,
                allStages: latestAllStages as Partial<Record<SkillStageId, string>>,
              },
              skillManagerSkillsRef.current,
            )
          : workspaceType === 'material'
            ? await getMaterialSystemPrompt(
              p.promptKind as MaterialPromptKind,
              p.stageId as MaterialStageId,
              {
               materialTitle: p.bookTitle,
                materialTypeKey: p.materialTypeKey ?? 'short',
               materialType: p.materialType,
                materialGenre: p.materialGenre,
                materialKind: p.materialEntryKind,
                materialOverview: p.getMaterialOverview?.() ?? p.materialOverview,
                currentEntryTitle: p.currentEntryTitle,
                stageBody: latestStageBody,
                allStages: latestAllStages as Partial<Record<MaterialStageId, string>>,
              },
            )
            : await getWorkspaceSystemPrompt(
              p.stageId as StageId,
              {
                workspaceType: p.bookType ?? 'short',
                bookTitle: p.bookTitle,
                bookGenre: p.bookGenre ?? '未分类',
                stageBody: latestStageBody,
                allStages: latestAllStages as Partial<Record<StageId, string>>,
                allowedWorkspaceStages: resolvePromptAllowedWorkspaceStages(
                  p.bookType,
                  p.workspaceAgentReadAccess,
                  (p.bookType !== 'long' && p.stageId === 'draft'
                    ? EXPERT_DRAFT_COORDINATOR_AGENT_ID
                    : p.stageId) as WorkspaceAgentId,
                  p.stageId as StageId,
                ),
                allowedMaterialKinds: resolvePromptAllowedMaterialKinds(
                  p.bookType,
                  p.workspaceAgentReadAccess,
                  (p.bookType !== 'long' && p.stageId === 'draft'
                    ? EXPERT_DRAFT_COORDINATOR_AGENT_ID
                    : p.stageId) as WorkspaceAgentId,
                ),
                allowedSkillKinds: resolvePromptAllowedSkillKinds(
                  p.bookType,
                  p.workspaceAgentReadAccess,
                  (p.bookType !== 'long' && p.stageId === 'draft'
                    ? EXPERT_DRAFT_COORDINATOR_AGENT_ID
                    : p.stageId) as WorkspaceAgentId,
                ),
                linkedMaterialsByKind: p.linkedMaterialsByKind,
                linkedSkill: p.linkedSkill,
                linkedSkillsByKind: p.linkedSkillsByKind,
              },
            )
      if (!agentRef.current || seq !== promptPullSeqRef.current) return
      const agent = agentRef.current
      agent.state.systemPrompt = nextPrompt
      const pendingPlotChildStage =
        workspaceType === 'book' &&
        p.bookType !== 'long' &&
        p.stageId === 'plot_design'
          ? pendingPlotChildStageRef.current
          : null
      const toolProps = pendingPlotChildStage
        ? {
            ...p,
            activeStageContentId: pendingPlotChildStage,
          }
        : p
      const extras = getWorkspaceStageAdditionalTools({
        bookTitle: toolProps.bookTitle,
        bookType: toolProps.bookType,
        materialTypeKey: toolProps.materialTypeKey,
        materialKind: toolProps.materialKind,
        materialEntryKind: toolProps.materialEntryKind,
        materialOverview: toolProps.getMaterialOverview?.() ?? toolProps.materialOverview,
        currentEntryTitle: toolProps.currentEntryTitle,
        materialStageItems:
          toolProps.getMaterialStageItems?.() ?? toolProps.materialStageItems,
        getMaterialStageItems: toolProps.getMaterialStageItems,
        getMaterialOverview: toolProps.getMaterialOverview,
        selectMaterialEntry: toolProps.selectMaterialEntry,
        createMaterialEntry: toolProps.createMaterialEntry,
        editMaterialEntry: toolProps.editMaterialEntry,
        writeMaterialOverview: toolProps.writeMaterialOverview,
        skillType: toolProps.skillType,
        skillManagerSkills: skillManagerSkillsRef.current,
        workspaceType,
        promptKind: toolProps.promptKind,
        stageId: toolProps.stageId,
        activeStageContentId: toolProps.activeStageContentId,
        stageBody: latestStageBody,
        getCurrentStageBody: (stageId) =>
          readLiveWorkspaceStageBodyFromProps(
            pendingPlotChildStage
              ? {
                  ...propsLatestRef.current,
                  activeStageContentId: pendingPlotChildStage,
                }
              : propsLatestRef.current,
            stageId,
          ),
        getDefaultWriteStageId: () => {
          const live = propsLatestRef.current
          if (
            workspaceType === 'book' &&
            live.bookType !== 'long' &&
            live.stageId === 'plot_design' &&
            pendingPlotChildStageRef.current
          ) {
            return pendingPlotChildStageRef.current
          }
          return (live.activeStageContentId ?? live.stageId) as StageId
        },
        allStages: latestAllStages,
        longWorkspace: toolProps.longWorkspace,
        getLongWorkspace: () => {
          const live = propsLatestRef.current
          return (
            live.getLongWorkspaceForBook?.(live.sessionBookId) ??
            live.longWorkspace
          )
        },
        replaceLongWorkspace: toolProps.replaceLongWorkspaceForBook
          ? (workspace) =>
              toolProps.replaceLongWorkspaceForBook?.(
                toolProps.sessionBookId,
                workspace,
              )
          : undefined,
        startLongWriting: toolProps.startLongWriting,
        linkedMaterial: toolProps.linkedMaterial,
        linkedMaterialsByKind: toolProps.linkedMaterialsByKind,
        linkedSkill: toolProps.linkedSkill,
        linkedSkillsByKind: toolProps.linkedSkillsByKind,
        skillKind: toolProps.skillKind,
        skillOverview: toolProps.getSkillOverview?.() ?? toolProps.skillOverview,
        skillStageItems: toolProps.getSkillStages?.() ?? toolProps.skillStageItems,
        getSkillStages: toolProps.getSkillStages,
        getSkillOverview: toolProps.getSkillOverview,
        selectSkillEntry: toolProps.selectSkillEntry,
        createSkillEntry: toolProps.createSkillEntry,
        editSkillEntry: toolProps.editSkillEntry,
        writeSkillOverview: toolProps.writeSkillOverview,
        workspaceAgentReadAccess: toolProps.workspaceAgentReadAccess,
        applyToStageEditor: toolProps.applyToStageEditor,
        selectPlotChildStage: toolProps.selectPlotChildStage
          ? (stageId) => {
              pendingPlotChildStageRef.current = stageId
              toolProps.selectPlotChildStage?.(stageId)
            }
          : undefined,
        onRequestSave: toolProps.onRequestSave,
        isToolCallStreamed: (id) => streamedToolCallIdsRef.current.has(id),
      })
      agent.state.tools = includePiArtifacts
        ? mergeAgentToolsPreservingArtifacts(agent.state.tools, extras)
        : extras
    })().catch((e: unknown) => console.warn('[DeepWrite·工作台提示词]', e))
  }, [
    chatReady,
    props.bookTitle,
    props.bookType,
    props.materialType,
    props.materialTypeKey,
    props.materialKind,
    props.materialEntryKind,
    props.materialGenre,
    props.materialOverview,
    props.currentEntryTitle,
    props.materialStageItems,
    props.skillType,
    props.skillKind,
    props.skillOverview,
    props.skillStageItems,
    props.bookGenre,
    props.promptKind,
    props.stageId,
    props.activeStageContentId,
    debouncedBody,
    props.allStages,
    props.longWorkspace,
    props.replaceLongWorkspaceForBook,
    props.startLongWriting,
    props.linkedMaterial,
    props.linkedMaterialsByKind,
    props.linkedSkill,
    props.linkedSkillsByKind,
    props.workspaceAgentReadAccess,
    props.applyToStageEditor,
    props.selectPlotChildStage,
    includePiArtifacts,
    promptRevision,
    isPaused,
    workspaceType,
  ])

  useEffect(() => {
    const request = externalPromptRequest
    if (!request || !chatReady || isPaused) return
    if (handledExternalPromptRequestIdRef.current === request.id) return
    handledExternalPromptRequestIdRef.current = request.id
    onExternalPromptRequestHandled?.(request.id)

    const prompt = request.prompt.trim()
    if (!prompt) return

    void (async () => {
      const agent = agentRef.current
      const chatPanel = chatPanelRef.current
      const iface = getAgentInterface(chatPanel)
      if (!agent || !chatPanel || !iface?.sendMessage) return
      if (agent.state.isStreaming) {
        await showAlert({
          title: '当前对话正在运行',
          message: '请等本轮回复结束后再初始化概述。',
        })
        return
      }
      await iface.sendMessage(prompt, [])
    })().catch((error: unknown) => {
      console.warn('[DeepWrite·AI面板] 外部消息发送失败:', error)
      void showAlert({
        title: '发送失败',
        message: error instanceof Error ? error.message : '无法发送初始化概述指令。',
      })
    })
  }, [
    chatReady,
    externalPromptRequest,
    isPaused,
    onExternalPromptRequestHandled,
    showAlert,
  ])

  const historyMenu = props.chatHistoryScope && (!props.historyPortalTargetId || !isPaused) ? (
    <AiChatHistoryMenu
      sessions={historySessions}
      activeSessionId={activeHistorySessionId}
      loading={historyLoading}
      disabled={historyDisabled}
      portalTargetId={props.historyPortalTargetId}
      onSelect={(sessionId) => applyHistorySession(sessionId)}
      onDelete={(sessionId) => void deleteHistorySession(sessionId)}
    />
  ) : null

  return (
    <>
      {dialog}
      {historyMenu ? (
        props.historyPortalTargetId ? (
          historyMenu
        ) : (
          <div className="workspace-ai-chat-history-row">
            {historyMenu}
          </div>
        )
      ) : null}
      <div ref={hostRef} className="workspace-ai-chat-host" />
    </>
  )
}

/**
 * WorkspaceAiChat 使用 React.memo 包装，自定义比较逻辑：
 * - sessionBookId、sessionEpoch、promptKind 变化时重建；素材库只保留单个管理智能体会话
 * - stageBody 和 allStages 字符串内容变化时更新，但引用变化不触发（流式写入时）
 * - isPaused 变化时更新
 * - promptRevision 变化时更新
 * - applyToStageEditor 函数引用不比较（总是使用最新）
 * - selectPlotChildStage 函数引用不比较（总是使用最新）
 */
export const WorkspaceAiChat = memo(WorkspaceAiChatInner, (prev, next) => {
  // 如果核心标识变化，必须更新
  if (prev.sessionBookId !== next.sessionBookId) return false
  if (prev.sessionEpoch !== next.sessionEpoch) return false
  if (prev.promptKind !== next.promptKind) return false
  if (prev.stageId !== next.stageId) return false
  if (prev.activeStageContentId !== next.activeStageContentId) return false
  if (prev.chatHistoryScope?.owner_type !== next.chatHistoryScope?.owner_type) return false
  if (prev.chatHistoryScope?.owner_id !== next.chatHistoryScope?.owner_id) return false
  if (prev.chatHistoryScope?.category_id !== next.chatHistoryScope?.category_id) return false
  if (prev.historyPortalTargetId !== next.historyPortalTargetId) return false
  if (prev.externalPromptRequest?.id !== next.externalPromptRequest?.id) return false
  if (prev.externalPromptRequest?.prompt !== next.externalPromptRequest?.prompt) return false

  // 暂停状态变化需要更新
  if (prev.isPaused !== next.isPaused) return false

  // 提示词版本变化需要更新
  if (prev.promptRevision !== next.promptRevision) return false

  // includePiArtifacts 变化需要更新
  if (prev.includePiArtifacts !== next.includePiArtifacts) return false

  // workspaceType 变化需要更新
  if (prev.workspaceType !== next.workspaceType) return false

  // 长篇结构变化时必须刷新只读查询工具闭包；只比较 flat stages 会漏掉列表/页签字段。
  if (prev.longWorkspace !== next.longWorkspace) return false
  if (prev.getLongWorkspaceForBook !== next.getLongWorkspaceForBook) return false
  if (prev.replaceLongWorkspaceForBook !== next.replaceLongWorkspaceForBook) return false
  if (prev.startLongWriting !== next.startLongWriting) return false
  if (prev.externalAgent !== next.externalAgent) return false
  if (prev.externalAgentRevision !== next.externalAgentRevision) return false

  if (prev.linkedMaterial?.id !== next.linkedMaterial?.id) return false
  if (prev.linkedMaterial?.updated_at !== next.linkedMaterial?.updated_at) return false
  if (prev.linkedMaterial?.stages !== next.linkedMaterial?.stages) return false
  if (
    linkedMaterialsFingerprint(prev.linkedMaterialsByKind) !==
    linkedMaterialsFingerprint(next.linkedMaterialsByKind)
  ) return false
  if (prev.linkedSkill?.id !== next.linkedSkill?.id) return false
  if (prev.linkedSkill?.updated_at !== next.linkedSkill?.updated_at) return false
  if (prev.linkedSkill?.stages !== next.linkedSkill?.stages) return false
  if (
    linkedSkillsFingerprint(prev.linkedSkillsByKind) !==
    linkedSkillsFingerprint(next.linkedSkillsByKind)
  ) return false
  if (prev.skillKind !== next.skillKind) return false
  if (prev.skillOverview !== next.skillOverview) return false
  if (
    skillStageItemsFingerprint(prev.skillStageItems) !==
    skillStageItemsFingerprint(next.skillStageItems)
  ) return false

  // stageBody 内容变化需要更新（比较字符串值而非引用）
  if (prev.stageBody !== next.stageBody) return false

  // allStages 内容浅比较（阶段数量或内容变化时更新）
  const prevKeys = Object.keys(prev.allStages ?? {})
  const nextKeys = Object.keys(next.allStages ?? {})
  if (prevKeys.length !== nextKeys.length) return false
  for (const key of prevKeys) {
    if (prev.allStages[key as StageId] !== next.allStages[key as StageId]) {
      return false
    }
  }

  // bookTitle 变化需要更新
  if (prev.bookTitle !== next.bookTitle) return false
  if (prev.bookType !== next.bookType) return false
  if (prev.materialType !== next.materialType) return false
  if (prev.materialTypeKey !== next.materialTypeKey) return false
  if (prev.materialKind !== next.materialKind) return false
  if (prev.materialEntryKind !== next.materialEntryKind) return false
  if (prev.materialGenre !== next.materialGenre) return false
  if (prev.materialOverview !== next.materialOverview) return false
  if (prev.currentEntryTitle !== next.currentEntryTitle) return false
  if (
    materialStageItemsFingerprint(prev.materialStageItems) !==
    materialStageItemsFingerprint(next.materialStageItems)
  ) return false
  if (prev.skillType !== next.skillType) return false
  if (prev.bookGenre !== next.bookGenre) return false
  if (prev.bookMemories !== next.bookMemories) return false
  if (prev.userMemories !== next.userMemories) return false
  if (prev.bookMemoryAutoCaptureEnabled !== next.bookMemoryAutoCaptureEnabled) return false
  if (prev.workspaceAgentReadAccess !== next.workspaceAgentReadAccess) return false

  // applyToStageEditor/selectPlotChildStage 函数引用不比较（总是使用最新）

  // 默认不更新（返回 true 表示相同）
  return true
})
