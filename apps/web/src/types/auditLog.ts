export interface AuditLog {
  id: string;
  patientId: string;
  userId: string | null;
  entity: string;
  entityId: string;
  action: string;
  description: string;
  createdAt: string;
}
