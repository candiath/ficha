import { api } from '@/lib/api';
import type { InformedConsent } from '@/types/consent';

export const consentKeys = {
  detail: (patientId: string) => ['patients', patientId, 'consent'] as const,
};

export const consentApi = {
  get: (patientId: string) =>
    api.get<InformedConsent | null>(`/api/patients/${patientId}/consent`),
  sign: (patientId: string) =>
    api.post<InformedConsent>(`/api/patients/${patientId}/consent`, {}),
  revoke: (patientId: string) =>
    api.delete(`/api/patients/${patientId}/consent`),
};
