import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Agent } from '@mariozechner/pi-agent-core'
import { ApiKeyPromptDialog, ChatPanel, ModelSelector } from '@mariozechner/pi-web-ui'
import { memo, useEffect, useRef, useState } from 'react'
import type {
  Material,
  StageId,
  PromptKind,
  MaterialStageId,
  MaterialPromptKind,
  StageReadAccessConfig,
} from '../bridge'
import { getWorkspaceSystemPrompt, getMaterialSystemPrompt } from '../bridge'
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

const ARTIFACTS_TOOL_NAME = 'artifacts'

function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setOut(value), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return out
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
  /** 提示词目录：shiqing / qinggan / material_*，决定加载哪种风格的提示词 */
  promptKind: PromptKind | MaterialPromptKind
  bookTitle: string
  stageId: StageId | MaterialStageId
  stageBody: string
  getCurrentStageBody?: () => string
  /** 各阶段全文，用于提示词中的交叉参考 */
  allStages: Partial<Record<StageId | MaterialStageId, string>>
  /** 当前书籍关联的素材库；前期设计阶段会将其暴露为 AI 工具可读取内容 */
  linkedMaterial?: Material | null
  /** 全局阶段可读配置（仅书籍短篇工作台） */
  stageReadAccess?: StageReadAccessConfig | null
  /**
   * Pi `ChatPanel` 无法在内部关闭，仍会把 `artifacts` 塞进 `agent.state.tools`。
   * 为 `false` 时在 `setAgent` 之后从状态中移除该工具，阶段更新时也仅同步业务工具。
   * @default true
   */
  includePiArtifacts?: boolean
  /** 侧栏「编辑提示词」保存后递增，强制重新拉取 disk 模板并刷新 systemPrompt */
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
   * 工作台类型：书籍工作台或素材库工作台。
   * 素材模式下使用素材提示词管线。
   * @default 'book'
   */
  workspaceType?: 'book' | 'material'
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
      await ensurePiAppStorage()
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

      const ctxTools = (): AgentTool[] =>
        getWorkspaceStageAdditionalTools({
          bookTitle: propsLatestRef.current.bookTitle,
          promptKind: propsLatestRef.current.promptKind,
          stageId: propsLatestRef.current.stageId,
          stageBody: propsLatestRef.current.stageBody,
          getCurrentStageBody:
            propsLatestRef.current.getCurrentStageBody ??
            (() => propsLatestRef.current.stageBody),
          allStages: propsLatestRef.current.allStages,
          linkedMaterial: propsLatestRef.current.linkedMaterial,
          stageReadAccess: propsLatestRef.current.stageReadAccess,
          applyToStageEditor: propsLatestRef.current.applyToStageEditor,
          onRequestSave: propsLatestRef.current.onRequestSave,
          isToolCallStreamed: (id) => streamedToolCallIdsRef.current.has(id),
        })

      const systemPromptInitial =
        workspaceType === 'material'
          ? await getMaterialSystemPrompt(
              props.promptKind as MaterialPromptKind,
              props.stageId as MaterialStageId,
              {
                materialTitle: props.bookTitle,
                stageBody: props.stageBody,
                allStages: props.allStages as Partial<Record<MaterialStageId, string>>,
              },
            )
          : await getWorkspaceSystemPrompt(
              props.promptKind as PromptKind,
              props.stageId as StageId,
              {
                bookTitle: props.bookTitle,
                stageBody: props.stageBody,
                allStages: props.allStages as Partial<Record<StageId, string>>,
              },
            )
      if (cancelled || !hostRef.current) return

      const sessionId = createPiSessionId(
        'workspace',
        props.sessionBookId,
        props.promptKind,
        props.stageId,
        sessionEpoch > 0 ? sessionEpoch : undefined,
      )

      const agent = new Agent({
        sessionId,
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
                block.name === 'write_material_editor'
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
              const mode = (args.mode as 'replace' | 'append') || 'replace'

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
      const nextPrompt =
        workspaceType === 'material'
          ? await getMaterialSystemPrompt(
              p.promptKind as MaterialPromptKind,
              p.stageId as MaterialStageId,
              {
                materialTitle: p.bookTitle,
                stageBody: debouncedBody,
                allStages: p.allStages as Partial<Record<MaterialStageId, string>>,
              },
            )
          : await getWorkspaceSystemPrompt(
              p.promptKind as PromptKind,
              p.stageId as StageId,
              {
                bookTitle: p.bookTitle,
                stageBody: debouncedBody,
                allStages: p.allStages as Partial<Record<StageId, string>>,
              },
            )
      if (!agentRef.current || seq !== promptPullSeqRef.current) return
      const agent = agentRef.current
      agent.state.systemPrompt = nextPrompt
      const extras = getWorkspaceStageAdditionalTools({
        bookTitle: p.bookTitle,
        promptKind: p.promptKind,
        stageId: p.stageId,
        stageBody: debouncedBody,
        getCurrentStageBody:
          p.getCurrentStageBody ?? (() => propsLatestRef.current.stageBody),
        allStages: p.allStages,
        linkedMaterial: p.linkedMaterial,
        stageReadAccess: p.stageReadAccess,
        applyToStageEditor: p.applyToStageEditor,
        onRequestSave: p.onRequestSave,
        isToolCallStreamed: (id) => streamedToolCallIdsRef.current.has(id),
      })
      agent.state.tools = includePiArtifacts
        ? mergeAgentToolsPreservingArtifacts(agent.state.tools, extras)
        : extras
    })().catch((e: unknown) => console.warn('[涌泉·工作台提示词]', e))
  }, [
    chatReady,
    props.bookTitle,
    props.promptKind,
    props.stageId,
    debouncedBody,
    props.allStages,
    props.linkedMaterial,
    props.stageReadAccess,
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
 * - sessionBookId、sessionEpoch、promptKind、stageId 变化时重建
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

  // applyToStageEditor 函数引用不比较（总是使用最新）

  // 默认不更新（返回 true 表示相同）
  return true
})
