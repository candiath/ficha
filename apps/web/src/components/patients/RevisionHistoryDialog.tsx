import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { History } from 'lucide-react'
import { auditActionLabel } from '@ficha/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  changedKeys,
  removedGroups,
  type SnapshotRenderContext,
  type SnapshotRenderer,
  type SnapshotRow,
} from '@/lib/revisionRows'
import { authorOf, reasonOf, revisionLine, when } from '@/lib/revisionDisplay'
import { revisionApi, revisionKeys } from '@/services/revisions'
import type { Revision } from '@/types/revision'

// Every past version of a clinical record (SPEC-clinical-revisions.md §7):
// the list of versions with action, reason, author and time, and the selected
// one read-only, from its snapshot. A field that differs from the version
// before is marked. Who may read it: every user of the clinic, as the record.

interface RevisionHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: string
  // The record's revisions path (services/revisions.ts revisionPaths).
  base: string
  // What the record is, for the title: "Historial de la sesión".
  title: string
  render: SnapshotRenderer
  renderContext?: SnapshotRenderContext
}

export default function RevisionHistoryDialog({
  open,
  onOpenChange,
  patientId,
  base,
  title,
  render,
  renderContext = {},
}: RevisionHistoryDialogProps) {
  const [picked, setPicked] = useState<number | null>(null)

  const { data: versions, isLoading, isError } = useQuery({
    queryKey: revisionKeys.list(patientId, base),
    queryFn: () => revisionApi.list(base),
    enabled: open,
  })

  // The newest until the user picks one.
  const selected = picked ?? versions?.[0]?.version ?? null

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setPicked(null)
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Cada versión guardada de este registro, con quién la escribió, cuándo y por qué.</DialogDescription>
        </DialogHeader>

        {isLoading && <p className="text-sm text-muted-foreground">Cargando historial…</p>}
        {isError && <p className="text-sm text-destructive">No se pudo cargar el historial.</p>}
        {versions && versions.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Este registro es anterior al historial: todavía no tiene versiones guardadas.
          </p>
        )}

        {versions && versions.length > 0 && selected !== null && (
          <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            <ol aria-label="Versiones" className="flex flex-col gap-1">
              {versions.map((r) => (
                <li key={r.version}>
                  <button
                    type="button"
                    aria-pressed={r.version === selected}
                    onClick={() => setPicked(r.version)}
                    className={cn(
                      'w-full rounded-md border px-3 py-2 text-left text-xs transition-colors hover:bg-muted/60',
                      r.version === selected && 'border-primary bg-muted',
                    )}
                  >
                    <span className="block font-medium">
                      Versión {r.version} · {auditActionLabel('audit_logs', r.action)}
                    </span>
                    <span className="block text-muted-foreground">
                      {[reasonOf(r), authorOf(r), when(r.createdAt)].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ol>

            <RevisionDetail
              patientId={patientId}
              base={base}
              version={selected}
              render={render}
              renderContext={renderContext}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function useRevision(patientId: string, base: string, version: number) {
  return useQuery({
    queryKey: revisionKeys.one(patientId, base, version),
    queryFn: () => revisionApi.get(base, version),
    enabled: version >= 1,
  })
}

function RevisionDetail({
  patientId,
  base,
  version,
  render,
  renderContext,
}: {
  patientId: string
  base: string
  version: number
  render: SnapshotRenderer
  renderContext: SnapshotRenderContext
}) {
  const current = useRevision(patientId, base, version)
  // The version before, to mark what this one changed.
  const previous = useRevision(patientId, base, version - 1)

  if (current.isLoading) return <p className="text-sm text-muted-foreground">Cargando versión…</p>
  if (!current.data) return <p className="text-sm text-destructive">No se pudo cargar esta versión.</p>

  const revision: Revision = current.data
  const rows = render(revision.snapshot, revision.schemaVersion, renderContext)
  const before = previous.data ? render(previous.data.snapshot, previous.data.schemaVersion, renderContext) : null
  const changed = rows ? changedKeys(rows, before) : new Set<string>()
  const removed = rows ? removedGroups(rows, before) : []

  return (
    <section aria-label={`Versión ${revision.version}`} className="flex flex-col gap-3 min-w-0">
      <p className="text-sm font-medium">{revisionLine(revision)}</p>
      {revision.reasonNote && (
        <p className="rounded-md bg-muted/50 p-2 text-sm">
          <span className="font-medium">Nota del cambio:</span> {revision.reasonNote}
        </p>
      )}

      {rows === null ? (
        <p className="text-sm text-muted-foreground">Esta versión tiene un formato que esta pantalla no sabe mostrar.</p>
      ) : (
        <SnapshotRows rows={rows} changed={changed} />
      )}

      {removed.length > 0 && (
        <p className="text-sm text-muted-foreground">Se quitó en esta versión: {removed.join(', ')}.</p>
      )}
    </section>
  )
}

function SnapshotRows({ rows, changed }: { rows: SnapshotRow[]; changed: Set<string> }) {
  // Rows in order, a heading before each new group.
  return (
    <dl className="flex flex-col gap-2 text-sm">
      {rows.map((row, i) => {
        const heading = row.group && row.group.key !== rows[i - 1]?.group?.key ? row.group.label : null
        const isChanged = changed.has(row.key)
        return (
          <div key={row.key}>
            {heading && <p className="mt-2 mb-1 font-medium">{heading}</p>}
            <div
              data-changed={isChanged || undefined}
              className={cn('rounded-md px-2 py-1', isChanged && 'bg-amber-50 dark:bg-amber-950/40')}
            >
              <dt className="flex items-center gap-2 text-xs text-muted-foreground">
                {row.label}
                {isChanged && (
                  <Badge variant="outline" className="h-4 px-1 text-[10px]">
                    Modificado
                  </Badge>
                )}
              </dt>
              <dd className="whitespace-pre-wrap break-words">{row.value}</dd>
            </div>
          </div>
        )
      })}
    </dl>
  )
}

// The button that opens it, the same on every record.
export function RevisionHistoryButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <Button type="button" variant="ghost" size="sm" className={cn('gap-1.5', className)} onClick={onClick}>
      <History className="h-3.5 w-3.5" />
      Ver historial
    </Button>
  )
}
