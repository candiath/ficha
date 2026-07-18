import { api } from '@/lib/api';
import type {
  LastBasePrice,
  Payment,
  PaymentUpdateData,
  SessionPackage,
  SessionPackageFormData,
} from '@/types/payment';

export const paymentKeys = {
  all: ['payments'] as const,
  list: (filters?: { patientId?: string; status?: string }) =>
    ['payments', filters] as const,
  lastBasePrice: ['payments', 'last-base-price'] as const,
};

export const packageKeys = {
  all: ['packages'] as const,
  byPatient: (patientId: string) => ['packages', patientId] as const,
};

export const paymentApi = {
  list: (params?: { patientId?: string; status?: string }) => {
    const query = new URLSearchParams();
    if (params?.patientId) query.set('patientId', params.patientId);
    if (params?.status) query.set('status', params.status);
    const qs = query.toString();
    return api.get<Payment[]>(`/api/payments${qs ? `?${qs}` : ''}`);
  },

  lastBasePrice: () => api.get<LastBasePrice | null>('/api/payments/last-base-price'),

  // El alta de pagos no tiene método propio: el cobro se crea junto con la
  // sesión en POST /sessions (transaccional, ver SessionCreateData.payment).

  update: (id: string, data: PaymentUpdateData) =>
    api.patch<Payment>(`/api/payments/${id}`, data),
};

export const packageApi = {
  list: (patientId?: string) => {
    const qs = patientId ? `?patientId=${patientId}` : '';
    return api.get<SessionPackage[]>(`/api/packages${qs}`);
  },

  create: (data: SessionPackageFormData) =>
    api.post<SessionPackage>('/api/packages', data),

  remove: (id: string) => api.delete(`/api/packages/${id}`),
};
