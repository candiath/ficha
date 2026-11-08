import { useRef, useState } from 'react'
import type { RevisionReason } from '@ficha/shared'
import type { RevisionReasonFieldProps } from '@/components/patients/RevisionReasonField'

// The state of one "Motivo del cambio" field. It starts unchosen: a preselected
// reason would be saved by whoever never looked at the field. A form calls
// `require()` when it saves a correction: it returns the chosen reason, or null
// after marking the field and moving the focus to it.
export function useRevisionReason() {
  const [reason, setReason] = useState<RevisionReason | null>(null)
  const [note, setNote] = useState('')
  const [missing, setMissing] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const fieldProps: RevisionReasonFieldProps = {
    reason,
    note,
    missing,
    triggerRef,
    onReasonChange: (value) => {
      setReason(value)
      setMissing(false)
    },
    onNoteChange: setNote,
  }

  return {
    reason,
    note,
    require(): RevisionReason | null {
      if (reason) return reason
      setMissing(true)
      triggerRef.current?.focus()
      return null
    },
    reset() {
      setReason(null)
      setNote('')
      setMissing(false)
    },
    fieldProps,
  }
}
