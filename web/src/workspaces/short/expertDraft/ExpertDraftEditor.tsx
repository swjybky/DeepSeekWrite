import type {
  ExpertDraft,
  ExpertDraftCharacterState,
  ExpertDraftSection,
} from '../../../bridge'

type Props = {
  draft: ExpertDraft
  stageBody: string
  stageBodyReadOnly?: boolean
  onStageBodyChange: (value: string) => void
  updateDraft: (updater: (draft: ExpertDraft) => ExpertDraft) => void
  stopWriting: () => void
  resetDraft: () => void
  mergeSectionsToDraft: () => void
  exportDraft: () => void
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
  stopWriting,
  resetDraft,
  mergeSectionsToDraft,
  exportDraft,
}: Props) {
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
  const sectionCounts = textCounts(selectedSection?.body ?? '')

  const deleteSelectedSection = () => {
    if (!selectedSection || draft.running) return
    const title = selectedSection.title.trim() || '当前小节'
    const ok = window.confirm(`删除「${title}」？该操作会同时删除本节人物状态。`)
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

  return (
    <div className="expert-draft-editor">
      <div className="expert-draft-heading">
        <div className="expert-draft-heading-main">
          <label className="workspace-stage-label">正文编写</label>
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
              onClick={deleteSelectedSection}
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
                onClick={mergeSectionsToDraft}
                disabled={draft.running}
              >
                合并小节正文
              </button>
              <button
                type="button"
                className="expert-draft-action"
                onClick={exportDraft}
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
                  placeholder="如 800-1000"
                  disabled={draft.running}
                />
              </label>
              <span className="expert-draft-count muted">
                {sectionCounts.nonSpace.toLocaleString('zh-CN')} 字
              </span>
            </div>

            <label className="expert-draft-textarea-field">
              <span>{selectedSection.title || '当前小节'}正文</span>
              <textarea
                className="editor-body workspace-textarea expert-draft-textarea"
                value={selectedSection.body}
                aria-label={`${selectedSection.title}正文`}
                onChange={(e) => {
                  const body = e.target.value
                  updateDraft((current) => ({
                    ...current,
                    sections: updateSectionList(current.sections, selectedId, {
                      body,
                    }),
                  }))
                }}
                placeholder="正文内容..."
                spellCheck={false}
                readOnly={draft.running}
              />
            </label>

            <label className="expert-draft-textarea-field">
              <span>{selectedState.title || defaultStateTitle(selectedSection.title)}</span>
              <textarea
                className="editor-body workspace-textarea expert-draft-state-textarea"
                value={selectedState.body}
                aria-label={`${selectedSection.title}人物状态`}
                onChange={(e) => {
                  const body = e.target.value
                  updateDraft((current) => ({
                    ...current,
                    character_states: updateStateList(
                      current.character_states,
                      selectedId,
                      { body },
                      selectedSection.title,
                    ),
                  }))
                }}
                placeholder="人物状态..."
                spellCheck={false}
                readOnly={draft.running}
              />
            </label>
          </section>
        ) : (
          <section className="expert-draft-main-editor">
            <textarea
              className="editor-body workspace-textarea expert-draft-main-textarea"
              value={stageBody}
              aria-label="正文编写正文"
              onChange={(e) => onStageBodyChange(e.target.value)}
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
