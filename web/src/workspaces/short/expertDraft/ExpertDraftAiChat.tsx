import { Agent } from '@earendil-works/pi-agent-core'
import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core'
import { ApiKeyPromptDialog, ChatPanel, ModelSelector } from '@earendil-works/pi-web-ui'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  deleteAiChatSession,
  getAiChatSession,
  listAiChatSessions,
  readWorkspaceAgentPromptTemplate,
  saveAiChatSession,
  type AiChatHistoryMetadata,
  type AiChatHistoryScope,
  type ExpertDraft,
  type MemoryEntry,
  type Material,
  type MaterialKind,
  type Skill,
  type StageId,
} from '../../../bridge'
import {
  createWorkspaceModelApiKeyResolver,
  openWorkspaceConfiguredModelSelector,
  syncWorkspaceModelButtonLabel,
} from '../../../pi/resolveWorkspaceChatModel'
import { convertToLlmWithSkillAsUser } from '../../../pi/skillMessageTransform'
import { createMemoryAwareConvertToLlm } from '../../../pi/memoryMessageTransform'
import { createPiSessionId } from '../../../pi/sessionId'
import { ensurePiAppStorage } from '../../../pi/setupPiWorkspace'
import { refreshChatPanelTranscript } from '../../../pi/chatPanelTranscript'
import { captureBookMemoryFromMessages } from '../../../pi/memoryCapture'
import {
  bindWorkspaceChatPreferences,
  getPreferredWorkspaceThinkingLevel,
  resolvePreferredWorkspaceChatModel,
} from '../../../pi/workspaceChatPreferences'
import { createWorkspaceStreamFn } from '../../../pi/workspaceStreamFn'
import { buildExpertDraftCoordinatorTools } from './coordinatorTools'
import {
  buildExpertDraftCoordinatorSystemPrompt,
  buildSectionWriterSystemPrompt,
} from './prompts'
import {
  buildSectionWriterTools,
  type ExpertDraftSectionContentField,
  type GetExpertDraftSectionContent,
  type RunExpertDraftSectionWriterOptions,
} from './sectionWriter'
import {
  EXPERT_DRAFT_COORDINATOR_AGENT_ID,
  EXPERT_SECTION_WRITER_AGENT_ID,
  type WorkspaceAgentReadAccessEntry,
} from '../stageReadAccess'
import { AiChatHistoryMenu } from '../../../components/AiChatHistoryMenu'

const ARTIFACTS_TOOL_NAME = 'artifacts'

type MessageEditorElement = HTMLElement & {
  attachments?: unknown[]
  requestUpdate?: () => void
}

function disableExpertDraftAttachments(chatPanel: ChatPanel) {
  const apply = () => {
    const iface = chatPanel.agentInterface
    if (!iface) return false
    iface.enableAttachments = false
    iface.requestUpdate?.()

    const editor = iface.querySelector('message-editor') as
      | MessageEditorElement
      | null
    if (editor) {
      editor.attachments = []
      editor.requestUpdate?.()
    }
    return true
  }

  if (apply()) return
  requestAnimationFrame(() => {
    if (apply()) return
    requestAnimationFrame(apply)
  })
}

type Props = {
  bookId: string
  bookTitle: string
  bookGenre: string
  sessionEpoch?: number
  stages: Partial<Record<StageId, string>>
  bookMemories?: MemoryEntry[]
  userMemories?: MemoryEntry[]
  bookMemoryAutoCaptureEnabled?: boolean
  linkedMaterial?: Material | null
  linkedMaterialsByKind?: Partial<Record<MaterialKind, Material[]>>
  linkedSkill?: Skill | null
  readAccess: WorkspaceAgentReadAccessEntry
  writerReadAccess: WorkspaceAgentReadAccessEntry
  expertDraft: ExpertDraft
  updateDraft: (updater: (draft: ExpertDraft) => ExpertDraft) => void
  startWriting: (
    sectionIds: string[],
    options?: {
      userWritingPrompt?: string
      model?: RunExpertDraftSectionWriterOptions['model']
      thinkingLevel?: RunExpertDraftSectionWriterOptions['thinkingLevel']
      callbacks?: Pick<
        RunExpertDraftSectionWriterOptions,
        'onSectionAgentStart' | 'onRunFinish'
      >
    },
  ) => boolean
  getRenderedExpertDraftSectionContent?: GetExpertDraftSectionContent
  getCurrentWorkspaceStageBody?: (stageId: StageId) => string | undefined
  syncExpertDraftSectionField?: (
    sectionId: string,
    field: ExpertDraftSectionContentField,
    body: string,
  ) => void
  getExpertDraftStageBody?: () => string
  applyExpertDraftStageBody?: (body: string) => void
  historyPortalTargetId?: string
  isHistoryPortalActive?: boolean
  onBookMemoriesCaptured?: (
    bookId: string,
    memories: MemoryEntry[],
  ) => void | Promise<void>
}

function resolveCoordinatorDraftBody(props: Props): string {
  const live = props.getCurrentWorkspaceStageBody?.('draft')
  if (live !== undefined) return live
  if (props.getExpertDraftStageBody) return props.getExpertDraftStageBody()
  return props.stages.draft ?? ''
}

function buildSectionWriterToolsInput(
  getProps: () => Props,
  sectionId: string,
  callbacks?: {
    onSectionBodyWritten?: (text: string) => void
    onCharacterStateWritten?: (text: string) => void
  },
) {
  const p = getProps()
  const section = p.expertDraft.sections.find((item) => item.id === sectionId)
  if (!section) return []
  return buildSectionWriterTools({
    bookTitle: p.bookTitle,
    sectionId,
    sectionTitle: section.title,
    allStages: p.stages,
    linkedMaterial: p.linkedMaterial,
    linkedMaterialsByKind: p.linkedMaterialsByKind,
    linkedSkill: p.linkedSkill,
    readAccess: p.writerReadAccess,
    getDraft: () => getProps().expertDraft,
    getRenderedSectionContent: getProps().getRenderedExpertDraftSectionContent,
    getCurrentWorkspaceStageBody: (stageId) =>
      getProps().getCurrentWorkspaceStageBody?.(stageId),
    syncExpertDraftSectionField: (sid, field, body) =>
      getProps().syncExpertDraftSectionField?.(sid, field, body),
    updateDraft: p.updateDraft,
    onSectionBodyWritten: callbacks?.onSectionBodyWritten,
    onCharacterStateWritten: callbacks?.onCharacterStateWritten,
  })
}

function buildCoordinatorToolsInput(
  getProps: () => Props,
  callbacks: {
    watchWriterAgent: RunExpertDraftSectionWriterOptions['onSectionAgentStart']
    finishWriterPreview: RunExpertDraftSectionWriterOptions['onRunFinish']
    resolveWriterRunState: () => Pick<
      RunExpertDraftSectionWriterOptions,
      'model' | 'thinkingLevel'
    >
  },
) {
  const props = getProps()
  return {
    bookTitle: props.bookTitle,
    allStages: props.stages,
    linkedMaterial: props.linkedMaterial,
    linkedMaterialsByKind: props.linkedMaterialsByKind,
    linkedSkill: props.linkedSkill,
    readAccess: props.readAccess,
    getDraft: () => getProps().expertDraft,
    updateDraft: props.updateDraft,
    getCurrentWorkspaceStageBody: (stageId: StageId) =>
      getProps().getCurrentWorkspaceStageBody?.(stageId),
    getExpertDraftStageBody: () => resolveCoordinatorDraftBody(getProps()),
    applyExpertDraftStageBody: (body: string) => {
      getProps().applyExpertDraftStageBody?.(body)
    },
    getRenderedExpertDraftSectionContent:
      props.getRenderedExpertDraftSectionContent,
    startWriting: ({
      sectionIds,
      userWritingPrompt,
    }: {
      sectionIds: string[]
      userWritingPrompt?: string
    }) =>
      getProps().startWriting(sectionIds, {
        userWritingPrompt,
        ...callbacks.resolveWriterRunState(),
        callbacks: {
          onSectionAgentStart: callbacks.watchWriterAgent,
          onRunFinish: callbacks.finishWriterPreview,
        },
      }),
  }
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

function hasUserMessage(messages: AgentMessage[]): boolean {
  return messages.some(
    (message) =>
      message &&
      typeof message === 'object' &&
      (message as { role?: unknown }).role === 'user',
  )
}

export function ExpertDraftAiChat(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const coordinatorAgentRef = useRef<Agent | null>(null)
  const sectionWriterAgentRef = useRef<Agent | null>(null)
  const chatPanelRef = useRef<ChatPanel | null>(null)
  const propsLatestRef = useRef(props)
  const coordinatorPromptTemplateRef = useRef('')
  const sectionWriterPromptTemplateRef = useRef('')
  const setPanelAgentRef = useRef<
    ((nextAgent: Agent, toolsFactory: () => AgentTool[]) => Promise<void>) | null
  >(null)
  const switchToCoordinatorRef = useRef<(() => Promise<void>) | null>(null)
  const switchToSectionWriterRef = useRef<
    ((sectionId: string) => Promise<void>) | null
  >(null)
  const backgroundWriterActiveRef = useRef(false)
  const activePanelKindRef = useRef<'coordinator' | 'section-writer'>(
    'coordinator',
  )
  const unsubscribeMessagesRefreshRef = useRef<(() => void) | null>(null)
  const [chatReady, setChatReady] = useState(false)
  const [activePanelKind, setActivePanelKind] = useState<
    'coordinator' | 'section-writer'
  >('coordinator')
  const [coordinatorHistorySessions, setCoordinatorHistorySessions] = useState<
    AiChatHistoryMetadata[]
  >([])
  const [writerHistorySessions, setWriterHistorySessions] = useState<
    AiChatHistoryMetadata[]
  >([])
  const [activeCoordinatorHistoryId, setActiveCoordinatorHistoryId] = useState('')
  const [activeWriterHistoryId, setActiveWriterHistoryId] = useState('')
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyDisabled, setHistoryDisabled] = useState(false)
  const debouncedDraft = useDebounced(props.expertDraft, 600)
  const activeCoordinatorHistoryIdRef = useRef('')
  const activeWriterHistoryIdRef = useRef('')
  const coordinatorBlankNonceRef = useRef(0)
  const writerBlankNonceRef = useRef(0)
  const persistHistoryFromAgentRef = useRef<
    ((
      kind: 'coordinator' | 'section-writer',
      agent: Agent,
    ) => Promise<void>) | null
  >(null)

  useEffect(() => {
    propsLatestRef.current = props
  }, [props])

  const historyScopeFor = (
    kind: 'coordinator' | 'section-writer',
  ): AiChatHistoryScope => ({
    owner_type: 'book',
    owner_id: propsLatestRef.current.bookId,
    category_id:
      kind === 'coordinator'
        ? EXPERT_DRAFT_COORDINATOR_AGENT_ID
        : EXPERT_SECTION_WRITER_AGENT_ID,
  })

  const resolveCoordinatorPiSessionId = (historyKey?: string) =>
    createPiSessionId(
      'expert-draft-coordinator',
      propsLatestRef.current.bookId,
      'shared',
      historyKey ||
        `blank_${propsLatestRef.current.sessionEpoch ?? 0}_${coordinatorBlankNonceRef.current}`,
    )

  const resolveWriterPiSessionId = (historyKey?: string) =>
    createPiSessionId(
      'expert-draft-writer',
      propsLatestRef.current.bookId,
      'shared',
      historyKey ||
        `blank_${propsLatestRef.current.sessionEpoch ?? 0}_${writerBlankNonceRef.current}`,
    )

  const refreshHistorySessions = async (
    kind: 'coordinator' | 'section-writer',
  ) => {
    const sessions = await listAiChatSessions(historyScopeFor(kind))
    if (kind === 'coordinator') setCoordinatorHistorySessions(sessions)
    else setWriterHistorySessions(sessions)
    return sessions
  }

  const persistHistoryFromAgent = async (
    kind: 'coordinator' | 'section-writer',
    agent: Agent,
  ) => {
    if (!hasUserMessage(agent.state.messages)) return
    const currentId =
      kind === 'coordinator'
        ? activeCoordinatorHistoryIdRef.current
        : activeWriterHistoryIdRef.current
    const saved = await saveAiChatSession({
      id: currentId,
      scope: historyScopeFor(kind),
      messages: agent.state.messages,
      model: agent.state.model,
      thinking_level: agent.state.thinkingLevel,
    })
    if (!saved) return
    if (kind === 'coordinator') {
      activeCoordinatorHistoryIdRef.current = saved.id
      setActiveCoordinatorHistoryId(saved.id)
      agent.sessionId = resolveCoordinatorPiSessionId(saved.id)
    } else {
      activeWriterHistoryIdRef.current = saved.id
      setActiveWriterHistoryId(saved.id)
      agent.sessionId = resolveWriterPiSessionId(saved.id)
    }
    await refreshHistorySessions(kind)
  }

  const captureMemoryFromAgent = (
    kind: 'coordinator' | 'section-writer',
    agent: Agent,
  ) => {
    if (kind === 'section-writer' && backgroundWriterActiveRef.current) return
    const p = propsLatestRef.current
    if (!p.bookMemoryAutoCaptureEnabled || !p.onBookMemoriesCaptured) return
    const messages = agent.state.messages.slice()
    const bookMemories = [...(p.bookMemories ?? [])]
    const userMemories = [...(p.userMemories ?? [])]
    void (async () => {
      try {
        const next = await captureBookMemoryFromMessages({
          bookId: p.bookId,
          bookTitle: p.bookTitle,
          bookType: 'short',
          messages,
          bookMemories,
          userMemories,
        })
        if (next) await p.onBookMemoriesCaptured?.(p.bookId, next)
      } catch (error) {
        console.warn('[DeepSeekWrite memory] expert capture skipped:', error)
      }
    })()
  }
  useEffect(() => {
    persistHistoryFromAgentRef.current = persistHistoryFromAgent
  })

  const activeHistoryAgent = () =>
    activePanelKind === 'section-writer'
      ? sectionWriterAgentRef.current
      : coordinatorAgentRef.current

  const applyHistorySession = async (sessionId: string) => {
    const kind = activePanelKind
    const agent = activeHistoryAgent()
    if (!agent) return
    if (agent.state.isStreaming) {
      window.alert('请等本轮回复结束后再切换历史对话。')
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
      if (kind === 'coordinator') {
        activeCoordinatorHistoryIdRef.current = session.id
        setActiveCoordinatorHistoryId(session.id)
        agent.sessionId = resolveCoordinatorPiSessionId(session.id)
      } else {
        activeWriterHistoryIdRef.current = session.id
        setActiveWriterHistoryId(session.id)
        agent.sessionId = resolveWriterPiSessionId(session.id)
      }
      refreshChatPanelTranscript(chatPanelRef.current, agent)
      await refreshHistorySessions(kind)
    } finally {
      setHistoryLoading(false)
    }
  }

  const deleteHistorySession = async (sessionId: string) => {
    if (!window.confirm('删除后无法恢复，确定要删除这条历史对话吗？')) return
    const kind = activePanelKind
    await deleteAiChatSession(sessionId)
    const agent = activeHistoryAgent()
    if (kind === 'coordinator' && activeCoordinatorHistoryIdRef.current === sessionId) {
      activeCoordinatorHistoryIdRef.current = ''
      setActiveCoordinatorHistoryId('')
      if (agent) {
        agent.state.messages = []
        agent.sessionId = resolveCoordinatorPiSessionId()
      }
    }
    if (kind === 'section-writer' && activeWriterHistoryIdRef.current === sessionId) {
      activeWriterHistoryIdRef.current = ''
      setActiveWriterHistoryId('')
      if (agent) {
        agent.state.messages = []
        agent.sessionId = resolveWriterPiSessionId()
      }
    }
    if (agent) refreshChatPanelTranscript(chatPanelRef.current, agent)
    await refreshHistorySessions(kind)
  }

  const bindActiveAgentUi = useCallback((agent: Agent) => {
    unsubscribeMessagesRefreshRef.current?.()
    let postAgentEndRaf = 0

    const refreshIdleUi = () => {
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

    unsubscribeMessagesRefreshRef.current = agent.subscribe(async (ev) => {
      const historyKind =
        agent === coordinatorAgentRef.current ? 'coordinator' : 'section-writer'
      if (ev.type === 'agent_start') {
        setHistoryDisabled(true)
      }
      if (ev.type === 'message_end') {
        if (ev.message.role === 'user') {
          window.setTimeout(() => captureMemoryFromAgent(historyKind, agent), 0)
        }
        agent.state.messages = agent.state.messages.slice()
      }
      if (ev.type === 'agent_end') {
        try {
          await persistHistoryFromAgentRef.current?.(historyKind, agent)
        } finally {
          setHistoryDisabled(false)
        }
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
  }, [])

  const showSelectedPanel = useCallback(async () => {
    const sectionId = propsLatestRef.current.expertDraft.active_section_id
    if (sectionId) {
      const runningAgent = sectionWriterAgentRef.current
      if (backgroundWriterActiveRef.current && runningAgent) {
        activePanelKindRef.current = 'section-writer'
        bindActiveAgentUi(runningAgent)
        await setPanelAgentRef.current?.(runningAgent, () =>
          stripArtifacts(runningAgent.state.tools),
        )
        return
      }
      await switchToSectionWriterRef.current?.(sectionId)
      return
    }
    await switchToCoordinatorRef.current?.()
  }, [bindActiveAgentUi])

  const watchWriterAgent: RunExpertDraftSectionWriterOptions['onSectionAgentStart'] =
    useCallback(
      async ({ agent }) => {
        backgroundWriterActiveRef.current = true
        sectionWriterAgentRef.current = agent
        await showSelectedPanel()
      },
      [showSelectedPanel],
    )

  const finishWriterPreview: RunExpertDraftSectionWriterOptions['onRunFinish'] =
    useCallback(async () => {
      backgroundWriterActiveRef.current = false
      await showSelectedPanel()
    }, [showSelectedPanel])

  useEffect(() => {
    let cancelled = false
    let resizeObserver: ResizeObserver | undefined
    let unsubscribePreferences: (() => void) | undefined
    let activePanelAgent: Agent | null = null
    let sectionWriterAgent: Agent | null = null
    sectionWriterAgentRef.current = null

    const currentCoordinatorTools = () =>
      buildExpertDraftCoordinatorTools(
        buildCoordinatorToolsInput(() => propsLatestRef.current, {
          watchWriterAgent,
          finishWriterPreview,
          resolveWriterRunState: () => ({
            model: coordinatorAgentRef.current?.state.model,
            thinkingLevel: coordinatorAgentRef.current?.state.thinkingLevel,
          }),
        }),
      )

    const buildSectionWriterToolsFor = (sectionId: string) =>
      buildSectionWriterToolsInput(() => propsLatestRef.current, sectionId)

    const refreshCoordinatorAgentState = (draft: ExpertDraft) => {
      const agent = coordinatorAgentRef.current
      if (!agent) return
      const p = propsLatestRef.current
      agent.state.systemPrompt = buildExpertDraftCoordinatorSystemPrompt({
        bookTitle: p.bookTitle,
        bookGenre: p.bookGenre,
        draft,
        workspaceStages: p.stages,
        allowedWorkspaceStages: p.readAccess.workspace as readonly StageId[],
        allowedMaterialKinds: p.readAccess.material as readonly MaterialKind[],
        linkedMaterialsByKind: p.linkedMaterialsByKind,
        template: coordinatorPromptTemplateRef.current,
        linkedSkill: p.linkedSkill,
      })
      agent.state.tools = stripArtifacts(currentCoordinatorTools())
    }

    const refreshSectionWriterAgentState = (sectionId: string, draft: ExpertDraft) => {
      const agent = sectionWriterAgentRef.current
      const section = draft.sections.find((item) => item.id === sectionId)
      if (!agent || !section) return
      const p = propsLatestRef.current
      agent.state.systemPrompt = buildSectionWriterSystemPrompt({
        bookTitle: p.bookTitle,
        bookGenre: p.bookGenre,
        stageBody: section.body,
        workspaceStages: p.stages,
        allowedWorkspaceStages: p.writerReadAccess.workspace as readonly StageId[],
        allowedMaterialKinds: p.writerReadAccess.material as readonly MaterialKind[],
        linkedMaterialsByKind: p.linkedMaterialsByKind,
        template: sectionWriterPromptTemplateRef.current,
        linkedSkill: p.linkedSkill,
      })
      agent.state.tools = stripArtifacts(buildSectionWriterToolsFor(sectionId))
    }

    ;(async () => {
      try {
        await ensurePiAppStorage()
      } catch (e) {
        console.warn('[DeepSeekWrite·正文专家面板] Pi 存储初始化失败，将重试:', e)
        await new Promise((r) => window.setTimeout(r, 500))
        if (cancelled) return
        try {
          await ensurePiAppStorage()
        } catch (e2) {
          console.error('[DeepSeekWrite·正文专家面板] Pi 存储初始化最终失败:', e2)
          return
        }
      }
      if (cancelled) return

      const [initialModel, coordinatorTemplate, sectionWriterTemplate] =
        await Promise.all([
          resolvePreferredWorkspaceChatModel(),
          readWorkspaceAgentPromptTemplate(EXPERT_DRAFT_COORDINATOR_AGENT_ID),
          readWorkspaceAgentPromptTemplate(EXPERT_SECTION_WRITER_AGENT_ID),
        ])
      coordinatorPromptTemplateRef.current = coordinatorTemplate
      sectionWriterPromptTemplateRef.current = sectionWriterTemplate

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
        syncWorkspaceModelButtonLabel(panel, activePanelAgent?.state.model)
      }

      resizeObserver = new ResizeObserver(() => {
        if (!cancelled) requestAnimationFrame(nudgePiLayout)
      })
      resizeObserver.observe(root)

      const coordinatorModel = initialModel
      const coordinatorThinkingLevel = getPreferredWorkspaceThinkingLevel()
      setHistoryLoading(true)
      try {
        await refreshHistorySessions('coordinator')
        if (cancelled) return
      } finally {
        if (!cancelled) setHistoryLoading(false)
      }
      activeCoordinatorHistoryIdRef.current = ''
      setActiveCoordinatorHistoryId('')

      const coordinatorAgent = new Agent({
        sessionId: resolveCoordinatorPiSessionId(),
        convertToLlm: createMemoryAwareConvertToLlm(
          convertToLlmWithSkillAsUser,
          () => ({
            bookTitle: propsLatestRef.current.bookTitle,
            bookType: 'short',
            bookMemories: propsLatestRef.current.bookMemories,
            userMemories: propsLatestRef.current.userMemories,
          }),
        ),
        getApiKey: createWorkspaceModelApiKeyResolver(
          () => coordinatorAgentRef.current?.state.model ?? coordinatorModel,
        ),
        streamFn: createWorkspaceStreamFn(),
        toolExecution: 'sequential',
        initialState: {
          systemPrompt: buildExpertDraftCoordinatorSystemPrompt({
            bookTitle: props.bookTitle,
            bookGenre: props.bookGenre,
            draft: props.expertDraft,
            workspaceStages: props.stages,
            allowedWorkspaceStages: props.readAccess.workspace as readonly StageId[],
            allowedMaterialKinds: props.readAccess.material as readonly MaterialKind[],
            linkedMaterialsByKind: props.linkedMaterialsByKind,
            template: coordinatorTemplate,
            linkedSkill: props.linkedSkill,
          }),
          model: coordinatorModel,
          thinkingLevel: coordinatorThinkingLevel,
          messages: [],
          tools: [],
        },
      })
      coordinatorAgentRef.current = coordinatorAgent

      const setPanelAgent = async (
        nextAgent: Agent,
        toolsFactory: () => AgentTool[],
      ) => {
        if (cancelled) return
        activePanelAgent = nextAgent
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
              syncWorkspaceModelButtonLabel(chatPanel, model)
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
        disableExpertDraftAttachments(chatPanel)
        nextAgent.state.tools = stripArtifacts(nextAgent.state.tools)
        if (!cancelled) {
          nudgePiLayout()
          chatPanel.requestUpdate?.()
        }
      }
      setPanelAgentRef.current = setPanelAgent

      const switchToCoordinator = async () => {
        const agent = coordinatorAgentRef.current
        if (!agent) return
        refreshCoordinatorAgentState(propsLatestRef.current.expertDraft)
        activePanelKindRef.current = 'coordinator'
        setActivePanelKind('coordinator')
        bindActiveAgentUi(agent)
        await setPanelAgent(agent, currentCoordinatorTools)
      }

      const ensureSectionWriterAgent = async () => {
        if (sectionWriterAgentRef.current) {
          sectionWriterAgent = sectionWriterAgentRef.current
          return sectionWriterAgent
        }
        if (sectionWriterAgent) return sectionWriterAgent
        const model = await resolvePreferredWorkspaceChatModel()
        const thinkingLevel = getPreferredWorkspaceThinkingLevel()
        setHistoryLoading(true)
        try {
          await refreshHistorySessions('section-writer')
        } finally {
          if (!cancelled) setHistoryLoading(false)
        }
        activeWriterHistoryIdRef.current = ''
        setActiveWriterHistoryId('')
        const agent = new Agent({
          sessionId: resolveWriterPiSessionId(),
          convertToLlm: createMemoryAwareConvertToLlm(
            convertToLlmWithSkillAsUser,
            () => ({
              bookTitle: propsLatestRef.current.bookTitle,
              bookType: 'short',
              bookMemories: propsLatestRef.current.bookMemories,
              userMemories: propsLatestRef.current.userMemories,
            }),
          ),
          getApiKey: createWorkspaceModelApiKeyResolver(
            () => sectionWriterAgent?.state.model ?? model,
          ),
          streamFn: createWorkspaceStreamFn(),
          toolExecution: 'sequential',
          initialState: {
            systemPrompt: '',
            model,
            thinkingLevel,
            messages: [],
            tools: [],
          },
        })
        sectionWriterAgent = agent
        sectionWriterAgentRef.current = agent
        return agent
      }

      const switchToSectionWriter = async (sectionId: string) => {
        const section = propsLatestRef.current.expertDraft.sections.find(
          (item) => item.id === sectionId,
        )
        if (!section) {
          await switchToCoordinator()
          return
        }
        const agent = await ensureSectionWriterAgent()
        refreshSectionWriterAgentState(
          sectionId,
          propsLatestRef.current.expertDraft,
        )
        activePanelKindRef.current = 'section-writer'
        setActivePanelKind('section-writer')
        bindActiveAgentUi(agent)
        await setPanelAgent(agent, () =>
          stripArtifacts(buildSectionWriterToolsFor(sectionId)),
        )
      }

      switchToCoordinatorRef.current = switchToCoordinator
      switchToSectionWriterRef.current = switchToSectionWriter

      const initialDraft = propsLatestRef.current.expertDraft
      const initialSectionId = initialDraft.active_section_id
      if (initialSectionId) {
        await switchToSectionWriter(initialSectionId)
      } else {
        await switchToCoordinator()
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
      resizeObserver?.disconnect()
      resizeObserver = undefined
      setChatReady(false)
      setHistoryDisabled(false)
      unsubscribeMessagesRefreshRef.current?.()
      unsubscribeMessagesRefreshRef.current = null
      unsubscribePreferences?.()
      backgroundWriterActiveRef.current = false
      setPanelAgentRef.current = null
      switchToCoordinatorRef.current = null
      switchToSectionWriterRef.current = null
      coordinatorAgentRef.current?.abort()
      coordinatorAgentRef.current = null
      ;(sectionWriterAgentRef.current ?? sectionWriterAgent)?.abort()
      sectionWriterAgent = null
      sectionWriterAgentRef.current = null
      chatPanelRef.current?.remove()
      chatPanelRef.current = null
    }
    // 仅挂载时初始化；换书由 key 重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!chatReady) return
    void showSelectedPanel()
  }, [chatReady, props.expertDraft.active_section_id, showSelectedPanel])

  useEffect(() => {
    if (!chatReady || debouncedDraft.running) return
    const coordinatorAgent = coordinatorAgentRef.current
    if (coordinatorAgent) {
      const p = propsLatestRef.current
      coordinatorAgent.state.systemPrompt = buildExpertDraftCoordinatorSystemPrompt({
        bookTitle: p.bookTitle,
        bookGenre: p.bookGenre,
        draft: debouncedDraft,
        workspaceStages: p.stages,
        allowedWorkspaceStages: p.readAccess.workspace as readonly StageId[],
        allowedMaterialKinds: p.readAccess.material as readonly MaterialKind[],
        linkedMaterialsByKind: p.linkedMaterialsByKind,
        template: coordinatorPromptTemplateRef.current,
        linkedSkill: p.linkedSkill,
      })
      coordinatorAgent.state.tools = stripArtifacts(
        buildExpertDraftCoordinatorTools(
          buildCoordinatorToolsInput(() => propsLatestRef.current, {
            watchWriterAgent,
            finishWriterPreview,
            resolveWriterRunState: () => ({
              model: coordinatorAgentRef.current?.state.model,
              thinkingLevel: coordinatorAgentRef.current?.state.thinkingLevel,
            }),
          }),
        ),
      )
    }

    const sectionId = debouncedDraft.active_section_id
    if (!sectionId) return
    const sectionAgent = sectionWriterAgentRef.current
    const section = debouncedDraft.sections.find((item) => item.id === sectionId)
    if (!sectionAgent || !section) return
    const p = propsLatestRef.current
    sectionAgent.state.systemPrompt = buildSectionWriterSystemPrompt({
      bookTitle: p.bookTitle,
      bookGenre: p.bookGenre,
      stageBody: section.body,
      workspaceStages: p.stages,
      allowedWorkspaceStages: p.writerReadAccess.workspace as readonly StageId[],
      allowedMaterialKinds: p.writerReadAccess.material as readonly MaterialKind[],
      linkedMaterialsByKind: p.linkedMaterialsByKind,
      template: sectionWriterPromptTemplateRef.current,
      linkedSkill: p.linkedSkill,
    })
    sectionAgent.state.tools = stripArtifacts(
      buildSectionWriterToolsInput(() => propsLatestRef.current, sectionId),
    )
  }, [
    chatReady,
    props.bookTitle,
    props.bookGenre,
    props.stages,
    props.linkedMaterial,
    props.linkedMaterialsByKind,
    props.linkedSkill,
    props.readAccess,
    props.writerReadAccess,
    debouncedDraft,
    watchWriterAgent,
    finishWriterPreview,
  ])

  const historyMenu = (
    <AiChatHistoryMenu
      sessions={
        activePanelKind === 'section-writer'
          ? writerHistorySessions
          : coordinatorHistorySessions
      }
      activeSessionId={
        activePanelKind === 'section-writer'
          ? activeWriterHistoryId
          : activeCoordinatorHistoryId
      }
      loading={historyLoading}
      disabled={historyDisabled}
      portalTargetId={props.historyPortalTargetId}
      onSelect={(sessionId) => applyHistorySession(sessionId)}
      onDelete={(sessionId) => void deleteHistorySession(sessionId)}
    />
  )

  return (
    <div className="expert-draft-ai-shell">
      {props.historyPortalTargetId ? (
        props.isHistoryPortalActive ? historyMenu : null
      ) : (
        <div className="workspace-ai-chat-history-row">{historyMenu}</div>
      )}
      <div ref={hostRef} className="workspace-ai-chat-host" />
    </div>
  )
}
