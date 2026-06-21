import { Agent } from '@earendil-works/pi-agent-core'
import { ApiKeyPromptDialog, ChatPanel, ModelSelector } from '@earendil-works/pi-web-ui'
import { useEffect, useRef } from 'react'

import {
  getLearningImitationSystemPrompt,
  type LearningDocument,
  type LearningResult,
  type LearningStageId,
} from '../../bridge'
import {
  openWorkspaceConfiguredModelSelector,
  syncWorkspaceModelButtonLabel,
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
  onApplyResult: (payload: LearningWritePayload) => void
}

export function LearningAiChat(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const chatPanelRef = useRef<ChatPanel | null>(null)
  const agentRef = useRef<Agent | null>(null)
  const promptSeqRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    let unsubscribePreferences: (() => void) | undefined
    void (async () => {
      await ensurePiAppStorage()
      if (cancelled || !hostRef.current) return
      const initialPrompt = await getLearningImitationSystemPrompt(props.activeStage, {
        documents: props.documents,
        result: props.result,
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
          tools: buildLearningTools({
            activeStage: props.activeStage,
            documents: props.documents,
            applyResult: props.onApplyResult,
          }),
        },
      })
      agentRef.current = agent
      unsubscribePreferences = bindWorkspaceChatPreferences(agent, () => {
        chatPanel.requestUpdate?.()
        syncWorkspaceModelButtonLabel(chatPanel, agent.state.model)
      })

      await chatPanel.setAgent(agent, {
        onApiKeyRequired: async (provider: string) => ApiKeyPromptDialog.prompt(provider),
        onModelSelect: async () => {
          const selectModel = (model: typeof agent.state.model) => {
            agent.state.model = model
            chatPanel.requestUpdate?.()
            syncWorkspaceModelButtonLabel(chatPanel, model)
          }
          const handled = await openWorkspaceConfiguredModelSelector(
            agent.state.model,
            selectModel,
          )
          if (!handled) {
            ModelSelector.open(agent.state.model, selectModel)
          }
        },
        toolsFactory: () => agent.state.tools,
      })
      agent.state.tools = buildLearningTools({
        activeStage: props.activeStage,
        documents: props.documents,
        applyResult: props.onApplyResult,
      })
      syncWorkspaceModelButtonLabel(chatPanel, agent.state.model)
      requestAnimationFrame(() => {
        chatPanel.requestUpdate?.()
        window.dispatchEvent(new Event('resize'))
      })
    })()

    return () => {
      cancelled = true
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
    void (async () => {
      const nextPrompt = await getLearningImitationSystemPrompt(props.activeStage, {
        documents: props.documents,
        result: props.result,
      })
      if (seq !== promptSeqRef.current || !agentRef.current) return
      agentRef.current.state.systemPrompt = nextPrompt
      agentRef.current.state.tools = buildLearningTools({
        activeStage: props.activeStage,
        documents: props.documents,
        applyResult: props.onApplyResult,
      })
      chatPanelRef.current?.requestUpdate?.()
    })().catch((error: unknown) => {
      console.warn('[WriteClaw] 学习仿写提示词更新失败', error)
    })
  }, [
    props.activeStage,
    props.documents,
    props.result,
    props.promptRevision,
    props.onApplyResult,
  ])

  return <div ref={hostRef} className="learning-ai-chat-host" />
}
