import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformTenant } from '@ficha/shared';
import PlatformApp from '@/pages/platform/PlatformApp';
import { platformAuthApi, platformTenantsApi } from '@/services/platform';

// Se mockea la capa HTTP de plataforma; el provider de sesión, el guard de
// ruta y las pantallas corren de verdad. La app clínica no aparece: este
// subárbol no la importa.
vi.mock('@/services/platform', () => ({
  platformKeys: {
    tenants: ['platform', 'tenants'],
    users: (id: string) => ['platform', 'tenants', id, 'users'],
    audit: (id: string) => ['platform', 'tenants', id, 'audit'],
  },
  platformAuthApi: { login: vi.fn(), me: vi.fn(), changePassword: vi.fn() },
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
