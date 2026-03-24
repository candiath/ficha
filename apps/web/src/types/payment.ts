export type PaymentStatus = 'PENDING' | 'PAID' | 'WAIVED';
export type PaymentMethod = 'CASH' | 'TRANSFER';

export interface Payment {
  id: string;
  patientId: string;
  sessionId: string;
  packageId: string | null;
  baseAmount: number;
  discount: number;
  finalAmount: number;
  status: PaymentStatus;
  method: PaymentMethod | null;
  paidAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  patient: { id: string; fullName: string };
  session: { id: string; sessionDate: string; sessionType: string };
  package: { id: string; name: string } | null;
}

export interface LastBasePrice {
  amount: number | null;
  date: string;
  isStale: boolean;
}

export interface SessionPackage {
  id: string;
  patientId: string;
  patientName: string;
  name: string;
  totalSessions: number;
  pricePerSession: number;
  usedSessions: number;
  remainingSessions: number;
  notes: string | null;
  createdAt: string;
}

export interface PaymentFormData {
  patientId: string;
  sessionId: string;
  packageId?: string | null;
  baseAmount: number;
  discount?: number;
  notes?: string | null;
}

export interface PaymentUpdateData {
  baseAmount?: number;
  discount?: number;
  status?: PaymentStatus;
  method?: PaymentMethod | null;
  paidAt?: string | null;
  packageId?: string | null;
  notes?: string | null;
}

export interface SessionPackageFormData {
  patientId: string;
  name: string;
  totalSessions: number;
  pricePerSession: number;
  notes?: string | null;
}
