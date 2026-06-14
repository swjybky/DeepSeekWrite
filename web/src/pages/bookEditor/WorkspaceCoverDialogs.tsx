import {
  CoverGenerateDialog,
  CoverViewerDialog,
} from './CoverDialogs'

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
