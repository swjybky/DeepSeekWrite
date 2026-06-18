import { TextHistoryControls } from '../../components/TextHistoryControls'
import type { TextHistoryController } from '../../hooks/useTextHistory'

type CoverGenerateDialogProps = {
  promptDraft: string
  generating: boolean
  onPromptChange: (value: string) => void
  onClose: () => void
  onConfirm: () => void
  textHistory: TextHistoryController
  historyKey: string
}

type CoverViewerDialogProps = {
  coverData: string
  onClose: () => void
}

export function CoverGenerateDialog({
  promptDraft,
  generating,
  onPromptChange,
  onClose,
  onConfirm,
  textHistory,
  historyKey,
}: CoverGenerateDialogProps) {
  return (
    <div
      className="workspace-cover-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wc-cover-dialog-title"
    >
      <div className="workspace-cover-dialog-panel">
        <div className="workspace-cover-dialog-head">
          <h2 id="wc-cover-dialog-title" className="workspace-cover-dialog-title">
            生成封面
          </h2>
          <button
            type="button"
            className="workspace-cover-dialog-close"
            aria-label="关闭"
            disabled={generating}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="workspace-cover-dialog-body">
          <label className="workspace-cover-dialog-label" htmlFor="cover-prompt">
            提示词（可修改）
          </label>
          <TextHistoryControls
            history={textHistory}
            historyKey={historyKey}
            value={promptDraft}
            onChange={onPromptChange}
            disabled={generating}
          />
          <textarea
            id="cover-prompt"
            className="workspace-cover-dialog-area"
            value={promptDraft}
            spellCheck={false}
            disabled={generating}
            onChange={(e) =>
              textHistory.change(
                historyKey,
                promptDraft,
                e.target.value,
                onPromptChange,
              )
            }
            onKeyDown={(event) =>
              textHistory.handleKeyDown(
                event,
                historyKey,
                promptDraft,
                onPromptChange,
              )
            }
          />
        </div>
        <div className="workspace-cover-dialog-foot">
          <button
            type="button"
            className="btn-cover-dialog-cancel"
            disabled={generating}
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="btn-cover-dialog-confirm"
            disabled={generating || !promptDraft.trim()}
            onClick={onConfirm}
          >
            {generating ? '生成中…' : '确认生成'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function CoverViewerDialog({ coverData, onClose }: CoverViewerDialogProps) {
  return (
    <div
      className="workspace-cover-viewer-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="workspace-cover-viewer-panel">
        <button
          type="button"
          className="workspace-cover-viewer-close"
          aria-label="关闭"
          onClick={onClose}
        >
          ×
        </button>
        <img
          src={`data:image/png;base64,${coverData}`}
          alt="书籍封面"
          className="workspace-cover-viewer-img"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  )
}
