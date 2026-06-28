import type { BookStatus, StageId } from '../../domain/workspace'
import type { PlotChildStageId as ScriptPlotChildStageId } from '../../workspaces/script/stages'
import type { PlotChildStageId as ShortPlotChildStageId } from '../../workspaces/short/stages'

/** 空 stages 对象，用于非激活阶段的稳定引用，避免不必要的重渲染 */
export const EMPTY_STAGES: Record<StageId, string> = {} as Record<StageId, string>

export type SaveCurrentBookOptions = {
  status?: BookStatus
  memory_auto_capture_enabled?: boolean | null
  successMessage?: string | null
}

export type PlotChildStageId = ShortPlotChildStageId | ScriptPlotChildStageId
export type PlotChildStageDefinition = { id: PlotChildStageId; label: string }

export const WORKSPACE_LEAVE_CONFIRM_MESSAGE =
  '当前有未保存的修改，确定离开创作空间吗？未保存的内容将丢失。'

/** Pi ChatPanel 会注入 artifacts；false 则从 Agent 工具列表移除（对话流式优先）。改为 true 可恢复侧栏工件面板能力。 */
export const WORKSPACE_AI_INCLUDE_PI_ARTIFACTS = false
