import type { ReactNode } from 'react'
import type { RevisionReason } from '@ficha/shared'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import RevisionReasonField from '@/components/patients/RevisionReasonField'
import { useRevisionReason } from '@/hooks/useRevisionReason'

// Annulling a clinical entry entered by mistake (SPEC-clinical-revisions.md §8):
// it is never deleted. The entry stays in the record struck through, its
// content in its history. Like every correction it says why, with no reason
// preselected: confirming without one marks the field and moves the focus to it.
export default function AnnulDialog({
  open,
  onOpenChange,
  title,
  description,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  pending: boolean
  onConfirm: (reason: RevisionReason, reasonNote: string) => void
}) {
  const revision = useRevisionReason()

  function handleOpenChange(next: boolean) {
    // A cancelled annulment leaves nothing chosen for the next one.
    if (!next) revision.reset()
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <RevisionReasonField
          {...revision.fieldProps}
          label="Motivo de la anulación"
          noteLabel="Nota (opcional)"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => {
              const reason = revision.require()
              if (reason) onConfirm(reason, revision.note)
            }}
          >
            {pending ? 'Anulando...' : 'Anular'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
