import type { ChatPanel } from '@earendil-works/pi-web-ui'

const MAX_INPUT_HEIGHT = 200

type AutosizeState = {
  textarea: HTMLTextAreaElement | null
  disposeTextarea: (() => void) | null
  observer: MutationObserver
  frameId: number
}

const stateByChatPanel = new WeakMap<ChatPanel, AutosizeState>()

function findTextarea(chatPanel: ChatPanel): HTMLTextAreaElement | null {
  return chatPanel.querySelector(
    'agent-interface message-editor textarea',
  ) as HTMLTextAreaElement | null
}

function resizeTextarea(textarea: HTMLTextAreaElement) {
  textarea.style.height = 'auto'
  const nextHeight = Math.min(textarea.scrollHeight, MAX_INPUT_HEIGHT)
  textarea.style.height = `${nextHeight}px`
  textarea.style.overflowY = textarea.scrollHeight > MAX_INPUT_HEIGHT
    ? 'auto'
    : 'hidden'
}

function bindTextarea(chatPanel: ChatPanel, state: AutosizeState) {
  const textarea = findTextarea(chatPanel)
  if (!textarea || textarea === state.textarea) return

  state.disposeTextarea?.()
  state.textarea = textarea

  const scheduleResize = () => {
    cancelAnimationFrame(state.frameId)
    state.frameId = requestAnimationFrame(() => resizeTextarea(textarea))
  }
  textarea.addEventListener('input', scheduleResize)
  textarea.addEventListener('keydown', scheduleResize)
  window.addEventListener('resize', scheduleResize)
  state.disposeTextarea = () => {
    textarea.removeEventListener('input', scheduleResize)
    textarea.removeEventListener('keydown', scheduleResize)
    window.removeEventListener('resize', scheduleResize)
  }
  scheduleResize()
}

/**
 * WKWebView does not consistently support `field-sizing: content`, so keep
 * Pi's message textarea in sync with its scroll height until the 200px cap.
 */
export function installMessageEditorAutosize(chatPanel: ChatPanel | null) {
  if (!chatPanel || stateByChatPanel.has(chatPanel)) return

  const state = {
    textarea: null,
    disposeTextarea: null,
    frameId: 0,
  } as AutosizeState
  state.observer = new MutationObserver(() => bindTextarea(chatPanel, state))
  state.observer.observe(chatPanel, { childList: true, subtree: true })
  stateByChatPanel.set(chatPanel, state)

  bindTextarea(chatPanel, state)
  requestAnimationFrame(() => bindTextarea(chatPanel, state))
}

export function refreshMessageEditorAutosize(chatPanel: ChatPanel | null) {
  if (!chatPanel) return
  const state = stateByChatPanel.get(chatPanel)
  if (!state) return
  bindTextarea(chatPanel, state)
  if (state.textarea) resizeTextarea(state.textarea)
}

export function disposeMessageEditorAutosize(chatPanel: ChatPanel | null) {
  if (!chatPanel) return
  const state = stateByChatPanel.get(chatPanel)
  if (!state) return
  cancelAnimationFrame(state.frameId)
  state.disposeTextarea?.()
  state.observer.disconnect()
  stateByChatPanel.delete(chatPanel)
}
