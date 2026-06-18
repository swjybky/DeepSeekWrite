import {
  CoverGenerateDialog,
  CoverViewerDialog,
} from './CoverDialogs'
import type { TextHistoryController } from '../../hooks/useTextHistory'

type WorkspaceCoverDialogsProps = {
  coverData: string | null
  coverDialogOpen: boolean
  coverGenerating: boolean
  coverPromptDraft: string
  coverViewerOpen: boolean
  setCoverDialogOpen: (open: boolean) => void
  setCoverPromptDraft: (prompt: string) => void
  setCoverViewerOpen: (open: boolean) => void
  confirmCoverGeneration: () => void
  textHistory: TextHistoryController
  historyKey: string
}

export function WorkspaceCoverDialogs({
  coverData,
  coverDialogOpen,
  coverGenerating,
  coverPromptDraft,
  coverViewerOpen,
  setCoverDialogOpen,
  setCoverPromptDraft,
  setCoverViewerOpen,
  confirmCoverGeneration,
  textHistory,
  historyKey,
}: WorkspaceCoverDialogsProps) {
  return (
    <>
      {coverDialogOpen ? (
        <CoverGenerateDialog
          promptDraft={coverPromptDraft}
          generating={coverGenerating}
          onPromptChange={setCoverPromptDraft}
          onClose={() => setCoverDialogOpen(false)}
          onConfirm={confirmCoverGeneration}
          textHistory={textHistory}
          historyKey={historyKey}
        />
      ) : null}

      {coverViewerOpen && coverData ? (
        <CoverViewerDialog
          coverData={coverData}
          onClose={() => setCoverViewerOpen(false)}
        />
      ) : null}
    </>
  )
}
