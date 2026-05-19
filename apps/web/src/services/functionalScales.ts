import { api } from '@/lib/api';
import type { FunctionalScale, FunctionalScaleCreateData, FunctionalScaleDetail } from '@/types/functionalScale';

export const functionalScaleKeys = {
  list: (patientId: string) => ['patients', patientId, 'scales'] as const,
  detail: (patientId: string, scaleId: string) =>
    ['patients', patientId, 'scales', scaleId] as const,
};

export const functionalScaleApi = {
  list: (patientId: string) =>
    api.get<FunctionalScale[]>(`/api/patients/${patientId}/scales`),
  get: (patientId: string, scaleId: string) =>
    api.get<FunctionalScaleDetail>(`/api/patients/${patientId}/scales/${scaleId}`),
  create: (patientId: string, data: FunctionalScaleCreateData) =>
    api.post<FunctionalScaleDetail>(`/api/patients/${patientId}/scales`, data),
  delete: (patientId: string, scaleId: string) =>
    api.delete(`/api/patients/${patientId}/scales/${scaleId}`),
};
