import type { AuditActorType } from '@ficha/shared';

// One row of a patient's history (#186, SPEC-audit-structured-entries.md):
// codes, read on screen through lib/auditDisplay.
export interface AuditLog {
  id: string;
  patientId: string;
  userId: string | null;
  actorType: AuditActorType;
  // Who acted; null for a SYSTEM row.
  author: { id: string; name: string | null } | null;
  entity: string;
  entityId: string;
  action: string;
  // Codes only.
  params: Record<string, unknown>;
  createdAt: string;
}
