import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { MATERIAL_STAGE_LABELS } from '../bridge'
import { SHORT_WORKSPACE_STAGES } from '../workspaces/short/stages'
import {
  ALL_MATERIAL_STAGE_IDS,
  type ConfigurableReadStageId,
  type StageReadAccessConfig,
  type StageReadAccessEntry,
  isStageReadAccessCustomized,
  resolveReadAccessForStage,
} from '../workspaces/short/stageReadAccess'
import type { MaterialStageId } from '../bridge'
import type { ShortStageId } from '../workspaces/short/stages'

type PopoverKind = 'workspace' | 'material' | null

const iconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

/** 创作阶段可读范围：递进线条示意流水线阶段 */
function WorkspaceStagesIcon() {
  return (
    <svg {...iconProps} aria-hidden>
      <path d="M4 6h14M4 12h10M4 18h6" />
    </svg>
  )
}

/** 素材阶段可读范围：与书架「素材库」卡片同款归档图标 */
function MaterialStagesIcon() {
  return (
    <svg {...iconProps} aria-hidden>
      <path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  )
}

type Props = {
  stageId: ConfigurableReadStageId
  config: StageReadAccessConfig
  onChange: (next: StageReadAccessConfig) => void
}

function usePopoverPosition(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
) {
  const [pos, setPos] = useState({ top: 0, left: 0 })
  useEffect(() => {
    if (!open || !anchorRef.current) return
    const update = () => {
      const rect = anchorRef.current!.getBoundingClientRect()
      const width = 220
      let left = rect.right + 8
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, rect.left - width - 8)
      }
      setPos({ top: rect.top, left })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [anchorRef, open])
  return pos
}

export function StageReadAccessPicker({ stageId, config, onChange }: Props) {
  const [openKind, setOpenKind] = useState<PopoverKind>(null)
  const workspaceBtnRef = useRef<HTMLButtonElement>(null)
  const materialBtnRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const entry = resolveReadAccessForStage(config, stageId) as StageReadAccessEntry
  const customized = isStageReadAccessCustomized(config, stageId)
  const anchorRef = openKind === 'material' ? materialBtnRef : workspaceBtnRef
  const pos = usePopoverPosition(anchorRef, openKind !== null)

  const patchEntry = useCallback(
    (patch: Partial<StageReadAccessEntry>) => {
      const current = resolveReadAccessForStage(config, stageId) as StageReadAccessEntry
      onChange({
        ...config,
        [stageId]: { ...current, ...patch },
      })
    },
    [config, onChange, stageId],
  )

  const toggleWorkspace = (id: ShortStageId) => {
    const set = new Set(entry.workspace)
    if (set.has(id)) set.delete(id)
    else set.add(id)
    patchEntry({ workspace: [...set] })
  }

  const toggleMaterial = (id: MaterialStageId) => {
    const set = new Set(entry.material)
    if (set.has(id)) set.delete(id)
    else set.add(id)
    patchEntry({ material: [...set] })
  }

  useEffect(() => {
    if (!openKind) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (
        popoverRef.current?.contains(t) ||
        workspaceBtnRef.current?.contains(t) ||
        materialBtnRef.current?.contains(t)
      ) {
        return
      }
      setOpenKind(null)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [openKind])

  const popover =
    openKind !== null
      ? createPortal(
          <div
            ref={popoverRef}
            className="stage-read-access-popover"
            role="dialog"
            aria-labelledby={listId}
            style={{ top: pos.top, left: pos.left }}
          >
            <p className="stage-read-access-popover-title" id={listId}>
              {openKind === 'workspace'
                ? '可读取的创作阶段'
                : '可读取的素材阶段'}
            </p>
            <ul className="stage-read-access-popover-list">
              {openKind === 'workspace'
                ? SHORT_WORKSPACE_STAGES.map((s) => (
                    <li key={s.id}>
                      <label className="stage-read-access-option">
                        <input
                          type="checkbox"
                          checked={entry.workspace.includes(s.id)}
                          onChange={() => toggleWorkspace(s.id)}
                        />
                        <span>{s.label}</span>
                      </label>
                    </li>
                  ))
                : ALL_MATERIAL_STAGE_IDS.map((id) => (
                    <li key={id}>
                      <label className="stage-read-access-option">
                        <input
                          type="checkbox"
                          checked={entry.material.includes(id)}
                          onChange={() => toggleMaterial(id)}
                        />
                        <span>{MATERIAL_STAGE_LABELS[id]}</span>
                      </label>
                    </li>
                  ))}
            </ul>
          </div>,
          document.body,
        )
      : null

  return (
    <div
      className={
        customized
          ? 'stage-read-access-picker stage-read-access-picker--customized'
          : 'stage-read-access-picker'
      }
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        ref={workspaceBtnRef}
        type="button"
        className={
          openKind === 'workspace'
            ? 'stage-read-access-btn stage-read-access-btn--active'
            : 'stage-read-access-btn'
        }
        aria-label="配置可读取的创作阶段"
        title={`配置可读取的创作阶段（已选 ${entry.workspace.length} 项）`}
        aria-expanded={openKind === 'workspace'}
        onClick={() =>
          setOpenKind((k) => (k === 'workspace' ? null : 'workspace'))
        }
      >
        <span className="stage-read-access-btn-icon">
          <WorkspaceStagesIcon />
        </span>
      </button>
      <button
        ref={materialBtnRef}
        type="button"
        className={
          openKind === 'material'
            ? 'stage-read-access-btn stage-read-access-btn--active'
            : 'stage-read-access-btn'
        }
        aria-label="配置可读取的素材阶段"
        title={`配置可读取的素材阶段（已选 ${entry.material.length} 项）`}
        aria-expanded={openKind === 'material'}
        onClick={() =>
          setOpenKind((k) => (k === 'material' ? null : 'material'))
        }
      >
        <span className="stage-read-access-btn-icon">
          <MaterialStagesIcon />
        </span>
      </button>
      {popover}
    </div>
  )
}
