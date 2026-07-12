import {
  addLongWorldCategory,
  bumpLongWorkspace,
  removeLongWorldCategory,
  setLongWorldbuildingFormat,
  type LongWorkspace,
  type LongWorldbuildingFormat,
} from './longWorkspace'
import './WorldbuildingFormatDialog.css'

type Props = {
  workspace: LongWorkspace
  onChange: (workspace: LongWorkspace) => void
  onClose: () => void
}

export function WorldbuildingFormatDialog({ workspace, onChange, onClose }: Props) {
  const renameCategory = (categoryId: string, name: string) => {
    onChange(
      bumpLongWorkspace({
        ...workspace,
        worldbuilding: {
          categories: workspace.worldbuilding.categories.map((category) =>
            category.id === categoryId ? { ...category, name } : category,
          ),
        },
      }),
    )
  }

  const changeFormat = (
    categoryId: string,
    format: LongWorldbuildingFormat,
  ) => {
    onChange(setLongWorldbuildingFormat(workspace, categoryId, format))
  }

  const addCategory = () => {
    onChange(addLongWorldCategory(workspace).workspace)
  }

  const deleteCategory = (categoryId: string, name: string) => {
    if (!window.confirm(`删除世界观分类「${name || '未命名分类'}」及其全部内容？`)) return
    onChange(removeLongWorldCategory(workspace, categoryId))
  }

  return (
    <div
      className="long-format-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="long-format-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="long-format-dialog-title"
      >
        <header className="long-format-dialog-head">
          <div>
            <h2 id="long-format-dialog-title">世界观格式管理</h2>
            <p>每个分类可独立使用列表格式或文本格式。</p>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose}>×</button>
        </header>
        <div className="long-format-dialog-body">
          {workspace.worldbuilding.categories.length === 0 ? (
            <p className="long-format-empty">暂无世界观分类，请新增。</p>
          ) : (
            <div className="long-format-category-list">
              {workspace.worldbuilding.categories.map((category) => (
                <div className="long-format-category-row" key={category.id}>
                  <input
                    aria-label="分类名称"
                    value={category.name}
                    onChange={(event) =>
                      renameCategory(category.id, event.target.value)
                    }
                  />
                  <div className="long-format-mode-switch" role="group" aria-label={`${category.name}格式`}>
                    {(['list', 'text'] as const).map((format) => (
                      <button
                        key={format}
                        type="button"
                        className={category.format === format ? 'is-active' : ''}
                        onClick={() => changeFormat(category.id, format)}
                      >
                        {format === 'list' ? '列表格式' : '文本格式'}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="long-format-delete"
                    onClick={() => deleteCategory(category.id, category.name)}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <footer className="long-format-dialog-foot">
          <button type="button" className="long-format-add" onClick={addCategory}>
            新增分类
          </button>
          <button type="button" className="long-format-done" onClick={onClose}>
            完成
          </button>
        </footer>
      </section>
    </div>
  )
}
