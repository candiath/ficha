import { AUDIT_REVISION_REASONS, auditActionLabel, type RevisionReason } from '@ficha/shared'
import type { RevisionSummary } from '@/types/revision'

// How a version reads in the history (RevisionHistoryDialog): its reason and
// author in words, from the audit row's codes.

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function reasonOf(r: RevisionSummary): string | null {
  const code = r.params.reason
  return typeof code === 'string' && code in AUDIT_REVISION_REASONS
    ? capitalize(AUDIT_REVISION_REASONS[code as RevisionReason])
    : null
}

// Who acted, in the version history and the activity timeline alike.
export function authorOf(r: Pick<RevisionSummary, 'author' | 'actorType'>): string {
  if (r.author) return r.author.name ?? 'Usuario sin nombre'
  return r.actorType === 'SYSTEM' ? 'Sistema' : 'Desconocido'
}

export const when = (iso: string) => new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })

/** "Versión N · acción · motivo · autor · fecha", the motivo only when there is one. */
export function revisionLine(r: RevisionSummary): string {
  return [`Versión ${r.version}`, auditActionLabel('audit_logs', r.action), reasonOf(r), authorOf(r), when(r.createdAt)]
    .filter(Boolean)
    .join(' · ')
}
