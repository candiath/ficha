import { useId } from 'react'
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
// reason is required and "Error de confección" comes chosen; the note is optional
// and goes only into the record's history.
export const DEFAULT_REVISION_REASON: RevisionReason = 'DATA_ENTRY_ERROR'

const REASONS = Object.entries(AUDIT_REVISION_REASONS).map(([value, label]) => ({
  value: value as RevisionReason,
  label: label.charAt(0).toUpperCase() + label.slice(1),
}))

interface RevisionReasonFieldProps {
  reason: RevisionReason
  note: string
  onReasonChange: (reason: RevisionReason) => void
  onNoteChange: (note: string) => void
}

export default function RevisionReasonField({
  reason,
  note,
  onReasonChange,
  onNoteChange,
}: RevisionReasonFieldProps) {
  // Several forms of one record can be on the page at once.
  const id = useId()
  return (
    <div className="grid gap-3 sm:grid-cols-[16rem_1fr]">
      <div className="space-y-1.5">
        <Label id={`${id}-reason`}>Motivo del cambio</Label>
        <Select
          items={REASONS}
          value={reason}
          onValueChange={(value) => value !== null && onReasonChange(value)}
        >
          <SelectTrigger className="w-full" aria-labelledby={`${id}-reason`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REASONS.map(({ value, label }) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-note`}>Nota del cambio (opcional)</Label>
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
