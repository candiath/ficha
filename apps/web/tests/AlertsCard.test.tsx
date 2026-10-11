import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SysadminAlert, SysadminAlertsOverview } from '@ficha/shared';
import AlertsCard from '@/components/platform/AlertsCard';
import { platformAlertsApi } from '@/services/platform';

// The Alertas card (#186, SPEC-sysadmin-alerts.md §10). Only the HTTP layer
// is mocked; the queries and the test mutation run for real.
vi.mock('@/services/platform', () => ({
  platformAlertKeys: { overview: ['platform', 'alerts'], bot: ['platform', 'alerts', 'bot'] },
  platformAlertsApi: { overview: vi.fn(), bot: vi.fn(), sendTest: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const overview = vi.mocked(platformAlertsApi.overview);
const bot = vi.mocked(platformAlertsApi.bot);
const sendTest = vi.mocked(platformAlertsApi.sendTest);

const FAILED_GUARDS: SysadminAlert = {
  id: 'al-1',
  kind: 'AUDIT_GUARDS_FAILED',
  createdAt: '2026-10-11T12:00:00.000Z',
  deliveries: 3,
  lastDelivery: { outcome: 'UNREACHABLE', errorCode: null, detail: 'TimeoutError', createdAt: '2026-10-11T12:01:00.000Z' },
};

const CONFIGURED: SysadminAlertsOverview = {
  environment: 'ficha-staging',
  configuration: 'configured',
  variables: [],
  alerts: [FAILED_GUARDS],
  lastTest: null,
  lastDelivery: { ...FAILED_GUARDS.lastDelivery!, alertId: 'al-1', kind: 'AUDIT_GUARDS_FAILED' },
  undeliveredAlert: FAILED_GUARDS,
};

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AlertsCard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AlertsCard', () => {
  it('shows the environment, the bot and the last delivery', async () => {
    overview.mockResolvedValue(CONFIGURED);
    bot.mockResolvedValue({ status: 'ok', username: 'ficha_staging_bot' });

    renderCard();

    expect(await screen.findByText('ficha-staging')).toBeInTheDocument();
    expect(await screen.findByText(/Configurado · bot @ficha_staging_bot/)).toBeInTheDocument();
    expect(screen.getByText(/Último envío/).closest('p')).toHaveTextContent(
      /Chequeo de auditoría fallido.*No se pudo contactar a Telegram/,
    );
  });

  it('lists the real alerts with their delivery state and attempts', async () => {
    overview.mockResolvedValue(CONFIGURED);
    bot.mockResolvedValue({ status: 'ok', username: 'ficha_staging_bot' });

    renderCard();

    const list = await screen.findByRole('list', { name: 'Últimas alertas' });
    const item = within(list).getByRole('listitem');
    expect(item).toHaveTextContent('Chequeo de auditoría fallido');
    expect(item).toHaveTextContent('No se pudo contactar a Telegram');
    expect(item).toHaveTextContent('3 intentos');
  });

  it('says what is missing and disables the test when not configured', async () => {
    overview.mockResolvedValue({
      ...CONFIGURED,
      configuration: 'not_configured',
      variables: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'],
      alerts: [],
      lastDelivery: null,
      undeliveredAlert: null,
    });

    renderCard();

    expect(
      await screen.findByText(/No configurado: faltan TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID en el servicio/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar alerta de prueba' })).toBeDisabled();
    expect(screen.getByText('Ninguna alerta todavía.')).toBeInTheDocument();
    expect(bot).not.toHaveBeenCalled();
  });

  it('names a malformed variable', async () => {
    overview.mockResolvedValue({ ...CONFIGURED, configuration: 'invalid', variables: ['TELEGRAM_CHAT_ID'] });

    renderCard();

    expect(await screen.findByText(/Configuración inválida: TELEGRAM_CHAT_ID/)).toBeInTheDocument();
  });

  it("says when the bot cannot be verified, with Telegram's code", async () => {
    overview.mockResolvedValue(CONFIGURED);
    bot.mockResolvedValue({ status: 'error', errorCode: 401, detail: 'Unauthorized' });

    renderCard();

    expect(await screen.findByText(/No se pudo verificar el bot \(Telegram respondió 401\)/)).toBeInTheDocument();
  });

  it("sends a test alert and shows Telegram's answer", async () => {
    overview.mockResolvedValue(CONFIGURED);
    bot.mockResolvedValue({ status: 'ok', username: 'ficha_staging_bot' });
    sendTest.mockResolvedValue({
      alertId: 'al-2',
      outcome: 'REJECTED',
      errorCode: 403,
      detail: 'Forbidden: bot was blocked by the user',
    });

    renderCard();
    await userEvent.click(await screen.findByRole('button', { name: 'Enviar alerta de prueba' }));

    expect(sendTest).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Rechazada por Telegram \(403\)/)).toBeInTheDocument();
    expect(screen.getByText(/Forbidden: bot was blocked by the user/)).toBeInTheDocument();
    await waitFor(() => expect(overview).toHaveBeenCalledTimes(2));
  });
});
