import { useEffect, useMemo, useState } from 'react'
import {
  getMaterialParentGenres,
  materialTypeLabel,
  resolveMaterialParentGenre,
  type MaterialType,
} from '../bridge'
import './MaterialGenreSelector.css'

export interface MaterialGenreValue {
  materialType: MaterialType
  parentGenre: string
  /** legacy: 旧数据保留字段，新界面不再展示或写入子分类。 */
  subGenre: string
}

interface MaterialGenreSelectorProps {
  value: MaterialGenreValue
  onChange: (value: MaterialGenreValue) => void
  disabled?: boolean
}

const MATERIAL_TYPES: MaterialType[] = ['short', 'long', 'script']

export function MaterialGenreSelector({
  value,
  onChange,
  disabled,
}: MaterialGenreSelectorProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const parentGenres = useMemo(
    () => getMaterialParentGenres(value.materialType),
    [value.materialType],
  )

  useEffect(() => {
    if (value.materialType === 'long') {
      if (value.parentGenre || value.subGenre) {
        onChange({ ...value, parentGenre: '', subGenre: '' })
      }
      return
    }

    const resolved = resolveMaterialParentGenre(value.parentGenre)
    const nextParent = parentGenres.includes(resolved)
      ? resolved
      : parentGenres[0] || ''
    if (nextParent !== value.parentGenre || value.subGenre) {
      onChange({ ...value, parentGenre: nextParent, subGenre: '' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentGenres, value.materialType, value.parentGenre, value.subGenre])

  const displayText = useMemo(() => {
    const typeText = materialTypeLabel(value.materialType)
    if (value.materialType === 'long') return typeText
    const parent = resolveMaterialParentGenre(value.parentGenre)
    return parent ? `${typeText} · ${parent}` : typeText
  }, [value])

  const handleTypeChange = (type: MaterialType) => {
    const nextParents = getMaterialParentGenres(type)
    onChange({
      materialType: type,
      parentGenre: nextParents[0] || '',
      subGenre: '',
    })
    if (type === 'long') setIsExpanded(false)
  }

  const handleParentGenreChange = (genre: string) => {
    onChange({
      ...value,
      parentGenre: genre,
      subGenre: '',
    })
  }

  return (
    <div className={`material-genre-selector ${isExpanded ? 'expanded' : ''}`}>
      <button
        type="button"
        className="genre-selector-trigger"
        onClick={() => setIsExpanded(!isExpanded)}
        disabled={disabled}
      >
        <span className="genre-display">{displayText}</span>
        <span className={`genre-arrow ${isExpanded ? 'up' : 'down'}`}>▼</span>
      </button>

      {isExpanded && (
        <div className="genre-selector-panel">
          <div className="genre-type-section">
            <label className="genre-section-label">素材类型</label>
            <div className="genre-type-options">
              {MATERIAL_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`genre-type-btn ${value.materialType === type ? 'active' : ''}`}
                  onClick={() => handleTypeChange(type)}
                >
                  {materialTypeLabel(type)}
                </button>
              ))}
            </div>
          </div>

          {parentGenres.length > 0 && (
            <div className="genre-parent-section">
              <label className="genre-section-label">分类</label>
              <div className="genre-parent-options">
                {parentGenres.map((genre) => (
                  <button
                    key={genre}
                    type="button"
                    className={`genre-parent-btn ${value.parentGenre === genre ? 'active' : ''}`}
                    onClick={() => handleParentGenreChange(genre)}
                  >
                    {genre}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="genre-selector-actions">
            <button
              type="button"
              className="genre-selector-close"
              onClick={() => setIsExpanded(false)}
            >
              确定
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export interface MaterialFilterValue {
  materialType: MaterialType | 'all'
  parentGenre: string | 'all'
  /** legacy: 旧筛选值兼容，不再展示子分类筛选。 */
  subGenre: string | 'all'
}

interface MaterialFilterProps {
  value: MaterialFilterValue
  onChange: (value: MaterialFilterValue) => void
}

function filterParentGenres(type: MaterialType | 'all'): string[] {
  if (type === 'long') return []
  if (type === 'short' || type === 'script') return getMaterialParentGenres(type)
  return [...new Set([
    ...getMaterialParentGenres('short'),
    ...getMaterialParentGenres('script'),
  ])]
}

export function MaterialFilter({ value, onChange }: MaterialFilterProps) {
  const parentGenres = useMemo(
    () => filterParentGenres(value.materialType),
    [value.materialType],
  )

  return (
    <div className="material-filter">
      <div className="filter-group">
        <select
          value={value.materialType}
          onChange={(event) =>
            onChange({
              materialType: event.target.value as MaterialType | 'all',
              parentGenre: 'all',
              subGenre: 'all',
            })
          }
          className="filter-select"
        >
          <option value="all">全部类型</option>
          {MATERIAL_TYPES.map((type) => (
            <option key={type} value={type}>
              {materialTypeLabel(type)}
            </option>
          ))}
        </select>
      </div>

      {parentGenres.length > 0 && (
        <div className="filter-group">
          <select
            value={value.parentGenre}
            onChange={(event) =>
              onChange({
                ...value,
                parentGenre: event.target.value,
                subGenre: 'all',
              })
            }
            className="filter-select"
          >
            <option value="all">全部分类</option>
            {parentGenres.map((genre) => (
              <option key={genre} value={genre}>
                {genre}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}
