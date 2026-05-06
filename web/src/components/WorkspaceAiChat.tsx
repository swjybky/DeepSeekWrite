import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Agent } from '@mariozechner/pi-agent-core'
import { ApiKeyPromptDialog, ChatPanel } from '@mariozechner/pi-web-ui'
import { useEffect, useRef, useState } from 'react'
import type { StageId } from '../bridge'
import { ensurePiAppStorage } from '../pi/setupPiWorkspace'
import { resolveWorkspaceChatModel } from '../pi/resolveWorkspaceChatModel'
import {
  type ApplyToStageEditorPayload,
  getWorkspaceStageAgentDefinition,
} from '../pi/workspaceStageAgents'

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
  /** 书籍 id，与 stageId 一起构成 Agent sessionId，避免跨阶段复用 OpenAI Responses 的 prompt 缓存导致 history replay 报错 */
  sessionBookId: string
  bookTitle: string
  stageId: StageId
  stageBody: string
  /** 各阶段全文，用于提示词中的交叉参考 */
  allStages: Partial<Record<StageId, string>>
  /**
   * Pi `ChatPanel` 无法在内部关闭，仍会把 `artifacts` 塞进 `agent.state.tools`。
   * 为 `false` 时在 `setAgent` 之后从状态中移除该工具，阶段更新时也仅同步业务工具。
   * @default true
   */
  includePiArtifacts?: boolean
  /** 供「写入编辑区」工具调用：写入中间栏当前阶段文本框 */
  applyToStageEditor?: (payload: ApplyToStageEditorPayload) => void
}

export function WorkspaceAiChat({
  includePiArtifacts = true,
  ...props
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const agentRef = useRef<Agent | null>(null)
  const chatPanelRef = useRef<ChatPanel | null>(null)
  const [chatReady, setChatReady] = useState(false)

  const debouncedBody = useDebounced(props.stageBody, 600)

  useEffect(() => {
    let cancelled = false
    let unsubscribeMessagesRefresh: (() => void) | undefined
    let postAgentEndRaf = 0

    ;(async () => {
      await ensurePiAppStorage()
      const initialModel = await resolveWorkspaceChatModel()
      const root = hostRef.current
      if (cancelled || !root) return

      const chatPanel = new ChatPanel()
      chatPanelRef.current = chatPanel
      chatPanel.style.flex = '1'
      chatPanel.style.minHeight = '0'
      root.appendChild(chatPanel)

      const ctx = {
        bookTitle: props.bookTitle,
        stageId: props.stageId,
        stageBody: props.stageBody,
        allStages: props.allStages,
        applyToStageEditor: props.applyToStageEditor,
      }
      const def = getWorkspaceStageAgentDefinition(ctx)

      const agent = new Agent({
        sessionId: `write-claw:${props.sessionBookId}:${props.stageId}`,
        initialState: {
          systemPrompt: def.systemPrompt,
          model: initialModel,
          thinkingLevel: 'off',
          messages: [],
          tools: [],
        },
      })
      agentRef.current = agent

      // pi-agent-core mutates `messages` in place; pi-web-ui's Lit `message-list`
      // only re-renders when the array reference changes. Without this, turns after
      // tool calls (final assistant text) never appear once streaming clears.
      //
      // `agent_end` is dispatched before `finishRun()` clears `state.isStreaming`.
      // AgentInterface may render once with isStreaming still true and never refresh,
      // so the stop button stays visible — reflow after the next frame when idle.
      unsubscribeMessagesRefresh = agent.subscribe(async (ev) => {
        if (ev.type === 'message_end') {
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
        toolsFactory: () => def.additionalTools,
      })

      if (!includePiArtifacts) {
        agent.state.tools = (agent.state.tools ?? []).filter(
          (t) => t.name !== ARTIFACTS_TOOL_NAME,
        )
      }

      if (!cancelled) setChatReady(true)
    })()

    return () => {
      cancelled = true
      cancelAnimationFrame(postAgentEndRaf)
      setChatReady(false)
      unsubscribeMessagesRefresh?.()
      agentRef.current = null
      chatPanelRef.current?.remove()
      chatPanelRef.current = null
    }

    // 仅挂载时初始化；换书由上层 key 重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!chatReady || !agentRef.current) return
    const ctx = {
      bookTitle: props.bookTitle,
      stageId: props.stageId,
      stageBody: debouncedBody,
      allStages: props.allStages,
      applyToStageEditor: props.applyToStageEditor,
    }
    const def = getWorkspaceStageAgentDefinition(ctx)
    const agent = agentRef.current
    agent.state.systemPrompt = def.systemPrompt
    agent.state.tools = includePiArtifacts
      ? mergeAgentToolsPreservingArtifacts(
          agent.state.tools,
          def.additionalTools,
        )
      : def.additionalTools
  }, [
    chatReady,
    props.bookTitle,
    props.stageId,
    debouncedBody,
    props.allStages,
    props.applyToStageEditor,
    includePiArtifacts,
  ])

  return <div ref={hostRef} className="workspace-ai-chat-host" />
}
