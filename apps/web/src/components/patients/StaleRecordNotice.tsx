import { Button } from '@/components/ui/button'

// Someone else saved the record after this form loaded it (a 409, isStaleEdit
// in lib/staleEdit.ts). What was typed stays until the user chooses to reload,
// which replaces it with the version just saved.

interface StaleRecordNoticeProps {
  message: string
  reloading: boolean
  onReload: () => void
}

export default function StaleRecordNotice({ message, reloading, onReload }: StaleRecordNoticeProps) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <p>{message} Al recargar se pierde lo que escribiste acá.</p>
      <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={reloading} onClick={onReload}>
        Recargar
      </Button>
    </div>
  )
}
