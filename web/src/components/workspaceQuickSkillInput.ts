import type { ChatPanel, Attachment } from '@earendil-works/pi-web-ui'
import {
  disposeMessageEditorAutosize,
  installMessageEditorAutosize,
  refreshMessageEditorAutosize,
} from './messageEditorAutosize'

export type QuickLoadableSkill = {
  id: string
  stageId: string
  name: string
  description: string
  body: string
}

type MessageEditorElement = HTMLElement & {
  value?: string
  requestUpdate?: () => void
}

type AgentInterfaceElement = HTMLElement & {
  requestUpdate?: () => void
  sendMessage?: (input: string, attachments?: Attachment[]) => void | Promise<void>
  session?: {
    state?: {
      messages?: unknown[]
    }
  }
  __deepSeekWriteQuickSkillSendWrapper?: boolean
}

type SlashQuery = {
  start: number
  end: number
  query: string
}

type QuickSkillInputConfig = {
  getSkills: () => QuickLoadableSkill[]
  isEnabled?: () => boolean
}

type QuickSkillInputState = QuickSkillInputConfig & {
  selectedSkill: QuickLoadableSkill | null
  selectedMarker: string
  highlightedIndex: number
  menuEl: HTMLDivElement | null
  editor: MessageEditorElement | null
  textarea: HTMLTextAreaElement | null
  disposeEditorListeners: (() => void) | null
  disposeDocumentListeners: (() => void) | null
}

const stateByChatPanel = new WeakMap<ChatPanel, QuickSkillInputState>()

function getAgentInterface(chatPanel: ChatPanel | null): AgentInterfaceElement | null {
  if (!chatPanel) return null
  if (chatPanel.agentInterface) {
    return chatPanel.agentInterface as AgentInterfaceElement
  }
  return chatPanel.querySelector('agent-interface') as AgentInterfaceElement | null
}

function getMessageEditor(chatPanel: ChatPanel | null): MessageEditorElement | null {
  return getAgentInterface(chatPanel)?.querySelector(
    'message-editor',
  ) as MessageEditorElement | null
}

function getTextarea(editor: MessageEditorElement | null): HTMLTextAreaElement | null {
  return editor?.querySelector('textarea') as HTMLTextAreaElement | null
}

function isQuickSkillEnabled(state: QuickSkillInputState): boolean {
  return state.isEnabled?.() ?? true
}

function skillMarker(skill: QuickLoadableSkill): string {
  return `/${skill.name} `
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function resolveSlashQuery(textarea: HTMLTextAreaElement): SlashQuery | null {
  const caret = textarea.selectionStart ?? textarea.value.length
  const beforeCaret = textarea.value.slice(0, caret)
  const match = /(^|\s)\/([^\s/]*)$/.exec(beforeCaret)
  if (!match) return null
  const query = match[2] ?? ''
  return {
    start: beforeCaret.length - query.length - 1,
    end: caret,
    query,
  }
}

function quickSkillUserMessage(skill: QuickLoadableSkill, input: string): string {
  const question = input.trim() || '请按上面的技能继续协助当前阶段。'
  return [
    `【已加载技能：${skill.name}】`,
    skill.description ? `技能说明：${skill.description}` : '',
    '本技能正文已由 / 技能快捷机制注入本轮上下文；请直接使用下面的技能内容，不要再调用 load_skill 加载同名技能。',
    '',
    skill.body.trim(),
    '',
    '---',
    '',
    '【用户问题】',
    question,
  ]
    .filter((line, index, lines) => {
      if (line) return true
      const previous = lines[index - 1]
      const next = lines[index + 1]
      return Boolean(previous || next)
    })
    .join('\n')
}

function stripSelectedMarker(input: string, marker: string): string {
  if (!marker) return input
  const index = input.indexOf(marker)
  if (index < 0) return input
  return `${input.slice(0, index)}${input.slice(index + marker.length)}`.trim()
}

function setEditorValue(
  editor: MessageEditorElement,
  textarea: HTMLTextAreaElement,
  value: string,
  caret: number,
) {
  editor.value = value
  textarea.value = value
  textarea.setSelectionRange(caret, caret)
  editor.requestUpdate?.()
}

function hideMenu(state: QuickSkillInputState) {
  state.menuEl?.remove()
  state.menuEl = null
  state.highlightedIndex = 0
}

function positionMenu(state: QuickSkillInputState) {
  const menu = state.menuEl
  const textarea = state.textarea
  if (!menu || !textarea) return

  const rect = textarea.getBoundingClientRect()
  const width = Math.min(Math.max(rect.width, 260), 420)
  menu.style.width = `${Math.round(width)}px`
  menu.style.left = `${Math.round(Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)))}px`

  const above = rect.top - menu.offsetHeight - 8
  const top = above >= 8 ? above : Math.min(rect.bottom + 8, window.innerHeight - menu.offsetHeight - 8)
  menu.style.top = `${Math.round(Math.max(8, top))}px`
}

function scrollHighlightedSkillIntoView(state: QuickSkillInputState) {
  state.menuEl
    ?.querySelector<HTMLElement>('.workspace-quick-skill-option--active')
    ?.scrollIntoView({ block: 'nearest' })
}

function candidateSkills(state: QuickSkillInputState, query: string): QuickLoadableSkill[] {
  const skills = state.getSkills()
  const normalizedQuery = normalizeSearch(query)
  if (!normalizedQuery) return skills
  return skills.filter((skill) => {
    const haystack = normalizeSearch(`${skill.name} ${skill.description}`)
    return haystack.includes(normalizedQuery)
  })
}

function selectSkill(
  state: QuickSkillInputState,
  skill: QuickLoadableSkill,
  slashQuery: SlashQuery | null,
) {
  const editor = state.editor
  const textarea = state.textarea
  if (!editor || !textarea) return

  const marker = skillMarker(skill)
  const query = slashQuery ?? resolveSlashQuery(textarea)
  const value = textarea.value
  const start = query?.start ?? value.length
  const end = query?.end ?? value.length
  const nextValue = `${value.slice(0, start)}${marker}${value.slice(end)}`
  const caret = start + marker.length
  state.selectedSkill = skill
  state.selectedMarker = marker
  hideMenu(state)
  setEditorValue(editor, textarea, nextValue, caret)
  textarea.focus({ preventScroll: true })
}

function renderMenu(
  state: QuickSkillInputState,
  skills: QuickLoadableSkill[],
  slashQuery: SlashQuery,
) {
  if (skills.length === 0) {
    hideMenu(state)
    return
  }

  const menu = state.menuEl ?? document.createElement('div')
  if (!state.menuEl) {
    menu.className = 'workspace-quick-skill-menu'
    menu.setAttribute('role', 'listbox')
    document.body.appendChild(menu)
    state.menuEl = menu
  }

  state.highlightedIndex = Math.min(
    Math.max(state.highlightedIndex, 0),
    skills.length - 1,
  )
  menu.innerHTML = ''

  for (const [index, skill] of skills.entries()) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className =
      index === state.highlightedIndex
        ? 'workspace-quick-skill-option workspace-quick-skill-option--active'
        : 'workspace-quick-skill-option'
    button.setAttribute('role', 'option')
    button.setAttribute('aria-selected', index === state.highlightedIndex ? 'true' : 'false')
    button.addEventListener('mouseenter', () => {
      if (state.highlightedIndex === index) return
      state.highlightedIndex = index
      renderMenu(state, skills, slashQuery)
    })
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      selectSkill(state, skill, slashQuery)
    })

    const name = document.createElement('span')
    name.className = 'workspace-quick-skill-option-name'
    name.textContent = skill.name
    button.appendChild(name)

    const description = document.createElement('span')
    description.className = 'workspace-quick-skill-option-description'
    description.textContent = skill.description
    button.appendChild(description)

    menu.appendChild(button)
  }

  positionMenu(state)
  scrollHighlightedSkillIntoView(state)
}

function refreshMenu(state: QuickSkillInputState) {
  const textarea = state.textarea
  if (!textarea || !isQuickSkillEnabled(state)) {
    hideMenu(state)
    return
  }

  if (state.selectedSkill && !textarea.value.includes(state.selectedMarker)) {
    state.selectedSkill = null
    state.selectedMarker = ''
  }

  const slashQuery = resolveSlashQuery(textarea)
  if (!slashQuery) {
    hideMenu(state)
    return
  }

  const skills = candidateSkills(state, slashQuery.query)
  renderMenu(state, skills, slashQuery)
}

function installEditorListeners(chatPanel: ChatPanel, state: QuickSkillInputState): boolean {
  const editor = getMessageEditor(chatPanel)
  const textarea = getTextarea(editor)
  if (!editor || !textarea) return false

  if (state.editor === editor && state.textarea === textarea) {
    refreshMenu(state)
    return true
  }

  state.disposeEditorListeners?.()
  state.editor = editor
  state.textarea = textarea

  const handleInput = () => refreshMenu(state)
  const consumeMenuKey = (event: KeyboardEvent) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const handleKeyDown = (event: KeyboardEvent) => {
    if (!state.menuEl || event.isComposing || event.key === 'Process') return
    const slashQuery = resolveSlashQuery(textarea)
    if (!slashQuery) return
    const skills = candidateSkills(state, slashQuery.query)
    if (skills.length === 0) return

    if (event.key === 'ArrowDown') {
      consumeMenuKey(event)
      state.highlightedIndex = (state.highlightedIndex + 1) % skills.length
      renderMenu(state, skills, slashQuery)
    } else if (event.key === 'ArrowUp') {
      consumeMenuKey(event)
      state.highlightedIndex = (state.highlightedIndex - 1 + skills.length) % skills.length
      renderMenu(state, skills, slashQuery)
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      consumeMenuKey(event)
      selectSkill(state, skills[state.highlightedIndex]!, slashQuery)
    } else if (event.key === 'Escape') {
      consumeMenuKey(event)
      hideMenu(state)
    }
  }
  const handleFocus = () => refreshMenu(state)
  const handleWindowChange = () => positionMenu(state)

  textarea.addEventListener('input', handleInput)
  textarea.addEventListener('keydown', handleKeyDown, true)
  textarea.addEventListener('focus', handleFocus)
  window.addEventListener('resize', handleWindowChange)
  window.addEventListener('scroll', handleWindowChange, true)

  state.disposeEditorListeners = () => {
    textarea.removeEventListener('input', handleInput)
    textarea.removeEventListener('keydown', handleKeyDown, true)
    textarea.removeEventListener('focus', handleFocus)
    window.removeEventListener('resize', handleWindowChange)
    window.removeEventListener('scroll', handleWindowChange, true)
  }

  refreshMenu(state)
  return true
}

function installDocumentListeners(state: QuickSkillInputState) {
  if (state.disposeDocumentListeners) return
  const handlePointerDown = (event: PointerEvent) => {
    const target = event.target as Node | null
    if (!target) return
    if (state.menuEl?.contains(target)) return
    if (state.editor?.contains(target)) return
    hideMenu(state)
  }
  document.addEventListener('pointerdown', handlePointerDown, true)
  state.disposeDocumentListeners = () =>
    document.removeEventListener('pointerdown', handlePointerDown, true)
}

function readMessageCount(iface: AgentInterfaceElement): number {
  return iface.session?.state?.messages?.length ?? 0
}

function installSendWrapper(chatPanel: ChatPanel, state: QuickSkillInputState) {
  const iface = getAgentInterface(chatPanel)
  if (
    !iface ||
    iface.__deepSeekWriteQuickSkillSendWrapper ||
    typeof iface.sendMessage !== 'function'
  ) {
    return
  }

  const originalSendMessage = iface.sendMessage.bind(iface)
  iface.sendMessage = async (input, attachments) => {
    const skill = state.selectedSkill
    const marker = state.selectedMarker
    const shouldWrap = Boolean(skill && marker && input.includes(marker))
    const nextInput =
      skill && shouldWrap
        ? quickSkillUserMessage(skill, stripSelectedMarker(input, marker))
        : input
    const beforeCount = readMessageCount(iface)
    await originalSendMessage(nextInput, attachments)
    refreshMessageEditorAutosize(chatPanel)
    if (shouldWrap && readMessageCount(iface) > beforeCount) {
      state.selectedSkill = null
      state.selectedMarker = ''
      hideMenu(state)
    }
  }
  iface.__deepSeekWriteQuickSkillSendWrapper = true
}

export function configureQuickSkillInput(
  chatPanel: ChatPanel | null,
  config: QuickSkillInputConfig,
) {
  if (!chatPanel) return
  installMessageEditorAutosize(chatPanel)

  const state = stateByChatPanel.get(chatPanel) ?? {
    ...config,
    selectedSkill: null,
    selectedMarker: '',
    highlightedIndex: 0,
    menuEl: null,
    editor: null,
    textarea: null,
    disposeEditorListeners: null,
    disposeDocumentListeners: null,
  }
  state.getSkills = config.getSkills
  state.isEnabled = config.isEnabled
  stateByChatPanel.set(chatPanel, state)

  installSendWrapper(chatPanel, state)
  installDocumentListeners(state)

  if (installEditorListeners(chatPanel, state)) return
  requestAnimationFrame(() => {
    if (installEditorListeners(chatPanel, state)) return
    requestAnimationFrame(() => installEditorListeners(chatPanel, state))
  })
}

export function disposeQuickSkillInput(chatPanel: ChatPanel | null) {
  if (!chatPanel) return
  disposeMessageEditorAutosize(chatPanel)
  const state = stateByChatPanel.get(chatPanel)
  if (!state) return
  hideMenu(state)
  state.disposeEditorListeners?.()
  state.disposeDocumentListeners?.()
  stateByChatPanel.delete(chatPanel)
}
