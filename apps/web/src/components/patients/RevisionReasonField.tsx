import { useId, type RefObject } from 'react'
import { AUDIT_REVISION_REASONS, type RevisionReason } from '@ficha/shared'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

// Why a clinical record is being corrected (SPEC-clinical-revisions.md §4). The
// reason is required and starts unchosen (its state: `useRevisionReason`); the
// note is optional and goes only into the record's history.

const REASONS = Object.entries(AUDIT_REVISION_REASONS).map(([value, label]) => ({
  value: value as RevisionReason,
  label: label.charAt(0).toUpperCase() + label.slice(1),
}))

export const MISSING_REASON = 'Elegí el motivo del cambio'

export interface RevisionReasonFieldProps {
  reason: RevisionReason | null
  note: string
  // Saving was tried with no reason chosen.
  missing: boolean
  triggerRef: RefObject<HTMLButtonElement | null>
  onReasonChange: (reason: RevisionReason) => void
  onNoteChange: (note: string) => void
  // An annulment names its own act ("Motivo de la anulación").
  label?: string
  noteLabel?: string
}

export default function RevisionReasonField({
  reason,
  note,
  missing,
  triggerRef,
  onReasonChange,
  onNoteChange,
  label = 'Motivo del cambio',
  noteLabel = 'Nota del cambio (opcional)',
}: RevisionReasonFieldProps) {
  // Several forms of one record can be on the page at once.
  const id = useId()
  return (
    <div className="grid gap-3 sm:grid-cols-[16rem_1fr]">
      <div className="space-y-1.5">
        <Label id={`${id}-reason`}>{label}</Label>
        <Select
          items={REASONS}
          value={reason}
          onValueChange={(value) => value !== null && onReasonChange(value)}
        >
          <SelectTrigger
            ref={triggerRef}
            className="w-full"
            aria-labelledby={`${id}-reason`}
            aria-invalid={missing || undefined}
            aria-describedby={missing ? `${id}-missing` : undefined}
          >
            <SelectValue placeholder="Elegí un motivo" />
          </SelectTrigger>
          <SelectContent>
            {REASONS.map(({ value, label }) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {missing && (
          <p id={`${id}-missing`} className="text-xs text-destructive">
            {MISSING_REASON}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-note`}>{noteLabel}</Label>
        <Textarea
          id={`${id}-note`}
          rows={1}
          maxLength={500}
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
        />
      </div>
    </div>
  )
}
