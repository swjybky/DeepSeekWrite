import type {
  Book,
  Material,
  MaterialKind,
  MaterialSummary,
  Skill,
  SkillSummary,
} from '../../domain/workspace'
import {
  emptyLinkedMaterialIdsByKind,
  MATERIAL_KIND_KEYS,
  MATERIAL_KIND_LABELS,
  MATERIAL_KIND_STAGE_IDS,
  MATERIAL_STAGE_LABELS,
  materialMatchesKind,
  materialTypeLabel,
  normalizeLinkedMaterialIdsByKind,
  skillTypeLabel,
} from '../../domain/workspace'

type MaterialSelectorDialogProps = {
  book: Book
  linkedMaterial: Material | null
  linkedMaterialsByKind: Partial<Record<MaterialKind, Material[]>>
  summaries: MaterialSummary[]
  loading: boolean
  saving: boolean
  onClose: () => void
  onChange: (linkedMaterialIdsByKind: Partial<Record<MaterialKind, string[]>>) => void
}

type SkillSelectorDialogProps = {
  book: Book
  linkedSkill: Skill | null
  summaries: SkillSummary[]
  loading: boolean
  saving: boolean
  onClose: () => void
  onSelect: (skillId: string) => void
  onClear: () => void
}

function compactOutputPath(path: string): string {
  return path.length > 42
    ? `${path.slice(0, 22)}…${path.slice(-16)}`
    : path
}

export function MaterialSelectorDialog({
  book,
  linkedMaterial,
  linkedMaterialsByKind,
  summaries,
  loading,
  saving,
  onClose,
  onChange,
}: MaterialSelectorDialogProps) {
  const currentByKind = normalizeLinkedMaterialIdsByKind(
    book.linked_material_ids_by_kind,
    book.linked_material_id,
  )
  const linkedCount = MATERIAL_KIND_KEYS.reduce(
    (sum, kind) => sum + (linkedMaterialsByKind[kind]?.length ?? 0),
    0,
  )

  const toggleMaterial = (kind: MaterialKind, materialId: string) => {
    const next = normalizeLinkedMaterialIdsByKind(currentByKind, null)
    const ids = new Set(next[kind] ?? [])
    if (ids.has(materialId)) {
      ids.delete(materialId)
    } else {
      ids.add(materialId)
    }
    next[kind] = [...ids]
    onChange(next)
  }

  return (
    <div
      className="workspace-material-selector-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wc-material-selector-title"
    >
      <div className="workspace-material-selector-panel">
        <div className="workspace-material-selector-head">
          <h2 id="wc-material-selector-title" className="workspace-material-selector-title">
            选择关联素材库
          </h2>
          <button
            type="button"
            className="workspace-material-selector-close"
            aria-label="关闭"
            disabled={saving}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="workspace-material-current">
          当前关联：
          <strong>{linkedCount > 0 ? `${linkedCount} 个素材库` : '未关联'}</strong>
          {linkedMaterial?.output_dir ? (
            <span title={linkedMaterial.output_dir}>
              {` · ${compactOutputPath(linkedMaterial.output_dir)}`}
            </span>
          ) : null}
        </div>
        <div className="workspace-material-stage-note">
          可按部门多选素材库；旧综合素材库可出现在所有部门。
        </div>
        <div className="workspace-material-list">
          {loading ? (
            <p className="muted workspace-material-empty">加载中…</p>
          ) : summaries.length === 0 ? (
            <p className="muted workspace-material-empty">暂无素材库</p>
          ) : (
            MATERIAL_KIND_KEYS.map((kind) => {
              const candidates = summaries.filter(
                (material) =>
                  material.material_type === book.book_type &&
                  materialMatchesKind(material, kind),
              )
              return (
                <section key={kind} className="workspace-material-kind-group">
                  <div className="workspace-material-kind-head">
                    <strong>{MATERIAL_KIND_LABELS[kind]}</strong>
                    <span>
                      {MATERIAL_KIND_STAGE_IDS[kind]
                        .map((stageId) => MATERIAL_STAGE_LABELS[stageId])
                        .join('、')}
                    </span>
                  </div>
                  {candidates.length === 0 ? (
                    <p className="muted workspace-material-empty">
                      暂无可关联素材库
                    </p>
                  ) : (
                    candidates.map((material) => {
                      const selected = (currentByKind[kind] ?? []).includes(material.id)
                      const genre = [
                        materialTypeLabel(material.material_type),
                        MATERIAL_KIND_LABELS[material.material_kind],
                        material.parent_genre,
                      ].filter(Boolean).join(' · ')
                      return (
                        <button
                          key={`${kind}-${material.id}`}
                          type="button"
                          className={
                            selected
                              ? 'workspace-material-item workspace-material-item--selected'
                              : 'workspace-material-item'
                          }
                          disabled={saving}
                          onClick={() => toggleMaterial(kind, material.id)}
                        >
                          <span className="workspace-material-item-main">
                            <span className="workspace-material-item-title">{material.title}</span>
                            <span className="workspace-material-item-meta">{genre || '素材'}</span>
                          </span>
                          <span className="workspace-material-item-state">
                            {selected ? '已关联' : '关联'}
                          </span>
                        </button>
                      )
                    })
                  )}
                </section>
              )
            })
          )}
        </div>
        <div className="workspace-material-selector-foot">
          <button
            type="button"
            className="btn-material-clear"
            disabled={saving || linkedCount === 0}
            onClick={() => onChange(emptyLinkedMaterialIdsByKind())}
          >
            取消关联
          </button>
          <button
            type="button"
            className="btn-material-close"
            disabled={saving}
            onClick={onClose}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}

export function SkillSelectorDialog({
  book,
  linkedSkill,
  summaries,
  loading,
  saving,
  onClose,
  onSelect,
  onClear,
}: SkillSelectorDialogProps) {
  return (
    <div
      className="workspace-material-selector-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wc-skill-selector-title"
    >
      <div className="workspace-material-selector-panel">
        <div className="workspace-material-selector-head">
          <h2 id="wc-skill-selector-title" className="workspace-material-selector-title">
            选择绑定技能库
          </h2>
          <button
            type="button"
            className="workspace-material-selector-close"
            aria-label="关闭"
            disabled={saving}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="workspace-material-current">
          当前绑定：
          <strong>{linkedSkill ? linkedSkill.title : '未绑定'}</strong>
          {linkedSkill?.output_dir ? (
            <span title={linkedSkill.output_dir}>
              {` · ${compactOutputPath(linkedSkill.output_dir)}`}
            </span>
          ) : null}
        </div>
        <div className="workspace-material-stage-note">
          AI 会按当前阶段展示可加载技能，并通过 load_skill 读取完整技能内容。
        </div>
        <div className="workspace-material-list">
          {loading ? (
            <p className="muted workspace-material-empty">加载中…</p>
          ) : summaries.length === 0 ? (
            <p className="muted workspace-material-empty">暂无技能库</p>
          ) : (
            summaries.map((skill) => {
              const selected = skill.id === book.linked_skill_id
              const count = skill.stage_skill_count ?? 0
              return (
                <button
                  key={skill.id}
                  type="button"
                  className={
                    selected
                      ? 'workspace-material-item workspace-material-item--selected'
                      : 'workspace-material-item'
                  }
                  disabled={saving}
                  onClick={() => onSelect(skill.id)}
                >
                  <span className="workspace-material-item-main">
                    <span className="workspace-material-item-title">{skill.title}</span>
                    <span className="workspace-material-item-meta">
                      {skillTypeLabel(skill.skill_type)} · {count > 0 ? `${count} 条阶段技能` : '暂无阶段技能'}
                    </span>
                  </span>
                  <span className="workspace-material-item-state">
                    {selected ? '已绑定' : '绑定'}
                  </span>
                </button>
              )
            })
          )}
        </div>
        <div className="workspace-material-selector-foot">
          <button
            type="button"
            className="btn-material-clear"
            disabled={saving || !book.linked_skill_id}
            onClick={onClear}
          >
            取消绑定
          </button>
          <button
            type="button"
            className="btn-material-close"
            disabled={saving}
            onClick={onClose}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
