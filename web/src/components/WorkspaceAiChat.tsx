import type { AgentMessage, AgentTool } from '@mariozechner/pi-agent-core'
import { Agent } from '@mariozechner/pi-agent-core'
import type { AssistantMessage, Model } from '@mariozechner/pi-ai'
import { ApiKeyPromptDialog, ChatPanel } from '@mariozechner/pi-web-ui'
import { memo, useEffect, useRef, useState } from 'react'
import type { Material, StageId, PromptKind, MaterialStageId, MaterialPromptKind } from '../bridge'
import { getWorkspaceSystemPrompt, getMaterialSystemPrompt } from '../bridge'
import { ensurePiAppStorage } from '../pi/setupPiWorkspace'
import {
  resolveWorkspaceChatModel,
  resolveWorkspaceFlashModel,
} from '../pi/resolveWorkspaceChatModel'
import {
  assistantAgentMessageToPlainText,
  runStageAssistantExtractStream,
} from '../pi/stageAssistantExtractStream'
import {
  type ApplyToStageEditorPayload,
  getWorkspaceStageAdditionalTools,
} from '../pi/workspaceStageAgents'

const ARTIFACTS_TOOL_NAME = 'artifacts'

const TOOLBAR_CAPTION = '抽取相关内容到编辑器'

/** 本条助手消息是否仍要求执行工具；若是，随后还有续写，不应挂「写入正文」。 */
function assistantMessageHasToolCalls(m: AgentMessage): boolean {
  if (m.role !== 'assistant') return false
  return (m as AssistantMessage).content.some((c) => c.type === 'toolCall')
}

function assistantIndexInTranscript(
  messages: AgentMessage[],
  targetTs: number,
): number {
  let idx = -1
  for (const m of messages) {
    if (m.role === 'assistant') {
      idx++
      if (m.timestamp === targetTs) return idx
    }
  }
  return -1
}

type MountToolbarOpts = {
  cancelled: () => boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pi-ai Model 与 provider 绑定
  loadFlashModel: () => Promise<Model<any>>
  getApplyToStageEditor: () => ApplyToStageEditor | undefined
  getStageId: () => StageId | MaterialStageId
  getStageBody: () => string
  getAgentStreaming: () => boolean
  extractAbortRef: { current: AbortController | null }
}

type ApplyToStageEditor = (payload: ApplyToStageEditorPayload) => void

function mountAssistExtractToolbar(
  root: HTMLElement,
  messages: AgentMessage[],
  assistantMsg: AgentMessage,
  opts: MountToolbarOpts,
) {
  if (opts.cancelled()) return
  if (assistantMsg.role !== 'assistant') return
  const plain = assistantAgentMessageToPlainText(assistantMsg)
  if (!plain) return
  const apply = opts.getApplyToStageEditor()
  if (!apply) return

  const ts = assistantMsg.timestamp
  root
    .querySelectorAll(`.wc-assist-toolbar[data-wc-ts="${ts}"]`)
    .forEach((n) => n.remove())

  const list = root.querySelector('message-list')
  if (!list) return
  const aIdx = assistantIndexInTranscript(messages, ts)
  if (aIdx < 0) return
  const nodes = list.querySelectorAll('assistant-message')
  const anchor = nodes[aIdx] as HTMLElement | undefined
  if (!anchor) return

  const next = anchor.nextElementSibling
  if (
    next?.classList.contains('wc-assist-toolbar') &&
    next.getAttribute('data-wc-ts') === String(ts)
  ) {
    return
  }

  const bar = document.createElement('div')
  bar.className = 'wc-assist-toolbar'
  bar.setAttribute('data-wc-ts', String(ts))

  const inner = document.createElement('div')
  inner.className = 'wc-assist-toolbar-inner'

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'wc-assist-extract-btn'
  btn.title = TOOLBAR_CAPTION
  btn.textContent = '写入正文'
  btn.setAttribute('aria-label', `写入正文，${TOOLBAR_CAPTION}`)

  const snapshot = plain

  btn.addEventListener('click', async () => {
    const applyNow = opts.getApplyToStageEditor()
    if (!applyNow) return
    if (opts.getAgentStreaming()) return
    opts.extractAbortRef.current?.abort()
    const ac = new AbortController()
    opts.extractAbortRef.current = ac
    btn.disabled = true
    try {
      const flash = await opts.loadFlashModel()
      const stageId = opts.getStageId()
      // 剧情细化阶段使用追加模式，不清空现有内容
      const isPlotRefine = stageId === 'plot_refine'
      await runStageAssistantExtractStream({
        flashModel: flash,
        stageId: String(stageId),
        stageBody: opts.getStageBody(),
        assistantPlainText: snapshot,
        applyToStageEditor: applyNow,
        signal: ac.signal,
        onError: (msg) => console.warn('[涌泉·写入正文]', msg),
        appendMode: isPlotRefine,
      })
    } finally {
      if (opts.extractAbortRef.current === ac) opts.extractAbortRef.current = null
      btn.disabled = false
    }
  })

  bar.appendChild(inner)
  inner.appendChild(btn)
  anchor.insertAdjacentElement('afterend', bar)
}

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
  /** 各阶段全文，用于提示词中的交叉参考 */
  allStages: Partial<Record<StageId | MaterialStageId, string>>
  /** 当前书籍关联的素材库；前期设计阶段会将其暴露为 AI 工具可读取内容 */
  linkedMaterial?: Material | null
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
  /**
   * 是否暂停实时更新（非激活阶段使用）。为 true 时跳过提示词重新加载和工具更新，
   * 减少后台计算开销，但保留对话状态。
   * @default false
   */
  isPaused?: boolean
  /**
   * 工作台类型：书籍工作台或素材库工作台。
   * 素材模式下使用素材提示词管线，且不挂载「写入正文」提取按钮。
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
  const extractAbortRef = useRef<AbortController | null>(null)
  const promptPullSeqRef = useRef(0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pi-ai Model 与 provider 绑定
  const flashModelPromiseRef = useRef<Promise<Model<any>> | null>(null)

  useEffect(() => {
    propsLatestRef.current = props
  }, [props])

  const debouncedBody = useDebounced(props.stageBody, 600)

  useEffect(() => {
    let cancelled = false
    let unsubscribeMessagesRefresh: (() => void) | undefined
    let postAgentEndRaf = 0

    let resizeObserver: ResizeObserver | undefined

    const loadFlashModel = () =>
      (flashModelPromiseRef.current ??=
        resolveWorkspaceFlashModel(agentRef.current?.state.model))

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
          allStages: propsLatestRef.current.allStages,
          linkedMaterial: propsLatestRef.current.linkedMaterial,
          applyToStageEditor: propsLatestRef.current.applyToStageEditor,
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

      const baseSessionId = `write-claw:${props.sessionBookId}:${props.promptKind}:${props.stageId}`
      const sessionId =
        sessionEpoch > 0 ? `${baseSessionId}:${sessionEpoch}` : baseSessionId

      const agent = new Agent({
        sessionId,
        initialState: {
          systemPrompt: systemPromptInitial,
          model: initialModel,
          thinkingLevel: 'high',
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
          const finished = ev.message
          if (
            workspaceType !== 'material' &&
            finished.role === 'assistant' &&
            !assistantMessageHasToolCalls(finished) &&
            assistantAgentMessageToPlainText(finished)
          ) {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                if (cancelled) return
                const shell = hostRef.current
                if (!shell) return
                mountAssistExtractToolbar(
                  shell,
                  agent.state.messages,
                  finished,
                  {
                    cancelled: () => cancelled,
                    loadFlashModel,
                    getApplyToStageEditor: () =>
                      propsLatestRef.current.applyToStageEditor,
                    getStageId: () => propsLatestRef.current.stageId,
                    getStageBody: () => propsLatestRef.current.stageBody,
                    getAgentStreaming: () => agent.state.isStreaming,
                    extractAbortRef,
                  },
                )
              })
            })
          }
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

    return () => {
      cancelled = true
      extractAbortRef.current?.abort()
      extractAbortRef.current = null
      flashModelPromiseRef.current = null
      cancelAnimationFrame(postAgentEndRaf)
      resizeObserver?.disconnect()
      resizeObserver = undefined
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
        allStages: p.allStages,
        linkedMaterial: p.linkedMaterial,
        applyToStageEditor: p.applyToStageEditor,
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
    props.applyToStageEditor,
    includePiArtifacts,
    promptRevision,
    isPaused,
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
  const prevKeys = Object.keys(prev.allStages)
  const nextKeys = Object.keys(next.allStages)
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
