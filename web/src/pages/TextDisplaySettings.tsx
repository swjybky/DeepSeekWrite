import { useNavigate } from 'react-router-dom'
import type { TextDisplayMode } from '../bridge'
import { TEXT_DISPLAY_MODE_LABELS, useTextDisplay } from '../textDisplay'
import './TextDisplaySettings.css'

const OPTIONS: Array<{ id: TextDisplayMode; description: string }> = [
  { id: 'text', description: '直接显示和编辑纯文本，不解析 Markdown 标记。' },
  { id: 'markdown', description: '默认按 Markdown 排版预览，并可随时切换到源码编辑。' },
]

export function TextDisplaySettings() {
  const navigate = useNavigate()
  const { mode, saving, error, setMode } = useTextDisplay()

  return (
    <div className="text-display-settings-page">
      <header className="workspace-settings-header">
        <button type="button" className="workspace-settings-back" onClick={() => navigate('/')}>
          ← 返回首页
        </button>
        <div>
          <h1>文字显示</h1>
          <p>统一设置创作空间、素材库和技能库的内容显示方式</p>
        </div>
        <span className={`workspace-settings-save-state${saving ? ' workspace-settings-save-state--saving' : ''}`}>
          {saving ? '保存中…' : ''}
        </span>
      </header>

      <main className="text-display-settings-content">
        <section className="text-display-settings-card" aria-labelledby="text-display-title">
          <div className="text-display-settings-card-head">
            <h2 id="text-display-title">显示模式</h2>
            <p>设置会自动保存，并立即应用到所有文字编辑页面。</p>
          </div>
          <div className="text-display-options" role="radiogroup" aria-label="文字显示模式">
            {OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={mode === option.id}
                className={mode === option.id ? 'text-display-option text-display-option--active' : 'text-display-option'}
                disabled={saving}
                onClick={() => void setMode(option.id)}
              >
                <span className="text-display-option-mark" aria-hidden="true" />
                <span>
                  <strong>{TEXT_DISPLAY_MODE_LABELS[option.id]}</strong>
                  <em>{option.description}</em>
                </span>
              </button>
            ))}
          </div>
          {error ? <p className="form-error">{error}</p> : null}
        </section>
      </main>
    </div>
  )
}
