import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformTenant } from '@ficha/shared';
import PlatformApp from '@/pages/platform/PlatformApp';
import { platformAlertsApi, platformAuthApi, platformTenantsApi } from '@/services/platform';

// Se mockea la capa HTTP de plataforma; el provider de sesión, el guard de
// ruta y las pantallas corren de verdad. La app clínica no aparece: este
// subárbol no la importa.
vi.mock('@/services/platform', () => ({
  platformKeys: {
    tenants: ['platform', 'tenants'],
    users: (id: string) => ['platform', 'tenants', id, 'users'],
    audit: (id: string) => ['platform', 'tenants', id, 'audit'],
  },
  platformAlertKeys: { overview: ['platform', 'alerts'], bot: ['platform', 'alerts', 'bot'] },
  platformAlertsApi: { overview: vi.fn(), bot: vi.fn(), sendTest: vi.fn() },
  platformAuthApi: { login: vi.fn(), me: vi.fn(), changePassword: vi.fn(), logout: vi.fn() },
  platformTenantsApi: {
    list: vi.fn(),
    create: vi.fn(),
    setActive: vi.fn(),
    users: vi.fn(),
    createAdmin: vi.fn(),
    updateUser: vi.fn(),
    auditLog: vi.fn(),
  },
}));

const me = vi.mocked(platformAuthApi.me);
const list = vi.mocked(platformTenantsApi.list);

const TENANTS: PlatformTenant[] = [
  {
    id: 't1',
    name: 'Clínica Norte',
    slug: 'clinica-norte',
    createdAt: '2026-09-01T12:00:00.000Z',
    deactivatedAt: null,
    activeAdmins: 1,
  },
  {
    id: 't2',
    name: 'Clínica Sur',
    slug: 'clinica-sur',
    createdAt: '2026-09-02T12:00:00.000Z',
    deactivatedAt: null,
    activeAdmins: 0,
  },
];

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="platform/*" element={<PlatformApp />} />
          <Route path="login" element={<p>login de la clínica</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  // The layout's alert banner and the Alertas card (#186): nothing to report.
  vi.mocked(platformAlertsApi.overview).mockResolvedValue({
    environment: 'local',
    configuration: 'not_configured',
    variables: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'],
    alerts: [],
    lastTest: null,
    lastDelivery: null,
    undeliveredAlert: null,
  });
});

describe('PlatformApp', () => {
  it('sin sesión de plataforma, /platform/tenants cae en el login de plataforma', async () => {
    renderAt('/platform/tenants');

    expect(await screen.findByText('Operación de plataforma')).toBeInTheDocument();
    expect(screen.queryByText('login de la clínica')).not.toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });

  // Un token de la CLÍNICA en localStorage no cuenta como sesión de
  // plataforma: son claves distintas.
  it('un token de la clínica no abre la plataforma', async () => {
    localStorage.setItem('ficha_token', 'token-de-clinica');
    renderAt('/platform/tenants');

    expect(await screen.findByText('Operación de plataforma')).toBeInTheDocument();
    expect(me).not.toHaveBeenCalled();
  });

  it('con sesión de plataforma, lista las clínicas y marca las que no tienen ADMIN', async () => {
    localStorage.setItem('ficha_platform_token', 'token-de-plataforma');
    me.mockResolvedValue({ id: 'op1', email: 'op@ficha.test', name: 'Operadora' });
    list.mockResolvedValue(TENANTS);

    renderAt('/platform/tenants');

    expect(await screen.findByText('Clínica Norte')).toBeInTheDocument();
    expect(screen.getByText('Clínica Sur')).toBeInTheDocument();
    expect(screen.getByText('Sin ADMIN')).toBeInTheDocument();
    expect(screen.getByText('Operadora')).toBeInTheDocument();
  });
});

describe('PlatformApp: another tab', () => {
  const tokenChangesElsewhere = (key: string, token: string | null) => {
    if (token) localStorage.setItem(key, token);
    else localStorage.removeItem(key);
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: token, storageArea: localStorage }));
  };

  it("an operator's logout there sends this tab to the platform login", async () => {
    localStorage.setItem('ficha_platform_token', 'token-de-plataforma');
    me.mockResolvedValue({ id: 'op1', email: 'op@ficha.test', name: 'Operadora' });
    list.mockResolvedValue(TENANTS);
    renderAt('/platform/tenants');
    expect(await screen.findByText('Clínica Norte')).toBeInTheDocument();

    tokenChangesElsewhere('ficha_platform_token', null);

    expect(await screen.findByText('Operación de plataforma')).toBeInTheDocument();
  });

  // The clinic's session clears the clinic's cache, never the platform's:
  // the platform has its own query client.
  it("a clinic login there leaves this tab's platform data and queries alone", async () => {
    localStorage.setItem('ficha_platform_token', 'token-de-plataforma');
    me.mockResolvedValue({ id: 'op1', email: 'op@ficha.test', name: 'Operadora' });
    list.mockResolvedValue(TENANTS);
    renderAt('/platform/tenants');
    expect(await screen.findByText('Clínica Norte')).toBeInTheDocument();

    tokenChangesElsewhere('ficha_token', 'token-de-clinica');

    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText('Clínica Norte')).toBeInTheDocument();
    expect(me).toHaveBeenCalledTimes(1);
  });
});

// The operator's session lives on the server (SPEC-operator-sessions.md).
describe('PlatformApp: session', () => {
  async function renderSignedIn() {
    localStorage.setItem('ficha_platform_token', 'token-de-plataforma');
    me.mockResolvedValue({ id: 'op1', email: 'op@ficha.test', name: 'Operadora' });
    list.mockResolvedValue(TENANTS);
    renderAt('/platform/tenants');
    expect(await screen.findByText('Clínica Norte')).toBeInTheDocument();
  }

  it('logout revokes the session on the server and clears the token', async () => {
    vi.mocked(platformAuthApi.logout).mockResolvedValue(undefined);
    await renderSignedIn();

    await userEvent.click(screen.getByRole('button', { name: /Salir/ }));

    expect(await screen.findByText('Operación de plataforma')).toBeInTheDocument();
    expect(platformAuthApi.logout).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('ficha_platform_token')).toBeNull();
  });

  it('logout clears the token even when the server cannot be reached', async () => {
    vi.mocked(platformAuthApi.logout).mockRejectedValue(new TypeError('Failed to fetch'));
    await renderSignedIn();

    await userEvent.click(screen.getByRole('button', { name: /Salir/ }));

    expect(await screen.findByText('Operación de plataforma')).toBeInTheDocument();
    expect(localStorage.getItem('ficha_platform_token')).toBeNull();
  });

  it('changing the password keeps the stored token', async () => {
    vi.mocked(platformAuthApi.changePassword).mockResolvedValue(undefined);
    await renderSignedIn();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Contraseña/ }));
    await user.type(screen.getByLabelText('Contraseña actual'), 'clave-actual-123');
    await user.type(screen.getByLabelText('Contraseña nueva'), 'clave-nueva-456');
    await user.type(screen.getByLabelText('Repetir contraseña nueva'), 'clave-nueva-456');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(platformAuthApi.changePassword).toHaveBeenCalledWith('clave-actual-123', 'clave-nueva-456');
    await vi.waitFor(() => expect(screen.queryByText('Cambiar contraseña')).not.toBeInTheDocument());
    expect(localStorage.getItem('ficha_platform_token')).toBe('token-de-plataforma');
    expect(screen.getByText('Clínica Norte')).toBeInTheDocument();
  });
});
