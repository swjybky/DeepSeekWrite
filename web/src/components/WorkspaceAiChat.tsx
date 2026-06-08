import type { AgentTool } from '@earendil-works/pi-agent-core'
import { Agent } from '@earendil-works/pi-agent-core'
import {
  ApiKeyPromptDialog,
  ChatPanel,
  ModelSelector,
  type Attachment,
} from '@earendil-works/pi-web-ui'
import { memo, useEffect, useRef, useState } from 'react'
import type {
  Material,
  StageId,
  MaterialStageId,
  MaterialPromptKind,
  Skill,
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
import { resolveWorkspaceAgentReadAccess } from '../workspaces/short/stageReadAccess'

const ARTIFACTS_TOOL_NAME = 'artifacts'
const WORKSPACE_ATTACHMENT_ACCEPTED_TYPES =
  'image/*,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.txt,text/plain,.md,text/markdown,text/x-markdown'
const WORKSPACE_ATTACHMENT_MAX_FILES = 10
const WORKSPACE_ATTACHMENT_MAX_FILE_SIZE = 20 * 1024 * 1024
const WORKSPACE_ATTACHMENT_SUPPORTED_LABEL = 'Word（.docx）、TXT、Markdown、图片'
const WORKSPACE_SEND_VALIDATION_ERROR_NAME = 'WriteClawSendValidationError'

type MessageEditorElement = HTMLElement & {
  attachments?: Attachment[]
  acceptedTypes?: string
  maxFiles?: number
  maxFileSize?: number
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
  if (fileName.endsWith('.docx')) return true
  if (fileName.endsWith('.txt') || fileName.endsWith('.md')) return true
  return (
    attachment.mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    attachment.mimeType === 'text/plain' ||
    attachment.mimeType === 'text/markdown' ||
    attachment.mimeType === 'text/x-markdown'
  )
}

function applyWorkspaceAttachmentOptions(chatPanel: ChatPanel | null): boolean {
  const editor = getMessageEditor(chatPanel)
  if (!editor) return false
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
  props: Pick<Props, 'stageId' | 'stageBody' | 'getCurrentStageBody'>,
): string {
  return props.getCurrentStageBody?.(props.stageId) ?? props.stageBody
}

function mergeCurrentStageIntoAllStages(
  props: Pick<Props, 'stageId' | 'allStages' | 'stageBody' | 'getCurrentStageBody'>,
): Partial<Record<StageId | MaterialStageId | SkillStageId, string>> {
  return {
    ...props.allStages,
    [props.stageId]: resolveCurrentStageBody(props),
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
  bookTitle: string
  /** 素材库智能体可见的素材类型上下文。 */
  materialType?: string
  /** 素材库智能体可见的素材分类上下文。 */
  materialGenre?: string
  /** 创作空间共享模板可见的书籍分类上下文。 */
  bookGenre?: string
  stageId: StageId | MaterialStageId | SkillStageId
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
  /** 供「写入编辑区」工具调用：写入中间栏当前阶段文本框 */
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
          workspaceType,
          promptKind: latest.promptKind,
          stageId: latest.stageId,
          stageBody: resolveCurrentStageBody(latest),
          getCurrentStageBody: (stageId) =>
            latest.getCurrentStageBody?.(stageId ?? latest.stageId),
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
                materialType: props.materialType,
                materialGenre: props.materialGenre,
                stageBody: resolveCurrentStageBody(props),
                allStages: mergeCurrentStageIntoAllStages(props) as Partial<Record<MaterialStageId, string>>,
              },
            )
            : await getWorkspaceSystemPrompt(
              props.stageId as StageId,
              {
                bookTitle: props.bookTitle,
                bookGenre: props.bookGenre ?? '未分类',
                stageBody: resolveCurrentStageBody(props),
                allStages: mergeCurrentStageIntoAllStages(props) as Partial<Record<StageId, string>>,
                allowedWorkspaceStages: resolveWorkspaceAgentReadAccess(
                  props.workspaceAgentReadAccess,
                  props.stageId as StageId,
                ).workspace,
                linkedSkill: props.linkedSkill,
              },
            )
      if (cancelled || !hostRef.current) return

      const sessionId = createPiSessionId(
        'workspace',
        props.sessionBookId,
        workspaceType === 'skill'
          ? 'skill_manager'
          : workspaceType === 'material'
            ? 'material_manager'
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

              if (mode === 'replace' && !streamingWriteRef.current.hasCleared) {
                streamingWriteRef.current.hasCleared = true
                streamingWriteRef.current.accumulatedText = ''
                apply({ text: '', mode: 'replace' })
              }

              const prev = streamingWriteRef.current.accumulatedText
              if (text.length > prev.length && text.startsWith(prev)) {
                const delta = text.slice(prev.length)
                streamingWriteRef.current.accumulatedText = text
                apply({ text: delta, mode: 'append_token' })
              } else if (text !== prev) {
                streamingWriteRef.current.accumulatedText = text
                apply({ text: text, mode: 'replace' })
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
              streamingWriteRef.current = null
              apply({ text: '', mode: 'streaming_end' })
            }
          }
        }

        if (ev.type === 'message_end') {
          // 清理未完成的流式写入
          if (streamingWriteRef.current) {
            streamedToolCallIdsRef.current.add(streamingWriteRef.current.toolCallId)
            streamingWriteRef.current = null
            propsLatestRef.current.applyToStageEditor?.({
              text: '',
              mode: 'streaming_end',
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
                `\n不支持：${unsupported.map((a) => a.fileName).join('、')}` +
                '\n老式 .doc 文件请另存为 .docx 后再上传。',
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
        propsLatestRef.current.applyToStageEditor?.({
          text: '',
          mode: 'streaming_end',
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
      const latestStageBody =
        p.getCurrentStageBody?.(p.stageId) ?? debouncedBody
      const latestAllStages = {
        ...p.allStages,
        [p.stageId]: latestStageBody,
      }
      const nextPrompt =
        workspaceType === 'skill'
          ? await getSkillSystemPrompt(
              p.stageId as SkillStageId,
              {
                skillTitle: p.bookTitle,
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
                materialType: p.materialType,
                materialGenre: p.materialGenre,
                stageBody: latestStageBody,
                allStages: latestAllStages as Partial<Record<MaterialStageId, string>>,
              },
            )
            : await getWorkspaceSystemPrompt(
              p.stageId as StageId,
              {
                bookTitle: p.bookTitle,
                bookGenre: p.bookGenre ?? '未分类',
                stageBody: latestStageBody,
                allStages: latestAllStages as Partial<Record<StageId, string>>,
                allowedWorkspaceStages: resolveWorkspaceAgentReadAccess(
                  p.workspaceAgentReadAccess,
                  p.stageId as StageId,
                ).workspace,
                linkedSkill: p.linkedSkill,
              },
            )
      if (!agentRef.current || seq !== promptPullSeqRef.current) return
      const agent = agentRef.current
      agent.state.systemPrompt = nextPrompt
      const extras = getWorkspaceStageAdditionalTools({
        bookTitle: p.bookTitle,
        workspaceType,
        promptKind: p.promptKind,
        stageId: p.stageId,
        stageBody: latestStageBody,
        getCurrentStageBody: (stageId) =>
          p.getCurrentStageBody?.(stageId ?? p.stageId),
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
    props.materialType,
    props.materialGenre,
    props.bookGenre,
    props.promptKind,
    props.stageId,
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
  if (prev.materialType !== next.materialType) return false
  if (prev.materialGenre !== next.materialGenre) return false
  if (prev.bookGenre !== next.bookGenre) return false
  if (prev.workspaceAgentReadAccess !== next.workspaceAgentReadAccess) return false

  // applyToStageEditor 函数引用不比较（总是使用最新）

  // 默认不更新（返回 true 表示相同）
  return true
})
