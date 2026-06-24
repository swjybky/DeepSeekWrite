import type { Agent, AgentMessage, AgentTool } from '@earendil-works/pi-agent-core'
import type { ChatPanel } from '@earendil-works/pi-web-ui'

type UpdatableElement = HTMLElement & {
  requestUpdate?: () => void
}

type AgentInterfaceElement = UpdatableElement & {
  session?: Agent
}

type MessageListElement = UpdatableElement & {
  messages?: AgentMessage[]
  tools?: AgentTool[]
  pendingToolCalls?: ReadonlySet<string>
  isStreaming?: boolean
}

type StreamingMessageContainerElement = UpdatableElement & {
  isStreaming?: boolean
  setMessage?: (message: AgentMessage | null, immediate?: boolean) => void
}

type MessageEditorElement = UpdatableElement & {
  isStreaming?: boolean
}

function getAgentInterface(chatPanel: ChatPanel | null): AgentInterfaceElement | null {
  if (!chatPanel) return null
  if (chatPanel.agentInterface) {
    return chatPanel.agentInterface as AgentInterfaceElement
  }
  return chatPanel.querySelector('agent-interface') as AgentInterfaceElement | null
}

function scrollTranscriptToBottom(iface: AgentInterfaceElement | null) {
  const scroller = iface?.querySelector('.overflow-y-auto') as HTMLElement | null
  if (!scroller) return
  scroller.scrollTop = scroller.scrollHeight
}

export function refreshChatPanelTranscript(chatPanel: ChatPanel | null, agent: Agent) {
  if (!chatPanel) return

  agent.state.messages = agent.state.messages.slice()

  const syncTranscript = () => {
    const iface = getAgentInterface(chatPanel)
    chatPanel.requestUpdate?.()
    if (!iface) return

    iface.session = agent
    iface.requestUpdate?.()

    const messageList = iface.querySelector('message-list') as MessageListElement | null
    if (messageList) {
      messageList.messages = agent.state.messages
      messageList.tools = agent.state.tools
      messageList.pendingToolCalls = agent.state.pendingToolCalls
      messageList.isStreaming = agent.state.isStreaming
      messageList.requestUpdate?.()
    }

    const streamingContainer = iface.querySelector(
      'streaming-message-container',
    ) as StreamingMessageContainerElement | null
    if (streamingContainer && !agent.state.isStreaming) {
      streamingContainer.isStreaming = false
      streamingContainer.setMessage?.(null, true)
      streamingContainer.requestUpdate?.()
    }

    const editor = iface.querySelector('message-editor') as MessageEditorElement | null
    if (editor && !agent.state.isStreaming) {
      editor.isStreaming = false
      editor.requestUpdate?.()
    }

    scrollTranscriptToBottom(iface)
  }

  syncTranscript()
  requestAnimationFrame(() => {
    syncTranscript()
    requestAnimationFrame(syncTranscript)
  })
}
