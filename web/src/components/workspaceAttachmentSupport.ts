import { ChatPanel, type Attachment } from '@earendil-works/pi-web-ui'

import type { AppDialogOptions } from './AppDialog'
import {
  isWorkspaceSupportedAttachment,
  loadWorkspaceAttachment,
  WORKSPACE_ATTACHMENT_ACCEPTED_TYPES,
  WORKSPACE_ATTACHMENT_SUPPORTED_LABEL,
} from '../utils/documentText'

const WORKSPACE_ATTACHMENT_MAX_FILES = 10
const WORKSPACE_ATTACHMENT_MAX_FILE_SIZE = 20 * 1024 * 1024
const WORKSPACE_SEND_VALIDATION_ERROR_NAME = 'DeepSeekWriteSendValidationError'

type ShowWorkspaceAlert = (
  options: Omit<AppDialogOptions, 'cancelText' | 'hideCancel'>,
) => Promise<boolean>

type MessageEditorElement = HTMLElement & {
  attachments?: Attachment[]
  acceptedTypes?: string
  maxFiles?: number
  maxFileSize?: number
  processingFiles?: boolean
  isDragging?: boolean
  onFilesChange?: (attachments: Attachment[]) => void
  handleFilesSelected?: (event: Event) => void | Promise<void>
  handleDrop?: (event: DragEvent) => void | Promise<void>
  __deepSeekWriteWorkspaceAttachmentLoader?: boolean
  requestUpdate?: () => void
}

type AgentInterfaceElement = HTMLElement & {
  enableAttachments?: boolean
  requestUpdate?: () => void
  sendMessage?: (input: string, attachments?: Attachment[]) => void | Promise<void>
  __deepSeekWriteSendValidationGuard?: boolean
}

type WorkspaceAttachmentModel = {
  id?: string
  input?: readonly string[]
} | null | undefined

class WorkspaceSendValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = WORKSPACE_SEND_VALIDATION_ERROR_NAME
  }
}

function isWorkspaceSendValidationError(error: unknown): error is Error {
  return (
    error instanceof Error && error.name === WORKSPACE_SEND_VALIDATION_ERROR_NAME
  )
}

async function addWorkspaceAttachmentFiles(
  editor: MessageEditorElement,
  files: File[],
  showAlert: ShowWorkspaceAlert,
) {
  if (files.length === 0) return

  const maxFiles = editor.maxFiles ?? WORKSPACE_ATTACHMENT_MAX_FILES
  const maxFileSize = editor.maxFileSize ?? WORKSPACE_ATTACHMENT_MAX_FILE_SIZE
  const currentAttachments = editor.attachments ?? []
  if (files.length + currentAttachments.length > maxFiles) {
    await showAlert({
      title: '文件数量超限',
      message: `最多可上传 ${maxFiles} 个文件。`,
    })
    return
  }

  editor.processingFiles = true
  editor.requestUpdate?.()
  const newAttachments: Attachment[] = []

  for (const file of files) {
    try {
      if (file.size > maxFileSize) {
        await showAlert({
          title: '文件过大',
          message: `${file.name} 超过 ${Math.round(maxFileSize / 1024 / 1024)}MB 限制。`,
        })
        continue
      }

      const attachment = await loadWorkspaceAttachment(file)
      if (!isWorkspaceSupportedAttachment(attachment)) {
        await showAlert({
          title: '不支持的附件格式',
          message: `当前仅支持上传${WORKSPACE_ATTACHMENT_SUPPORTED_LABEL}。`,
          details: `不支持：${file.name}`,
        })
        continue
      }
      newAttachments.push(attachment)
    } catch (error) {
      console.error(`Error processing ${file.name}:`, error)
      await showAlert({
        title: '处理附件失败',
        message: `处理 ${file.name} 失败。`,
        details: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (newAttachments.length > 0) {
    editor.attachments = [...(editor.attachments ?? []), ...newAttachments]
    editor.onFilesChange?.(editor.attachments)
  }
  editor.processingFiles = false
  editor.requestUpdate?.()
}

function installWorkspaceAttachmentLoader(
  editor: MessageEditorElement,
  showAlert: ShowWorkspaceAlert,
) {
  if (editor.__deepSeekWriteWorkspaceAttachmentLoader) return

  editor.handleFilesSelected = async (event: Event) => {
    event.stopImmediatePropagation()
    const input = event.target as HTMLInputElement
    await addWorkspaceAttachmentFiles(editor, Array.from(input.files ?? []), showAlert)
    input.value = ''
  }
  editor.handleDrop = async (event: DragEvent) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    editor.isDragging = false
    await addWorkspaceAttachmentFiles(
      editor,
      Array.from(event.dataTransfer?.files ?? []),
      showAlert,
    )
  }
  editor.__deepSeekWriteWorkspaceAttachmentLoader = true
  editor.requestUpdate?.()
}

export function getWorkspaceAgentInterface(
  chatPanel: ChatPanel | null,
): AgentInterfaceElement | null {
  if (!chatPanel) return null
  if (chatPanel.agentInterface) {
    return chatPanel.agentInterface as AgentInterfaceElement
  }
  return chatPanel.querySelector('agent-interface') as AgentInterfaceElement | null
}

function getWorkspaceMessageEditor(
  chatPanel: ChatPanel | null,
): MessageEditorElement | null {
  return getWorkspaceAgentInterface(chatPanel)?.querySelector(
    'message-editor',
  ) as MessageEditorElement | null
}

function applyWorkspaceAttachmentOptions(
  chatPanel: ChatPanel | null,
  showAlert: ShowWorkspaceAlert,
): boolean {
  const iface = getWorkspaceAgentInterface(chatPanel)
  const editor = getWorkspaceMessageEditor(chatPanel)
  if (!iface || !editor) return false
  iface.enableAttachments = true
  iface.requestUpdate?.()
  installWorkspaceAttachmentLoader(editor, showAlert)
  editor.acceptedTypes = WORKSPACE_ATTACHMENT_ACCEPTED_TYPES
  editor.maxFiles = WORKSPACE_ATTACHMENT_MAX_FILES
  editor.maxFileSize = WORKSPACE_ATTACHMENT_MAX_FILE_SIZE
  editor.requestUpdate?.()
  return true
}

export function configureWorkspaceAttachmentOptions(
  chatPanel: ChatPanel | null,
  showAlert: ShowWorkspaceAlert,
) {
  if (applyWorkspaceAttachmentOptions(chatPanel, showAlert)) return
  requestAnimationFrame(() => {
    if (applyWorkspaceAttachmentOptions(chatPanel, showAlert)) return
    requestAnimationFrame(() => applyWorkspaceAttachmentOptions(chatPanel, showAlert))
  })
}

export function getCurrentWorkspaceAttachments(
  chatPanel: ChatPanel | null,
): Attachment[] {
  return getWorkspaceMessageEditor(chatPanel)?.attachments ?? []
}

export function refreshWorkspaceChatInput(chatPanel: ChatPanel | null) {
  getWorkspaceMessageEditor(chatPanel)?.requestUpdate?.()
  getWorkspaceAgentInterface(chatPanel)?.requestUpdate?.()
  chatPanel?.requestUpdate?.()
}

export function installWorkspaceSendValidationGuard(chatPanel: ChatPanel) {
  const iface = getWorkspaceAgentInterface(chatPanel)
  if (
    !iface ||
    iface.__deepSeekWriteSendValidationGuard ||
    typeof iface.sendMessage !== 'function'
  ) {
    return
  }

  const originalSendMessage = iface.sendMessage.bind(iface)
  iface.sendMessage = async (input, attachments) => {
    try {
      await originalSendMessage(input, attachments)
    } catch (error) {
      if (isWorkspaceSendValidationError(error)) {
        console.warn('[DeepSeekWrite·AI面板] 发送已取消:', error.message)
        refreshWorkspaceChatInput(chatPanel)
        return
      }
      throw error
    }
  }
  iface.__deepSeekWriteSendValidationGuard = true
}

export async function validateWorkspaceAttachmentsBeforeSend(
  chatPanel: ChatPanel | null,
  model: WorkspaceAttachmentModel,
  showAlert: ShowWorkspaceAlert,
) {
  const attachments = getCurrentWorkspaceAttachments(chatPanel)
  const unsupported = attachments.filter(
    (attachment) => !isWorkspaceSupportedAttachment(attachment),
  )
  if (unsupported.length > 0) {
    await showAlert({
      title: '不支持的附件格式',
      message: `当前仅支持上传${WORKSPACE_ATTACHMENT_SUPPORTED_LABEL}。`,
      details: `不支持：${unsupported.map((a) => a.fileName).join('、')}`,
    })
    throw new WorkspaceSendValidationError(
      'Unsupported workspace attachment type',
    )
  }

  const hasImage = attachments.some(
    (attachment) =>
      attachment.type === 'image' ||
      attachment.mimeType.startsWith('image/'),
  )
  if (hasImage && !model?.input?.includes('image')) {
    const modelName = model?.id ?? '当前模型'
    await showAlert({
      title: '当前模型不支持图片',
      message: `${modelName} 不支持图片输入。`,
      details: '请先切换到支持视觉/图片输入的模型，再发送图片附件。',
    })
    throw new WorkspaceSendValidationError(
      'Current model does not support image attachments',
    )
  }
}
