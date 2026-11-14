import { api } from '@/lib/api';
import type { InformedConsent } from '@/types/consent';

export const consentKeys = {
  detail: (patientId: string) => ['patients', patientId, 'consent'] as const,
};

export const consentApi = {
  get: (patientId: string) =>
    api.get<InformedConsent | null>(`/api/patients/${patientId}/consent`),
  // The version the screen showed (0: none), so a signature over a consent
  // someone else changed meanwhile is a 409.
  sign: (patientId: string, expectedVersion: number) =>
    api.post<InformedConsent>(`/api/patients/${patientId}/consent`, { expectedVersion }),
  revoke: (patientId: string) =>
    api.delete(`/api/patients/${patientId}/consent`),
};
