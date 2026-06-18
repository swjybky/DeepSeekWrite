import type { Book, Material, Skill } from '../../domain/workspace'
import { bookTypeLabel, isWorkspaceBook } from '../../domain/workspace'
import {
  autoSaveStatusLabel,
  type AutoSaveStatus,
} from '../../hooks/useKeyedAutoSave'

type Props = {
  book: Book
  coverData: string | null
  coverGenerating: boolean
  linkedMaterial: Material | null
  linkedSkill: Skill | null
  saving: boolean
  error: string | null
  message: string | null
  autoSaveStatus: AutoSaveStatus
  onBack: () => void
  onViewCover: () => void
  onGenerateCover: () => void
  onCoverError: () => void
  onOpenMaterialSelector: () => void
  onOpenSkillSelector: () => void
  onToggleStatus: () => void
}

export function WorkspaceBookHeader({
  book,
  coverData,
  coverGenerating,
  linkedMaterial,
  linkedSkill,
  saving,
  error,
  message,
  autoSaveStatus,
  onBack,
  onViewCover,
  onGenerateCover,
  onCoverError,
  onOpenMaterialSelector,
  onOpenSkillSelector,
  onToggleStatus,
}: Props) {
  return (
    <header className="editor-header editor-header--agent">
      <button type="button" className="back-link" onClick={onBack}>
        ← 返回
      </button>
      <div className="editor-header-meta muted">
        <span className="editor-header-meta-inner">
          <span className="editor-header-meta-text">
            {book.title || '未命名'}
            {' · '}
            {bookTypeLabel(book.book_type)}
            {isWorkspaceBook(book) && (book.categories?.length ?? 0) > 0
              ? ` · ${(book.categories ?? []).join('、')}`
              : ''}
            {book.status === 'completed' ? ' · 已完成' : ''}
          </span>
          {error || message ? (
            <span
              className={
                error
                  ? 'editor-header-flash editor-header-flash--error'
                  : 'editor-header-flash editor-header-flash--ok'
              }
              aria-live="polite"
            >
              {error ?? message}
            </span>
          ) : null}
        </span>
      </div>
      <div className="editor-header-actions">
        {coverData ? (
          <button
            type="button"
            className="btn-cover-view"
            title="查看封面"
            onClick={onViewCover}
          >
            <img
              src={`data:image/png;base64,${coverData}`}
              alt="封面"
              className="btn-cover-thumb"
              onError={onCoverError}
            />
          </button>
        ) : null}
        <button
          type="button"
          className="btn-cover-generate"
          onClick={onGenerateCover}
          disabled={coverGenerating}
        >
          {coverGenerating ? '生成中…' : '生成封面'}
        </button>
        <span
          className="editor-header-material-name"
          title={linkedMaterial ? `已关联：${linkedMaterial.title}` : '未关联素材库'}
        >
          {linkedMaterial ? linkedMaterial.title : '未关联素材'}
        </span>
        <button
          type="button"
          className={
            linkedMaterial
              ? 'editor-header-material-select editor-header-material-select--active'
              : 'editor-header-material-select'
          }
          aria-label="选择关联素材库"
          title={linkedMaterial ? `已关联：${linkedMaterial.title}` : '选择关联素材库'}
          onClick={onOpenMaterialSelector}
        >
          素材库选择
        </button>
        <span
          className="editor-header-material-name"
          title={linkedSkill ? `已绑定：${linkedSkill.title}` : '未绑定技能库'}
        >
          {linkedSkill ? linkedSkill.title : '未绑定技能'}
        </span>
        <button
          type="button"
          className={
            linkedSkill
              ? 'editor-header-material-select editor-header-material-select--active'
              : 'editor-header-material-select'
          }
          aria-label="选择绑定技能库"
          title={linkedSkill ? `已绑定：${linkedSkill.title}` : '选择绑定技能库'}
          onClick={onOpenSkillSelector}
        >
          技能库选择
        </button>
        <span
          className={`workspace-settings-save-state workspace-settings-save-state--${autoSaveStatus}`}
          aria-live="polite"
        >
          {autoSaveStatusLabel(autoSaveStatus)}
        </span>
        <button
          type="button"
          className={
            book.status === 'completed'
              ? 'btn-book-status btn-book-status--completed'
              : 'btn-book-status'
          }
          onClick={onToggleStatus}
          disabled={saving}
        >
          {book.status === 'completed' ? '修改' : '完本'}
        </button>
      </div>
    </header>
  )
}
