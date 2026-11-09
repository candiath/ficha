import type { AuditActorType } from '@ficha/shared';

// A version of a clinical record (SPEC-clinical-revisions.md §7), as the API's
// revision routes return it. `params` are the audit row's codes, the reason
// among them; the screen builds the words from the catalog.
export interface RevisionSummary {
  version: number;
  action: string;
  params: Record<string, unknown>;
  actorType: AuditActorType;
  // Who wrote it; null for the system.
  author: { id: string; name: string | null } | null;
  createdAt: string;
}

// One version with its content: the snapshot as stored, parsed by the screen
// with the schema of its `schemaVersion`.
export interface Revision extends RevisionSummary {
  schemaVersion: number;
  snapshot: unknown;
  reasonNote: string | null;
}
