import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Agent } from '@earendil-works/pi-agent-core'
import {
  ApiKeyPromptDialog,
  ChatPanel,
  loadAttachment,
  ModelSelector,
  type Attachment,
} from '@earendil-works/pi-web-ui'
import { memo, useEffect, useRef, useState } from 'react'
import type {
  Material,
  BookType,
  StageId,
  MaterialStageId,
  MaterialType,
  MaterialPromptKind,
  Skill,
  SkillType,
  SkillStageId,
  WorkspaceAgentReadAccessConfig,
} from '../bridge'
import { getWorkspaceSystemPrompt, getMaterialSystemPrompt, getSkillSystemPrompt } from '../bridge'
import { ensurePiAppStorage } from '../pi/setupPiWorkspace'
import {
  openWorkspaceConfiguredModelSelector,
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
import { convertToLlmWithSkillAsUser } from '../pi/skillMessageTransform'
import {
  EXPERT_DRAFT_COORDINATOR_AGENT_ID,
  resolveWorkspaceAgentReadAccess,
  type WorkspaceAgentId,
} from '../workspaces/short/stageReadAccess'
import {
  resolveWorkspaceAgentReadAccess as resolveScriptWorkspaceAgentReadAccess,
} from '../workspaces/script/stageReadAccess'

const ARTIFACTS_TOOL_NAME = 'artifacts'
const WORD_ATTACHMENT_EXTENSIONS = ['.docx']
const LEGACY_WORD_ATTACHMENT_EXTENSIONS = ['.doc']
const WORD_ATTACHMENT_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]
const LEGACY_WORD_ATTACHMENT_MIME_TYPES = ['application/msword']
const EXCEL_ATTACHMENT_EXTENSIONS = ['.xlsx', '.xls']
const EXCEL_ATTACHMENT_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]
const TEXT_ATTACHMENT_EXTENSIONS = ['.txt', '.md']
const TEXT_ATTACHMENT_MIME_TYPES = ['text/plain', 'text/markdown', 'text/x-markdown']
const WORKSPACE_ATTACHMENT_ACCEPTED_TYPES = [
  'image/*',
  ...WORD_ATTACHMENT_EXTENSIONS,
  ...LEGACY_WORD_ATTACHMENT_EXTENSIONS,
  ...WORD_ATTACHMENT_MIME_TYPES,
  ...LEGACY_WORD_ATTACHMENT_MIME_TYPES,
  ...EXCEL_ATTACHMENT_EXTENSIONS,
  ...EXCEL_ATTACHMENT_MIME_TYPES,
  ...TEXT_ATTACHMENT_EXTENSIONS,
  ...TEXT_ATTACHMENT_MIME_TYPES,
].join(',')
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
const WORKSPACE_ATTACHMENT_SUPPORTED_LABEL =
  'Word（.doc/.docx）、Excel（.xlsx/.xls）、TXT、Markdown、图片'
const WORKSPACE_SEND_VALIDATION_ERROR_NAME = 'WriteClawSendValidationError'

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
  __writeClawWorkspaceAttachmentLoader?: boolean
  requestUpdate?: () => void
}

type AgentInterfaceElement = HTMLElement & {
  requestUpdate?: () => void
  sendMessage?: (input: string, attachments?: Attachment[]) => void | Promise<void>
  __writeClawSendValidationGuard?: boolean
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

function hasAttachmentExtension(fileName: string, extensions: string[]): boolean {
  return extensions.some((ext) => fileName.endsWith(ext))
}

function isLegacyWordAttachmentName(fileName: string): boolean {
  return hasAttachmentExtension(fileName.toLowerCase(), LEGACY_WORD_ATTACHMENT_EXTENSIONS)
}

function isLegacyWordFile(file: File): boolean {
  return (
    isLegacyWordAttachmentName(file.name) ||
    LEGACY_WORD_ATTACHMENT_MIME_TYPES.includes(file.type)
  )
}

function arrayBufferToBase64(arrayBuffer: ArrayBuffer): string {
  const bytes = new Uint8Array(arrayBuffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize))
  }
  return btoa(binary)
}

function isReadableDocCodePoint(code: number): boolean {
  return (
    code === 9 ||
    code === 10 ||
    code === 13 ||
    (code >= 0x20 && code <= 0x7e) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0x3400 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef)
  )
}

function collectReadableRuns(text: string, minLength: number): string[] {
  const runs: string[] = []
  let current = ''
  for (const char of text) {
    if (isReadableDocCodePoint(char.codePointAt(0) ?? 0)) {
      current += char
    } else {
      if (current.trim().length >= minLength) runs.push(current)
      current = ''
    }
  }
  if (current.trim().length >= minLength) runs.push(current)
  return runs
}

function collectUtf16ReadableRuns(bytes: Uint8Array, offset: number): string[] {
  let text = ''
  for (let i = offset; i + 1 < bytes.length; i += 2) {
    text += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8))
  }
  return collectReadableRuns(text, 4)
}

function normalizeLegacyDocText(runs: string[]): string {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const run of runs) {
    const normalizedLines = run
      .split('\u0000')
      .join('')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length >= 2)

    for (const line of normalizedLines) {
      if (seen.has(line)) continue
      seen.add(line)
      lines.push(line)
    }
  }
  return lines.join('\n')
}

function extractLegacyWordText(arrayBuffer: ArrayBuffer): string {
  const bytes = new Uint8Array(arrayBuffer)
  const runs = [
    ...collectUtf16ReadableRuns(bytes, 0),
    ...collectUtf16ReadableRuns(bytes, 1),
  ]

  try {
    runs.push(...collectReadableRuns(new TextDecoder('gb18030').decode(bytes), 6))
  } catch {
    runs.push(...collectReadableRuns(new TextDecoder().decode(bytes), 6))
  }

  return normalizeLegacyDocText(runs)
}

async function loadLegacyWordAttachment(file: File): Promise<Attachment> {
  const arrayBuffer = await file.arrayBuffer()
  const extractedBody = extractLegacyWordText(arrayBuffer)
  if (!extractedBody.trim()) {
    throw new Error('无法从 .doc 文件中提取可读文字，请另存为 .docx 后再上传。')
  }
  return {
    id: `${file.name}_${Date.now()}_${Math.random()}`,
    type: 'document',
    fileName: file.name,
    mimeType: 'application/msword',
    size: file.size,
    content: arrayBufferToBase64(arrayBuffer),
    extractedText: `<doc filename="${file.name}">\n${extractedBody}\n</doc>`,
  }
}

function loadWorkspaceAttachment(file: File): Promise<Attachment> {
  if (isLegacyWordFile(file)) {
    return loadLegacyWordAttachment(file)
  }
  return loadAttachment(file)
}

async function addWorkspaceAttachmentFiles(
  editor: MessageEditorElement,
  files: File[],
) {
  if (files.length === 0) return

  const maxFiles = editor.maxFiles ?? WORKSPACE_ATTACHMENT_MAX_FILES
  const maxFileSize = editor.maxFileSize ?? WORKSPACE_ATTACHMENT_MAX_FILE_SIZE
  const currentAttachments = editor.attachments ?? []
  if (files.length + currentAttachments.length > maxFiles) {
    window.alert(`最多可上传 ${maxFiles} 个文件`)
    return
  }

  editor.processingFiles = true
  editor.requestUpdate?.()
  const newAttachments: Attachment[] = []

  for (const file of files) {
    try {
      if (file.size > maxFileSize) {
        window.alert(
          `${file.name} 超过 ${Math.round(maxFileSize / 1024 / 1024)}MB 限制`,
        )
        continue
      }

      const attachment = await loadWorkspaceAttachment(file)
      if (!isWorkspaceSupportedAttachment(attachment)) {
        window.alert(`当前仅支持上传${WORKSPACE_ATTACHMENT_SUPPORTED_LABEL}。\n不支持：${file.name}`)
        continue
      }
      newAttachments.push(attachment)
    } catch (error) {
      console.error(`Error processing ${file.name}:`, error)
      window.alert(
        `处理 ${file.name} 失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  if (newAttachments.length > 0) {
    editor.attachments = [...(editor.attachments ?? []), ...newAttachments]
    editor.onFilesChange?.(editor.attachments)
  }
  editor.processingFiles = false
  editor.requestUpdate?.()
}

function installWorkspaceAttachmentLoader(editor: MessageEditorElement) {
  if (editor.__writeClawWorkspaceAttachmentLoader) return

  editor.handleFilesSelected = async (event: Event) => {
    event.stopImmediatePropagation()
    const input = event.target as HTMLInputElement
    await addWorkspaceAttachmentFiles(editor, Array.from(input.files ?? []))
    input.value = ''
  }
  editor.handleDrop = async (event: DragEvent) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    editor.isDragging = false
    await addWorkspaceAttachmentFiles(
      editor,
      Array.from(event.dataTransfer?.files ?? []),
    )
  }
  editor.__writeClawWorkspaceAttachmentLoader = true
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

function isWorkspaceSupportedAttachment(attachment: Attachment): boolean {
  const fileName = attachment.fileName.toLowerCase()
  if (attachment.type === 'image' || attachment.mimeType.startsWith('image/')) {
    return true
  }
  if (hasAttachmentExtension(fileName, WORD_ATTACHMENT_EXTENSIONS)) {
    return true
  }
  if (hasAttachmentExtension(fileName, LEGACY_WORD_ATTACHMENT_EXTENSIONS)) {
    return true
  }
  if (hasAttachmentExtension(fileName, EXCEL_ATTACHMENT_EXTENSIONS)) {
    return true
  }
  if (hasAttachmentExtension(fileName, TEXT_ATTACHMENT_EXTENSIONS)) {
    return true
  }
  return [
    ...WORD_ATTACHMENT_MIME_TYPES,
    ...LEGACY_WORD_ATTACHMENT_MIME_TYPES,
    ...EXCEL_ATTACHMENT_MIME_TYPES,
    ...TEXT_ATTACHMENT_MIME_TYPES,
  ].includes(attachment.mimeType)
}

function applyWorkspaceAttachmentOptions(chatPanel: ChatPanel | null): boolean {
  const editor = getMessageEditor(chatPanel)
  if (!editor) return false
  installWorkspaceAttachmentLoader(editor)
  editor.acceptedTypes = WORKSPACE_ATTACHMENT_ACCEPTED_TYPES
  editor.maxFiles = WORKSPACE_ATTACHMENT_MAX_FILES
  editor.maxFileSize = WORKSPACE_ATTACHMENT_MAX_FILE_SIZE
  editor.requestUpdate?.()
  return true
}

function configureWorkspaceAttachmentOptions(chatPanel: ChatPanel | null) {
  if (applyWorkspaceAttachmentOptions(chatPanel)) return
  requestAnimationFrame(() => {
    if (applyWorkspaceAttachmentOptions(chatPanel)) return
    requestAnimationFrame(() => applyWorkspaceAttachmentOptions(chatPanel))
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
    iface.__writeClawSendValidationGuard ||
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
        console.warn('[DeepseekWrite·AI面板] 发送已取消:', error.message)
        refreshWorkspaceChatInput(chatPanel)
        return
      }
      throw error
    }
  }
  iface.__writeClawSendValidationGuard = true
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

function mergeCurrentStageIntoAllStages(
  props: Pick<Props, 'stageId' | 'activeStageContentId' | 'allStages' | 'stageBody' | 'getCurrentStageBody'>,
): Partial<Record<StageId | MaterialStageId | SkillStageId, string>> {
  const contentStageId = props.activeStageContentId ?? props.stageId
  return {
    ...props.allStages,
    [contentStageId]: resolveCurrentStageBody(props),
  }
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
}

function WorkspaceAiChatInner({
  includePiArtifacts = true,
  sessionEpoch = 0,
  promptRevision = 0,
  isPaused = false,
  workspaceType = 'book',
  ...props
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const agentRef = useRef<Agent | null>(null)
  const chatPanelRef = useRef<ChatPanel | null>(null)
  const [chatReady, setChatReady] = useState(false)
  const propsLatestRef = useRef(props)
  const promptPullSeqRef = useRef(0)

  /** 已流式同步到编辑器的 tool call id 集合 */
  const streamedToolCallIdsRef = useRef<Set<string>>(new Set())
  /** 当前正在流式写入编辑器的 tool call 状态 */
  const streamingWriteRef = useRef<{
    toolCallId: string
    accumulatedText: string
    hasCleared: boolean
    targetStageId?: StageId | MaterialStageId | SkillStageId
  } | null>(null)

  useEffect(() => {
    propsLatestRef.current = props
  }, [props])

  const debouncedBody = useDebounced(props.stageBody, 600)

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
        console.warn('[DeepseekWrite·AI面板] Pi 存储初始化失败，将重试:', e)
        await new Promise((r) => window.setTimeout(r, 500))
        if (cancelled) return
        try {
          await ensurePiAppStorage()
        } catch (e2) {
          console.error('[DeepseekWrite·AI面板] Pi 存储初始化最终失败:', e2)
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
      }

      resizeObserver = new ResizeObserver(() => {
        if (cancelled) return
        requestAnimationFrame(nudgePiLayout)
      })
      resizeObserver.observe(root)

      const ctxTools = (): AgentTool[] => {
        const latest = propsLatestRef.current
        return getWorkspaceStageAdditionalTools({
          bookTitle: latest.bookTitle,
          bookType: latest.bookType,
          materialTypeKey: latest.materialTypeKey,
          skillType: latest.skillType,
          workspaceType,
          promptKind: latest.promptKind,
          stageId: latest.stageId,
          activeStageContentId: latest.activeStageContentId,
          stageBody: resolveCurrentStageBody(latest),
          getCurrentStageBody: (stageId) =>
            latest.getCurrentStageBody?.(stageId ?? latest.activeStageContentId ?? latest.stageId),
          allStages: mergeCurrentStageIntoAllStages(latest),
          linkedMaterial: latest.linkedMaterial,
          linkedSkill: latest.linkedSkill,
          workspaceAgentReadAccess: latest.workspaceAgentReadAccess,
          applyToStageEditor: latest.applyToStageEditor,
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

      const sessionId = createPiSessionId(
        'workspace',
        props.sessionBookId,
        workspaceType === 'skill'
          ? `skill_${props.skillType ?? 'short'}_manager`
          : workspaceType === 'material'
            ? `material_${props.materialTypeKey ?? 'short'}_manager`
            : props.bookType === 'script'
              ? 'script_shared'
              : 'shared',
        workspaceType === 'material' || workspaceType === 'skill'
          ? undefined
          : props.stageId,
        sessionEpoch > 0 ? sessionEpoch : undefined,
      )

      const agent = new Agent({
        sessionId,
        convertToLlm: convertToLlmWithSkillAsUser,
        initialState: {
          systemPrompt: systemPromptInitial,
          model: initialModel,
          thinkingLevel: getPreferredWorkspaceThinkingLevel(),
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
                streamingWriteRef.current = {
                  toolCallId: block.id,
                  accumulatedText: '',
                  hasCleared: false,
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
              const targetStageId = String(args.target_stage_id ?? '').trim() as
                | StageId
                | MaterialStageId
                | SkillStageId
                | ''
              if (targetStageId) {
                streamingWriteRef.current.targetStageId = targetStageId
              }
              const effectiveTargetStageId =
                targetStageId || streamingWriteRef.current.targetStageId

              if (mode === 'replace' && !streamingWriteRef.current.hasCleared) {
                streamingWriteRef.current.hasCleared = true
                streamingWriteRef.current.accumulatedText = ''
                apply({
                  text: '',
                  mode: 'replace',
                  targetStageId: effectiveTargetStageId || undefined,
                })
              }

              const prev = streamingWriteRef.current.accumulatedText
              if (text.length > prev.length && text.startsWith(prev)) {
                const delta = text.slice(prev.length)
                streamingWriteRef.current.accumulatedText = text
                apply({
                  text: delta,
                  mode: 'append_token',
                  targetStageId: effectiveTargetStageId || undefined,
                })
              } else if (text !== prev) {
                streamingWriteRef.current.accumulatedText = text
                apply({
                  text: text,
                  mode: 'replace',
                  targetStageId: effectiveTargetStageId || undefined,
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
              streamedToolCallIdsRef.current.add(tc.id)
              const targetStageId = streamingWriteRef.current.targetStageId
              streamingWriteRef.current = null
              apply({ text: '', mode: 'streaming_end', targetStageId })
            }
          }
        }

        if (ev.type === 'message_end') {
          // 清理未完成的流式写入
          if (streamingWriteRef.current) {
            streamedToolCallIdsRef.current.add(streamingWriteRef.current.toolCallId)
            const targetStageId = streamingWriteRef.current.targetStageId
            streamingWriteRef.current = null
            propsLatestRef.current.applyToStageEditor?.({
              text: '',
              mode: 'streaming_end',
              targetStageId,
            })
          }
          agent.state.messages = agent.state.messages.slice()
        }
        if (ev.type === 'agent_end') {
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
            window.alert(
              `当前仅支持上传${WORKSPACE_ATTACHMENT_SUPPORTED_LABEL}。` +
                `\n不支持：${unsupported.map((a) => a.fileName).join('、')}`,
            )
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
            window.alert(
              `${modelName} 不支持图片输入。请先切换到支持视觉/图片输入的模型，再发送图片附件。`,
            )
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
      configureWorkspaceAttachmentOptions(chatPanel)

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
      const latestStageBody =
        p.getCurrentStageBody?.(contentStageId) ?? debouncedBody
      const latestAllStages = {
        ...p.allStages,
        [contentStageId]: latestStageBody,
      }
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
      const extras = getWorkspaceStageAdditionalTools({
        bookTitle: p.bookTitle,
        bookType: p.bookType,
        materialTypeKey: p.materialTypeKey,
        skillType: p.skillType,
        workspaceType,
        promptKind: p.promptKind,
        stageId: p.stageId,
        activeStageContentId: p.activeStageContentId,
        stageBody: latestStageBody,
        getCurrentStageBody: (stageId) =>
          p.getCurrentStageBody?.(stageId ?? p.activeStageContentId ?? p.stageId),
        allStages: latestAllStages,
        linkedMaterial: p.linkedMaterial,
        linkedSkill: p.linkedSkill,
        workspaceAgentReadAccess: p.workspaceAgentReadAccess,
        applyToStageEditor: p.applyToStageEditor,
        onRequestSave: p.onRequestSave,
        isToolCallStreamed: (id) => streamedToolCallIdsRef.current.has(id),
      })
      agent.state.tools = includePiArtifacts
        ? mergeAgentToolsPreservingArtifacts(agent.state.tools, extras)
        : extras
    })().catch((e: unknown) => console.warn('[DeepseekWrite·工作台提示词]', e))
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
    includePiArtifacts,
    promptRevision,
    isPaused,
    workspaceType,
  ])

  return <div ref={hostRef} className="workspace-ai-chat-host" />
}

/**
 * WorkspaceAiChat 使用 React.memo 包装，自定义比较逻辑：
 * - sessionBookId、sessionEpoch、promptKind 变化时重建；素材库只保留单个管理智能体会话
 * - stageBody 和 allStages 字符串内容变化时更新，但引用变化不触发（流式写入时）
 * - isPaused 变化时更新
 * - promptRevision 变化时更新
 * - applyToStageEditor 函数引用不比较（总是使用最新）
 */
export const WorkspaceAiChat = memo(WorkspaceAiChatInner, (prev, next) => {
  // 如果核心标识变化，必须更新
  if (prev.sessionBookId !== next.sessionBookId) return false
  if (prev.sessionEpoch !== next.sessionEpoch) return false
  if (prev.promptKind !== next.promptKind) return false
  if (prev.stageId !== next.stageId) return false
  if (prev.activeStageContentId !== next.activeStageContentId) return false

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
  if (prev.workspaceAgentReadAccess !== next.workspaceAgentReadAccess) return false

  // applyToStageEditor 函数引用不比较（总是使用最新）

  // 默认不更新（返回 true 表示相同）
  return true
})
