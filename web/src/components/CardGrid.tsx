import { Link } from 'react-router-dom'
import type { BookSummary, MaterialSummary, SkillSummary } from '../bridge'
import './CardGrid.css'

export interface CardItem {
  id: string
  title: string
  type: 'book' | 'material' | 'skill'
  subtype?: string
  genre?: string
  subGenre?: string
  meta?: string
  outputDir?: string
  coverData?: string
  to: string
}

interface CardGridProps {
  items: CardItem[]
  emptyText?: string
  onDelete?: (id: string) => void
  deletingId?: string | null
}

export function CardGrid({ items, emptyText = '暂无项目', onDelete, deletingId }: CardGridProps) {
  if (items.length === 0) {
    return <p className="card-grid-empty muted">{emptyText}</p>
  }

  return (
    <div className="card-grid">
      {items.map((item) => (
        <div
          key={item.id}
          className="card-item"
          data-type={item.type}
          data-subtype={item.subtype}
          data-genre={item.genre}
          data-has-cover={item.coverData ? 'true' : undefined}
        >
          <Link className="card-link" to={item.to}>
            {item.coverData ? (
              <img
                className="card-cover"
                src={`data:image/png;base64,${item.coverData}`}
                alt=""
                loading="lazy"
              />
            ) : null}
            <div className="card-content">
              <h3 className="card-title">{item.title || '未命名'}</h3>
              <div className="card-meta">
                {item.type === 'book' ? (
                  <span className="card-type">
                    {item.subtype === 'short' ? '短篇' : '长篇'}
                    {item.genre && ` · ${item.genre}`}
                  </span>
                ) : item.type === 'skill' ? (
                  <span className="card-type">
                    短篇技能
                    {item.genre && ` · ${item.genre}`}
                  </span>
                ) : (
                  <span className="card-type">
                    {item.subtype === 'short' ? '短篇素材' : '长篇素材'}
                    {item.genre && item.subGenre && ` · ${item.genre}`}
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
          {onDelete && (
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
      ))}
    </div>
  )
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
    genre: material.parent_genre,
    subGenre: material.sub_genre,
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
    subtype: 'short',
    genre: skill.genre,
    outputDir: skill.output_dir,
    to: `/skill/${skill.id}`,
  }
}
