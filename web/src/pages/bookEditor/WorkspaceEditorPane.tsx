import { useState, type ComponentType, type MutableRefObject } from 'react'
import type { ExpertDraft, StageId } from '../../domain/workspace'
import type { ManuscriptExportFormat } from '../../bridge'
import type { PlotChildStageDefinition, PlotChildStageId } from './workspaceTypes'
import { longStageLabel } from '../../workspaces/long/stages'
import { PLOT_STAGE_ID } from '../../workspaces/short/stages'
import { stageTextCounts } from './stageEditing'
import { TextHistoryControls } from '../../components/TextHistoryControls'
import type { TextHistoryController } from '../../hooks/useTextHistory'
import { MarkdownModeToggle, MarkdownTextEditor } from '../../components/MarkdownTextEditor'
import { useTextDisplay } from '../../textDisplay'

type ExpertDraftEditorProps = {
  draft: ExpertDraft
  stageBody: string
  stageBodyReadOnly?: boolean
  onStageBodyChange: (value: string) => void
  updateDraft: (updater: (draft: ExpertDraft) => ExpertDraft) => void
  onSectionTextareaRef?: (
    sectionId: string,
    field: 'body' | 'character_state',
    node: HTMLTextAreaElement | null,
  ) => void
  onMainStageTextareaRef?: (node: HTMLTextAreaElement | null) => void
  stopWriting: () => void
  resetDraft: () => void
  exportDraft: (format: ManuscriptExportFormat) => void
  textHistory: TextHistoryController
  historyPrefix: string
  onTextBlur: () => void
}

type Props = {
  expertDraftActive: boolean
  ActiveExpertDraftEditor: ComponentType<ExpertDraftEditorProps>
  expertDraft: ExpertDraft
  stageBody: string
  streamingStages: Partial<Record<StageId, boolean>>
  onStageBodyChange: (value: string, stageId?: StageId) => void
  updateExpertDraft: (updater: (current: ExpertDraft) => ExpertDraft) => void
  onSectionTextareaRef: (
    sectionId: string,
    field: 'body' | 'character_state',
    node: HTMLTextAreaElement | null,
  ) => void
  stopExpertWriting: () => void
  resetExpertDraft: () => void
  exportExpertDraft: (format: ManuscriptExportFormat) => void
  activeStage: StageId
  activeContentStage: StageId
  activePlotChildStage: PlotChildStageId | ''
  activePlotChildStages: readonly PlotChildStageDefinition[]
  stages: Record<StageId, string>
  railStages: readonly { id: StageId; label: string }[]
  textareaRef: MutableRefObject<HTMLTextAreaElement | null>
  textareaRefsRef: MutableRefObject<
    Partial<Record<StageId, HTMLTextAreaElement | null>>
  >
  bookId: string
  textHistory: TextHistoryController
  onTextBlur: () => void
}

function StageCharCount({ text }: { text: string }) {
  const counts = stageTextCounts(text)
  return (
    <span
      className="workspace-char-count muted"
      aria-live="polite"
      title={`不含空白字数 ${counts.nonSpace.toLocaleString('zh-CN')}；总字符（含空格与换行）${counts.total.toLocaleString('zh-CN')}`}
    >
      {counts.nonSpace.toLocaleString('zh-CN')} 字
      <span className="workspace-char-count-sep" aria-hidden>
        {' · '}
      </span>
      <span className="workspace-char-count-detail">
        {counts.total.toLocaleString('zh-CN')} 字符
      </span>
    </span>
  )
}

export function WorkspaceEditorPane({
  expertDraftActive,
  ActiveExpertDraftEditor,
  expertDraft,
  stageBody,
  streamingStages,
  onStageBodyChange,
  updateExpertDraft,
  onSectionTextareaRef,
  stopExpertWriting,
  resetExpertDraft,
  exportExpertDraft,
  activeStage,
  activeContentStage,
  activePlotChildStage,
  activePlotChildStages,
  stages,
  railStages,
  textareaRef,
  textareaRefsRef,
  bookId,
  textHistory,
  onTextBlur,
}: Props) {
  const { mode: textDisplayMode } = useTextDisplay()
  const [mdEditingMap, setMdEditingMap] = useState<Record<string, boolean>>({})

  const getMdKey = (stageId: StageId) => `stage:${stageId}`
  const singleStageKey = getMdKey(activeContentStage)
  const setMdEditing = (key: string, editing: boolean) => {
    setMdEditingMap((prev) => ({ ...prev, [key]: editing }))
  }
  const renderMdToggle = (key: string) =>
    textDisplayMode === 'markdown' ? (
      <MarkdownModeToggle
        editing={mdEditingMap[key] ?? false}
        onChange={(editing) => setMdEditing(key, editing)}
      />
    ) : null

  return (
    <div className="workspace-editor-pane workspace-editor-pane--primary">
      {expertDraftActive ? (
        <ActiveExpertDraftEditor
          draft={expertDraft}
          stageBody={stageBody}
          stageBodyReadOnly={Boolean(streamingStages.draft)}
          onStageBodyChange={(value) => onStageBodyChange(value, 'draft')}
          updateDraft={updateExpertDraft}
          onSectionTextareaRef={onSectionTextareaRef}
          onMainStageTextareaRef={(node) => {
            textareaRefsRef.current.draft = node
            if (node) {
              textareaRef.current = node
            }
          }}
          stopWriting={stopExpertWriting}
          resetDraft={resetExpertDraft}
          exportDraft={exportExpertDraft}
          textHistory={textHistory}
          historyPrefix={`workspace:${bookId}`}
          onTextBlur={onTextBlur}
        />
      ) : activeStage === PLOT_STAGE_ID ? (
        <div
          className={
            activePlotChildStage
              ? 'workspace-plot-editor workspace-plot-editor--single'
              : 'workspace-plot-editor'
          }
        >
          {(activePlotChildStage
            ? activePlotChildStages.filter(
                (stage) => stage.id === activePlotChildStage,
              )
            : activePlotChildStages
          ).map((plotStage) => {
            const body = stages[plotStage.id] ?? ''
            return (
              <section
                key={plotStage.id}
                className="workspace-plot-editor-section"
              >
                <div className="workspace-stage-heading">
                  <label
                    className="workspace-stage-label"
                    htmlFor={`stage-body-${plotStage.id}`}
                  >
                    {plotStage.label}
                  </label>
                  <TextHistoryControls
                    history={textHistory}
                    historyKey={`workspace:${bookId}:stage:${plotStage.id}`}
                    value={body}
                    onChange={(value) => onStageBodyChange(value, plotStage.id)}
                    disabled={Boolean(streamingStages[plotStage.id])}
                  />
                  {renderMdToggle(getMdKey(plotStage.id))}
                  <StageCharCount text={body} />
                </div>
                <MarkdownTextEditor
                  key={`md-${plotStage.id}`}
                  id={`stage-body-${plotStage.id}`}
                  textareaRef={(node) => {
                    textareaRefsRef.current[plotStage.id] = node
                    if (plotStage.id === activeContentStage) {
                      textareaRef.current = node
                    }
                  }}
                  className="editor-body workspace-textarea"
                  value={body}
                  onValueChange={(value) =>
                    textHistory.change(
                      `workspace:${bookId}:stage:${plotStage.id}`,
                      body,
                      value,
                      (value) => onStageBodyChange(value, plotStage.id),
                    )
                  }
                  onKeyDown={(event) =>
                    textHistory.handleKeyDown(
                      event,
                      `workspace:${bookId}:stage:${plotStage.id}`,
                      body,
                      (value) => onStageBodyChange(value, plotStage.id),
                    )
                  }
                  onBlur={onTextBlur}
                  placeholder="在此编辑当前剧情内容..."
                  spellCheck={false}
                  readOnly={Boolean(streamingStages[plotStage.id])}
                  showToolbar={false}
                  editingMarkdown={mdEditingMap[getMdKey(plotStage.id)] ?? false}
                  onEditingMarkdownChange={(editing) =>
                    setMdEditing(getMdKey(plotStage.id), editing)
                  }
                />
              </section>
            )
          })}
        </div>
      ) : (
        <>
          <div className="workspace-stage-heading">
            <label className="workspace-stage-label" htmlFor="stage-body">
              {railStages.find((s) => s.id === activeStage)?.label ??
                longStageLabel(activeContentStage)}
            </label>
            <TextHistoryControls
              history={textHistory}
              historyKey={`workspace:${bookId}:stage:${activeContentStage}`}
              value={stageBody}
              onChange={(value) => onStageBodyChange(value)}
              disabled={Boolean(streamingStages[activeContentStage])}
            />
            {renderMdToggle(singleStageKey)}
            <StageCharCount text={stageBody} />
          </div>
          <MarkdownTextEditor
            key={`md-${activeContentStage}`}
            id="stage-body"
            textareaRef={(node) => {
              textareaRef.current = node
              textareaRefsRef.current[activeContentStage] = node
            }}
            className="editor-body workspace-textarea"
            value={stageBody}
            onValueChange={(value) =>
              textHistory.change(
                `workspace:${bookId}:stage:${activeContentStage}`,
                stageBody,
                value,
                (value) => onStageBodyChange(value),
              )
            }
            onKeyDown={(event) =>
              textHistory.handleKeyDown(
                event,
                `workspace:${bookId}:stage:${activeContentStage}`,
                stageBody,
                (value) => onStageBodyChange(value),
              )
            }
            onBlur={onTextBlur}
            placeholder="在此编辑当前阶段内容..."
            spellCheck={false}
            readOnly={Boolean(streamingStages[activeContentStage])}
            showToolbar={false}
            editingMarkdown={mdEditingMap[singleStageKey] ?? false}
            onEditingMarkdownChange={(editing) =>
              setMdEditing(singleStageKey, editing)
            }
          />
        </>
      )}
    </div>
  )
}
