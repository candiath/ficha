import type { AuditActorType, ClinicalAuditAction } from '@ficha/shared';
import type { TenantContext } from './types';

// Reading the clinical revisions (docs/specs/SPEC-clinical-revisions.md §7):
// every past version of an aggregate, inside its patient's record. Who, when
// and what come from the audit row each revision points at.

// ─── Targets ─────────────────────────────────────────────────────────────────

// The aggregate whose history is read, named as the record's paths name it: an
// evaluation by its episode and the consent by its patient, since each has at
// most one.
export type RevisionTarget =
  | { aggregate: 'patient' }
  | { aggregate: 'session'; sessionId: string }
  | { aggregate: 'episode'; episodeId: string }
  | { aggregate: 'evaluation'; episodeId: string }
  | { aggregate: 'consent' }
  | { aggregate: 'patientEvent'; eventId: string };

export type RevisionAggregate = RevisionTarget['aggregate'];

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface RevisionAuthorDTO {
  id: string;
  name: string | null;
}

// One version, as the list shows it. `params` are the audit row's codes (the
// reason among them), read with readAuditParams: the screens build the sentence
// from the catalog.
export interface RevisionSummaryDTO {
  version: number;
  action: ClinicalAuditAction;
  params: Record<string, unknown>;
  actorType: AuditActorType;
  // The user who wrote it; null for SYSTEM.
  author: RevisionAuthorDTO | null;
  createdAt: string;
}

// One version with its content. The snapshot is returned as stored: the screen
// parses it with the schema of its `schemaVersion` (packages/shared
// clinicalSnapshots.ts). Clinical content, like `reasonNote`: only inside the
// record.
export interface RevisionDTO extends RevisionSummaryDTO {
  schemaVersion: number;
  snapshot: unknown;
  reasonNote: string | null;
}

// ─── Port ────────────────────────────────────────────────────────────────────

// Both read only aggregates of a patient of the clinic that exists and is not
// deleted. A soft-deleted session or event keeps its history readable: its
// deletion is one of its versions.
export interface RevisionRepository {
  // Newest first. null: no such aggregate under this patient (or the patient is
  // missing or deleted). An aggregate with no revision (version 0) lists none.
  list(ctx: TenantContext, patientId: string, target: RevisionTarget): Promise<RevisionSummaryDTO[] | null>;

  get(
    ctx: TenantContext,
    patientId: string,
    target: RevisionTarget,
    version: number,
  ): Promise<{ ok: true; revision: RevisionDTO } | { ok: false; reason: 'not_found' | 'no_version' }>;
}
