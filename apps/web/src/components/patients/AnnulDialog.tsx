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
interface AnnulDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  pending: boolean
  onConfirm: (reason: RevisionReason, reasonNote: string) => void
}

export default function AnnulDialog({ open, onOpenChange, ...content }: AnnulDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* The reason lives in the content, which unmounts when the dialog
            closes, however it closes (cancelled, or closed by the parent after
            an annulment): every annulment starts with nothing chosen. */}
        <AnnulForm {...content} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function AnnulForm({
  title,
  description,
  pending,
  onConfirm,
  onCancel,
}: Omit<AnnulDialogProps, 'open' | 'onOpenChange'> & { onCancel: () => void }) {
  const revision = useRevisionReason()
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <RevisionReasonField
        {...revision.fieldProps}
        label="Motivo de la anulación"
        noteLabel="Nota (opcional)"
        missingMessage="Elegí el motivo de la anulación"
      />
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
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
    </>
  )
}
