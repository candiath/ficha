import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConsentTab from '@/components/patients/ConsentTab';
import { ApiError } from '@/lib/api';
import { consentApi } from '@/services/consent';
import type { InformedConsent } from '@/types/consent';
import type { Patient } from '@/types/patient';

// Signing is a fact, not a correction: no reason, but over the version on
// screen (SPEC-clinical-revisions.md §4, §5).
vi.mock('@/services/consent', () => ({
  consentKeys: { detail: (patientId: string) => ['patients', patientId, 'consent'] },
  consentApi: { get: vi.fn(), sign: vi.fn(), revoke: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const STALE = 'Otra persona editó este registro. Recargá para ver los cambios.';

const PATIENT = { id: 'p1', fullName: 'María García' } as Patient;
const REVOKED: InformedConsent = {
  id: 'c1',
  patientId: 'p1',
  signed: false,
  signedAt: '2026-10-01T13:00:00.000Z',
  revokedAt: '2026-10-05T13:00:00.000Z',
  createdAt: '2026-10-01T13:00:00.000Z',
  updatedAt: '2026-10-05T13:00:00.000Z',
  version: 2,
};

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ConsentTab patient={PATIENT} />
    </QueryClientProvider>,
  );
}

const signButton = () => screen.findByRole('button', { name: 'Registrar consentimiento' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ConsentTab', () => {
  it('signs a first consent as version 0', async () => {
    vi.mocked(consentApi.get).mockResolvedValue(null);
    vi.mocked(consentApi.sign).mockResolvedValue({ ...REVOKED, signed: true, revokedAt: null, version: 1 });
    renderTab();

    await userEvent.click(await signButton());

    await waitFor(() => expect(consentApi.sign).toHaveBeenCalledWith('p1', 0));
  });

  it('signs again over the version on screen, and shows a 409 as the API words it', async () => {
    vi.mocked(consentApi.get).mockResolvedValue(REVOKED);
    vi.mocked(consentApi.sign).mockRejectedValueOnce(new ApiError(STALE, 409, { error: STALE }));
    renderTab();

    await userEvent.click(await signButton());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(STALE));
    expect(consentApi.sign).toHaveBeenCalledWith('p1', 2);
    // What is there now is read again.
    await waitFor(() => expect(consentApi.get).toHaveBeenCalledTimes(2));
  });
});
