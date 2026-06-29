import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Agent } from '@earendil-works/pi-agent-core'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import {
  ApiKeyPromptDialog,
  ChatPanel,
  ModelSelector,
  type Attachment,
} from '@earendil-works/pi-web-ui'
import { memo, useEffect, useRef, useState } from 'react'
import type {
  Material,
  BookType,
  MemoryEntry,
  StageId,
  MaterialStageId,
  MaterialType,
  MaterialPromptKind,
  Skill,
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
import {
  bindWorkspaceChatPreferences,
  getPreferredWorkspaceThinkingLevel,
  resolvePreferredWorkspaceChatModel,
} from '../pi/workspaceChatPreferences'
import { createWorkspaceStreamFn } from '../pi/workspaceStreamFn'
import { convertToLlmWithSkillAsUser } from '../pi/skillMessageTransform'
import { refreshChatPanelTranscript } from '../pi/chatPanelTranscript'
import { createMemoryAwareConvertToLlm } from '../pi/memoryMessageTransform'
import { captureBookMemoryFromMessages } from '../pi/memoryCapture'
import {
  EXPERT_DRAFT_COORDINATOR_AGENT_ID,
  resolveWorkspaceAgentReadAccess,
  type WorkspaceAgentId,
} from '../workspaces/short/stageReadAccess'
import {
  resolveWorkspaceAgentReadAccess as resolveScriptWorkspaceAgentReadAccess,
} from '../workspaces/script/stageReadAccess'
import {
  isWorkspaceSupportedAttachment,
  loadWorkspaceAttachment,
  WORKSPACE_ATTACHMENT_ACCEPTED_TYPES,
  WORKSPACE_ATTACHMENT_SUPPORTED_LABEL,
} from '../utils/documentText'
import { useAppDialog } from './useAppDialog'
import type { AppDialogOptions } from './AppDialog'
import { AiChatHistoryMenu } from './AiChatHistoryMenu'

const ARTIFACTS_TOOL_NAME = 'artifacts'
const WORKSPACE_ATTACHMENT_MAX_FILES = 10

function resolvePromptReadAccess(
  bookType: BookType | undefined,
  config: WorkspaceAgentReadAccessConfig | null | undefined,
  agentId: WorkspaceAgentId,
) {
  return bookType === 'script'
    ? resolveScriptWorkspaceAgentReadAccess(config, agentId)
    : resolveWorkspaceAgentReadAccess(config, agentId)
}
const WORKSPACE_ATTACHMENT_MAX_FILE_SIZE = 20 * 1024 * 1024
const WORKSPACE_SEND_VALIDATION_ERROR_NAME = 'DeepSeekWriteSendValidationError'

type ShowWorkspaceAlert = (
  options: Omit<AppDialogOptions, 'cancelText' | 'hideCancel'>,
) => Promise<boolean>

type MessageEditorElement = HTMLElement & {
  attachments?: Attachment[]
  acceptedTypes?: string
  maxFiles?: number
  maxFileSize?: number
  processingFiles?: boolean
  isDragging?: boolean
  onFilesChange?: (attachments: Attachment[]) => void
  handleFilesSelected?: (event: Event) => void | Promise<void>
  handleDrop?: (event: DragEvent) => void | Promise<void>
  __deepSeekWriteWorkspaceAttachmentLoader?: boolean
  requestUpdate?: () => void
}

type AgentInterfaceElement = HTMLElement & {
  requestUpdate?: () => void
  sendMessage?: (input: string, attachments?: Attachment[]) => void | Promise<void>
  __deepSeekWriteSendValidationGuard?: boolean
}

class WorkspaceSendValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = WORKSPACE_SEND_VALIDATION_ERROR_NAME
  }
}

function isWorkspaceSendValidationError(error: unknown): error is Error {
  return (
    error instanceof Error && error.name === WORKSPACE_SEND_VALIDATION_ERROR_NAME
  )
}

function hasUserMessage(messages: AgentMessage[]): boolean {
  return messages.some(
    (message) =>
      message &&
      typeof message === 'object' &&
      (message as { role?: unknown }).role === 'user',
  )
}

async function addWorkspaceAttachmentFiles(
  editor: MessageEditorElement,
  files: File[],
  showAlert: ShowWorkspaceAlert,
) {
  if (files.length === 0) return

  const maxFiles = editor.maxFiles ?? WORKSPACE_ATTACHMENT_MAX_FILES
  const maxFileSize = editor.maxFileSize ?? WORKSPACE_ATTACHMENT_MAX_FILE_SIZE
  const currentAttachments = editor.attachments ?? []
  if (files.length + currentAttachments.length > maxFiles) {
    await showAlert({
      title: '文件数量超限',
      message: `最多可上传 ${maxFiles} 个文件。`,
    })
    return
  }

  editor.processingFiles = true
  editor.requestUpdate?.()
  const newAttachments: Attachment[] = []

  for (const file of files) {
    try {
      if (file.size > maxFileSize) {
        await showAlert({
          title: '文件过大',
          message: `${file.name} 超过 ${Math.round(maxFileSize / 1024 / 1024)}MB 限制。`,
        })
        continue
      }

      const attachment = await loadWorkspaceAttachment(file)
      if (!isWorkspaceSupportedAttachment(attachment)) {
        await showAlert({
          title: '不支持的附件格式',
          message: `当前仅支持上传${WORKSPACE_ATTACHMENT_SUPPORTED_LABEL}。`,
          details: `不支持：${file.name}`,
        })
        continue
      }
      newAttachments.push(attachment)
    } catch (error) {
      console.error(`Error processing ${file.name}:`, error)
      await showAlert({
        title: '处理附件失败',
        message: `处理 ${file.name} 失败。`,
        details: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (newAttachments.length > 0) {
    editor.attachments = [...(editor.attachments ?? []), ...newAttachments]
    editor.onFilesChange?.(editor.attachments)
  }
  editor.processingFiles = false
  editor.requestUpdate?.()
}

function installWorkspaceAttachmentLoader(
  editor: MessageEditorElement,
  showAlert: ShowWorkspaceAlert,
) {
  if (editor.__deepSeekWriteWorkspaceAttachmentLoader) return

  editor.handleFilesSelected = async (event: Event) => {
    event.stopImmediatePropagation()
    const input = event.target as HTMLInputElement
    await addWorkspaceAttachmentFiles(editor, Array.from(input.files ?? []), showAlert)
    input.value = ''
  }
  editor.handleDrop = async (event: DragEvent) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    editor.isDragging = false
    await addWorkspaceAttachmentFiles(
      editor,
      Array.from(event.dataTransfer?.files ?? []),
      showAlert,
    )
  }
  editor.__deepSeekWriteWorkspaceAttachmentLoader = true
  editor.requestUpdate?.()
}

function getAgentInterface(chatPanel: ChatPanel | null): AgentInterfaceElement | null {
  if (!chatPanel) return null
  if (chatPanel.agentInterface) {
    return chatPanel.agentInterface as AgentInterfaceElement
  }
  return chatPanel.querySelector('agent-interface') as AgentInterfaceElement | null
}

function getMessageEditor(chatPanel: ChatPanel | null): MessageEditorElement | null {
  return getAgentInterface(chatPanel)?.querySelector(
    'message-editor',
  ) as MessageEditorElement | null
}

function applyWorkspaceAttachmentOptions(
  chatPanel: ChatPanel | null,
  showAlert: ShowWorkspaceAlert,
): boolean {
  const editor = getMessageEditor(chatPanel)
  if (!editor) return false
  installWorkspaceAttachmentLoader(editor, showAlert)
  editor.acceptedTypes = WORKSPACE_ATTACHMENT_ACCEPTED_TYPES
  editor.maxFiles = WORKSPACE_ATTACHMENT_MAX_FILES
  editor.maxFileSize = WORKSPACE_ATTACHMENT_MAX_FILE_SIZE
  editor.requestUpdate?.()
  return true
}

function configureWorkspaceAttachmentOptions(
  chatPanel: ChatPanel | null,
  showAlert: ShowWorkspaceAlert,
) {
  if (applyWorkspaceAttachmentOptions(chatPanel, showAlert)) return
  requestAnimationFrame(() => {
    if (applyWorkspaceAttachmentOptions(chatPanel, showAlert)) return
    requestAnimationFrame(() => applyWorkspaceAttachmentOptions(chatPanel, showAlert))
  })
}

function getCurrentAttachments(chatPanel: ChatPanel | null): Attachment[] {
  return getMessageEditor(chatPanel)?.attachments ?? []
}

function refreshWorkspaceChatInput(chatPanel: ChatPanel | null) {
  getMessageEditor(chatPanel)?.requestUpdate?.()
  getAgentInterface(chatPanel)?.requestUpdate?.()
  chatPanel?.requestUpdate?.()
}

function installWorkspaceSendValidationGuard(chatPanel: ChatPanel) {
  const iface = getAgentInterface(chatPanel)
  if (
    !iface ||
    iface.__deepSeekWriteSendValidationGuard ||
    typeof iface.sendMessage !== 'function'
  ) {
    return
  }

  const originalSendMessage = iface.sendMessage.bind(iface)
  iface.sendMessage = async (input, attachments) => {
    try {
      await originalSendMessage(input, attachments)
    } catch (error) {
      if (isWorkspaceSendValidationError(error)) {
        console.warn('[DeepSeekWrite·AI面板] 发送已取消:', error.message)
        refreshWorkspaceChatInput(chatPanel)
        return
      }
      throw error
    }
  }
  iface.__deepSeekWriteSendValidationGuard = true
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
  /** 素材库智能体可见的素材分类上下文。 */
  materialGenre?: string
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
  bookMemories?: MemoryEntry[]
  userMemories?: MemoryEntry[]
  bookMemoryAutoCaptureEnabled?: boolean
  onBookMemoriesCaptured?: (
    bookId: string,
    memories: MemoryEntry[],
  ) => void | Promise<void>
  /** 当前书籍关联的素材库；前期设计阶段会将其暴露为 AI 工具可读取内容 */
  linkedMaterial?: Material | null
  /** 当前书籍绑定的技能库；书籍工作台智能体可按阶段加载技能 */
  linkedSkill?: Skill | null
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
  const promptPullSeqRef = useRef(0)
  const activeHistorySessionIdRef = useRef('')
  const blankHistoryNonceRef = useRef(0)
  const historySaveSeqRef = useRef(0)

  /** 已流式同步到编辑器的 tool call id 集合 */
  const streamedToolCallIdsRef = useRef<Set<string>>(new Set())
  /** 当前正在流式写入编辑器的 tool call 状态 */
  const streamingWriteRef = useRef<StreamingWriteState | null>(null)
  const pendingPlotChildStageRef = useRef<StageId | null>(null)

  const resolveDefaultStreamingWriteTargetStageId = (): WritableStageId => {
    const p = propsLatestRef.current
    if (workspaceType === 'book' && p.stageId === 'plot_design') {
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
    if (workspaceType === 'book' && p.stageId === 'plot_design') {
      const allowed =
        p.bookType === 'script'
          ? ['plot_design', 'plot_refine']
          : ['plot_design', 'intro_design', 'plot_refine']
      return allowed.includes(String(targetStageId)) ? targetStageId : undefined
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

  const debouncedBody = useDebounced(props.stageBody, 600)

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
      (p.bookType !== 'short' && p.bookType !== 'script') ||
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
        console.warn('[DeepSeekWrite memory] capture skipped:', error)
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
    let postAgentEndRaf = 0

    let resizeObserver: ResizeObserver | undefined

    ;(async () => {
      try {
        await ensurePiAppStorage()
      } catch (e) {
        console.warn('[DeepSeekWrite·AI面板] Pi 存储初始化失败，将重试:', e)
        await new Promise((r) => window.setTimeout(r, 500))
        if (cancelled) return
        try {
          await ensurePiAppStorage()
        } catch (e2) {
          console.error('[DeepSeekWrite·AI面板] Pi 存储初始化最终失败:', e2)
          return
        }
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
          workspaceType === 'book' && rawLatest.stageId === 'plot_design'
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
          skillType: latest.skillType,
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
              p.stageId === 'plot_design' &&
              pendingPlotChildStageRef.current
            ) {
              return pendingPlotChildStageRef.current
            }
            return (p.activeStageContentId ?? p.stageId) as StageId
          },
          allStages: mergeLiveStagesFromProps(latest),
          linkedMaterial: latest.linkedMaterial,
          linkedSkill: latest.linkedSkill,
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
                stageBody: resolveCurrentStageBody(props),
                allStages: mergeCurrentStageIntoAllStages(props) as Partial<Record<SkillStageId, string>>,
              },
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
                allowedWorkspaceStages: resolvePromptReadAccess(
                  props.bookType,
                  props.workspaceAgentReadAccess,
                  (props.stageId === 'draft'
                    ? EXPERT_DRAFT_COORDINATOR_AGENT_ID
                    : props.stageId) as WorkspaceAgentId,
                ).workspace as readonly StageId[],
                linkedSkill: props.linkedSkill,
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
        convertToLlm: createMemoryAwareConvertToLlm(
          convertToLlmWithSkillAsUser,
          () => {
            const latest = propsLatestRef.current
            return {
              bookTitle: latest.bookTitle,
              bookType: latest.bookType,
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
            }
          }

          if (ame.type === 'toolcall_delta') {
            const block = ame.partial.content[ame.contentIndex]
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
          const attachments = getCurrentAttachments(chatPanel)
          const unsupported = attachments.filter(
            (attachment) => !isWorkspaceSupportedAttachment(attachment),
          )
          if (unsupported.length > 0) {
            await showAlert({
              title: '不支持的附件格式',
              message: `当前仅支持上传${WORKSPACE_ATTACHMENT_SUPPORTED_LABEL}。`,
              details: `不支持：${unsupported.map((a) => a.fileName).join('、')}`,
            })
            throw new WorkspaceSendValidationError(
              'Unsupported workspace attachment type',
            )
          }

          const hasImage = attachments.some(
            (attachment) =>
              attachment.type === 'image' ||
              attachment.mimeType.startsWith('image/'),
          )
          if (hasImage && !agent.state.model?.input?.includes('image')) {
            const modelName = agent.state.model?.id ?? '当前模型'
            await showAlert({
              title: '当前模型不支持图片',
              message: `${modelName} 不支持图片输入。`,
              details: '请先切换到支持视觉/图片输入的模型，再发送图片附件。',
            })
            throw new WorkspaceSendValidationError(
              'Current model does not support image attachments',
            )
          }
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
      agentRef.current = null
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
               stageBody: latestStageBody,
                allStages: latestAllStages as Partial<Record<SkillStageId, string>>,
              },
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
                allowedWorkspaceStages: resolvePromptReadAccess(
                  p.bookType,
                  p.workspaceAgentReadAccess,
                  (p.stageId === 'draft'
                    ? EXPERT_DRAFT_COORDINATOR_AGENT_ID
                    : p.stageId) as WorkspaceAgentId,
                ).workspace as readonly StageId[],
                linkedSkill: p.linkedSkill,
              },
            )
      if (!agentRef.current || seq !== promptPullSeqRef.current) return
      const agent = agentRef.current
      agent.state.systemPrompt = nextPrompt
      const pendingPlotChildStage =
        workspaceType === 'book' && p.stageId === 'plot_design'
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
        skillType: toolProps.skillType,
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
            live.stageId === 'plot_design' &&
            pendingPlotChildStageRef.current
          ) {
            return pendingPlotChildStageRef.current
          }
          return (live.activeStageContentId ?? live.stageId) as StageId
        },
        allStages: latestAllStages,
        linkedMaterial: toolProps.linkedMaterial,
        linkedSkill: toolProps.linkedSkill,
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
    })().catch((e: unknown) => console.warn('[DeepSeekWrite·工作台提示词]', e))
  }, [
    chatReady,
    props.bookTitle,
    props.bookType,
    props.materialType,
    props.materialTypeKey,
    props.materialGenre,
    props.skillType,
    props.bookGenre,
    props.promptKind,
    props.stageId,
    props.activeStageContentId,
    debouncedBody,
    props.allStages,
    props.linkedMaterial,
    props.linkedSkill,
    props.workspaceAgentReadAccess,
    props.applyToStageEditor,
    props.selectPlotChildStage,
    includePiArtifacts,
    promptRevision,
    isPaused,
    workspaceType,
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

  // 暂停状态变化需要更新
  if (prev.isPaused !== next.isPaused) return false

  // 提示词版本变化需要更新
  if (prev.promptRevision !== next.promptRevision) return false

  // includePiArtifacts 变化需要更新
  if (prev.includePiArtifacts !== next.includePiArtifacts) return false

  // workspaceType 变化需要更新
  if (prev.workspaceType !== next.workspaceType) return false

  if (prev.linkedMaterial?.id !== next.linkedMaterial?.id) return false
  if (prev.linkedMaterial?.updated_at !== next.linkedMaterial?.updated_at) return false
  if (prev.linkedMaterial?.stages !== next.linkedMaterial?.stages) return false
  if (prev.linkedSkill?.id !== next.linkedSkill?.id) return false
  if (prev.linkedSkill?.updated_at !== next.linkedSkill?.updated_at) return false
  if (prev.linkedSkill?.stages !== next.linkedSkill?.stages) return false

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
  if (prev.materialGenre !== next.materialGenre) return false
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
