import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SysadminAlertsOverview } from '@ficha/shared';
import UndeliveredAlertBanner from '@/components/platform/UndeliveredAlertBanner';
import { platformAlertsApi } from '@/services/platform';

// The banner across /platform (#186, SPEC-sysadmin-alerts.md §10): shown
// while the most recent real alert has not arrived. The API decides that
// (undeliveredAlert); the banner only shows it.
vi.mock('@/services/platform', () => ({
  platformAlertKeys: { overview: ['platform', 'alerts'], bot: ['platform', 'alerts', 'bot'] },
  platformAlertsApi: { overview: vi.fn(), bot: vi.fn(), sendTest: vi.fn() },
}));

const overview = vi.mocked(platformAlertsApi.overview);

const BASE: SysadminAlertsOverview = {
  environment: 'Ficha',
  configuration: 'configured',
  variables: [],
  alerts: [],
  lastTest: null,
  lastDelivery: null,
  undeliveredAlert: null,
};

function renderBanner() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <UndeliveredAlertBanner />
        <p>página</p>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('UndeliveredAlertBanner', () => {
  it('says which alert did not arrive, and links to the card', async () => {
    overview.mockResolvedValue({
      ...BASE,
      undeliveredAlert: {
        id: 'al-1',
        kind: 'AUDIT_MAINTENANCE_FLAG_PRESENT',
        createdAt: '2026-10-11T12:00:00.000Z',
        deliveries: 1,
        lastDelivery: { outcome: 'REJECTED', errorCode: 401, detail: 'Unauthorized', createdAt: '2026-10-11T12:00:01.000Z' },
      },
    });

    renderBanner();

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/La última alerta no llegó por Telegram/);
    expect(banner).toHaveTextContent(/Marca de mantenimiento de auditoría presente/);
    expect(screen.getByRole('link', { name: /Revisá la tarjeta Alertas/ })).toHaveAttribute(
      'href',
      '/platform/tenants#alertas',
    );
  });

  it('shows nothing when the last real alert arrived', async () => {
    overview.mockResolvedValue(BASE);

    renderBanner();

    await screen.findByText('página');
    await vi.waitFor(() => expect(overview).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
