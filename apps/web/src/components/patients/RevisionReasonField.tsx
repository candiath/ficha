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
  return (
    <div className="grid gap-3 sm:grid-cols-[16rem_1fr]">
      <div className="space-y-1.5">
        <Label id="revision-reason-label">Motivo del cambio</Label>
        <Select
          items={REASONS}
          value={reason}
          onValueChange={(value) => value !== null && onReasonChange(value)}
        >
          <SelectTrigger className="w-full" aria-labelledby="revision-reason-label">
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
        <Label htmlFor="revision-reason-note">Nota del cambio (opcional)</Label>
        <Textarea
          id="revision-reason-note"
          rows={1}
          maxLength={500}
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
        />
      </div>
    </div>
  )
}
