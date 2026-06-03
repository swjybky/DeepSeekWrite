import type { ExpertDraft, ExpertDraftCharacterState, ExpertDraftSection } from '../../../bridge'

type Props = {
  draft: ExpertDraft
  updateDraft: (updater: (draft: ExpertDraft) => ExpertDraft) => void
  stopWriting: () => void
  resetDraft: () => void
  writeToDraftStage: () => void
  editPrompt: () => void
  promptEditorLoading?: boolean
  onDeaiSectionBody?: (sectionId: string) => void
  onDeaiCharacterState?: (sectionId: string) => void
  deaiBusy?: boolean
}

function textCounts(text: string): { total: number; nonSpace: number } {
  return {
    total: text.length,
    nonSpace: text.replace(/\p{White_Space}/gu, '').length,
  }
}

function nextSectionId(sections: ExpertDraftSection[]): string {
  let n = sections.length
  const used = new Set(sections.map((s) => s.id))
  while (used.has(`section-${n}`)) n += 1
  return `section-${n}`
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

function updateStateList(
  states: ExpertDraftCharacterState[],
  sectionId: string,
  patch: Partial<ExpertDraftCharacterState>,
): ExpertDraftCharacterState[] {
  if (!states.some((state) => state.section_id === sectionId)) {
    return [
      ...states,
      {
        section_id: sectionId,
        title: patch.title ?? '人物状态',
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
  updateDraft,
  stopWriting,
  resetDraft,
  writeToDraftStage,
  editPrompt,
  promptEditorLoading = false,
  onDeaiSectionBody,
  onDeaiCharacterState,
  deaiBusy = false,
}: Props) {
  const deaiDisabled = draft.running || deaiBusy
  const activeId = draft.active_section_id
  const totalBody = draft.sections.map((s) => s.body).join('\n\n')
  const counts = textCounts(totalBody)

  const addSection = () => {
    updateDraft((current) => {
      const id = nextSectionId(current.sections)
      const title = `第${current.sections.length}节`
      return {
        ...current,
        sections: [
          ...current.sections,
          { id, title, word_count_requirement: '', body: '' },
        ],
        character_states: [
          ...current.character_states,
          { section_id: id, title: `${title}人物状态`, body: '' },
        ],
      }
    })
  }

  return (
    <div className="expert-draft-editor">
      <div className="expert-draft-heading">
        <div className="expert-draft-heading-main">
          <label className="workspace-stage-label">正文编写 · 专家模式</label>
          <span className="expert-draft-status">
            {draft.running ? '后台写作中' : '待启动'}
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
            onClick={writeToDraftStage}
            disabled={draft.running}
          >
            写入正文
          </button>
          <button
            type="button"
            className="expert-draft-action"
            onClick={editPrompt}
            disabled={promptEditorLoading}
          >
            {promptEditorLoading ? '加载…' : '编辑提示词'}
          </button>
        </div>
        <span
          className="workspace-char-count muted"
          aria-live="polite"
          title={`专家正文不含空白字数 ${counts.nonSpace.toLocaleString('zh-CN')}；总字符（含空格与换行）${counts.total.toLocaleString('zh-CN')}`}
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

      <div className="expert-draft-scroll">
        <section className="expert-draft-list" aria-label="正文列表">
          <div className="expert-draft-list-head">
            <h2 className="expert-draft-list-title">正文列表</h2>
            <button
              type="button"
              className="expert-draft-add"
              onClick={addSection}
              disabled={draft.running}
            >
              添加小节
            </button>
          </div>
          {draft.sections.map((section, index) => {
            const sectionCounts = textCounts(section.body)
            const active = activeId === section.id
            return (
              <article
                key={section.id}
                className={
                  active
                    ? 'expert-draft-card expert-draft-card--active'
                    : 'expert-draft-card'
                }
              >
                <div className="expert-draft-card-head">
                  <input
                    className="expert-draft-title-input"
                    value={section.title}
                    aria-label={`正文小节 ${index + 1} 标题`}
                    onChange={(e) => {
                      const title = e.target.value
                      updateDraft((current) => ({
                        ...current,
                        sections: updateSectionList(current.sections, section.id, {
                          title,
                        }),
                      }))
                    }}
                    disabled={draft.running}
                  />
                  {onDeaiSectionBody ? (
                    <button
                      type="button"
                      className="btn-deai-flavor btn-deai-flavor--compact"
                      title="去除本节正文的 AI 腔"
                      disabled={deaiDisabled || !section.body.trim()}
                      onClick={() => onDeaiSectionBody(section.id)}
                    >
                      {deaiBusy ? '处理中…' : '去除AI味道'}
                    </button>
                  ) : null}
                  <span className="expert-draft-count muted">
                    {sectionCounts.nonSpace.toLocaleString('zh-CN')} 字
                  </span>
                </div>
                <input
                  className="expert-draft-word-input"
                  value={section.word_count_requirement ?? ''}
                  aria-label={`${section.title}字数要求`}
                  onChange={(e) => {
                    const word_count_requirement = e.target.value
                    updateDraft((current) => ({
                      ...current,
                      sections: updateSectionList(current.sections, section.id, {
                        word_count_requirement,
                      }),
                    }))
                  }}
                  placeholder="字数要求，如 800-1000"
                  disabled={draft.running}
                />
                <textarea
                  className="editor-body workspace-textarea expert-draft-textarea"
                  value={section.body}
                  aria-label={`${section.title}正文`}
                  onChange={(e) => {
                    const body = e.target.value
                    updateDraft((current) => ({
                      ...current,
                      sections: updateSectionList(current.sections, section.id, {
                        body,
                      }),
                    }))
                  }}
                  placeholder="正文内容…"
                  spellCheck={false}
                  readOnly={deaiDisabled}
                />
              </article>
            )
          })}
        </section>

        <section className="expert-draft-list" aria-label="人物状态编辑框列表">
          <div className="expert-draft-list-head">
            <h2 className="expert-draft-list-title">人物状态编辑框列表</h2>
          </div>
          {draft.sections.map((section) => {
            const state =
              draft.character_states.find((s) => s.section_id === section.id) ??
              {
                section_id: section.id,
                title: `${section.title}人物状态`,
                body: '',
              }
            const active = activeId === section.id
            return (
              <article
                key={section.id}
                className={
                  active
                    ? 'expert-draft-card expert-draft-card--active'
                    : 'expert-draft-card'
                }
              >
                <div className="expert-draft-card-head">
                  <input
                    className="expert-draft-title-input"
                    value={state.title}
                    aria-label={`${section.title}人物状态标题`}
                    onChange={(e) => {
                      const title = e.target.value
                      updateDraft((current) => ({
                        ...current,
                        character_states: updateStateList(
                          current.character_states,
                          section.id,
                          { title },
                        ),
                      }))
                    }}
                    disabled={draft.running}
                  />
                  {onDeaiCharacterState ? (
                    <button
                      type="button"
                      className="btn-deai-flavor btn-deai-flavor--compact"
                      title="去除本框人物状态的 AI 腔"
                      disabled={deaiDisabled || !state.body.trim()}
                      onClick={() => onDeaiCharacterState(section.id)}
                    >
                      {deaiBusy ? '处理中…' : '去除AI味道'}
                    </button>
                  ) : null}
                </div>
                <input
                  className="expert-draft-word-input expert-draft-word-input--placeholder"
                  readOnly
                  tabIndex={-1}
                  aria-hidden="true"
                />
                <textarea
                  className="editor-body workspace-textarea expert-draft-state-textarea"
                  value={state.body}
                  aria-label={`${section.title}人物状态`}
                  onChange={(e) => {
                    const body = e.target.value
                    updateDraft((current) => ({
                      ...current,
                      character_states: updateStateList(
                        current.character_states,
                        section.id,
                        { body },
                      ),
                    }))
                  }}
                  placeholder="人物状态…"
                  spellCheck={false}
                  readOnly={deaiDisabled}
                />
              </article>
            )
          })}
        </section>
      </div>
    </div>
  )
}
