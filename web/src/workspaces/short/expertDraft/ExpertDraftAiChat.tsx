import { Agent } from '@earendil-works/pi-agent-core'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import { ApiKeyPromptDialog, ChatPanel, ModelSelector } from '@earendil-works/pi-web-ui'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  readWorkspaceAgentPromptTemplate,
  type ExpertDraft,
  type Material,
  type Skill,
  type StageId,
} from '../../../bridge'
import {
  openWorkspaceConfiguredModelSelector,
  resolveWorkspaceProviderApiKey,
  syncWorkspaceModelButtonLabel,
} from '../../../pi/resolveWorkspaceChatModel'
import { convertToLlmWithSkillAsUser } from '../../../pi/skillMessageTransform'
import { createPiSessionId } from '../../../pi/sessionId'
import { ensurePiAppStorage } from '../../../pi/setupPiWorkspace'
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
  linkedMaterial?: Material | null
  linkedSkill?: Skill | null
  readAccess: WorkspaceAgentReadAccessEntry
  writerReadAccess: WorkspaceAgentReadAccessEntry
  expertDraft: ExpertDraft
  updateDraft: (updater: (draft: ExpertDraft) => ExpertDraft) => void
  startWriting: (
    sectionIds: string[],
    options?: {
      userWritingPrompt?: string
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
  },
) {
  const props = getProps()
  return {
    bookTitle: props.bookTitle,
    allStages: props.stages,
    linkedMaterial: props.linkedMaterial,
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

export function ExpertDraftAiChat(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const coordinatorAgentRef = useRef<Agent | null>(null)
  const sectionWriterAgentsRef = useRef<Map<string, Agent>>(new Map())
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
  const backgroundWriterLockRef = useRef(false)
  const activePanelKindRef = useRef<'coordinator' | 'section-writer'>(
    'coordinator',
  )
  const unsubscribeMessagesRefreshRef = useRef<(() => void) | null>(null)
  const [chatReady, setChatReady] = useState(false)
  const debouncedDraft = useDebounced(props.expertDraft, 600)

  useEffect(() => {
    propsLatestRef.current = props
  }, [props])

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

    unsubscribeMessagesRefreshRef.current = agent.subscribe((ev) => {
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
  }, [])

  const watchWriterAgent: RunExpertDraftSectionWriterOptions['onSectionAgentStart'] =
    useCallback(
      async ({ agent }) => {
        backgroundWriterLockRef.current = true
        activePanelKindRef.current = 'section-writer'

        bindActiveAgentUi(agent)
        await setPanelAgentRef.current?.(agent, () =>
          stripArtifacts(agent.state.tools),
        )
      },
      [bindActiveAgentUi],
    )

  const finishWriterPreview: RunExpertDraftSectionWriterOptions['onRunFinish'] =
    useCallback(async () => {
      backgroundWriterLockRef.current = false

      const sectionId = propsLatestRef.current.expertDraft.active_section_id
      if (sectionId) {
        await switchToSectionWriterRef.current?.(sectionId)
      } else {
        await switchToCoordinatorRef.current?.()
      }
    }, [])

  useEffect(() => {
    let cancelled = false
    let resizeObserver: ResizeObserver | undefined
    let unsubscribePreferences: (() => void) | undefined
    let activePanelAgent: Agent | null = null
    const sectionWriterAgents = new Map<string, Agent>()
    sectionWriterAgentsRef.current = sectionWriterAgents

    const currentCoordinatorTools = () =>
      buildExpertDraftCoordinatorTools(
        buildCoordinatorToolsInput(() => propsLatestRef.current, {
          watchWriterAgent,
          finishWriterPreview,
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
        template: coordinatorPromptTemplateRef.current,
        linkedSkill: p.linkedSkill,
      })
      agent.state.tools = stripArtifacts(currentCoordinatorTools())
    }

    const refreshSectionWriterAgentState = (sectionId: string, draft: ExpertDraft) => {
      const agent = sectionWriterAgentsRef.current.get(sectionId)
      const section = draft.sections.find((item) => item.id === sectionId)
      if (!agent || !section) return
      const p = propsLatestRef.current
      agent.state.systemPrompt = buildSectionWriterSystemPrompt({
        bookTitle: p.bookTitle,
        bookGenre: p.bookGenre,
        stageBody: section.body,
        workspaceStages: p.stages,
        allowedWorkspaceStages: p.writerReadAccess.workspace as readonly StageId[],
        template: sectionWriterPromptTemplateRef.current,
        linkedSkill: p.linkedSkill,
      })
      agent.state.tools = stripArtifacts(buildSectionWriterToolsFor(sectionId))
    }

    ;(async () => {
      try {
        await ensurePiAppStorage()
      } catch (e) {
        console.warn('[DeepseekWrite·正文专家面板] Pi 存储初始化失败，将重试:', e)
        await new Promise((r) => window.setTimeout(r, 500))
        if (cancelled) return
        try {
          await ensurePiAppStorage()
        } catch (e2) {
          console.error('[DeepseekWrite·正文专家面板] Pi 存储初始化最终失败:', e2)
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

      const coordinatorAgent = new Agent({
        sessionId: createPiSessionId(
          'expert-draft-coordinator',
          props.bookId,
          'shared',
          props.sessionEpoch && props.sessionEpoch > 0
            ? props.sessionEpoch
            : undefined,
        ),
        convertToLlm: convertToLlmWithSkillAsUser,
        getApiKey: resolveWorkspaceProviderApiKey,
        streamFn: createWorkspaceStreamFn(),
        toolExecution: 'sequential',
        initialState: {
          systemPrompt: buildExpertDraftCoordinatorSystemPrompt({
            bookTitle: props.bookTitle,
            bookGenre: props.bookGenre,
            draft: props.expertDraft,
            workspaceStages: props.stages,
            allowedWorkspaceStages: props.readAccess.workspace as readonly StageId[],
            template: coordinatorTemplate,
            linkedSkill: props.linkedSkill,
          }),
          model: initialModel,
          thinkingLevel: getPreferredWorkspaceThinkingLevel(),
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
        bindActiveAgentUi(agent)
        await setPanelAgent(agent, currentCoordinatorTools)
      }

      const ensureSectionWriterAgent = async (sectionId: string) => {
        let agent = sectionWriterAgents.get(sectionId)
        if (agent) return agent
        const model = await resolvePreferredWorkspaceChatModel()
        agent = new Agent({
          sessionId: createPiSessionId(
            'expert-draft-writer',
            propsLatestRef.current.bookId,
            'shared',
            sectionId,
          ),
          convertToLlm: convertToLlmWithSkillAsUser,
          getApiKey: resolveWorkspaceProviderApiKey,
          streamFn: createWorkspaceStreamFn(),
          toolExecution: 'sequential',
          initialState: {
            systemPrompt: '',
            model,
            thinkingLevel: getPreferredWorkspaceThinkingLevel(),
            messages: [],
            tools: [],
          },
        })
        sectionWriterAgents.set(sectionId, agent)
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
        const agent = await ensureSectionWriterAgent(sectionId)
        refreshSectionWriterAgentState(
          sectionId,
          propsLatestRef.current.expertDraft,
        )
        activePanelKindRef.current = 'section-writer'
        bindActiveAgentUi(agent)
        await setPanelAgent(agent, () =>
          stripArtifacts(buildSectionWriterToolsFor(sectionId)),
        )
      }

      switchToCoordinatorRef.current = switchToCoordinator
      switchToSectionWriterRef.current = switchToSectionWriter

      const initialSectionId = propsLatestRef.current.expertDraft.active_section_id
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
      unsubscribeMessagesRefreshRef.current?.()
      unsubscribeMessagesRefreshRef.current = null
      unsubscribePreferences?.()
      backgroundWriterLockRef.current = false
      setPanelAgentRef.current = null
      switchToCoordinatorRef.current = null
      switchToSectionWriterRef.current = null
      coordinatorAgentRef.current?.abort()
      coordinatorAgentRef.current = null
      for (const agent of sectionWriterAgents.values()) {
        agent.abort()
      }
      sectionWriterAgents.clear()
      sectionWriterAgentsRef.current = new Map()
      chatPanelRef.current?.remove()
      chatPanelRef.current = null
    }
    // 仅挂载时初始化；换书由 key 重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!chatReady || backgroundWriterLockRef.current) return
    const sectionId = props.expertDraft.active_section_id
    if (sectionId) {
      void switchToSectionWriterRef.current?.(sectionId)
      return
    }
    void switchToCoordinatorRef.current?.()
  }, [chatReady, props.expertDraft.active_section_id])

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
        template: coordinatorPromptTemplateRef.current,
        linkedSkill: p.linkedSkill,
      })
      coordinatorAgent.state.tools = stripArtifacts(
        buildExpertDraftCoordinatorTools(
          buildCoordinatorToolsInput(() => propsLatestRef.current, {
            watchWriterAgent,
            finishWriterPreview,
          }),
        ),
      )
    }

    const sectionId = debouncedDraft.active_section_id
    if (!sectionId || backgroundWriterLockRef.current) return
    const sectionAgent = sectionWriterAgentsRef.current.get(sectionId)
    const section = debouncedDraft.sections.find((item) => item.id === sectionId)
    if (!sectionAgent || !section) return
    const p = propsLatestRef.current
    sectionAgent.state.systemPrompt = buildSectionWriterSystemPrompt({
      bookTitle: p.bookTitle,
      bookGenre: p.bookGenre,
      stageBody: section.body,
      workspaceStages: p.stages,
      allowedWorkspaceStages: p.writerReadAccess.workspace as readonly StageId[],
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
    props.linkedSkill,
    props.readAccess,
    props.writerReadAccess,
    debouncedDraft,
    watchWriterAgent,
    finishWriterPreview,
  ])

  return (
    <div className="expert-draft-ai-shell">
      <div ref={hostRef} className="workspace-ai-chat-host" />
    </div>
  )
}
