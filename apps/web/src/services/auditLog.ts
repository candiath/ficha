import { api } from '@/lib/api';
import type { AuditLog } from '@/types/auditLog';

export const auditLogKeys = {
  list: (patientId: string) => ['patients', patientId, 'audit-log'] as const,
};

export const auditLogApi = {
  list: (patientId: string) =>
    api.get<AuditLog[]>(`/api/patients/${patientId}/audit-log`),
};
