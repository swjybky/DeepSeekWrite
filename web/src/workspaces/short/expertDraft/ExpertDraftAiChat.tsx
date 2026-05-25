import { Agent } from '@mariozechner/pi-agent-core'
import type { AgentMessage, AgentTool } from '@mariozechner/pi-agent-core'
import { ApiKeyPromptDialog, ChatPanel, ModelSelector } from '@mariozechner/pi-web-ui'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ExpertDraft, PromptKind, StageId } from '../../../bridge'
import {
  openWorkspaceConfiguredModelSelector,
  resolveWorkspaceProviderApiKey,
} from '../../../pi/resolveWorkspaceChatModel'
import { createPiSessionId } from '../../../pi/sessionId'
import { ensurePiAppStorage } from '../../../pi/setupPiWorkspace'
import {
  bindWorkspaceChatPreferences,
  getPreferredWorkspaceThinkingLevel,
  resolvePreferredWorkspaceChatModel,
} from '../../../pi/workspaceChatPreferences'
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

type WriterPreview = {
  active: boolean
  sectionTitle: string
  progress: string
  status: string
  text: string
  userPrompt: string
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

function messageText(message: AgentMessage | undefined): string {
  if (!message || message.role !== 'assistant') return ''
  return message.content
    .map((block) => {
      if (block.type === 'text') return block.text
      return ''
    })
    .filter(Boolean)
    .join('\n\n')
}

function previewText(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= 1200) return trimmed
  return `${trimmed.slice(-1200).trimStart()}`
}

function toolStatus(toolName: string, done = false): string {
  if (toolName === 'write_section_body') {
    return done ? '正文已写入' : '正在写入正文'
  }
  if (toolName === 'write_character_state') {
    return done ? '人物状态已写入' : '正在写入人物状态'
  }
  if (toolName === 'read_workspace_content') {
    return done ? '已读取工作台内容' : '正在读取工作台内容'
  }
  return done ? '工具调用完成' : '正在调用工具'
}

export function ExpertDraftAiChat(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const agentRef = useRef<Agent | null>(null)
  const chatPanelRef = useRef<ChatPanel | null>(null)
  const propsLatestRef = useRef(props)
  const unsubscribeWriterPreviewRef = useRef<(() => void) | null>(null)
  const writerPreviewRafRef = useRef(0)
  const writerPreviewPatchRef = useRef<Partial<WriterPreview> | null>(null)
  const [chatReady, setChatReady] = useState(false)
  const [writerPreview, setWriterPreview] = useState<WriterPreview>({
    active: false,
    sectionTitle: '',
    progress: '',
    status: '',
    text: '',
    userPrompt: '',
  })
  const [promptViewerOpen, setPromptViewerOpen] = useState(false)
  const debouncedDraft = useDebounced(props.expertDraft, 600)

  useEffect(() => {
    propsLatestRef.current = props
  }, [props])

  const scheduleWriterPreview = useCallback((patch: Partial<WriterPreview>) => {
    writerPreviewPatchRef.current = {
      ...(writerPreviewPatchRef.current ?? {}),
      ...patch,
    }
    if (writerPreviewRafRef.current) return
    writerPreviewRafRef.current = requestAnimationFrame(() => {
      writerPreviewRafRef.current = 0
      const pending = writerPreviewPatchRef.current
      writerPreviewPatchRef.current = null
      if (!pending) return
      setWriterPreview((prev) => ({ ...prev, ...pending }))
    })
  }, [])

  const watchWriterAgent: RunExpertDraftSectionWriterOptions['onSectionAgentStart'] =
    useCallback(({ agent, sectionTitle, sectionIndex, sectionCount, userPrompt }) => {
      unsubscribeWriterPreviewRef.current?.()
      unsubscribeWriterPreviewRef.current = null
      setWriterPreview({
        active: true,
        sectionTitle,
        progress: `${sectionIndex + 1}/${sectionCount}`,
        status: '准备中',
        text: '',
        userPrompt,
      })

      unsubscribeWriterPreviewRef.current = agent.subscribe((ev) => {
        if (ev.type === 'message_start') {
          if (ev.message.role === 'assistant') {
            scheduleWriterPreview({ status: '生成正文中', text: '' })
          }
          return
        }
        if (ev.type === 'message_update') {
          const text = messageText(ev.message)
          scheduleWriterPreview({
            status: text ? '生成正文中' : '思考中',
            text: previewText(text),
          })
          return
        }
        if (ev.type === 'tool_execution_start') {
          scheduleWriterPreview({ status: toolStatus(ev.toolName) })
          return
        }
        if (ev.type === 'tool_execution_end') {
          scheduleWriterPreview({ status: toolStatus(ev.toolName, true) })
          return
        }
        if (ev.type === 'agent_end') {
          scheduleWriterPreview({ status: '本节完成' })
        }
      })
    }, [scheduleWriterPreview])

  const finishWriterPreview: RunExpertDraftSectionWriterOptions['onRunFinish'] =
    useCallback(({ aborted }) => {
      unsubscribeWriterPreviewRef.current?.()
      unsubscribeWriterPreviewRef.current = null
      scheduleWriterPreview({
        active: false,
        status: aborted ? '已停止' : '全部完成',
      })
    }, [scheduleWriterPreview])

  useEffect(() => {
    let cancelled = false
    let unsubscribeMessagesRefresh: (() => void) | undefined
    let postAgentEndRaf = 0
    let resizeObserver: ResizeObserver | undefined
    let unsubscribePreferences: (() => void) | undefined

    const currentTools = () =>
      buildExpertDraftCoordinatorTools({
        getDraft: () => propsLatestRef.current.expertDraft,
        updateDraft: propsLatestRef.current.updateDraft,
        startWriting: (sectionIds) =>
          propsLatestRef.current.startWriting(sectionIds, {
            onSectionAgentStart: watchWriterAgent,
            onRunFinish: finishWriterPreview,
          }),
      })

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
        sessionId: createPiSessionId(
          'expert-draft-coordinator',
          props.bookId,
          props.sessionEpoch && props.sessionEpoch > 0
            ? props.sessionEpoch
            : undefined,
        ),
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
          thinkingLevel: getPreferredWorkspaceThinkingLevel(),
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
        unsubscribePreferences?.()
        unsubscribePreferences = bindWorkspaceChatPreferences(nextAgent, () => {
          nudgePiLayout()
          chatPanel.requestUpdate?.()
          requestAnimationFrame(nudgePiLayout)
        })
        await chatPanel.setAgent(nextAgent, {
          onApiKeyRequired: async (provider: string) =>
            ApiKeyPromptDialog.prompt(provider),
          onModelSelect: async () => {
            const selectModel = (model: typeof nextAgent.state.model) => {
              nextAgent.state.model = model
              nudgePiLayout()
              requestAnimationFrame(nudgePiLayout)
            }
            const handled = await openWorkspaceConfiguredModelSelector(
              nextAgent.state.model,
              selectModel,
            )
            if (!handled) {
              ModelSelector.open(nextAgent.state.model, selectModel)
            }
          },
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

      // pi-agent-core mutates `messages` in place; pi-web-ui's message list
      // only redraws reliably when the top-level array reference changes.
      unsubscribeMessagesRefresh = agent.subscribe((ev) => {
        if (ev.type === 'message_end') {
          agent.state.messages = agent.state.messages.slice()
        }
        if (ev.type === 'agent_end') {
          cancelAnimationFrame(postAgentEndRaf)
          postAgentEndRaf = requestAnimationFrame(() => {
            refreshIdleUi()
            postAgentEndRaf = requestAnimationFrame(() => {
              postAgentEndRaf = 0
              refreshIdleUi()
            })
          })
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
      cancelAnimationFrame(postAgentEndRaf)
      resizeObserver?.disconnect()
      resizeObserver = undefined
      setChatReady(false)
      unsubscribeMessagesRefresh?.()
      unsubscribePreferences?.()
      unsubscribeWriterPreviewRef.current?.()
      unsubscribeWriterPreviewRef.current = null
      cancelAnimationFrame(writerPreviewRafRef.current)
      writerPreviewRafRef.current = 0
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
    if (debouncedDraft.running) return
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
            onSectionAgentStart: watchWriterAgent,
            onRunFinish: finishWriterPreview,
          }),
      }),
    )
  }, [
    chatReady,
    props.bookTitle,
    props.promptKind,
    props.stages,
    debouncedDraft,
    watchWriterAgent,
    finishWriterPreview,
  ])

  return (
    <div className="expert-draft-ai-shell">
      <div
        className={
          writerPreview.active
            ? 'expert-draft-agent-preview expert-draft-agent-preview--active'
            : 'expert-draft-agent-preview'
        }
        aria-live="polite"
      >
        <div className="expert-draft-agent-preview-head">
          <span className="expert-draft-agent-preview-kicker">
            后台小节智能体
          </span>
          <span className="expert-draft-agent-preview-actions">
            {writerPreview.userPrompt ? (
              <button
                type="button"
                className="expert-draft-agent-prompt-button"
                onClick={() => setPromptViewerOpen(true)}
              >
                Prompt
              </button>
            ) : null}
            <span className="expert-draft-agent-preview-status">
              {writerPreview.status || '待启动'}
            </span>
          </span>
        </div>
        <div className="expert-draft-agent-preview-title">
          {writerPreview.sectionTitle
            ? `${writerPreview.progress} · ${writerPreview.sectionTitle}`
            : '等待主智能体启动小节编写'}
        </div>
        {writerPreview.text ? (
          <pre className="expert-draft-agent-preview-body">
            {writerPreview.text}
          </pre>
        ) : null}
      </div>
      <div ref={hostRef} className="workspace-ai-chat-host" />
      {promptViewerOpen ? (
        <div
          className="expert-draft-prompt-viewer-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wc-expert-prompt-viewer-title"
        >
          <div className="expert-draft-prompt-viewer-panel">
            <div className="expert-draft-prompt-viewer-head">
              <h2
                id="wc-expert-prompt-viewer-title"
                className="expert-draft-prompt-viewer-title"
              >
                后台小节 User Prompt
              </h2>
              <button
                type="button"
                className="expert-draft-prompt-viewer-close"
                aria-label="关闭"
                onClick={() => setPromptViewerOpen(false)}
              >
                ×
              </button>
            </div>
            <pre className="expert-draft-prompt-viewer-body">
              {writerPreview.userPrompt || '暂无 prompt'}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  )
}
