import { useState } from 'react'
import type {
  Book,
  Material,
  MaterialKind,
  MaterialLibraryGroup,
  MaterialSummary,
  Skill,
  SkillKind,
  SkillLibraryGroup,
  SkillSummary,
} from '../../domain/workspace'
import {
  emptyLinkedMaterialIdsByKind,
  emptyLinkedSkillIdsByKind,
  MATERIAL_KIND_KEYS,
  MATERIAL_KIND_LABELS,
  MATERIAL_KIND_STAGE_IDS,
  MATERIAL_STAGE_LABELS,
  materialMatchesKind,
  materialLibraryGroupLinks,
  materialMetaLabel,
  normalizeLinkedMaterialIdsByKind,
  normalizeLinkedSkillIdsByKind,
  SKILL_KIND_KEYS,
  SKILL_KIND_LABELS,
  SKILL_KIND_STAGE_IDS,
  SKILL_STAGE_LABELS,
  skillMatchesKind,
  skillLibraryGroupLinks,
  skillTypeLabel,
} from '../../domain/workspace'

type MaterialSelectorDialogProps = {
  book: Book
  linkedMaterial: Material | null
  linkedMaterialsByKind: Partial<Record<MaterialKind, Material[]>>
  summaries: MaterialSummary[]
  groups: MaterialLibraryGroup[]
  loading: boolean
  saving: boolean
  onClose: () => void
  onChange: (linkedMaterialIdsByKind: Partial<Record<MaterialKind, string[]>>) => void
}

type SkillSelectorDialogProps = {
  book: Book
  linkedSkill: Skill | null
  linkedSkillsByKind: Partial<Record<SkillKind, Skill[]>>
  summaries: SkillSummary[]
  groups: SkillLibraryGroup[]
  loading: boolean
  saving: boolean
  onClose: () => void
  onChange: (linkedSkillIdsByKind: Partial<Record<SkillKind, string[]>>) => void
}

function compactOutputPath(path: string): string {
  return path.length > 42
    ? `${path.slice(0, 22)}…${path.slice(-16)}`
    : path
}

type LibraryBindingMode = 'single' | 'group'

function linkedIdsEqual<K extends string>(
  keys: readonly K[],
  left: Partial<Record<K, string[]>>,
  right: Partial<Record<K, string[]>>,
): boolean {
  return keys.every((key) => {
    const leftIds = [...(left[key] ?? [])].sort()
    const rightIds = [...(right[key] ?? [])].sort()
    return leftIds.length === rightIds.length &&
      leftIds.every((id, index) => id === rightIds[index])
  })
}

export function MaterialSelectorDialog({
  book,
  linkedMaterial,
  linkedMaterialsByKind,
  summaries,
  groups,
  loading,
  saving,
  onClose,
  onChange,
}: MaterialSelectorDialogProps) {
  const [bindingMode, setBindingMode] = useState<LibraryBindingMode>('single')
  const currentByKind = normalizeLinkedMaterialIdsByKind(
    book.linked_material_ids_by_kind,
    book.linked_material_id,
  )
  const linkedCount = MATERIAL_KIND_KEYS.reduce(
    (sum, kind) => sum + (linkedMaterialsByKind[kind]?.length ?? 0),
    0,
  )
  const groupOptions = groups
    .map((group) => ({
      group,
      links: materialLibraryGroupLinks(group, summaries, book.book_type),
    }))
    .filter(({ links }) => MATERIAL_KIND_KEYS.some((kind) => links[kind].length > 0))

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
          <div className="workspace-library-selector-heading">
            <h2 id="wc-material-selector-title" className="workspace-material-selector-title">
              选择关联素材库
            </h2>
            <div className="workspace-library-binding-modes" role="radiogroup" aria-label="素材库绑定方式">
              <label>
                <input
                  type="radio"
                  name="workspaceMaterialBindingMode"
                  checked={bindingMode === 'single'}
                  onChange={() => setBindingMode('single')}
                />
                单个
              </label>
              <label>
                <input
                  type="radio"
                  name="workspaceMaterialBindingMode"
                  checked={bindingMode === 'group'}
                  onChange={() => setBindingMode('group')}
                />
                分组
              </label>
            </div>
          </div>
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
          {bindingMode === 'single'
            ? '可按部门多选素材库；旧综合素材库可出现在所有部门。'
            : '选择一个素材分组，将一次关联该分组内适用于当前书籍类型的全部素材库。'}
        </div>
        <div className="workspace-material-list">
          {loading ? (
            <p className="muted workspace-material-empty">加载中…</p>
          ) : bindingMode === 'group' ? (
            groupOptions.length === 0 ? (
              <p className="muted workspace-material-empty">暂无适用于当前书籍类型的素材分组</p>
            ) : (
              groupOptions.map(({ group, links }) => {
                const selected = linkedIdsEqual(MATERIAL_KIND_KEYS, currentByKind, links)
                const memberNames = MATERIAL_KIND_KEYS.flatMap((kind) => links[kind])
                  .map((id) => summaries.find((item) => item.id === id)?.title)
                  .filter((title): title is string => Boolean(title))
                return (
                  <button
                    key={group.id}
                    type="button"
                    className={
                      selected
                        ? 'workspace-material-item workspace-material-item--selected'
                        : 'workspace-material-item'
                    }
                    disabled={saving}
                    onClick={() => onChange(links)}
                  >
                    <span className="workspace-material-item-main">
                      <span className="workspace-material-item-title">{group.title}</span>
                      <span className="workspace-material-item-meta">
                        {memberNames.join('、') || '暂无可用成员'}
                      </span>
                    </span>
                    <span className="workspace-material-item-state">
                      {selected ? '已关联' : '关联分组'}
                    </span>
                  </button>
                )
              })
            )
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
                      const genre = materialMetaLabel(material)
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
  linkedSkillsByKind,
  summaries,
  groups,
  loading,
  saving,
  onClose,
  onChange,
}: SkillSelectorDialogProps) {
  const [bindingMode, setBindingMode] = useState<LibraryBindingMode>('single')
  const currentByKind = normalizeLinkedSkillIdsByKind(
    book.linked_skill_ids_by_kind,
    book.linked_skill_id,
  )
  const linkedCount = SKILL_KIND_KEYS.reduce(
    (sum, kind) => sum + (linkedSkillsByKind[kind]?.length ?? 0),
    0,
  )
  const groupOptions = groups
    .map((group) => ({
      group,
      links: skillLibraryGroupLinks(group, summaries, book.book_type),
    }))
    .filter(({ links }) => SKILL_KIND_KEYS.some((kind) => links[kind].length > 0))

  const toggleSkill = (kind: SkillKind, skillId: string) => {
    const next = normalizeLinkedSkillIdsByKind(currentByKind, null)
    const ids = new Set(next[kind] ?? [])
    if (ids.has(skillId)) {
      ids.delete(skillId)
    } else {
      ids.add(skillId)
    }
    next[kind] = [...ids]
    onChange(next)
  }

  return (
    <div
      className="workspace-material-selector-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wc-skill-selector-title"
    >
      <div className="workspace-material-selector-panel">
        <div className="workspace-material-selector-head">
          <div className="workspace-library-selector-heading">
            <h2 id="wc-skill-selector-title" className="workspace-material-selector-title">
              选择绑定技能库
            </h2>
            <div className="workspace-library-binding-modes" role="radiogroup" aria-label="技能库绑定方式">
              <label>
                <input
                  type="radio"
                  name="workspaceSkillBindingMode"
                  checked={bindingMode === 'single'}
                  onChange={() => setBindingMode('single')}
                />
                单个
              </label>
              <label>
                <input
                  type="radio"
                  name="workspaceSkillBindingMode"
                  checked={bindingMode === 'group'}
                  onChange={() => setBindingMode('group')}
                />
                分组
              </label>
            </div>
          </div>
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
          <strong>{linkedCount > 0 ? `${linkedCount} 个技能库` : '未绑定'}</strong>
          {linkedSkill?.output_dir && linkedCount <= 1 ? (
            <span title={linkedSkill.output_dir}>
              {` · ${compactOutputPath(linkedSkill.output_dir)}`}
            </span>
          ) : null}
        </div>
        <div className="workspace-material-stage-note">
          {bindingMode === 'single'
            ? '可按分类多选技能库；AI 会按当前阶段展示可加载技能，并通过 load_skill 读取完整技能内容。'
            : '选择一个技能分组，将一次绑定该分组内适用于当前书籍类型的全部技能库。'}
        </div>
        <div className="workspace-material-list">
          {loading ? (
            <p className="muted workspace-material-empty">加载中…</p>
          ) : bindingMode === 'group' ? (
            groupOptions.length === 0 ? (
              <p className="muted workspace-material-empty">暂无适用于当前书籍类型的技能分组</p>
            ) : (
              groupOptions.map(({ group, links }) => {
                const selected = linkedIdsEqual(SKILL_KIND_KEYS, currentByKind, links)
                const memberNames = SKILL_KIND_KEYS.flatMap((kind) => links[kind])
                  .map((id) => summaries.find((item) => item.id === id)?.title)
                  .filter((title): title is string => Boolean(title))
                return (
                  <button
                    key={group.id}
                    type="button"
                    className={
                      selected
                        ? 'workspace-material-item workspace-material-item--selected'
                        : 'workspace-material-item'
                    }
                    disabled={saving}
                    onClick={() => onChange(links)}
                  >
                    <span className="workspace-material-item-main">
                      <span className="workspace-material-item-title">{group.title}</span>
                      <span className="workspace-material-item-meta">
                        {memberNames.join('、') || '暂无可用成员'}
                      </span>
                    </span>
                    <span className="workspace-material-item-state">
                      {selected ? '已绑定' : '绑定分组'}
                    </span>
                  </button>
                )
              })
            )
          ) : summaries.length === 0 ? (
            <p className="muted workspace-material-empty">暂无技能库</p>
          ) : (
            SKILL_KIND_KEYS.map((kind) => {
              const candidates = summaries.filter(
                (skill) =>
                  (skill.is_builtin || skill.skill_type === book.book_type) &&
                  skillMatchesKind(skill, kind),
              )
              return (
                <section key={kind} className="workspace-material-kind-group">
                  <div className="workspace-material-kind-head">
                    <strong>{SKILL_KIND_LABELS[kind]}</strong>
                    <span>
                      {SKILL_KIND_STAGE_IDS[kind]
                        .map((stageId) => SKILL_STAGE_LABELS[stageId])
                        .join('、')}
                    </span>
                  </div>
                  {candidates.length === 0 ? (
                    <p className="muted workspace-material-empty">
                      暂无可绑定技能库
                    </p>
                  ) : (
                    candidates.map((skill) => {
                      const selected = (currentByKind[kind] ?? []).includes(skill.id)
                      const count = skill.stage_skill_count ?? 0
                      return (
                        <button
                          key={`${kind}-${skill.id}`}
                          type="button"
                          className={
                            selected
                              ? 'workspace-material-item workspace-material-item--selected'
                              : 'workspace-material-item'
                          }
                          disabled={saving}
                          onClick={() => toggleSkill(kind, skill.id)}
                        >
                          <span className="workspace-material-item-main">
                            <span className="workspace-material-item-title">{skill.title}</span>
                            <span className="workspace-material-item-meta">
                              {skillTypeLabel(skill.skill_type)} · {SKILL_KIND_LABELS[skill.skill_kind]} · {count > 0 ? `${count} 条阶段技能` : '暂无阶段技能'}
                            </span>
                          </span>
                          <span className="workspace-material-item-state">
                            {selected ? '已绑定' : '绑定'}
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
            onClick={() => onChange(emptyLinkedSkillIdsByKind())}
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
