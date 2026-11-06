import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PaymentsPage from '@/pages/PaymentsPage';
import { paymentApi } from '@/services/payments';
import type { Payment } from '@/types/payment';

// Nobody picks a date when charging, so the API stamps it: a device's clock
// that is off must not end up in the record of a payment.
vi.mock('@/services/payments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/payments')>()),
  paymentApi: { list: vi.fn(), update: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const PAYMENT: Payment = {
  id: 'pay1',
  patientId: 'p1',
  sessionId: 's1',
  packageId: null,
  baseAmountCents: 1500000,
  discountCents: 0,
  finalAmountCents: 1500000,
  status: 'PENDING',
  method: null,
  paidAt: null,
  notes: null,
  createdAt: '2026-10-01T13:00:00.000Z',
  updatedAt: '2026-10-01T13:00:00.000Z',
  patient: { id: 'p1', fullName: 'María García' },
  session: { id: 's1', sessionDate: '2026-10-01T13:00:00.000Z', sessionType: 'FOLLOW_UP' },
  package: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(paymentApi.list).mockResolvedValue([PAYMENT]);
  vi.mocked(paymentApi.update).mockResolvedValue({ ...PAYMENT, status: 'PAID', method: 'CASH' });
});

describe('PaymentsPage: charging a payment', () => {
  it('sends the method and no date', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <PaymentsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // The table rebuilds its cells on every render, so the button is read only
    // once the page has settled.
    await screen.findByRole('button', { name: 'Cobrar' });
    await act(async () => {});
    await userEvent.click(screen.getByRole('button', { name: 'Cobrar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Efectivo' }));

    await waitFor(() => expect(paymentApi.update).toHaveBeenCalledTimes(1));
    expect(paymentApi.update).toHaveBeenCalledWith('pay1', { status: 'PAID', method: 'CASH' });
  });
});
