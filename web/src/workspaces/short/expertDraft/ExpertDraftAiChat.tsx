import { Agent } from '@mariozechner/pi-agent-core'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { ApiKeyPromptDialog, ChatPanel } from '@mariozechner/pi-web-ui'
import { useEffect, useRef, useState } from 'react'

import type { ExpertDraft, PromptKind, StageId } from '../../../bridge'
import {
  resolveWorkspaceChatModel,
  resolveWorkspaceProviderApiKey,
} from '../../../pi/resolveWorkspaceChatModel'
import { ensurePiAppStorage } from '../../../pi/setupPiWorkspace'
import { buildExpertDraftCoordinatorTools } from './coordinatorTools'
import { buildExpertDraftCoordinatorSystemPrompt } from './prompts'
import type { RunExpertDraftSectionWriterOptions } from './sectionWriter'

const ARTIFACTS_TOOL_NAME = 'artifacts'

type Props = {
  bookId: string
  bookTitle: string
  promptKind: PromptKind
  sessionEpoch?: number
  stages: Partial<Record<StageId, string>>
  expertDraft: ExpertDraft
  updateDraft: (updater: (draft: ExpertDraft) => ExpertDraft) => void
  startWriting: (
    sectionIds: string[],
    callbacks?: Pick<
      RunExpertDraftSectionWriterOptions,
      'onSectionAgentStart' | 'onRunFinish'
    >,
  ) => boolean
}

function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setOut(value), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return out
}

function stripArtifacts(tools: AgentTool[]): AgentTool[] {
  return tools.filter((tool) => tool.name !== ARTIFACTS_TOOL_NAME)
}

export function ExpertDraftAiChat(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const agentRef = useRef<Agent | null>(null)
  const chatPanelRef = useRef<ChatPanel | null>(null)
  const propsLatestRef = useRef(props)
  const showWriterAgentRef = useRef<
    RunExpertDraftSectionWriterOptions['onSectionAgentStart']
  >(async () => {})
  const restoreCoordinatorAgentRef = useRef<
    RunExpertDraftSectionWriterOptions['onRunFinish']
  >(async () => {})
  const [chatReady, setChatReady] = useState(false)
  const debouncedDraft = useDebounced(props.expertDraft, 600)

  useEffect(() => {
    propsLatestRef.current = props
  }, [props])

  useEffect(() => {
    let cancelled = false
    let unsubscribeMessagesRefresh: (() => void) | undefined
    let postAgentEndTimer = 0
    let postAgentEndRaf = 0
    let resizeObserver: ResizeObserver | undefined

    const currentTools = () =>
      buildExpertDraftCoordinatorTools({
        getDraft: () => propsLatestRef.current.expertDraft,
        updateDraft: propsLatestRef.current.updateDraft,
        startWriting: (sectionIds) =>
          propsLatestRef.current.startWriting(sectionIds, {
            onSectionAgentStart: (info) => showWriterAgentRef.current?.(info),
            onRunFinish: (info) => restoreCoordinatorAgentRef.current?.(info),
          }),
      })

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

      const nudgePiLayout = () => {
        const panel = chatPanelRef.current
        if (!panel || cancelled) return
        const h = root.getBoundingClientRect().height
        if (h > 0) panel.style.height = `${Math.round(h)}px`
        panel.requestUpdate?.()
        const iface = panel.querySelector(
          'agent-interface',
        ) as (HTMLElement & { requestUpdate?: () => void }) | null
        iface?.requestUpdate?.()
      }

      resizeObserver = new ResizeObserver(() => {
        if (!cancelled) requestAnimationFrame(nudgePiLayout)
      })
      resizeObserver.observe(root)

      const agent = new Agent({
        sessionId:
          props.sessionEpoch && props.sessionEpoch > 0
            ? `write-claw:${props.bookId}:expert-draft:coordinator:${props.sessionEpoch}`
            : `write-claw:${props.bookId}:expert-draft:coordinator`,
        getApiKey: resolveWorkspaceProviderApiKey,
        toolExecution: 'sequential',
        initialState: {
          systemPrompt: buildExpertDraftCoordinatorSystemPrompt({
            bookTitle: props.bookTitle,
            promptKind: props.promptKind,
            stages: props.stages,
            draft: props.expertDraft,
          }),
          model: initialModel,
          thinkingLevel: 'high',
          messages: [],
          tools: [],
        },
      })
      agentRef.current = agent

      const refreshIdleUi = () => {
        if (cancelled) return
        const panel = chatPanelRef.current
        panel?.requestUpdate?.()
        const iface = panel?.querySelector('agent-interface') as
          | (HTMLElement & { requestUpdate?: () => void })
          | null
          | undefined
        iface?.requestUpdate?.()
        const editor = iface?.querySelector('message-editor') as
          | (HTMLElement & {
              isStreaming?: boolean
              requestUpdate?: () => void
            })
          | null
          | undefined
        if (editor) {
          editor.isStreaming = false
          editor.requestUpdate?.()
        }
      }

      const setPanelAgent = async (
        nextAgent: Agent,
        toolsFactory: () => AgentTool[],
      ) => {
        if (cancelled) return
        await chatPanel.setAgent(nextAgent, {
          onApiKeyRequired: async (provider: string) =>
            ApiKeyPromptDialog.prompt(provider),
          toolsFactory,
        })
        nextAgent.state.tools = stripArtifacts(nextAgent.state.tools)
        if (!cancelled) {
          nudgePiLayout()
          chatPanel.requestUpdate?.()
        }
      }

      const setCoordinatorAgent = async () => {
        await setPanelAgent(agent, currentTools)
      }

      showWriterAgentRef.current = async ({ agent: writerAgent }) => {
        await setPanelAgent(writerAgent, () =>
          stripArtifacts(writerAgent.state.tools),
        )
      }

      restoreCoordinatorAgentRef.current = async () => {
        if (cancelled) return
        await setCoordinatorAgent()
        refreshIdleUi()
      }

      // pi-agent-core mutates `messages` in place; pi-web-ui's message list
      // only redraws reliably when the top-level array reference changes.
      unsubscribeMessagesRefresh = agent.subscribe((ev) => {
        if (ev.type === 'message_end') {
          agent.state.messages = agent.state.messages.slice()
        }
        if (ev.type === 'agent_end') {
          window.clearTimeout(postAgentEndTimer)
          cancelAnimationFrame(postAgentEndRaf)
          postAgentEndTimer = window.setTimeout(() => {
            postAgentEndTimer = 0
            postAgentEndRaf = requestAnimationFrame(() => {
              refreshIdleUi()
              postAgentEndRaf = requestAnimationFrame(() => {
                postAgentEndRaf = 0
                refreshIdleUi()
              })
            })
          }, 0)
        }
      })

      await setCoordinatorAgent()

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

    return () => {
      cancelled = true
      window.clearTimeout(postAgentEndTimer)
      cancelAnimationFrame(postAgentEndRaf)
      resizeObserver?.disconnect()
      resizeObserver = undefined
      setChatReady(false)
      showWriterAgentRef.current = async () => {}
      restoreCoordinatorAgentRef.current = async () => {}
      unsubscribeMessagesRefresh?.()
      agentRef.current?.abort()
      agentRef.current = null
      chatPanelRef.current?.remove()
      chatPanelRef.current = null
    }
    // 仅挂载时初始化；换书由 key 重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!chatReady || !agentRef.current) return
    const p = propsLatestRef.current
    const agent = agentRef.current
    agent.state.systemPrompt = buildExpertDraftCoordinatorSystemPrompt({
      bookTitle: p.bookTitle,
      promptKind: p.promptKind,
      stages: p.stages,
      draft: debouncedDraft,
    })
    agent.state.tools = stripArtifacts(
      buildExpertDraftCoordinatorTools({
        getDraft: () => propsLatestRef.current.expertDraft,
        updateDraft: propsLatestRef.current.updateDraft,
        startWriting: (sectionIds) =>
          propsLatestRef.current.startWriting(sectionIds, {
            onSectionAgentStart: (info) => showWriterAgentRef.current?.(info),
            onRunFinish: (info) => restoreCoordinatorAgentRef.current?.(info),
          }),
      }),
    )
  }, [
    chatReady,
    props.bookTitle,
    props.promptKind,
    props.stages,
    debouncedDraft,
  ])

  return <div ref={hostRef} className="workspace-ai-chat-host" />
}
