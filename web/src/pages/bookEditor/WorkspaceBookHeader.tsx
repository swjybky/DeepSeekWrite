import type { Book, Material, MaterialKind, Skill, SkillKind } from '../../domain/workspace'
import {
  bookTypeLabel,
  isWorkspaceBook,
  MATERIAL_KIND_KEYS,
  SKILL_KIND_KEYS,
} from '../../domain/workspace'
import {
  autoSaveStatusLabel,
  type AutoSaveStatus,
} from '../../hooks/useKeyedAutoSave'

type Props = {
  book: Book
  coverData: string | null
  coverGenerating: boolean
  linkedMaterial: Material | null
  linkedMaterialsByKind: Partial<Record<MaterialKind, Material[]>>
  linkedSkill: Skill | null
  linkedSkillsByKind: Partial<Record<SkillKind, Skill[]>>
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
  onOpenExpertWritingPrompt: () => void
  onOpenMemoryManager: () => void
  onToggleStatus: () => void
  memoryUnread?: boolean
}

function coverDataToSrc(coverData: string): string {
  return coverData.startsWith('data:')
    ? coverData
    : `data:image/png;base64,${coverData}`
}

export function WorkspaceBookHeader({
  book,
  coverData,
  coverGenerating,
  linkedMaterial,
  linkedMaterialsByKind,
  linkedSkill,
  linkedSkillsByKind,
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
  onOpenExpertWritingPrompt,
  onOpenMemoryManager,
  onToggleStatus,
  memoryUnread = false,
}: Props) {
  const linkedMaterialCount = MATERIAL_KIND_KEYS.reduce(
    (sum, kind) => sum + (linkedMaterialsByKind[kind]?.length ?? 0),
    0,
  )
  const linkedMaterialTitle =
    linkedMaterialCount > 0
      ? `已关联 ${linkedMaterialCount} 个素材库`
      : linkedMaterial
        ? linkedMaterial.title
        : '未关联素材库'
  const linkedSkillCount = SKILL_KIND_KEYS.reduce(
    (sum, kind) => sum + (linkedSkillsByKind[kind]?.length ?? 0),
    0,
  )
  const linkedSkillTitle =
    linkedSkillCount > 0
      ? `已绑定 ${linkedSkillCount} 个技能库`
      : linkedSkill
        ? linkedSkill.title
        : '未绑定技能库'
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
          <span
            className={`workspace-settings-save-state workspace-settings-save-state--${autoSaveStatus}`}
            aria-live="polite"
          >
            {autoSaveStatusLabel(autoSaveStatus)}
          </span>
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
              src={coverDataToSrc(coverData)}
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
          title={linkedMaterialTitle}
        >
          {linkedMaterialCount > 0 ? `素材 ${linkedMaterialCount}` : '未关联素材'}
        </span>
        <button
          type="button"
          className={
            linkedMaterialCount > 0
              ? 'editor-header-material-select editor-header-material-select--active'
              : 'editor-header-material-select'
          }
          aria-label="选择关联素材库"
          title={linkedMaterialTitle}
          onClick={onOpenMaterialSelector}
        >
          素材库选择
        </button>
        <span
          className="editor-header-material-name"
          title={linkedSkillTitle}
        >
          {linkedSkillCount > 0 ? `技能 ${linkedSkillCount}` : '未绑定技能'}
        </span>
        <button
          type="button"
          className={
            linkedSkillCount > 0 || linkedSkill
              ? 'editor-header-material-select editor-header-material-select--active'
              : 'editor-header-material-select'
          }
          aria-label="选择绑定技能库"
          title={linkedSkillTitle}
          onClick={onOpenSkillSelector}
        >
          技能库选择
        </button>
        <button
          type="button"
          className="btn-book-memory"
          onClick={onOpenExpertWritingPrompt}
        >
          自动写作提示词
        </button>
        <button
          type="button"
          className={
            memoryUnread
              ? 'btn-book-memory btn-book-memory--unread'
              : 'btn-book-memory'
          }
          onClick={onOpenMemoryManager}
        >
          记忆管理
        </button>
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
