import { useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import {
  LONG_CHARACTER_STAGES,
  LONG_CONTINUITY_STAGES,
  LONG_PLOT_STAGES,
  LONG_WORKSPACE_STAGES,
  longRootStageIdForStage,
  type LongRootStageId,
  type LongStageId,
} from './stages'
import {
  longWorldbuildingStageId,
  orderedLongArcs,
  orderedLongChapterCards,
  orderedLongVolumes,
  type LongWorkspace,
} from './longWorkspace'

type Props = {
  rootLabel: string
  workspace: LongWorkspace
  activeStageId: LongStageId
  onStageSelect: (stageId: LongStageId) => void
  editingTitle?: boolean
  titleDraft?: string
  onTitleDraftChange?: (value: string) => void
  onTitleEditStart?: () => void
  onTitleEditEnd?: () => void
  onTitleEditCancel?: () => void
  titleInputControls?: ReactNode
  onTitleInputKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
}

function activeClass(base: string, active: boolean) {
  return active ? `${base} ${base}--active` : base
}

export function LongWorkspaceTree({
  rootLabel,
  workspace,
  activeStageId,
  onStageSelect,
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
  const [rootExpanded, setRootExpanded] = useState(true)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const isExpanded = (id: string, fallback = true) => expanded[id] ?? fallback
  const toggle = (id: string, fallback = true) => {
    setExpanded((current) => ({ ...current, [id]: !(current[id] ?? fallback) }))
  }

  const childrenForRoot = (rootId: Exclude<LongRootStageId, 'draft'>) => {
    if (rootId === 'worldbuilding') {
      return workspace.worldbuilding.categories.map((category) => ({
        id: longWorldbuildingStageId(category.id),
        label: category.name || '未命名分类',
      }))
    }
    if (rootId === 'character_design') return LONG_CHARACTER_STAGES
    if (rootId === 'plot_design') return LONG_PLOT_STAGES
    return LONG_CONTINUITY_STAGES
  }

  const rootRow = (stage: (typeof LONG_WORKSPACE_STAGES)[number]) => {
    const open = isExpanded(stage.id, activeRootId === stage.id)
    return (
      <div className="workspace-tree-stage-row">
        <button
          type="button"
          className={activeClass('workspace-tree-stage workspace-tree-stage--branch', activeRootId === stage.id)}
          aria-expanded={open}
          onClick={() => {
            if (stage.id === 'draft') {
              onStageSelect('draft')
              if (!open) toggle(stage.id, activeRootId === stage.id)
              return
            }
            toggle(stage.id, activeRootId === stage.id)
          }}
        >
          <span className="workspace-tree-stage-dot" aria-hidden />
          {stage.label}
        </button>
        <button
          type="button"
          className="workspace-tree-toggle workspace-tree-stage-toggle"
          aria-expanded={open}
          aria-label={open ? `收起${stage.label}` : `展开${stage.label}`}
          onClick={() => toggle(stage.id, activeRootId === stage.id)}
        >
          <span className="workspace-tree-chevron" aria-hidden>{open ? '▾' : '▸'}</span>
        </button>
      </div>
    )
  }

  const staticGroup = (stage: Exclude<(typeof LONG_WORKSPACE_STAGES)[number], { id: 'draft' }>) => {
    const open = isExpanded(stage.id, activeRootId === stage.id)
    const children = childrenForRoot(stage.id)
    return (
      <li key={stage.id} className="workspace-tree-stage-item">
        {rootRow(stage)}
        {open ? (
          <ul className="workspace-tree-stage-children">
            {children.map((child) => (
              <li key={child.id}>
                <button
                  type="button"
                  className={activeClass('workspace-tree-stage-child', activeStageId === child.id)}
                  onClick={() => onStageSelect(child.id)}
                  title={child.label}
                >
                  {child.label}
                </button>
              </li>
            ))}
            {children.length === 0 ? <li className="workspace-tree-empty muted">暂无分类</li> : null}
          </ul>
        ) : null}
      </li>
    )
  }

  const draftStage = LONG_WORKSPACE_STAGES.find((stage) => stage.id === 'draft')!
  const renderDraft = () => {
    const open = isExpanded('draft', activeRootId === 'draft')
    const volumes = orderedLongVolumes(workspace)
    return (
      <li key="draft" className="workspace-tree-stage-item">
        {rootRow(draftStage)}
        {open ? (
          <ul className="workspace-tree-stage-children workspace-tree-stage-children--nested">
            {volumes.map((volume) => {
              const volumeOpen = isExpanded(`draft:${volume.id}`, activeRootId === 'draft')
              return (
                <li key={volume.id} className="workspace-tree-stage-child-node">
                  <div className="workspace-tree-stage-child-row">
                    <button type="button" className="workspace-tree-stage-child workspace-tree-stage-child--branch" onClick={() => toggle(`draft:${volume.id}`, activeRootId === 'draft')}>
                      {volume.name}
                    </button>
                    <button type="button" className="workspace-tree-toggle workspace-tree-stage-toggle" aria-expanded={volumeOpen} onClick={() => toggle(`draft:${volume.id}`, activeRootId === 'draft')}>
                      <span className="workspace-tree-chevron" aria-hidden>{volumeOpen ? '▾' : '▸'}</span>
                    </button>
                  </div>
                  {volumeOpen ? (
                    <ul className="workspace-tree-stage-children workspace-tree-stage-children--nested">
                      {orderedLongArcs(workspace, volume.id).map((arc) => {
                        const arcOpen = isExpanded(`draft:${arc.id}`, activeRootId === 'draft')
                        return (
                          <li key={arc.id} className="workspace-tree-stage-child-node">
                            <div className="workspace-tree-stage-child-row">
                              <button type="button" className="workspace-tree-stage-child workspace-tree-stage-child--branch" onClick={() => toggle(`draft:${arc.id}`, activeRootId === 'draft')}>
                                {arc.name}
                              </button>
                              <button type="button" className="workspace-tree-toggle workspace-tree-stage-toggle" aria-expanded={arcOpen} onClick={() => toggle(`draft:${arc.id}`, activeRootId === 'draft')}>
                                <span className="workspace-tree-chevron" aria-hidden>{arcOpen ? '▾' : '▸'}</span>
                              </button>
                            </div>
                            {arcOpen ? (
                              <ul className="workspace-tree-stage-children workspace-tree-stage-children--nested">
                                {orderedLongChapterCards(workspace, arc.id).map((card) => {
                                  const committed = workspace.chapters[card.stage_id]?.committed
                                  return (
                                    <li key={card.id}>
                                      <button
                                        type="button"
                                        className={activeClass('workspace-tree-stage-child long-draft-tree-chapter', activeStageId === card.stage_id)}
                                        onClick={() => onStageSelect(card.stage_id)}
                                      >
                                        <span>{card.title}</span>
                                        {committed ? <span className="long-draft-tree-status">已落盘</span> : null}
                                      </button>
                                    </li>
                                  )
                                })}
                              </ul>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  ) : null}
                </li>
              )
            })}
            {volumes.length === 0 ? <li className="workspace-tree-empty muted">请先在剧情阶段创建分卷和章卡</li> : null}
          </ul>
        ) : null}
      </li>
    )
  }

  return (
    <nav className="workspace-tree workspace-tree--long" aria-label="长篇项目结构">
      <div className="workspace-tree-root">
        <button type="button" className="workspace-tree-toggle" aria-expanded={rootExpanded} onClick={() => setRootExpanded((value) => !value)}>
          <span className="workspace-tree-chevron" aria-hidden>{rootExpanded ? '▾' : '▸'}</span>
        </button>
        {editingTitle ? (
          <div className="workspace-tree-title-editor">
            {titleInputControls}
            <input
              className="workspace-tree-title-input"
              value={titleDraft}
              onChange={(event) => onTitleDraftChange?.(event.target.value)}
              onBlur={() => onTitleEditEnd?.()}
              onKeyDown={(event) => {
                onTitleInputKeyDown?.(event)
                if (event.defaultPrevented) return
                if (event.key === 'Enter') event.currentTarget.blur()
                else if (event.key === 'Escape') onTitleEditCancel?.()
              }}
              autoFocus
            />
          </div>
        ) : (
          <button type="button" className="workspace-tree-book" title="双击编辑名称" onDoubleClick={() => onTitleEditStart?.()}>{rootLabel || '未命名'}</button>
        )}
      </div>
      {rootExpanded ? (
        <ul className="workspace-tree-stages">
          {LONG_WORKSPACE_STAGES.map((stage) => stage.id === 'draft' ? renderDraft() : staticGroup(stage as Exclude<typeof stage, { id: 'draft' }>))}
        </ul>
      ) : null}
    </nav>
  )
}
