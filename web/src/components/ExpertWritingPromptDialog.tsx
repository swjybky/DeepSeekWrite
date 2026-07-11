import { useEffect, useState } from 'react'
import type { BookType } from '../domain/workspaceCore'
import {
  getDefaultExpertWritingTaskPrompt,
  getExpertWritingTaskPrompt,
  resetExpertWritingTaskPrompt,
  saveExpertWritingTaskPrompt,
} from '../bridge'
import './ExpertWritingPromptDialog.css'

type WorkspaceType = Extract<BookType, 'short' | 'script'>
type TabId = 'mine' | 'recommended'

type Props = {
  workspaceType: WorkspaceType
  onClose: () => void
}

function typeLabel(workspaceType: WorkspaceType): string {
  return workspaceType === 'script' ? '剧本' : '短篇'
}

export function ExpertWritingPromptDialog({ workspaceType, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('mine')
  const [draft, setDraft] = useState('')
  const [recommended, setRecommended] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      getExpertWritingTaskPrompt(workspaceType),
      getDefaultExpertWritingTaskPrompt(workspaceType),
    ])
      .then(([current, builtIn]) => {
        if (cancelled) return
        setDraft(current)
        setRecommended(builtIn)
      })
      .catch((reason) => {
        if (cancelled) return
        setError(reason instanceof Error ? reason.message : '读取提示词失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceType])

  const save = async () => {
    if (!draft.trim()) {
      setError('自动写作任务提示词不能为空')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await saveExpertWritingTaskPrompt(workspaceType, draft)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存提示词失败')
    } finally {
      setSaving(false)
    }
  }

  const restoreDefault = async () => {
    setSaving(true)
    setError(null)
    try {
      const builtIn = await resetExpertWritingTaskPrompt(workspaceType)
      setRecommended(builtIn)
      setDraft(builtIn)
      setActiveTab('mine')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '恢复默认提示词失败')
    } finally {
      setSaving(false)
    }
  }

  const loadRecommendation = () => {
    setDraft(recommended)
    setActiveTab('mine')
    setError(null)
  }

  const busy = loading || saving

  return (
    <div className="expert-writing-prompt-backdrop" role="presentation">
      <section
        className="expert-writing-prompt-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="expert-writing-prompt-title"
      >
        <header className="expert-writing-prompt-head">
          <div>
            <h2 id="expert-writing-prompt-title">自动写作提示词</h2>
            <p>{typeLabel(workspaceType)}作品共用；运行状态与本轮写作要求会由程序自动追加。</p>
          </div>
          <button
            type="button"
            className="expert-writing-prompt-close"
            aria-label="关闭"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="expert-writing-prompt-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'mine'}
            className={activeTab === 'mine' ? 'is-active' : ''}
            onClick={() => setActiveTab('mine')}
          >
            我的提示词
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'recommended'}
            className={activeTab === 'recommended' ? 'is-active' : ''}
            onClick={() => setActiveTab('recommended')}
          >
            推荐提示词
          </button>
        </div>

        <div className="expert-writing-prompt-body">
          {error ? <p className="expert-writing-prompt-error" role="alert">{error}</p> : null}
          {loading ? (
            <p className="expert-writing-prompt-loading">正在读取提示词…</p>
          ) : activeTab === 'mine' ? (
            <>
              <label htmlFor="expert-writing-prompt-editor">固定任务提示词</label>
              <textarea
                id="expert-writing-prompt-editor"
                value={draft}
                rows={16}
                disabled={saving}
                onChange={(event) => setDraft(event.target.value)}
              />
              <p className="expert-writing-prompt-note">
                当前小节、进度、字数、前置小节、本轮写作要求和写回规则不在此处编辑，将自动追加在这段文字后面。
              </p>
            </>
          ) : (
            <article className="expert-writing-prompt-recommendation">
              <div className="expert-writing-prompt-recommendation-head">
                <div>
                  <h3>{typeLabel(workspaceType)}官方推荐</h3>
                  <p>沿用并整理现有自动写作组织方案。</p>
                </div>
                <button
                  type="button"
                  disabled={saving || !recommended.trim()}
                  onClick={loadRecommendation}
                >
                  加载使用
                </button>
              </div>
              <pre>{recommended}</pre>
            </article>
          )}
        </div>

        <footer className="expert-writing-prompt-foot">
          <button
            type="button"
            className="expert-writing-prompt-secondary"
            disabled={busy}
            onClick={() => void restoreDefault()}
          >
            恢复默认
          </button>
          <div>
            <button
              type="button"
              className="expert-writing-prompt-secondary"
              disabled={busy}
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="button"
              className="expert-writing-prompt-primary"
              disabled={busy || !draft.trim()}
              onClick={() => void save()}
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
