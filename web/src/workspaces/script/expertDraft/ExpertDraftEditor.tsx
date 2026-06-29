import { useState } from 'react'
import type {
  ExpertDraft,
  ExpertDraftCharacterState,
  ExpertDraftSection,
  ManuscriptExportFormat,
} from '../../../bridge'
import { TextHistoryControls } from '../../../components/TextHistoryControls'
import { MarkdownTextEditor } from '../../../components/MarkdownTextEditor'
import { useAppDialog } from '../../../components/useAppDialog'
import type { TextHistoryController } from '../../../hooks/useTextHistory'

type Props = {
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

function textCounts(text: string): { total: number; nonSpace: number } {
  return {
    total: text.length,
    nonSpace: text.replace(/\p{White_Space}/gu, '').length,
  }
}

function updateSectionList(
  sections: ExpertDraftSection[],
  sectionId: string,
  patch: Partial<ExpertDraftSection>,
): ExpertDraftSection[] {
  return sections.map((section) =>
    section.id === sectionId ? { ...section, ...patch } : section,
  )
}

function defaultStateTitle(sectionTitle: string): string {
  return `${sectionTitle.trim() || '小节'}人物状态`
}

function updateStateList(
  states: ExpertDraftCharacterState[],
  sectionId: string,
  patch: Partial<ExpertDraftCharacterState>,
  sectionTitle: string,
): ExpertDraftCharacterState[] {
  if (!states.some((state) => state.section_id === sectionId)) {
    return [
      ...states,
      {
        section_id: sectionId,
        title: patch.title ?? defaultStateTitle(sectionTitle),
        body: patch.body ?? '',
      },
    ]
  }
  return states.map((state) =>
    state.section_id === sectionId ? { ...state, ...patch } : state,
  )
}

export function ExpertDraftEditor({
  draft,
  stageBody,
  stageBodyReadOnly = false,
  onStageBodyChange,
  updateDraft,
  onSectionTextareaRef,
  onMainStageTextareaRef,
  stopWriting,
  resetDraft,
  exportDraft,
  textHistory,
  historyPrefix,
  onTextBlur,
}: Props) {
  const { confirm, dialog } = useAppDialog()
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const selectedSection = draft.sections.find(
    (section) => section.id === draft.active_section_id,
  )
  const selectedId = selectedSection?.id ?? ''
  const selectedState = selectedSection
    ? draft.character_states.find((state) => state.section_id === selectedId) ?? {
        section_id: selectedId,
        title: defaultStateTitle(selectedSection.title),
        body: '',
      }
    : null
  const isSectionMode = Boolean(selectedSection && selectedState)
  const counts = textCounts(isSectionMode ? (selectedSection?.body ?? '') : stageBody)
  const bodyKey = `${historyPrefix}:expert:${selectedId}:body`
  const stateKey = `${historyPrefix}:expert:${selectedId}:character-state`
  const mainBodyKey = `${historyPrefix}:stage:draft`
  const sectionCounts = textCounts(selectedSection?.body ?? '')

  const deleteSelectedSection = async () => {
    if (!selectedSection || draft.running) return
    const title = selectedSection.title.trim() || '当前小节'
    const ok = await confirm({
      title: '删除小节',
      message: `删除「${title}」？`,
      details: '该操作会同时删除本节人物状态。',
      confirmText: '删除',
      variant: 'danger',
    })
    if (!ok) return
    updateDraft((current) => {
      const index = current.sections.findIndex((section) => section.id === selectedId)
      if (index < 0) return current
      const sections = current.sections.filter((section) => section.id !== selectedId)
      const nextActiveSectionId =
        sections[Math.min(index, Math.max(0, sections.length - 1))]?.id ?? ''
      return {
        ...current,
        sections,
        character_states: current.character_states.filter(
          (state) => state.section_id !== selectedId,
        ),
        active_section_id: nextActiveSectionId,
      }
    })
  }

  const selectExportFormat = (format: ManuscriptExportFormat) => {
    setExportDialogOpen(false)
    exportDraft(format)
  }

  return (
    <div className="expert-draft-editor">
      <div className="expert-draft-heading">
        <div className="expert-draft-heading-main">
          <label className="workspace-stage-label">正文编写</label>
          {!isSectionMode ? (
            <TextHistoryControls
              history={textHistory}
              historyKey={mainBodyKey}
              value={stageBody}
              onChange={onStageBodyChange}
              disabled={draft.running || stageBodyReadOnly}
            />
          ) : null}
          <span className="expert-draft-status">
            {draft.running ? '分节写作中' : '待启动'}
          </span>
          {draft.running ? (
            <button
              type="button"
              className="expert-draft-stop"
              onClick={stopWriting}
            >
              立即停止
            </button>
          ) : null}
          {isSectionMode ? (
            <button
              type="button"
              className="expert-draft-action expert-draft-action--danger"
              onClick={() => void deleteSelectedSection()}
              disabled={draft.running}
            >
              删除本节
            </button>
          ) : (
            <>
              <button
                type="button"
                className="expert-draft-action"
                onClick={resetDraft}
                disabled={draft.running}
              >
                清空
              </button>
              <button
                type="button"
                className="expert-draft-action"
                onClick={() => setExportDialogOpen(true)}
              >
                导出正文
              </button>
            </>
          )}
        </div>
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
      </div>
      {dialog}
      {exportDialogOpen ? (
        <div
          className="app-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setExportDialogOpen(false)
          }}
        >
          <section
            className="app-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="expert-draft-export-title"
          >
            <header className="app-dialog-head">
              <span className="app-dialog-mark" aria-hidden="true">
                i
              </span>
              <h2 id="expert-draft-export-title">选择导出格式</h2>
            </header>
            <div className="app-dialog-body">
              <p>请选择正文导出的文件类型。</p>
              <div className="expert-draft-export-options">
                <button
                  type="button"
                  className="app-dialog-btn app-dialog-btn--secondary"
                  onClick={() => selectExportFormat('docx')}
                >
                  DOCX
                </button>
                <button
                  type="button"
                  className="app-dialog-btn app-dialog-btn--secondary"
                  onClick={() => selectExportFormat('txt')}
                >
                  TXT
                </button>
                <button
                  type="button"
                  className="app-dialog-btn app-dialog-btn--secondary"
                  onClick={() => selectExportFormat('epub')}
                >
                  EPUB
                </button>
              </div>
            </div>
            <footer className="app-dialog-foot">
              <button
                type="button"
                className="app-dialog-btn app-dialog-btn--secondary"
                onClick={() => setExportDialogOpen(false)}
              >
                取消
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      <div className="expert-draft-workbench">
        {isSectionMode && selectedSection && selectedState ? (
          <section className="expert-draft-active-editor">
            <div className="expert-draft-section-toolbar">
              <label className="field expert-draft-section-title-field">
                <span className="field-label">章节名称</span>
                <input
                  type="text"
                  value={selectedSection.title}
                  onChange={(e) => {
                    const title = e.target.value
                    updateDraft((current) => ({
                      ...current,
                      sections: updateSectionList(current.sections, selectedId, {
                        title,
                      }),
                      character_states: updateStateList(
                        current.character_states,
                        selectedId,
                        { title: defaultStateTitle(title) },
                        title,
                      ),
                    }))
                  }}
                  onBlur={onTextBlur}
                  disabled={draft.running}
                />
              </label>
              <label className="field expert-draft-section-word-field">
                <span className="field-label">字数要求</span>
                <input
                  type="text"
                  value={selectedSection.word_count_requirement ?? ''}
                  onChange={(e) => {
                    const word_count_requirement = e.target.value
                    updateDraft((current) => ({
                      ...current,
                      sections: updateSectionList(current.sections, selectedId, {
                        word_count_requirement,
                      }),
                    }))
                  }}
                  onBlur={onTextBlur}
                  placeholder="如 800-1000"
                  disabled={draft.running}
                />
              </label>
              <span className="expert-draft-count muted">
                {sectionCounts.nonSpace.toLocaleString('zh-CN')} 字
              </span>
            </div>

            <label className="expert-draft-textarea-field">
              <span className="expert-draft-field-heading"><span>{selectedSection.title || '当前小节'}正文</span><TextHistoryControls history={textHistory} historyKey={bodyKey} value={selectedSection.body} onChange={(body) => updateDraft((current) => ({ ...current, sections: updateSectionList(current.sections, selectedId, { body }) }))} disabled={draft.running} /></span>
              <MarkdownTextEditor
                className="editor-body workspace-textarea expert-draft-textarea"
                value={selectedSection.body}
                aria-label={`${selectedSection.title}正文`}
                textareaRef={(node) =>
                  onSectionTextareaRef?.(selectedId, 'body', node)
                }
                onValueChange={(value) => {
                  textHistory.change(bodyKey, selectedSection.body, value, (body) => updateDraft((current) => ({ ...current, sections: updateSectionList(current.sections, selectedId, { body }) })))
                }}
                onKeyDown={(event) => textHistory.handleKeyDown(event, bodyKey, selectedSection.body, (body) => updateDraft((current) => ({ ...current, sections: updateSectionList(current.sections, selectedId, { body }) })))}
                onBlur={onTextBlur}
                placeholder="正文内容..."
                spellCheck={false}
                readOnly={draft.running}
              />
            </label>

            <label className="expert-draft-textarea-field">
              <span className="expert-draft-field-heading"><span>{selectedState.title || defaultStateTitle(selectedSection.title)}</span><TextHistoryControls history={textHistory} historyKey={stateKey} value={selectedState.body} onChange={(body) => updateDraft((current) => ({ ...current, character_states: updateStateList(current.character_states, selectedId, { body }, selectedSection.title) }))} disabled={draft.running} /></span>
              <MarkdownTextEditor
                className="editor-body workspace-textarea expert-draft-state-textarea"
                value={selectedState.body}
                aria-label={`${selectedSection.title}人物状态`}
                textareaRef={(node) =>
                  onSectionTextareaRef?.(selectedId, 'character_state', node)
                }
                onValueChange={(value) => {
                  textHistory.change(stateKey, selectedState.body, value, (body) => updateDraft((current) => ({ ...current, character_states: updateStateList(current.character_states, selectedId, { body }, selectedSection.title) })))
                }}
                onKeyDown={(event) => textHistory.handleKeyDown(event, stateKey, selectedState.body, (body) => updateDraft((current) => ({ ...current, character_states: updateStateList(current.character_states, selectedId, { body }, selectedSection.title) })))}
                onBlur={onTextBlur}
                placeholder="人物状态..."
                spellCheck={false}
                readOnly={draft.running}
              />
            </label>
          </section>
        ) : (
          <section className="expert-draft-main-editor">
            <MarkdownTextEditor
              className="editor-body workspace-textarea expert-draft-main-textarea"
              value={stageBody}
              aria-label="正文编写正文"
              textareaRef={(node) => onMainStageTextareaRef?.(node)}
              onValueChange={(value) => textHistory.change(mainBodyKey, stageBody, value, onStageBodyChange)}
              onKeyDown={(event) => textHistory.handleKeyDown(event, mainBodyKey, stageBody, onStageBodyChange)}
              onBlur={onTextBlur}
              placeholder="在此编辑正文..."
              spellCheck={false}
              readOnly={draft.running || stageBodyReadOnly}
            />
          </section>
        )}
      </div>
    </div>
  )
}
