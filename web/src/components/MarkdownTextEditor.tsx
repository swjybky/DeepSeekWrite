import { useState, type Ref, type TextareaHTMLAttributes } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTextDisplay } from '../textDisplay'
import './MarkdownTextEditor.css'

type MarkdownModeToggleProps = {
  editing: boolean
  onChange: (editing: boolean) => void
}

export function MarkdownModeToggle({ editing, onChange }: MarkdownModeToggleProps) {
  return (
    <span className="markdown-mode-toggle" aria-label="Markdown 模式切换">
      <span className="markdown-mode-toggle-label">
        {editing ? 'Markdown 源码' : 'Markdown 预览'}
      </span>
      <button type="button" onClick={() => onChange(!editing)}>
        {editing ? '预览' : '编辑'}
      </button>
    </span>
  )
}

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string
  onValueChange: (value: string) => void
  textareaRef?: Ref<HTMLTextAreaElement | null>
  showToolbar?: boolean
  editingMarkdown?: boolean
  onEditingMarkdownChange?: (editing: boolean) => void
}

export function MarkdownTextEditor({
  value,
  onValueChange,
  textareaRef,
  className = '',
  placeholder,
  showToolbar = true,
  editingMarkdown: controlledEditing,
  onEditingMarkdownChange,
  ...textareaProps
}: Props) {
  const { mode } = useTextDisplay()
  const [internalEditing, setInternalEditing] = useState(false)
  const isEditing = controlledEditing !== undefined ? controlledEditing : internalEditing
  const setIsEditing = (next: boolean) => {
    if (controlledEditing === undefined) {
      setInternalEditing(next)
    }
    onEditingMarkdownChange?.(next)
  }

  const textarea = (
    <textarea
      {...textareaProps}
      ref={textareaRef}
      className={className}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onValueChange(event.target.value)}
    />
  )

  if (mode === 'text') return textarea

  return (
    <div className={`markdown-text-editor${isEditing ? ' markdown-text-editor--editing' : ''}`}>
      {showToolbar ? (
        <div className="markdown-text-editor-toolbar">
          <MarkdownModeToggle editing={isEditing} onChange={setIsEditing} />
        </div>
      ) : null}
      {isEditing ? (
        textarea
      ) : (
        <div className={`${className} markdown-preview`} aria-label={textareaProps['aria-label']}>
          {value.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
          ) : (
            <p className="markdown-preview-empty">{placeholder || '暂无内容'}</p>
          )}
        </div>
      )}
    </div>
  )
}
