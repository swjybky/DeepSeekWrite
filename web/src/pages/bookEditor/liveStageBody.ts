import type { MutableRefObject } from 'react'
import type { StageId } from '../../domain/workspace'
import type { BookWorkspaceSessionState } from '../../stores/workspaceStore'
import type { ExpertDraftSectionContentField } from '../../workspaces/shared/expertDraftSectionTools'

export type ExpertDraftSectionEditorSlot = {
  sectionId: string
  body: HTMLTextAreaElement | null
  state: HTMLTextAreaElement | null
}

/** 将小节正文/人物状态同步到已挂载的 textarea。 */
export function syncExpertDraftSectionTextarea(
  slotRef: MutableRefObject<ExpertDraftSectionEditorSlot>,
  sectionId: string,
  field: ExpertDraftSectionContentField,
  body: string,
): void {
  const slot = slotRef.current
  if (slot.sectionId !== sectionId) return
  const node = field === 'body' ? slot.body : slot.state
  if (!node?.isConnected) return
  node.value = body
}

/** 将阶段正文同步到已挂载的 textarea，避免受控组件重渲染前读取到旧 DOM 值。 */
export function syncWorkspaceStageTextarea(
  textareaRefsRef: MutableRefObject<
    Partial<Record<StageId, HTMLTextAreaElement | null>>
  >,
  stageId: StageId,
  body: string,
): void {
  const textarea = textareaRefsRef.current[stageId]
  if (!textarea || !textarea.isConnected) return
  textarea.value = body
}

/**
 * 解析阶段正文的实时来源：编辑框 DOM → 会话内存 → props 回退。
 * 与 AI 工具的 read / search / replace 共用，避免读写到不同快照。
 */
export function resolveLiveWorkspaceStageBody(input: {
  sessionBookId: string
  activeBookId: string
  stageId: StageId
  fallbackStages: Partial<Record<StageId, string>>
  workspaceSessionsRef: MutableRefObject<Record<string, BookWorkspaceSessionState>>
  getRenderedWorkspaceStageBody: (stageId: StageId) => string | undefined
}): string {
  if (input.sessionBookId === input.activeBookId) {
    const rendered = input.getRenderedWorkspaceStageBody(input.stageId)
    if (rendered !== undefined) return rendered
  }
  const cached =
    input.workspaceSessionsRef.current[input.sessionBookId]?.stages[input.stageId]
  if (cached !== undefined) return cached
  return input.fallbackStages[input.stageId] ?? ''
}
