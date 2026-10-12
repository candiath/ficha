import type { AuditActorType } from '@ficha/shared';

// One row of a patient's history (#186, SPEC-audit-structured-entries.md):
// codes, read on screen through lib/auditDisplay.
export interface AuditLog {
  id: string;
  patientId: string;
  userId: string | null;
  // Absent from an API that predates the catalog.
  actorType?: AuditActorType;
  entity: string;
  entityId: string;
  action: string;
  // Codes only. Absent from an API that predates the catalog.
  params?: Record<string, unknown>;
  // The sentence of an API that predates the catalog; while both exist, the
  // API builds it from the codes too.
  description?: string;
  createdAt: string;
}
