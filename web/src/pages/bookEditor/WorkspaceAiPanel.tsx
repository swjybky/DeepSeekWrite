import { useId, type MutableRefObject } from 'react'
import type {
  Book,
  ExpertDraft,
  MemoryEntry,
  Material,
  MaterialKind,
  StageId,
  WorkspaceAgentReadAccessConfig,
} from '../../domain/workspace'
import { WorkspaceAiChat } from '../../components/WorkspaceAiChat'
import {
  WorkspaceLayoutControls,
  type WorkspaceLayoutCollapsed,
} from '../../components/WorkspaceLayoutControls'
import type { ApplyToStageEditorPayload } from '../../pi/workspaceStageAgents'
import {
  ExpertDraftAiChat as ShortExpertDraftAiChat,
} from '../../workspaces/short/expertDraft/ExpertDraftAiChat'
import {
  ExpertDraftAiChat as ScriptExpertDraftAiChat,
} from '../../workspaces/script/expertDraft/ExpertDraftAiChat'
import type {
  ExpertDraftSectionContentField,
  GetExpertDraftSectionContent,
  RunExpertDraftSectionWriterOptions,
} from '../../workspaces/short/expertDraft/sectionWriter'
import {
  EXPERT_DRAFT_COORDINATOR_AGENT_ID,
  EXPERT_SECTION_WRITER_AGENT_ID,
} from '../../workspaces/short/stageReadAccess'
import {
  longContentStageRowsFromStages,
  longRootStageIdForStage,
  longStageLabel,
} from '../../workspaces/long/stages'
import { PLOT_STAGE_ID } from '../../workspaces/short/stages'
import type { BookWorkspaceSessionState } from '../../stores/workspaceStore'
import { resolveLiveWorkspaceStageBody } from './liveStageBody'
import {
  resolveWorkspaceBookGenre,
  resolveWorkspaceStagesForBook,
} from '../../domain/workspace'
import {
  isPlotChildStageId,
  plotChildStagesForBook,
  resolveReadAccessForBook,
} from './stageEditing'
import { WORKSPACE_AI_INCLUDE_PI_ARTIFACTS } from './workspaceTypes'
import type { PlotChildStageId } from './workspaceTypes'

type StartExpertWriting = (
  bookId: string,
  sectionIds: string[],
  options?: {
    userWritingPrompt?: string
    bookMemories?: MemoryEntry[]
    userMemories?: MemoryEntry[]
    model?: RunExpertDraftSectionWriterOptions['model']
    thinkingLevel?: RunExpertDraftSectionWriterOptions['thinkingLevel']
    callbacks?: Pick<
      RunExpertDraftSectionWriterOptions,
      'onSectionAgentStart' | 'onRunFinish'
    >
  },
) => boolean

function workspaceAgentTitle(
  bookType: Book['book_type'],
  activeStage: StageId,
  activeExpertDraftSectionId: string,
): string {
  if (activeExpertDraftSectionId) return '小节智能体'
  if (bookType === 'long') {
    const rootStage = longRootStageIdForStage(activeStage)
    if (rootStage === 'worldbuilding') return '世界观智能体'
    if (rootStage === 'character_design') return '人物智能体'
    if (rootStage === 'plot_design') return '剧情总控智能体'
    if (rootStage === 'draft') return '正文智能体'
    if (rootStage === 'continuity_ledger') return '状态账本智能体'
  }
  if (activeStage === 'character_design') return '人物智能体'
  if (
    activeStage === 'plot_design' ||
    activeStage === 'intro_design' ||
    activeStage === 'plot_refine'
  ) {
    return '剧情智能体'
  }
  if (activeStage === 'outline') return '大纲智能体'
  if (activeStage === 'draft') return '正文智能体'
  return '智能体'
}

function workspaceAgentTip(
  bookType: Book['book_type'],
  activeStage: StageId,
  activeExpertDraftSectionId: string,
  activePlotChildLabel: string,
): string {
  if (activeExpertDraftSectionId) {
    return '输入“帮我开始xx小节编写，要求如下：xxxx”'
  }
  if (bookType === 'long') {
    const rootStage = longRootStageIdForStage(activeStage)
    if (rootStage === 'worldbuilding') return '输入“帮我细化当前世界观节点”开始'
    if (rootStage === 'character_design') return '输入“帮我维护当前人物分组”开始'
    if (rootStage === 'plot_design') return '输入“帮我规划当前剧情节点”开始'
    if (rootStage === 'draft') return '输入“根据当前章卡写这一章”开始'
    if (rootStage === 'continuity_ledger') return '输入“帮我整理本章状态变化”开始'
  }
  if (activeStage === 'character_design') {
    return '输入“帮我设计xxx的人物设计”开始'
  }
  if (
    activeStage === 'plot_design' ||
    activeStage === 'intro_design' ||
    activeStage === 'plot_refine'
  ) {
    return `输入“帮我设计xxx的${activePlotChildLabel || '剧情设计'}”开始`
  }
  if (activeStage === 'outline') {
    return '输入“帮我整理大纲”开始'
  }
  if (activeStage === 'draft') {
    return '输入“帮我直接开始编写正文”开始自动小节内容编写'
  }
  return ''
}

type Props = {
  book: Book
  railStages: readonly { id: StageId; label: string }[]
  activeStage: StageId
  activePlotChildLabel: string
  expertDraftActive: boolean
  activeExpertDraftSectionId: string
  expertDraft: ExpertDraft
  renderedWorkspaceSessions: BookWorkspaceSessionState[]
  userMemories: MemoryEntry[]
  workspaceAgentReadAccess: WorkspaceAgentReadAccessConfig
  linkedMaterialTitle?: string
  linkedMaterialsByKind: Partial<Record<MaterialKind, Material[]>>
  linkedSkillTitle?: string
  workspaceSessionsRef: MutableRefObject<Record<string, BookWorkspaceSessionState>>
  getRenderedWorkspaceStageBody: (stageId: StageId) => string | undefined
  applyToStageEditorForBook: (
    bookId: string,
    stage: StageId,
    payload: ApplyToStageEditorPayload,
  ) => void
  selectPlotChildForBook: (bookId: string, childId: PlotChildStageId) => void
  saveBookSession: (bookId: string) => Promise<Book | null>
  updateExpertDraftForBook: (
    bookId: string,
    updater: (current: ExpertDraft) => ExpertDraft,
  ) => void
  startExpertWritingForBook: StartExpertWriting
  getRenderedExpertDraftSectionContent: GetExpertDraftSectionContent
  syncExpertDraftSectionField?: (
    sectionId: string,
    field: ExpertDraftSectionContentField,
    body: string,
  ) => void
  onBookMemoriesCaptured?: (
    bookId: string,
    memories: MemoryEntry[],
  ) => void | Promise<void>
  onExpertDraftStageBodyChange: (body: string) => void
  bumpActiveExpertChatEpoch: () => void
  bumpActiveStageChatEpoch: (stageId: StageId) => void
  editorCollapsed?: boolean
  layoutCollapsed: WorkspaceLayoutCollapsed
  onToggleLeftPanel: () => void
  onToggleTopPanel: () => void
  onToggleRightPanel: () => void
}

export function WorkspaceAiPanel({
  book,
  railStages,
  activeStage,
  activePlotChildLabel,
  expertDraftActive,
  activeExpertDraftSectionId,
  expertDraft,
  renderedWorkspaceSessions,
  userMemories,
  workspaceAgentReadAccess,
  linkedMaterialTitle,
  linkedMaterialsByKind,
  linkedSkillTitle,
  workspaceSessionsRef,
  getRenderedWorkspaceStageBody,
  applyToStageEditorForBook,
  selectPlotChildForBook,
  saveBookSession,
  updateExpertDraftForBook,
  startExpertWritingForBook,
  getRenderedExpertDraftSectionContent,
  syncExpertDraftSectionField,
  onBookMemoriesCaptured,
  onExpertDraftStageBodyChange,
  bumpActiveExpertChatEpoch,
  bumpActiveStageChatEpoch,
  editorCollapsed = false,
  layoutCollapsed,
  onToggleLeftPanel,
  onToggleTopPanel,
  onToggleRightPanel,
}: Props) {
  const historyPortalTargetId = useId()
  const activeExpertSectionForHeader = expertDraftActive
    ? activeExpertDraftSectionId
    : ''
  const activeAgentTitle = workspaceAgentTitle(
    book.book_type,
    activeStage,
    activeExpertSectionForHeader,
  )
  const activeAgentTip = workspaceAgentTip(
    book.book_type,
    activeStage,
    activeExpertSectionForHeader,
    activePlotChildLabel,
  )
  const linkedMaterialCount = Object.values(linkedMaterialsByKind).reduce(
    (sum, items) => sum + (items?.length ?? 0),
    0,
  )

  return (
    <aside className="workspace-ai workspace-ai--center" aria-label="AI 对话">
      <div className="workspace-ai-header workspace-ai-header-row">
        <div className="workspace-ai-header-title-line">
          <span className="workspace-ai-header-title">{activeAgentTitle}</span>
          {activeAgentTip ? (
            <span className="workspace-ai-title-tip" title={activeAgentTip}>
              {activeAgentTip}
            </span>
          ) : null}
        </div>
        <div className="workspace-ai-header-actions">
          <div
            id={historyPortalTargetId}
            className="workspace-ai-header-history-slot"
          />
          <button
            type="button"
            className="workspace-ai-new-chat"
            aria-label={
              expertDraftActive
                ? activeExpertSectionForHeader
                  ? '清空当前小节分节写手对话并开始新会话'
                  : '清空专家总控智能体对话并开始新会话'
                : '清空当前阶段 AI 对话并开始新会话'
            }
            title={
              expertDraftActive
                ? activeExpertSectionForHeader
                  ? '仅清空当前小节的分节写手会话，其它小节各自保留独立历史'
                  : '仅清空专家总控智能体上下文，不影响后台分节写作任务'
                : '仅影响当前左侧阶段对应的助手会话，其他阶段各有一份独立历史'
            }
            disabled={expertDraftActive && expertDraft.running}
            onClick={() => {
              if (expertDraftActive) {
                bumpActiveExpertChatEpoch()
                return
              }
              bumpActiveStageChatEpoch(activeStage)
            }}
          >
            新建对话
          </button>
          {editorCollapsed ? (
            <WorkspaceLayoutControls
              collapsed={layoutCollapsed}
              onToggleLeft={onToggleLeftPanel}
              onToggleTop={onToggleTopPanel}
              onToggleRight={onToggleRightPanel}
              compact
            />
          ) : null}
        </div>
      </div>
      <div className="workspace-ai-hint muted">
        {railStages.find((s) => s.id === activeStage)?.label ??
          (book.book_type === 'long' ? longStageLabel(activeStage) : '')}
        {activePlotChildLabel ? ` · ${activePlotChildLabel}` : ''}
        {expertDraftActive
          ? activeExpertSectionForHeader
            ? ' · 分节写手'
            : ' · 专家总控'
          : ''}
        {' · '}
        {book.categories.join('、') || '未分类'}
        {linkedMaterialCount > 0
          ? ` · 素材：${linkedMaterialCount} 个`
          : linkedMaterialTitle
            ? ` · 素材：${linkedMaterialTitle}`
            : ''}
        {linkedSkillTitle ? ` · 技能：${linkedSkillTitle}` : ''}
      </div>
      <div className="workspace-ai-chat-stack">
        {renderedWorkspaceSessions.flatMap((session) => {
          const sessionBookGenre = resolveWorkspaceBookGenre(session.book)
          const sessionStages =
            session.book.book_type === 'long'
              ? longContentStageRowsFromStages(session.stages)
              : resolveWorkspaceStagesForBook(session.book)
          const supportsExpertDraft = session.book.book_type !== 'long'
          const sessionExpertActive =
            supportsExpertDraft && session.activeStage === 'draft'
          const isVisibleBook = session.book.id === book.id
          const SessionExpertDraftAiChat =
            session.book.book_type === 'script'
              ? ScriptExpertDraftAiChat
              : ShortExpertDraftAiChat
          const stageLayers = sessionStages
            .filter((s) => supportsExpertDraft ? s.id !== 'draft' : true)
            .map((s) => {
              const epoch = session.aiChatEpochByStage[s.id] ?? 0
              const activeContentStageForLayer =
                s.id === PLOT_STAGE_ID
                  ? session.activePlotChildStage || PLOT_STAGE_ID
                  : s.id
              const layerKey =
                epoch > 0
                  ? `${session.book.id}-shared-${s.id}-${epoch}`
                  : `${session.book.id}-shared-${s.id}`
              const isActive =
                isVisibleBook &&
                session.activeStage === s.id &&
                !sessionExpertActive
              return (
                <div
                  key={layerKey}
                  className={
                    isActive
                      ? 'workspace-ai-chat-layer workspace-ai-chat-layer--active'
                      : 'workspace-ai-chat-layer'
                  }
                  aria-hidden={!isActive}
                >
                  <WorkspaceAiChat
                    sessionBookId={session.book.id}
                    sessionEpoch={epoch}
                    bookType={session.book.book_type}
                    bookTitle={session.book.title}
                    bookGenre={sessionBookGenre}
                    stageId={s.id}
                    chatHistoryScope={{
                      owner_type: 'book',
                      owner_id: session.book.id,
                      category_id: s.id,
                    }}
                    historyPortalTargetId={historyPortalTargetId}
                    activeStageContentId={activeContentStageForLayer}
                    stageBody={session.stages[activeContentStageForLayer] ?? ''}
                    getCurrentStageBody={(stageId) => {
                      const sid = (stageId ?? activeContentStageForLayer) as StageId
                      return resolveLiveWorkspaceStageBody({
                        sessionBookId: session.book.id,
                        activeBookId: book.id,
                        stageId: sid,
                        fallbackStages: session.stages,
                        workspaceSessionsRef,
                        getRenderedWorkspaceStageBody,
                      })
                    }}
                    allStages={session.stages}
                    bookMemories={session.book.memories ?? []}
                    userMemories={userMemories}
                    bookMemoryAutoCaptureEnabled={
                      Boolean(session.book.memory_auto_capture_enabled)
                    }
                    linkedMaterial={session.linkedMaterial}
                    linkedMaterialsByKind={session.linkedMaterialsByKind}
                    linkedSkill={session.linkedSkill}
                    workspaceAgentReadAccess={workspaceAgentReadAccess}
                    includePiArtifacts={WORKSPACE_AI_INCLUDE_PI_ARTIFACTS}
                    applyToStageEditor={(payload) =>
                      applyToStageEditorForBook(session.book.id, s.id, payload)
                    }
                    selectPlotChildStage={(stageId) => {
                      if (!isPlotChildStageId(stageId)) return
                      const allowed = plotChildStagesForBook(session.book).some(
                        (child) => child.id === stageId,
                      )
                      if (!allowed) return
                      selectPlotChildForBook(session.book.id, stageId)
                    }}
                    onRequestSave={async () => {
                      await saveBookSession(session.book.id)
                    }}
                    onBookMemoriesCaptured={onBookMemoriesCaptured}
                    isPaused={!isActive}
                  />
                </div>
              )
            })

          if (!supportsExpertDraft) return stageLayers

          const expertLayerActive = isVisibleBook && sessionExpertActive
          const expertLayer = (
            <div
              key={`${session.book.id}-expert-draft-layer`}
              className={
                expertLayerActive
                  ? 'workspace-ai-chat-layer workspace-ai-chat-layer--active'
                  : 'workspace-ai-chat-layer'
              }
              aria-hidden={!expertLayerActive}
            >
              <SessionExpertDraftAiChat
                key={`${session.book.id}-shared-expert-draft-${session.expertAiChatEpoch}`}
                bookId={session.book.id}
                bookTitle={session.book.title}
                bookGenre={sessionBookGenre}
                sessionEpoch={session.expertAiChatEpoch}
                stages={session.stages}
                bookMemories={session.book.memories ?? []}
                userMemories={userMemories}
                bookMemoryAutoCaptureEnabled={
                  Boolean(session.book.memory_auto_capture_enabled)
                }
                linkedMaterial={session.linkedMaterial}
                linkedMaterialsByKind={session.linkedMaterialsByKind}
                linkedSkill={session.linkedSkill}
                readAccess={resolveReadAccessForBook(
                  session.book,
                  workspaceAgentReadAccess,
                  EXPERT_DRAFT_COORDINATOR_AGENT_ID,
                )}
                writerReadAccess={resolveReadAccessForBook(
                  session.book,
                  workspaceAgentReadAccess,
                  EXPERT_SECTION_WRITER_AGENT_ID,
                )}
                expertDraft={session.expertDraft}
                updateDraft={(updater) =>
                  updateExpertDraftForBook(session.book.id, updater)
                }
                startWriting={(sectionIds, options) =>
                  startExpertWritingForBook(
                    session.book.id,
                    sectionIds,
                    {
                      ...options,
                      bookMemories: session.book.memories ?? [],
                      userMemories,
                    },
                  )
                }
                getRenderedExpertDraftSectionContent={
                  isVisibleBook
                    ? getRenderedExpertDraftSectionContent
                    : undefined
                }
                syncExpertDraftSectionField={
                  isVisibleBook ? syncExpertDraftSectionField : undefined
                }
                getCurrentWorkspaceStageBody={(stageId) =>
                  resolveLiveWorkspaceStageBody({
                    sessionBookId: session.book.id,
                    activeBookId: book.id,
                    stageId,
                    fallbackStages: session.stages,
                    workspaceSessionsRef,
                    getRenderedWorkspaceStageBody,
                  })
                }
                getExpertDraftStageBody={() =>
                  resolveLiveWorkspaceStageBody({
                    sessionBookId: session.book.id,
                    activeBookId: book.id,
                    stageId: 'draft',
                    fallbackStages: session.stages,
                    workspaceSessionsRef,
                    getRenderedWorkspaceStageBody,
                  })
                }
                applyExpertDraftStageBody={(body) =>
                  onExpertDraftStageBodyChange(body)
                }
                historyPortalTargetId={historyPortalTargetId}
                isHistoryPortalActive={expertLayerActive}
                onBookMemoriesCaptured={onBookMemoriesCaptured}
              />
            </div>
          )
          return [...stageLayers, expertLayer]
        })}
      </div>
    </aside>
  )
}
