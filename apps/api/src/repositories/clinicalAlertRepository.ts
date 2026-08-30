import type { TenantContext } from './types';

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface ClinicalAlertDTO {
  id: string;
  patientId: string;
  patientName: string;
  type: string;
  message: string;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface AlertCreateDTO {
  patientId: string;
  type: 'FOLLOW_UP' | 'NO_SHOW' | 'PAYMENT' | 'CUSTOM';
  message: string;
}

export interface AlertFilters {
  type?: string;
  isRead?: boolean;
}

// ─── Port ────────────────────────────────────────────────────────────────────

export interface ClinicalAlertRepository {
  list(ctx: TenantContext, filters?: AlertFilters): Promise<ClinicalAlertDTO[]>;
  stats(ctx: TenantContext): Promise<{
    unread: number;
    followUp: number;
    payment: number;
    noShow: number;
  }>;
  create(ctx: TenantContext, data: AlertCreateDTO): Promise<ClinicalAlertDTO>;
  /** null si la alerta no existe o es de otro tenant. */
  markAsRead(ctx: TenantContext, id: string): Promise<ClinicalAlertDTO | null>;
  markAllAsRead(ctx: TenantContext): Promise<number>;
}
