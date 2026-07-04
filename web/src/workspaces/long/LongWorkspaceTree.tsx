import { useMemo, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

import {
  LONG_CHARACTER_STAGES,
  LONG_CONTINUITY_STAGES,
  LONG_PLOT_STAGES,
  LONG_WORLDBUILDING_STAGES,
  LONG_WORKSPACE_STAGES,
  collectLongDraftTree,
  longRootStageIdForStage,
  type LongRootStageId,
  type LongStageId,
} from './stages'

type Props = {
  rootLabel: string
  stages: Partial<Record<string, string>>
  activeStageId: LongStageId
  onStageSelect: (stageId: LongStageId) => void
  onCreateDraftVolume: () => void
  onCreateDraftArc: (volumeNumber: number) => void
  onCreateDraftChapter: (volumeNumber: number, arcNumber: number) => void
  editingTitle?: boolean
  titleDraft?: string
  onTitleDraftChange?: (value: string) => void
  onTitleEditStart?: () => void
  onTitleEditEnd?: () => void
  onTitleEditCancel?: () => void
  titleInputControls?: ReactNode
  onTitleInputKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
}

const STATIC_CHILDREN: Record<
  Exclude<LongRootStageId, 'draft'>,
  readonly { id: LongStageId; label: string }[]
> = {
  worldbuilding: LONG_WORLDBUILDING_STAGES,
  character_design: LONG_CHARACTER_STAGES,
  plot_design: LONG_PLOT_STAGES,
  continuity_ledger: LONG_CONTINUITY_STAGES,
}

function buttonClass(base: string, active: boolean) {
  return active ? `${base} ${base}--active` : base
}

export function LongWorkspaceTree({
  rootLabel,
  stages,
  activeStageId,
  onStageSelect,
  onCreateDraftVolume,
  onCreateDraftArc,
  onCreateDraftChapter,
  editingTitle = false,
  titleDraft = '',
  onTitleDraftChange,
  onTitleEditStart,
  onTitleEditEnd,
  onTitleEditCancel,
  titleInputControls,
  onTitleInputKeyDown,
}: Props) {
  const activeRootId = longRootStageIdForStage(activeStageId)
  const draftTree = useMemo(() => collectLongDraftTree(stages), [stages])
  const [rootExpanded, setRootExpanded] = useState(true)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const isExpanded = (id: string, defaultValue = true) =>
    expanded[id] ?? defaultValue
  const toggle = (id: string, defaultValue = true) => {
    setExpanded((prev) => ({
      ...prev,
      [id]: !(prev[id] ?? defaultValue),
    }))
  }

  const renderRootRow = (stage: (typeof LONG_WORKSPACE_STAGES)[number]) => {
    const stageExpanded = isExpanded(stage.id, activeRootId === stage.id)
    const active = activeRootId === stage.id
    return (
      <div className="workspace-tree-stage-row">
        <button
          type="button"
          className={
            active
              ? 'workspace-tree-stage workspace-tree-stage--active workspace-tree-stage--branch'
              : 'workspace-tree-stage workspace-tree-stage--branch'
          }
          aria-expanded={stageExpanded}
          onClick={() => toggle(stage.id, activeRootId === stage.id)}
        >
          <span className="workspace-tree-stage-dot" aria-hidden />
          {stage.label}
        </button>
        <button
          type="button"
          className="workspace-tree-toggle workspace-tree-stage-toggle"
          aria-expanded={stageExpanded}
          aria-label={stageExpanded ? `收起${stage.label}` : `展开${stage.label}`}
          onClick={() => toggle(stage.id, activeRootId === stage.id)}
        >
          <span className="workspace-tree-chevron" aria-hidden>
            {stageExpanded ? '▾' : '▸'}
          </span>
        </button>
      </div>
    )
  }

  const renderStaticGroup = (
    stage: (typeof LONG_WORKSPACE_STAGES)[number],
    children: readonly { id: LongStageId; label: string }[],
  ) => {
    const stageExpanded = isExpanded(stage.id, activeRootId === stage.id)
    return (
      <li key={stage.id} className="workspace-tree-stage-item">
        {renderRootRow(stage)}
        {stageExpanded ? (
          <ul className="workspace-tree-stage-children">
            {children.map((child) => (
              <li key={child.id}>
                <button
                  type="button"
                  className={buttonClass(
                    'workspace-tree-stage-child',
                    activeStageId === child.id,
                  )}
                  onClick={() => onStageSelect(child.id)}
                  title={child.label}
                >
                  {child.label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </li>
    )
  }

  const renderDraftGroup = (stage: (typeof LONG_WORKSPACE_STAGES)[number]) => {
    const stageExpanded = isExpanded(stage.id, activeRootId === stage.id)
    return (
      <li key={stage.id} className="workspace-tree-stage-item">
        {renderRootRow(stage)}
        {stageExpanded ? (
          <ul className="workspace-tree-stage-children workspace-tree-stage-children--nested">
            {draftTree.map((volume) => {
              const volumeExpanded = isExpanded(volume.id, activeRootId === 'draft')
              return (
                <li key={volume.id} className="workspace-tree-stage-child-node">
                  <div className="workspace-tree-stage-child-row">
                    <button
                      type="button"
                      className="workspace-tree-stage-child workspace-tree-stage-child--branch"
                      onClick={() => toggle(volume.id, activeRootId === 'draft')}
                    >
                      {volume.label}
                    </button>
                    <button
                      type="button"
                      className="workspace-tree-toggle workspace-tree-stage-toggle"
                      aria-expanded={volumeExpanded}
                      aria-label={volumeExpanded ? `收起${volume.label}` : `展开${volume.label}`}
                      onClick={() => toggle(volume.id, activeRootId === 'draft')}
                    >
                      <span className="workspace-tree-chevron" aria-hidden>
                        {volumeExpanded ? '▾' : '▸'}
                      </span>
                    </button>
                  </div>
                  {volumeExpanded ? (
                    <ul className="workspace-tree-stage-children workspace-tree-stage-children--nested">
                      {volume.arcs.map((arc) => {
                        const arcExpanded = isExpanded(arc.id, activeRootId === 'draft')
                        return (
                          <li key={arc.id} className="workspace-tree-stage-child-node">
                            <div className="workspace-tree-stage-child-row">
                              <button
                                type="button"
                                className="workspace-tree-stage-child workspace-tree-stage-child--branch"
                                onClick={() => toggle(arc.id, activeRootId === 'draft')}
                              >
                                {arc.label}
                              </button>
                              <button
                                type="button"
                                className="workspace-tree-toggle workspace-tree-stage-toggle"
                                aria-expanded={arcExpanded}
                                aria-label={arcExpanded ? `收起${arc.label}` : `展开${arc.label}`}
                                onClick={() => toggle(arc.id, activeRootId === 'draft')}
                              >
                                <span className="workspace-tree-chevron" aria-hidden>
                                  {arcExpanded ? '▾' : '▸'}
                                </span>
                              </button>
                            </div>
                            {arcExpanded ? (
                              <ul className="workspace-tree-stage-children workspace-tree-stage-children--nested">
                                {arc.chapters.map((chapter) => (
                                  <li key={chapter.id}>
                                    <button
                                      type="button"
                                      className={buttonClass(
                                        'workspace-tree-stage-child',
                                        activeStageId === chapter.id,
                                      )}
                                      onClick={() => onStageSelect(chapter.id)}
                                    >
                                      {chapter.label}
                                    </button>
                                  </li>
                                ))}
                                <li>
                                  <button
                                    type="button"
                                    className="workspace-tree-stage-child workspace-tree-stage-child--create"
                                    onClick={() =>
                                      onCreateDraftChapter(
                                        volume.volumeNumber,
                                        arc.arcNumber,
                                      )
                                    }
                                  >
                                    新建章节
                                  </button>
                                </li>
                              </ul>
                            ) : null}
                          </li>
                        )
                      })}
                      <li>
                        <button
                          type="button"
                          className="workspace-tree-stage-child workspace-tree-stage-child--create"
                          onClick={() => onCreateDraftArc(volume.volumeNumber)}
                        >
                          新建剧情弧线
                        </button>
                      </li>
                    </ul>
                  ) : null}
                </li>
              )
            })}
            <li>
              <button
                type="button"
                className="workspace-tree-stage-child workspace-tree-stage-child--create"
                onClick={onCreateDraftVolume}
              >
                新建卷
              </button>
            </li>
          </ul>
        ) : null}
      </li>
    )
  }

  return (
    <nav className="workspace-tree workspace-tree--long" aria-label="长篇项目结构">
      <div className="workspace-tree-root">
        <button
          type="button"
          className="workspace-tree-toggle"
          aria-expanded={rootExpanded}
          aria-label={rootExpanded ? '收起阶段列表' : '展开阶段列表'}
          onClick={() => setRootExpanded((v) => !v)}
        >
          <span className="workspace-tree-chevron" aria-hidden>
            {rootExpanded ? '▾' : '▸'}
          </span>
        </button>
        {editingTitle ? (
          <div className="workspace-tree-title-editor">
            {titleInputControls}
            <input
              className="workspace-tree-title-input"
              value={titleDraft}
              onChange={(e) => onTitleDraftChange?.(e.target.value)}
              onBlur={() => onTitleEditEnd?.()}
              onKeyDown={(e) => {
                onTitleInputKeyDown?.(e)
                if (e.defaultPrevented) return
                if (e.key === 'Enter') {
                  e.currentTarget.blur()
                } else if (e.key === 'Escape') {
                  onTitleEditCancel?.()
                }
              }}
              autoFocus
            />
          </div>
        ) : (
          <button
            type="button"
            className="workspace-tree-book"
            title="双击编辑名称"
            onDoubleClick={() => onTitleEditStart?.()}
          >
            {rootLabel || '未命名'}
          </button>
        )}
      </div>
      {rootExpanded ? (
        <ul className="workspace-tree-stages">
          {LONG_WORKSPACE_STAGES.map((stage) =>
            stage.id === 'draft'
              ? renderDraftGroup(stage)
              : renderStaticGroup(stage, STATIC_CHILDREN[stage.id]),
          )}
        </ul>
      ) : null}
    </nav>
  )
}
