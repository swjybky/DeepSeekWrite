import {
  loadAttachment,
  type Attachment,
} from '@earendil-works/pi-web-ui'

export const WORD_ATTACHMENT_EXTENSIONS = ['.docx']
export const LEGACY_WORD_ATTACHMENT_EXTENSIONS = ['.doc']
export const WORD_ATTACHMENT_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]
export const LEGACY_WORD_ATTACHMENT_MIME_TYPES = ['application/msword']
export const EXCEL_ATTACHMENT_EXTENSIONS = ['.xlsx', '.xls']
export const EXCEL_ATTACHMENT_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]
export const TEXT_ATTACHMENT_EXTENSIONS = ['.txt', '.md']
export const TEXT_ATTACHMENT_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'text/x-markdown',
]
export const WORKSPACE_ATTACHMENT_ACCEPTED_TYPES = [
  'image/*',
  ...WORD_ATTACHMENT_EXTENSIONS,
  ...LEGACY_WORD_ATTACHMENT_EXTENSIONS,
  ...WORD_ATTACHMENT_MIME_TYPES,
  ...LEGACY_WORD_ATTACHMENT_MIME_TYPES,
  ...EXCEL_ATTACHMENT_EXTENSIONS,
  ...EXCEL_ATTACHMENT_MIME_TYPES,
  ...TEXT_ATTACHMENT_EXTENSIONS,
  ...TEXT_ATTACHMENT_MIME_TYPES,
].join(',')
export const WORKSPACE_ATTACHMENT_SUPPORTED_LABEL =
  'Word（.doc/.docx）、Excel（.xlsx/.xls）、TXT、Markdown、图片'

export const LEARNING_DOCUMENT_ACCEPTED_TYPES = [
  ...WORD_ATTACHMENT_EXTENSIONS,
  ...LEGACY_WORD_ATTACHMENT_EXTENSIONS,
  ...WORD_ATTACHMENT_MIME_TYPES,
  ...LEGACY_WORD_ATTACHMENT_MIME_TYPES,
  ...TEXT_ATTACHMENT_EXTENSIONS,
  ...TEXT_ATTACHMENT_MIME_TYPES,
].join(',')
export const LEARNING_DOCUMENT_SUPPORTED_LABEL =
  'TXT、Markdown、Word（.doc/.docx）'

function hasAttachmentExtension(fileName: string, extensions: string[]): boolean {
  return extensions.some((ext) => fileName.endsWith(ext))
}

function isLegacyWordAttachmentName(fileName: string): boolean {
  return hasAttachmentExtension(fileName.toLowerCase(), LEGACY_WORD_ATTACHMENT_EXTENSIONS)
}

function isLegacyWordFile(file: File): boolean {
  return (
    isLegacyWordAttachmentName(file.name) ||
    LEGACY_WORD_ATTACHMENT_MIME_TYPES.includes(file.type)
  )
}

function isTextDocumentFile(file: File): boolean {
  const fileName = file.name.toLowerCase()
  return (
    hasAttachmentExtension(fileName, TEXT_ATTACHMENT_EXTENSIONS) ||
    TEXT_ATTACHMENT_MIME_TYPES.includes(file.type)
  )
}

function isWordDocumentFile(file: File): boolean {
  const fileName = file.name.toLowerCase()
  return (
    isLegacyWordFile(file) ||
    hasAttachmentExtension(fileName, WORD_ATTACHMENT_EXTENSIONS) ||
    WORD_ATTACHMENT_MIME_TYPES.includes(file.type)
  )
}

function arrayBufferToBase64(arrayBuffer: ArrayBuffer): string {
  const bytes = new Uint8Array(arrayBuffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize))
  }
  return btoa(binary)
}

function isReadableDocCodePoint(code: number): boolean {
  return (
    code === 9 ||
    code === 10 ||
    code === 13 ||
    (code >= 0x20 && code <= 0x7e) ||
    (code >= 0x3000 && code <= 0x303f) ||
    (code >= 0x3400 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef)
  )
}

function collectReadableRuns(text: string, minLength: number): string[] {
  const runs: string[] = []
  let current = ''
  for (const char of text) {
    if (isReadableDocCodePoint(char.codePointAt(0) ?? 0)) {
      current += char
    } else {
      if (current.trim().length >= minLength) runs.push(current)
      current = ''
    }
  }
  if (current.trim().length >= minLength) runs.push(current)
  return runs
}

function collectUtf16ReadableRuns(bytes: Uint8Array, offset: number): string[] {
  let text = ''
  for (let i = offset; i + 1 < bytes.length; i += 2) {
    text += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8))
  }
  return collectReadableRuns(text, 4)
}

function normalizeLegacyDocText(runs: string[]): string {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const run of runs) {
    const normalizedLines = run
      .split('\u0000')
      .join('')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length >= 2)

    for (const line of normalizedLines) {
      if (seen.has(line)) continue
      seen.add(line)
      lines.push(line)
    }
  }
  return lines.join('\n')
}

function extractLegacyWordText(arrayBuffer: ArrayBuffer): string {
  const bytes = new Uint8Array(arrayBuffer)
  const runs = [
    ...collectUtf16ReadableRuns(bytes, 0),
    ...collectUtf16ReadableRuns(bytes, 1),
  ]

  try {
    runs.push(...collectReadableRuns(new TextDecoder('gb18030').decode(bytes), 6))
  } catch {
    runs.push(...collectReadableRuns(new TextDecoder().decode(bytes), 6))
  }

  return normalizeLegacyDocText(runs)
}

async function loadLegacyWordAttachment(file: File): Promise<Attachment> {
  const arrayBuffer = await file.arrayBuffer()
  const extractedBody = extractLegacyWordText(arrayBuffer)
  if (!extractedBody.trim()) {
    throw new Error('无法从 .doc 文件中提取可读文字，请另存为 .docx 后再上传。')
  }
  return {
    id: `${file.name}_${Date.now()}_${Math.random()}`,
    type: 'document',
    fileName: file.name,
    mimeType: 'application/msword',
    size: file.size,
    content: arrayBufferToBase64(arrayBuffer),
    extractedText: `<doc filename="${file.name}">\n${extractedBody}\n</doc>`,
  }
}

export function loadWorkspaceAttachment(file: File): Promise<Attachment> {
  if (isLegacyWordFile(file)) {
    return loadLegacyWordAttachment(file)
  }
  return loadAttachment(file)
}

export function isWorkspaceSupportedAttachment(attachment: Attachment): boolean {
  const fileName = attachment.fileName.toLowerCase()
  if (attachment.type === 'image' || attachment.mimeType.startsWith('image/')) {
    return true
  }
  if (hasAttachmentExtension(fileName, WORD_ATTACHMENT_EXTENSIONS)) return true
  if (hasAttachmentExtension(fileName, LEGACY_WORD_ATTACHMENT_EXTENSIONS)) return true
  if (hasAttachmentExtension(fileName, EXCEL_ATTACHMENT_EXTENSIONS)) return true
  if (hasAttachmentExtension(fileName, TEXT_ATTACHMENT_EXTENSIONS)) return true
  return [
    ...WORD_ATTACHMENT_MIME_TYPES,
    ...LEGACY_WORD_ATTACHMENT_MIME_TYPES,
    ...EXCEL_ATTACHMENT_MIME_TYPES,
    ...TEXT_ATTACHMENT_MIME_TYPES,
  ].includes(attachment.mimeType)
}

export function isLearningDocumentFile(file: File): boolean {
  return isTextDocumentFile(file) || isWordDocumentFile(file)
}

function cleanExtractedAttachmentText(text: string): string {
  return text
    .replace(/^<doc\b[^>]*>\s*/i, '')
    .replace(/\s*<\/doc>\s*$/i, '')
    .replace(/^<document\b[^>]*>\s*/i, '')
    .replace(/\s*<\/document>\s*$/i, '')
    .replace(/\r\n/g, '\n')
    .trim()
}

export async function extractTextDocumentFile(file: File): Promise<string> {
  if (!isLearningDocumentFile(file)) {
    throw new Error(`当前仅支持 ${LEARNING_DOCUMENT_SUPPORTED_LABEL}`)
  }
  if (isTextDocumentFile(file)) {
    return (await file.text()).replace(/\r\n/g, '\n').trim()
  }
  const attachment = await loadWorkspaceAttachment(file)
  const text = cleanExtractedAttachmentText(attachment.extractedText ?? '')
  if (!text) {
    throw new Error(`无法从 ${file.name} 中提取可读正文`)
  }
  return text
}

export function fileExtensionOf(fileName: string): string {
  const match = /\.([^.]+)$/.exec(fileName)
  return match ? `.${match[1].toLowerCase()}` : ''
}
