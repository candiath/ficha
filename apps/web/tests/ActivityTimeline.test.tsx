import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ActivityTimeline from '@/components/patients/ActivityTimeline';
import { auditLogApi } from '@/services/auditLog';
import type { AuditLog } from '@/types/auditLog';

vi.mock('@/services/auditLog', async (original) => ({
  ...(await original<typeof import('@/services/auditLog')>()),
  auditLogApi: { list: vi.fn() },
}));

const row = (id: string, entity: string, action: string): AuditLog => ({
  id,
  patientId: 'p1',
  userId: 'u1',
  actorType: 'USER',
  author: { id: 'u1', name: 'Ana Fisio' },
  entity,
  entityId: id,
  action,
  params: {},
  createdAt: '2026-11-06T12:00:00.000Z',
});

function renderTimeline(rows: AuditLog[]) {
  vi.mocked(auditLogApi.list).mockResolvedValue(rows);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ActivityTimeline patientId="p1" />
    </QueryClientProvider>,
  );
}

describe('ActivityTimeline filter', () => {
  it('shows every row at first, and only the chosen entity after filtering', async () => {
    renderTimeline([
      row('a', 'APPOINTMENT', 'APPOINTMENT_SCHEDULED'),
      row('b', 'SESSION', 'SESSION_RECORDED'),
    ]);

    expect(await screen.findByText('Agendó un turno')).toBeInTheDocument();
    expect(screen.getByText('Registró una sesión')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Sesión' }));
    expect(screen.queryByText('Agendó un turno')).not.toBeInTheDocument();
    expect(screen.getByText('Registró una sesión')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Todo' }));
    expect(screen.getByText('Agendó un turno')).toBeInTheDocument();
  });

  it('offers no filter when every row is of one entity', async () => {
    renderTimeline([row('a', 'SESSION', 'SESSION_RECORDED')]);

    expect(await screen.findByText('Registró una sesión')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Todo' })).not.toBeInTheDocument();
  });

  // Who acted (area 3 review, M2): a user by name, or the system.
  it('says who did each thing', async () => {
    renderTimeline([
      row('a', 'PAYMENT', 'PAYMENT_CREATED'),
      { ...row('b', 'PATIENT', 'PATIENT_CREATED'), userId: null, actorType: 'SYSTEM', author: null },
    ]);

    expect(await screen.findByText(/Ana Fisio/)).toBeInTheDocument();
    expect(screen.getByText(/Sistema/)).toBeInTheDocument();
  });
});
