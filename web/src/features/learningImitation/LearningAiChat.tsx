import { Agent } from '@earendil-works/pi-agent-core'
import type { AgentEvent } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import { ApiKeyPromptDialog, ChatPanel, ModelSelector } from '@earendil-works/pi-web-ui'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'

import {
  getLearningImitationSystemPrompt,
  type LearningDocument,
  type LearningResult,
  type LearningStageId,
} from '../../bridge'
import {
  openWorkspaceConfiguredModelSelector,
  syncWorkspaceModelButtonLabel,
  workspaceModelDisplayName,
} from '../../pi/resolveWorkspaceChatModel'
import { createPiSessionId } from '../../pi/sessionId'
import { ensurePiAppStorage } from '../../pi/setupPiWorkspace'
import { convertToLlmWithSkillAsUser } from '../../pi/skillMessageTransform'
import {
  bindWorkspaceChatPreferences,
  getPreferredWorkspaceThinkingLevel,
  resolvePreferredWorkspaceChatModel,
} from '../../pi/workspaceChatPreferences'
import { createWorkspaceStreamFn } from '../../pi/workspaceStreamFn'
import {
  buildLearningTools,
  type LearningWritePayload,
} from './learningAgentTools'

type Props = {
  activeStage: LearningStageId
  documents: LearningDocument[]
  result: LearningResult
  promptRevision: number
  showCustomInput: boolean
  onApplyResult: (stageId: LearningStageId, payload: LearningWritePayload) => void
  onModelLabelChange?: (label: string) => void
  onRunStateChange?: (running: boolean) => void
  onError?: (message: string) => void
}

export type LearningAiChatHandle = {
  runPreset: (stageId: LearningStageId, prompt: string) => Promise<void>
  openModelSelector: () => Promise<void>
  abort: () => void
}

function isAssistantErrorMessage(
  message: unknown,
): message is { stopReason?: string; errorMessage?: string } {
  return (
    typeof message === 'object'
    && message !== null
    && 'stopReason' in message
  )
}

function extractErrorMessage(event: AgentEvent, agent: Agent | null): string | null {
  if (
    (event.type === 'message_end' || event.type === 'turn_end')
    && isAssistantErrorMessage(event.message)
  ) {
    if (event.message.stopReason === 'error' && event.message.errorMessage) {
      return event.message.errorMessage
    }
  }
  if (event.type === 'agent_end' && agent?.state.errorMessage) {
    return agent.state.errorMessage
  }
  return null
}

export const LearningAiChat = forwardRef<LearningAiChatHandle, Props>(
function LearningAiChat({
  activeStage,
  documents,
  result,
  promptRevision,
  showCustomInput,
  onApplyResult,
  onModelLabelChange,
  onRunStateChange,
  onError,
}, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const chatPanelRef = useRef<ChatPanel | null>(null)
  const agentRef = useRef<Agent | null>(null)
  const promptSeqRef = useRef(0)
  const lastActiveStageRef = useRef<LearningStageId>(activeStage)
  const onModelLabelChangeRef = useRef(onModelLabelChange)
  const onRunStateChangeRef = useRef(onRunStateChange)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onModelLabelChangeRef.current = onModelLabelChange
  }, [onModelLabelChange])

  useEffect(() => {
    onRunStateChangeRef.current = onRunStateChange
  }, [onRunStateChange])

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  const notifyModelLabel = useCallback((model: Model<Api> | null | undefined) => {
    const label = workspaceModelDisplayName(model)
    onModelLabelChangeRef.current?.(label)
  }, [])

  const buildToolsForStage = useCallback((stageId: LearningStageId) =>
    buildLearningTools({
      activeStage: stageId,
      documents,
      applyResult: (payload) => onApplyResult(stageId, payload),
    }), [documents, onApplyResult])

  const buildToolsWithArtifacts = useCallback((stageId: LearningStageId) => {
    const artifactTool = chatPanelRef.current?.artifactsPanel?.tool
    const learningTools = buildToolsForStage(stageId)
    return artifactTool ? [artifactTool, ...learningTools] : learningTools
  }, [buildToolsForStage])

  const openModelSelector = useCallback(async () => {
    const agent = agentRef.current
    if (!agent) throw new Error('学习仿写智能体尚未就绪')

    const chatPanel = chatPanelRef.current
    const selectModel = (model: Model<Api>) => {
      agent.state.model = model
      chatPanel?.requestUpdate?.()
      syncWorkspaceModelButtonLabel(chatPanel, model)
      notifyModelLabel(model)
    }
    const handled = await openWorkspaceConfiguredModelSelector(
      agent.state.model,
      selectModel,
    )
    if (!handled) {
      ModelSelector.open(agent.state.model, selectModel)
    }
  }, [notifyModelLabel])

  const refreshAgentForStage = useCallback(async (stageId: LearningStageId) => {
    const agent = agentRef.current
    if (!agent) return false
    const nextPrompt = await getLearningImitationSystemPrompt(stageId, {
      documents,
      result,
    })
    if (agentRef.current !== agent) return false
    agent.state.systemPrompt = nextPrompt
    agent.state.tools = buildToolsWithArtifacts(stageId)
    agent.state.messages = []
    chatPanelRef.current?.requestUpdate?.()
    return true
  }, [buildToolsWithArtifacts, documents, result])

  useImperativeHandle(ref, () => ({
    async runPreset(stageId: LearningStageId, prompt: string) {
      const agent = agentRef.current
      if (!agent) throw new Error('学习仿写智能体尚未就绪')
      if (agent.state.isStreaming) throw new Error('学习仿写智能体正在运行')
      const refreshed = await refreshAgentForStage(stageId)
      if (!refreshed) throw new Error('学习仿写智能体尚未就绪')
      await agent.prompt(prompt)
    },
    openModelSelector,
    abort() {
      agentRef.current?.abort()
    },
  }), [openModelSelector, refreshAgentForStage])

  useEffect(() => {
    let cancelled = false
    let unsubscribePreferences: (() => void) | undefined
    let unsubscribeAgent: (() => void) | undefined
    void (async () => {
      await ensurePiAppStorage()
      if (cancelled || !hostRef.current) return
      const initialPrompt = await getLearningImitationSystemPrompt(activeStage, {
        documents,
        result,
      })
      const initialModel = await resolvePreferredWorkspaceChatModel()
      if (cancelled || !hostRef.current) return

      const chatPanel = new ChatPanel()
      chatPanelRef.current = chatPanel
      hostRef.current.appendChild(chatPanel)

      const agent = new Agent({
        sessionId: createPiSessionId('learning-imitation', 'shared'),
        convertToLlm: convertToLlmWithSkillAsUser,
        streamFn: createWorkspaceStreamFn(),
        initialState: {
          systemPrompt: initialPrompt,
          model: initialModel,
          thinkingLevel: getPreferredWorkspaceThinkingLevel(),
          messages: [],
          tools: buildToolsWithArtifacts(activeStage),
        },
      })
      agentRef.current = agent
      unsubscribeAgent = agent.subscribe((event) => {
        if (event.type === 'agent_start') {
          onRunStateChangeRef.current?.(true)
        } else if (event.type === 'agent_end') {
          onRunStateChangeRef.current?.(false)
        }
        const errorMessage = extractErrorMessage(event, agent)
        if (errorMessage) {
          onErrorRef.current?.(errorMessage)
        }
      })
      unsubscribePreferences = bindWorkspaceChatPreferences(agent, () => {
        chatPanel.requestUpdate?.()
        syncWorkspaceModelButtonLabel(chatPanel, agent.state.model)
        notifyModelLabel(agent.state.model)
      })

      await chatPanel.setAgent(agent, {
        onApiKeyRequired: async (provider: string) => ApiKeyPromptDialog.prompt(provider),
        onModelSelect: openModelSelector,
        toolsFactory: () => buildToolsWithArtifacts(activeStage),
      })
      syncWorkspaceModelButtonLabel(chatPanel, agent.state.model)
      notifyModelLabel(agent.state.model)
      requestAnimationFrame(() => {
        chatPanel.requestUpdate?.()
        window.dispatchEvent(new Event('resize'))
      })
    })()

    return () => {
      cancelled = true
      onRunStateChangeRef.current?.(false)
      unsubscribeAgent?.()
      unsubscribePreferences?.()
      agentRef.current?.abort()
      agentRef.current = null
      chatPanelRef.current?.remove()
      chatPanelRef.current = null
    }
    // Mount once while the document set is valid; prompt/tools are updated below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const agent = agentRef.current
    if (!agent) return
    const seq = ++promptSeqRef.current
    const stageChanged = lastActiveStageRef.current !== activeStage
    lastActiveStageRef.current = activeStage
    void (async () => {
      const nextPrompt = await getLearningImitationSystemPrompt(activeStage, {
        documents,
        result,
      })
      if (seq !== promptSeqRef.current || !agentRef.current) return
      agentRef.current.state.systemPrompt = nextPrompt
      agentRef.current.state.tools = buildToolsWithArtifacts(activeStage)
      if (stageChanged) {
        agentRef.current.state.messages = []
      }
      chatPanelRef.current?.requestUpdate?.()
    })().catch((error: unknown) => {
      console.warn('[WriteClaw] 学习仿写提示词更新失败', error)
    })
  }, [
    activeStage,
    documents,
    result,
    promptRevision,
    buildToolsWithArtifacts,
  ])

  useEffect(() => {
    const chatPanel = chatPanelRef.current
    if (!chatPanel) return
    requestAnimationFrame(() => {
      chatPanel.requestUpdate?.()
      window.dispatchEvent(new Event('resize'))
      const agentInterface = chatPanel.querySelector('agent-interface')
      const editor = agentInterface?.querySelector('message-editor') as
        | HTMLElement
        | undefined
      if (showCustomInput && editor) {
        editor.scrollIntoView({ block: 'nearest' })
        const textarea = editor.querySelector('textarea') as HTMLTextAreaElement | null
        textarea?.focus({ preventScroll: true })
      }
    })
  }, [showCustomInput])

  return (
    <div
      ref={hostRef}
      className={showCustomInput
        ? 'learning-ai-chat-host learning-ai-chat-host--custom'
        : 'learning-ai-chat-host learning-ai-chat-host--preset'}
    />
  )
})
