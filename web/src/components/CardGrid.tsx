import { Link } from 'react-router-dom'
import {
  bookTypeLabel,
  countLibraryGroupMembers,
  MATERIAL_KIND_KEYS,
  MATERIAL_KIND_LABELS,
  SKILL_KIND_KEYS,
  SKILL_KIND_LABELS,
  type BookSummary,
  type MaterialLibraryGroup,
  type MaterialSummary,
  type SkillLibraryGroup,
  type SkillSummary,
} from '../bridge'
import defaultMaterialCover from '../assets/default-material-cover.png'
import defaultMaterialCoverModern from '../assets/default-material-cover-modern.png'
import defaultSkillCover from '../assets/default-skill-cover.png'
import defaultSkillCoverModern from '../assets/default-skill-cover-modern.png'
import './CardGrid.css'

export interface CardItem {
  id: string
  title: string
  type: 'book' | 'material' | 'skill' | 'material_group' | 'skill_group'
  subtype?: string
  genre?: string
  subGenre?: string
  meta?: string
  outputDir?: string
  coverData?: string
  isBuiltin?: boolean
  to: string
}

interface CardGridProps {
  items: CardItem[]
  emptyText?: string
  onDelete?: (id: string) => void
  deletingId?: string | null
}

type CardCoverSource = {
  src: string
  appearance?: 'classic' | 'modern'
}

type CardCover = {
  sources: CardCoverSource[]
  isDefault: boolean
}

export function CardGrid({ items, emptyText = '暂无项目', onDelete, deletingId }: CardGridProps) {
  if (items.length === 0) {
    return <p className="card-grid-empty muted">{emptyText}</p>
  }

  return (
    <div className="card-grid">
      {items.map((item) => {
        const cover = getCardCover(item)
        const hasCover = cover.sources.length > 0

        return (
          <div
            key={item.id}
            className="card-item"
            data-type={item.type}
            data-subtype={item.subtype}
            data-genre={item.genre}
            data-has-cover={hasCover ? 'true' : undefined}
            data-default-cover={cover.isDefault ? 'true' : undefined}
          >
            <Link className="card-link" to={item.to}>
              {cover.sources.map((source) => (
                <img
                  key={source.appearance ?? 'custom'}
                  className={[
                    'card-cover',
                    source.appearance ? `card-cover--${source.appearance}` : '',
                  ].filter(Boolean).join(' ')}
                  src={source.src}
                  alt=""
                  loading="lazy"
                />
              ))}
              <div className="card-content">
                <h3 className="card-title">{item.title || '未命名'}</h3>
                <div className="card-meta">
                  {item.type === 'book' ? (
                    <span className="card-type" title={[
                      item.meta,
                      item.genre,
                    ].filter(Boolean).join(' · ')}>
                      {item.meta}
                      {item.genre && ` · ${item.genre}`}
                    </span>
                  ) : item.type === 'skill' ? (
                    <span className="card-type" title={item.meta || '技能库'}>
                      {item.meta || '技能库'}
                    </span>
                  ) : item.type === 'skill_group' ? (
                    <span className="card-type" title={[
                      '技能分组',
                      item.meta,
                    ].filter(Boolean).join(' · ')}>
                      技能分组
                      {item.meta && ` · ${item.meta}`}
                    </span>
                  ) : item.type === 'material_group' ? (
                    <span className="card-type" title={[
                      '素材分组',
                      item.meta,
                    ].filter(Boolean).join(' · ')}>
                      素材分组
                      {item.meta && ` · ${item.meta}`}
                    </span>
                  ) : (
                    <span className="card-type" title={item.meta || undefined}>
                      {item.meta}
                    </span>
                  )}
                </div>
              </div>
            </Link>
            {item.outputDir && (
              <span className="card-path muted" title={item.outputDir}>
                {truncatePath(item.outputDir, 24)}
              </span>
            )}
            {onDelete && !item.isBuiltin && (
              <button
                type="button"
                className="card-delete-btn"
                aria-label={`删除 ${item.title}`}
                disabled={deletingId === item.id}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onDelete(item.id)
                }}
              >
                {deletingId === item.id ? '删除中...' : '×'}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function getCardCover(item: CardItem): CardCover {
  if (item.coverData) {
    const src = item.coverData.startsWith('data:')
      ? item.coverData
      : `data:image/png;base64,${item.coverData}`
    return { sources: [{ src }], isDefault: false }
  }
  if (item.type === 'material' || item.type === 'material_group') {
    return {
      sources: [
        { src: defaultMaterialCover, appearance: 'classic' },
        { src: defaultMaterialCoverModern, appearance: 'modern' },
      ],
      isDefault: true,
    }
  }
  if (item.type === 'skill' || item.type === 'skill_group') {
    return {
      sources: [
        { src: defaultSkillCover, appearance: 'classic' },
        { src: defaultSkillCoverModern, appearance: 'modern' },
      ],
      isDefault: true,
    }
  }
  return { sources: [], isDefault: false }
}

function truncatePath(path: string, maxLen: number): string {
  if (!path || path.length <= maxLen) return path || ''
  const sep = path.includes('\\') ? '\\' : '/'
  const parts = path.split(sep)
  if (parts.length <= 2) return '...' + path.slice(-maxLen + 3)
  return parts[0] + sep + '...' + sep + parts.slice(-2).join(sep)
}

// 辅助函数：将 BookSummary 转换为 CardItem
// eslint-disable-next-line react-refresh/only-export-components
export function bookToCardItem(book: BookSummary, coverData?: string): CardItem {
  return {
    id: book.id,
    title: book.title,
    type: 'book',
    subtype: book.book_type,
    meta: bookTypeLabel(book.book_type),
    genre: book.categories?.[0],
    outputDir: book.output_dir,
    coverData,
    to: `/book/${book.id}`,
  }
}

// 辅助函数：将 MaterialSummary 转换为 CardItem
// eslint-disable-next-line react-refresh/only-export-components
export function materialToCardItem(material: MaterialSummary): CardItem {
  return {
    id: material.id,
    title: material.title,
    type: 'material',
    subtype: material.material_type,
    meta: MATERIAL_KIND_LABELS[material.material_kind],
    genre: material.parent_genre,
    outputDir: material.output_dir,
    to: `/material/${material.id}`,
  }
}

// 辅助函数：将 SkillSummary 转换为 CardItem
// eslint-disable-next-line react-refresh/only-export-components
export function skillToCardItem(skill: SkillSummary): CardItem {
  return {
    id: skill.id,
    title: skill.title,
    type: 'skill',
    subtype: skill.skill_type,
    // 技能库卡片封面标签只展示技能分类，避免与卡片类型“技能库”重复。
    meta: skill.is_builtin ? '官方内置 · 全类型' : SKILL_KIND_LABELS[skill.skill_kind],
    isBuiltin: skill.is_builtin,
    outputDir: skill.output_dir,
    to: `/skill/${skill.id}`,
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function materialGroupToCardItem(group: MaterialLibraryGroup): CardItem {
  const count = countLibraryGroupMembers(group.members)
  return {
    id: group.id,
    title: group.title,
    type: 'material_group',
    meta: `已选 ${count}/${MATERIAL_KIND_KEYS.length} 个部门`,
    to: `/material-group/${group.id}`,
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function skillGroupToCardItem(group: SkillLibraryGroup): CardItem {
  const count = countLibraryGroupMembers(group.members)
  return {
    id: group.id,
    title: group.title,
    type: 'skill_group',
    meta: `已选 ${count}/${SKILL_KIND_KEYS.length} 个分类`,
    to: `/skill-group/${group.id}`,
  }
}
