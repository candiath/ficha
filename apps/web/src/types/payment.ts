export type PaymentStatus = 'PENDING' | 'PAID' | 'WAIVED';
export type PaymentMethod = 'CASH' | 'TRANSFER';

// Amounts in integer cents (lib/money.ts).
export interface Payment {
  id: string;
  patientId: string;
  sessionId: string;
  packageId: string | null;
  baseAmountCents: number;
  discountCents: number;
  finalAmountCents: number;
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
  amountCents: number | null;
  date: string;
  isStale: boolean;
}

export interface SessionPackage {
  id: string;
  patientId: string;
  patientName: string;
  name: string;
  totalSessions: number;
  pricePerSessionCents: number;
  usedSessions: number;
  remainingSessions: number;
  notes: string | null;
  createdAt: string;
}

export interface PaymentUpdateData {
  baseAmountCents?: number;
  discountCents?: number;
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
  pricePerSessionCents: number;
  notes?: string | null;
}
