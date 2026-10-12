import type { AuditActorType } from '@ficha/shared';

// One row of a patient's history (#186, SPEC-audit-structured-entries.md):
// codes, read on screen through lib/auditDisplay.
export interface AuditLog {
  id: string;
  patientId: string;
  userId: string | null;
  actorType: AuditActorType;
  entity: string;
  entityId: string;
  action: string;
  // Codes only.
  params: Record<string, unknown>;
  createdAt: string;
}
