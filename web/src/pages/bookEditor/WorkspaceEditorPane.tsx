import type { ComponentType, MutableRefObject } from 'react'
import type { ExpertDraft, StageId } from '../../domain/workspace'
import type { PlotChildStageDefinition, PlotChildStageId } from './workspaceTypes'
import { PLOT_STAGE_ID } from '../../workspaces/short/stages'
import { stageTextCounts } from './stageEditing'

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
  stopWriting: () => void
  resetDraft: () => void
  mergeSectionsToDraft: () => void
  exportDraft: () => void
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
  mergeExpertDraftToStage: () => void
  exportExpertDraft: () => void
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
  mergeExpertDraftToStage,
  exportExpertDraft,
  activeStage,
  activeContentStage,
  activePlotChildStage,
  activePlotChildStages,
  stages,
  railStages,
  textareaRef,
  textareaRefsRef,
}: Props) {
  return (
    <div className="workspace-editor-pane workspace-editor-pane--primary">
      {expertDraftActive ? (
        <ActiveExpertDraftEditor
          draft={expertDraft}
          stageBody={stageBody}
          stageBodyReadOnly={Boolean(streamingStages.draft)}
          onStageBodyChange={onStageBodyChange}
          updateDraft={updateExpertDraft}
          onSectionTextareaRef={onSectionTextareaRef}
          stopWriting={stopExpertWriting}
          resetDraft={resetExpertDraft}
          mergeSectionsToDraft={mergeExpertDraftToStage}
          exportDraft={exportExpertDraft}
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
                  <StageCharCount text={body} />
                </div>
                <textarea
                  id={`stage-body-${plotStage.id}`}
                  ref={(node) => {
                    textareaRefsRef.current[plotStage.id] = node
                    if (plotStage.id === activeContentStage) {
                      textareaRef.current = node
                    }
                  }}
                  className="editor-body workspace-textarea"
                  value={body}
                  onChange={(e) =>
                    onStageBodyChange(e.target.value, plotStage.id)
                  }
                  placeholder="在此编辑当前剧情内容..."
                  spellCheck={false}
                  readOnly={Boolean(streamingStages[plotStage.id])}
                />
              </section>
            )
          })}
        </div>
      ) : (
        <>
          <div className="workspace-stage-heading">
            <label className="workspace-stage-label" htmlFor="stage-body">
              {railStages.find((s) => s.id === activeStage)?.label}
            </label>
            <StageCharCount text={stageBody} />
          </div>
          <textarea
            id="stage-body"
            ref={(node) => {
              textareaRef.current = node
              textareaRefsRef.current[activeContentStage] = node
            }}
            className="editor-body workspace-textarea"
            value={stageBody}
            onChange={(e) => onStageBodyChange(e.target.value)}
            placeholder="在此编辑当前阶段内容..."
            spellCheck={false}
            readOnly={Boolean(streamingStages[activeContentStage])}
          />
        </>
      )}
    </div>
  )
}
