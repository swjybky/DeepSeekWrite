import { useState, useEffect, useMemo } from 'react'
import { SHORT_MATERIAL_GENRES, type MaterialType } from '../bridge'
import './MaterialGenreSelector.css'

export interface MaterialGenreValue {
  materialType: MaterialType
  parentGenre: string  // 世情/情感
  subGenre: string     // 子分类
}

interface MaterialGenreSelectorProps {
  value: MaterialGenreValue
  onChange: (value: MaterialGenreValue) => void
  disabled?: boolean
}

export function MaterialGenreSelector({ value, onChange, disabled }: MaterialGenreSelectorProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  // 获取可用的大分类列表
  const parentGenres = useMemo(() => Object.keys(SHORT_MATERIAL_GENRES), [])

  // 获取当前大分类下的子分类
  const subGenres = useMemo(() => {
    if (!value.parentGenre) return []
    return SHORT_MATERIAL_GENRES[value.parentGenre] || []
  }, [value.parentGenre])

  // 当大分类改变时，如果当前子分类不在新列表中，重置子分类
  useEffect(() => {
    if (value.parentGenre && subGenres.length > 0 && !subGenres.includes(value.subGenre)) {
      onChange({ ...value, subGenre: subGenres[0] || '' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.parentGenre, subGenres, value.subGenre, onChange])

  // 获取显示文本
  const displayText = useMemo(() => {
    if (value.materialType === 'long') {
      return '长篇素材'
    }
    if (value.parentGenre && value.subGenre) {
      return `${value.parentGenre} · ${value.subGenre}`
    }
    if (value.parentGenre) {
      return value.parentGenre
    }
    return '短篇素材'
  }, [value])

  // 选择素材类型（长篇/短篇）
  const handleTypeChange = (type: MaterialType) => {
    onChange({
      materialType: type,
      parentGenre: type === 'short' ? parentGenres[0] || '' : '',
      subGenre: type === 'short' ? (SHORT_MATERIAL_GENRES[parentGenres[0]]?.[0] || '') : '',
    })
    if (type === 'long') {
      setIsExpanded(false)
    }
  }

  // 选择大分类
  const handleParentGenreChange = (genre: string) => {
    const newSubGenres = SHORT_MATERIAL_GENRES[genre] || []
    onChange({
      ...value,
      materialType: 'short',
      parentGenre: genre,
      subGenre: newSubGenres[0] || '',
    })
  }

  // 选择子分类
  const handleSubGenreChange = (subGenre: string) => {
    onChange({
      ...value,
      materialType: 'short',
      subGenre,
    })
  }

  return (
    <div className={`material-genre-selector ${isExpanded ? 'expanded' : ''}`}>
      {/* 主选择器按钮 */}
      <button
        type="button"
        className="genre-selector-trigger"
        onClick={() => setIsExpanded(!isExpanded)}
        disabled={disabled}
      >
        <span className="genre-display">{displayText}</span>
        <span className={`genre-arrow ${isExpanded ? 'up' : 'down'}`}>▼</span>
      </button>

      {/* 展开的分类选择面板 */}
      {isExpanded && (
        <div className="genre-selector-panel">
          {/* 素材类型选择 */}
          <div className="genre-type-section">
            <label className="genre-section-label">素材类型</label>
            <div className="genre-type-options">
              <button
                type="button"
                className={`genre-type-btn ${value.materialType === 'long' ? 'active' : ''}`}
                onClick={() => handleTypeChange('long')}
              >
                长篇
              </button>
              <button
                type="button"
                className={`genre-type-btn ${value.materialType === 'short' ? 'active' : ''}`}
                onClick={() => handleTypeChange('short')}
              >
                短篇
              </button>
            </div>
          </div>

          {/* 短篇分类选择 */}
          {value.materialType === 'short' && (
            <>
              {/* 大分类 */}
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

              {/* 子分类 */}
              {subGenres.length > 0 && (
                <div className="genre-sub-section">
                  <label className="genre-section-label">子分类</label>
                  <div className="genre-sub-options">
                    {subGenres.map((subGenre) => (
                      <button
                        key={subGenre}
                        type="button"
                        className={`genre-sub-btn ${value.subGenre === subGenre ? 'active' : ''}`}
                        onClick={() => handleSubGenreChange(subGenre)}
                      >
                        {subGenre}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* 关闭按钮 */}
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

// 分类筛选器组件（用于素材库筛选）
export interface MaterialFilterValue {
  materialType: MaterialType | 'all'
  parentGenre: string | 'all'
  subGenre: string | 'all'
}

interface MaterialFilterProps {
  value: MaterialFilterValue
  onChange: (value: MaterialFilterValue) => void
}

export function MaterialFilter({ value, onChange }: MaterialFilterProps) {
  const parentGenres = useMemo(() => Object.keys(SHORT_MATERIAL_GENRES), [])

  // 获取子分类
  const subGenres = useMemo(() => {
    if (value.parentGenre === 'all') {
      return Object.values(SHORT_MATERIAL_GENRES).flat()
    }
    return SHORT_MATERIAL_GENRES[value.parentGenre] || []
  }, [value.parentGenre])

  return (
    <div className="material-filter">
      {/* 类型筛选 */}
      <div className="filter-group">
        <select
          value={value.materialType}
          onChange={(e) =>
            onChange({
              materialType: e.target.value as MaterialType | 'all',
              parentGenre: 'all',
              subGenre: 'all',
            })
          }
          className="filter-select"
        >
          <option value="all">全部类型</option>
          <option value="long">长篇</option>
          <option value="short">短篇</option>
        </select>
      </div>

      {/* 分类筛选 */}
      {(value.materialType === 'short' || value.materialType === 'all') && (
        <>
          <div className="filter-group">
            <select
              value={value.parentGenre}
              onChange={(e) =>
                onChange({
                  ...value,
                  parentGenre: e.target.value,
                  subGenre: 'all',
                })
              }
              className="filter-select"
            >
              <option value="all">全部分类</option>
              {parentGenres.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <select
              value={value.subGenre}
              onChange={(e) => onChange({ ...value, subGenre: e.target.value })}
              className="filter-select"
              disabled={value.parentGenre === 'all'}
            >
              <option value="all">全部子分类</option>
              {subGenres.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
    </div>
  )
}
