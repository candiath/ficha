import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSessionDTO } from '@ficha/shared';
import ConnectedDevicesCard from '@/components/account/ConnectedDevicesCard';
import { authSessionApi } from '@/services/auth';

// Only the HTTP layer and the auth context are mocked: the query, the
// mutations and the rendering run for real.
vi.mock('@/services/auth', () => ({
  authSessionKeys: { list: ['auth-sessions'] },
  authSessionApi: {
    list: vi.fn(),
    close: vi.fn(),
    closeOthers: vi.fn(),
    untrust: vi.fn(),
  },
}));

const logout = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ logout }) }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const api = vi.mocked(authSessionApi);

const WINDOWS_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

function device(overrides: Partial<AuthSessionDTO>): AuthSessionDTO {
  const now = new Date().toISOString();
  return {
    id: 'd',
    createdAt: now,
    lastUsedAt: now,
    expiresAt: now,
    trusted: false,
    ip: '200.1.2.3',
    userAgent: WINDOWS_CHROME,
    current: false,
    ...overrides,
  };
}

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ConnectedDevicesCard />
    </QueryClientProvider>,
  );
}

const rows = () => screen.findAllByTestId('device-row');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ConnectedDevicesCard', () => {
  it('lists the devices with the current one first, its label, badges and activity', async () => {
    api.list.mockResolvedValue([
      device({
        id: 'phone',
        userAgent: IPHONE_SAFARI,
        trusted: true,
        lastUsedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      }),
      device({ id: 'this', current: true }),
    ]);
    renderCard();

    const [first, second] = await rows();
    expect(within(first).getByText('Chrome en Windows')).toBeInTheDocument();
    expect(within(first).getByText('Este dispositivo')).toBeInTheDocument();
    expect(within(first).getByText(/Activo ahora/)).toBeInTheDocument();
    expect(within(first).getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();

    expect(within(second).getByText('Safari en iPhone')).toBeInTheDocument();
    expect(within(second).getByText('De confianza')).toBeInTheDocument();
    expect(within(second).getByText(/hace 3 horas/)).toBeInTheDocument();
    expect(within(second).getByRole('button', { name: 'Desconectar' })).toBeInTheDocument();
    expect(within(second).getByRole('button', { name: 'Dejar de confiar' })).toBeInTheDocument();
  });

  it('"Desconectar" closes that device and reloads the list', async () => {
    api.list.mockResolvedValue([device({ id: 'this', current: true }), device({ id: 'laptop' })]);
    api.close.mockResolvedValue(undefined);
    renderCard();

    const [, laptop] = await rows();
    await userEvent.click(within(laptop).getByRole('button', { name: 'Desconectar' }));

    await waitFor(() => expect(api.close).toHaveBeenCalledWith('laptop', expect.anything()));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    expect(logout).not.toHaveBeenCalled();
  });

  it('"Cerrar sesión" on this device is the normal logout', async () => {
    api.list.mockResolvedValue([device({ id: 'this', current: true })]);
    renderCard();

    const [current] = await rows();
    await userEvent.click(within(current).getByRole('button', { name: 'Cerrar sesión' }));

    expect(logout).toHaveBeenCalledOnce();
    expect(api.close).not.toHaveBeenCalled();
  });

  it('"Dejar de confiar" untrusts that device', async () => {
    api.list.mockResolvedValue([
      device({ id: 'this', current: true }),
      device({ id: 'phone', trusted: true }),
    ]);
    api.untrust.mockResolvedValue(undefined);
    renderCard();

    const [, phone] = await rows();
    await userEvent.click(within(phone).getByRole('button', { name: 'Dejar de confiar' }));

    await waitFor(() => expect(api.untrust).toHaveBeenCalledWith('phone', expect.anything()));
  });

  it('"Desconectar los demás" only shows with more than one device', async () => {
    api.list.mockResolvedValue([device({ id: 'this', current: true })]);
    const { unmount } = renderCard();
    await rows();
    expect(screen.queryByRole('button', { name: 'Desconectar los demás' })).not.toBeInTheDocument();
    unmount();

    api.list.mockResolvedValue([device({ id: 'this', current: true }), device({ id: 'laptop' })]);
    api.closeOthers.mockResolvedValue({ revoked: 1 });
    renderCard();
    await rows();
    await userEvent.click(screen.getByRole('button', { name: 'Desconectar los demás' }));

    await waitFor(() => expect(api.closeOthers).toHaveBeenCalledOnce());
  });
});
