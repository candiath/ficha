import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAuditEntry, PlatformTenant, PlatformUser } from '@ficha/shared';
import PlatformTenantDetailPage from '@/pages/platform/PlatformTenantDetailPage';
import { platformTenantsApi } from '@/services/platform';

// Se mockea solo la capa HTTP de plataforma; la página, el select de rol, las
// confirmaciones y las mutaciones de react-query corren de verdad. Es la
// pantalla con todas las acciones que cambian estado, así que lo que se
// prueba es cuándo pide confirmación, cuándo no, y qué manda a la API.
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
    disconnectUserDevices: vi.fn(),
    createUserPasswordReset: vi.fn(),
    auditLog: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from 'sonner';

const list = vi.mocked(platformTenantsApi.list);
const users = vi.mocked(platformTenantsApi.users);
const auditLog = vi.mocked(platformTenantsApi.auditLog);
const updateUser = vi.mocked(platformTenantsApi.updateUser);
const setActive = vi.mocked(platformTenantsApi.setActive);
const createAdmin = vi.mocked(platformTenantsApi.createAdmin);
const disconnectUserDevices = vi.mocked(platformTenantsApi.disconnectUserDevices);
const createUserPasswordReset = vi.mocked(platformTenantsApi.createUserPasswordReset);

const NORTE: PlatformTenant = {
  id: 't1',
  name: 'Clínica Norte',
  slug: 'clinica-norte',
  createdAt: '2026-09-01T12:00:00.000Z',
  deactivatedAt: null,
  activeAdmins: 1,
};

const ADMIN: PlatformUser = {
  id: 'u-admin',
  email: 'admin@norte.test',
  name: 'Ana Admin',
  role: 'ADMIN',
  isActive: true,
  lastLoginAt: '2026-09-10T12:00:00.000Z',
  passwordResetExpiresAt: null,
};

const FISIO: PlatformUser = {
  id: 'u-fisio',
  email: 'fisio@norte.test',
  name: 'Fede Fisio',
  role: 'THERAPIST',
  isActive: true,
  lastLoginAt: null,
  passwordResetExpiresAt: null,
};

const AUDIT: PlatformAuditEntry[] = [
  {
    id: 'a1',
    operatorId: 'op1',
    tenantId: 't1',
    targetUserId: null,
    targetUser: null,
    action: 'TENANT_CREATED',
    description: 'Creó la clínica',
    createdAt: '2026-09-01T12:00:00.000Z',
  },
];

function renderAt(path = '/platform/tenants/t1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="platform/tenants/:tenantId" element={<PlatformTenantDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// La fila de un usuario, para acotar los queries a sus propios controles.
async function fila(nombre: string) {
  const titulo = await screen.findByText(nombre);
  return within(titulo.closest('li') as HTMLElement);
}

async function elegirRol(nombre: string, etiqueta: string) {
  const user = userEvent.setup();
  const row = await fila(nombre);
  await user.click(row.getByRole('combobox', { name: `Rol de ${nombre}` }));
  await user.click(await screen.findByRole('option', { name: etiqueta }));
  return user;
}

async function confirmar(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
  return dialog;
}

beforeEach(() => {
  vi.clearAllMocks();
  list.mockResolvedValue([NORTE]);
  users.mockResolvedValue([ADMIN, FISIO]);
  auditLog.mockResolvedValue(AUDIT);
});

describe('PlatformTenantDetailPage', () => {
  it('muestra la clínica, sus usuarios y el historial con etiquetas legibles', async () => {
    renderAt();

    expect(await screen.findByRole('heading', { name: 'Clínica Norte' })).toBeInTheDocument();
    expect(await screen.findByText('Ana Admin')).toBeInTheDocument();
    expect(screen.getByText('Fede Fisio')).toBeInTheDocument();
    // La acción se muestra con su etiqueta, no con el enum.
    expect(await screen.findByText('Clínica creada')).toBeInTheDocument();
    expect(screen.queryByText('TENANT_CREATED')).not.toBeInTheDocument();
  });

  it('un id que no está en la lista dice que no existe y no pide usuarios ni historial', async () => {
    renderAt('/platform/tenants/no-existe');

    expect(
      await screen.findByText('No hay ninguna clínica con ese identificador.'),
    ).toBeInTheDocument();
    expect(users).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('ascender a ADMIN llama a la API sin pedir confirmación', async () => {
    updateUser.mockResolvedValue({ ...FISIO, role: 'ADMIN' });
    renderAt();

    await elegirRol('Fede Fisio', 'Administrador');

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith('t1', 'u-fisio', { role: 'ADMIN' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('degradar pide confirmación y recién ahí llama a la API', async () => {
    updateUser.mockResolvedValue({ ...ADMIN, role: 'THERAPIST' });
    renderAt();

    const user = await elegirRol('Ana Admin', 'Fisioterapeuta');

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('¿Quitarle el rol de administración a Ana Admin?');
    expect(updateUser).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith('t1', 'u-admin', { role: 'THERAPIST' }),
    );
  });

  it('el 409 de la última ADMIN se muestra con el mensaje del servidor', async () => {
    updateUser.mockRejectedValue(
      new Error('La clínica tiene que conservar al menos una persona administradora activa'),
    );
    renderAt();

    const user = await elegirRol('Ana Admin', 'Fisioterapeuta');
    await confirmar(user);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'La clínica tiene que conservar al menos una persona administradora activa',
      ),
    );
    // La confirmación se cierra sola: el error ya está en el toast.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('desactivar a alguien pide confirmación; reactivar aplica directo', async () => {
    users.mockResolvedValue([ADMIN, { ...FISIO, isActive: false }]);
    updateUser.mockResolvedValue({ ...FISIO, isActive: true });
    renderAt();

    const user = userEvent.setup();
    const fisio = await fila('Fede Fisio');
    await user.click(fisio.getByRole('button', { name: 'Reactivar' }));
    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith('t1', 'u-fisio', { isActive: true }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const admin = await fila('Ana Admin');
    await user.click(admin.getByRole('button', { name: 'Desactivar' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('¿Desactivar a Ana Admin?');
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(updateUser).toHaveBeenCalledTimes(1);
  });

  it('desactivar la clínica pide confirmación y avisa que es inmediato', async () => {
    setActive.mockResolvedValue({ ...NORTE, deactivatedAt: '2026-09-15T10:00:00.000Z' });
    renderAt();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Desactivar clínica' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('¿Desactivar la clínica "Clínica Norte"?');
    expect(dialog).toHaveTextContent('pierde el acceso en el próximo request');
    expect(setActive).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(setActive).toHaveBeenCalledWith('t1', false));
    expect(toast.success).toHaveBeenCalledWith('Clínica desactivada');
  });

  it('reactivar la clínica aplica directo', async () => {
    list.mockResolvedValue([{ ...NORTE, deactivatedAt: '2026-09-15T10:00:00.000Z' }]);
    setActive.mockResolvedValue(NORTE);
    renderAt();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Reactivar clínica' }));

    await waitFor(() => expect(setActive).toHaveBeenCalledWith('t1', true));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('crear ADMIN manda los tres campos y avisa que ya puede entrar', async () => {
    createAdmin.mockResolvedValue({
      id: 'u-nueva',
      email: 'nueva@norte.test',
      name: 'Nueva Admin',
      role: 'ADMIN',
      isActive: true,
      lastLoginAt: null,
      passwordResetExpiresAt: null,
    });
    renderAt();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Crear ADMIN' }));
    const dialog = await screen.findByRole('dialog');

    // Con el formulario a medias el botón no se habilita.
    const enviar = within(dialog).getByRole('button', { name: 'Crear ADMIN' });
    expect(enviar).toBeDisabled();

    await user.type(within(dialog).getByLabelText('Nombre'), 'Nueva Admin');
    await user.type(within(dialog).getByLabelText('Email'), 'nueva@norte.test');
    await user.type(within(dialog).getByLabelText('Contraseña inicial'), 'clave-larga-123');
    expect(enviar).toBeEnabled();
    await user.click(enviar);

    await waitFor(() =>
      expect(createAdmin).toHaveBeenCalledWith('t1', {
        name: 'Nueva Admin',
        email: 'nueva@norte.test',
        password: 'clave-larga-123',
      }),
    );
    expect(toast.success).toHaveBeenCalledWith('nueva@norte.test ya puede entrar como ADMIN');
  });
});

describe('PlatformTenantDetailPage: disconnect devices', () => {
  const disconnectButton = { name: 'Desconectar dispositivos' };

  it('is offered on active users only', async () => {
    users.mockResolvedValue([ADMIN, { ...FISIO, isActive: false }]);
    renderAt();

    expect((await fila('Ana Admin')).getByRole('button', disconnectButton)).toBeEnabled();
    expect((await fila('Fede Fisio')).queryByRole('button', disconnectButton)).not.toBeInTheDocument();
  });

  it('confirms, calls the API with tenant and user, and refreshes the audit log', async () => {
    disconnectUserDevices.mockResolvedValue(undefined);
    renderAt();

    const user = userEvent.setup();
    await user.click((await fila('Fede Fisio')).getByRole('button', disconnectButton));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('¿Desconectar los dispositivos de Fede Fisio?');
    expect(disconnectUserDevices).not.toHaveBeenCalled();
    const auditCallsBefore = auditLog.mock.calls.length;

    await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(disconnectUserDevices).toHaveBeenCalledWith('t1', 'u-fisio'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Dispositivos desconectados'));
    await waitFor(() => expect(auditLog.mock.calls.length).toBeGreaterThan(auditCallsBefore));
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('labels the new audit action', async () => {
    auditLog.mockResolvedValue([
      {
        ...AUDIT[0],
        id: 'a2',
        action: 'USER_DEVICES_DISCONNECTED',
        targetUserId: 'u-fisio',
        targetUser: { email: 'fisio@norte.test', name: 'Fede Fisio' },
        description: 'Desconectó los dispositivos de la usuaria',
      },
    ]);
    renderAt();

    expect(await screen.findByText('Dispositivos desconectados')).toBeInTheDocument();
    expect(screen.queryByText('USER_DEVICES_DISCONNECTED')).not.toBeInTheDocument();
  });

  // Descriptions never name the person (#186): who was affected comes from
  // the row's target, read when the list is.
  it('names the affected user next to the action', async () => {
    auditLog.mockResolvedValue([
      {
        ...AUDIT[0],
        id: 'a4',
        action: 'USER_ACTIVE_CHANGED',
        targetUserId: 'u-fisio',
        targetUser: { email: 'fisio@norte.test', name: 'Fede Fisio' },
        description: 'Desactivó a la usuaria',
      },
    ]);
    renderAt();

    expect(await screen.findByText('Fede Fisio (fisio@norte.test)')).toBeInTheDocument();
  });
});

describe('PlatformTenantDetailPage: password reset', () => {
  const resetButton = { name: 'Restablecer contraseña' };

  it('is offered on active users only', async () => {
    users.mockResolvedValue([ADMIN, { ...FISIO, isActive: false }]);
    renderAt();

    expect((await fila('Ana Admin')).getByRole('button', resetButton)).toBeEnabled();
    expect((await fila('Fede Fisio')).queryByRole('button', resetButton)).not.toBeInTheDocument();
  });

  it('confirms, calls the API with tenant and user, shows the link and refreshes list and audit log', async () => {
    createUserPasswordReset.mockResolvedValue({
      token: 'tok_op',
      expiresAt: '2026-10-07T15:00:00.000Z',
    });
    renderAt();

    const user = userEvent.setup();
    await user.click((await fila('Ana Admin')).getByRole('button', resetButton));
    const confirm = await screen.findByRole('dialog');
    expect(confirm).toHaveTextContent('¿Restablecer la contraseña de Ana Admin?');
    expect(createUserPasswordReset).not.toHaveBeenCalled();
    const usersCallsBefore = users.mock.calls.length;
    const auditCallsBefore = auditLog.mock.calls.length;

    await user.click(within(confirm).getByRole('button', { name: 'Confirmar' }));

    expect(createUserPasswordReset).toHaveBeenCalledWith('t1', 'u-admin');
    const shown = await screen.findByRole('dialog', { name: 'Enlace para Ana Admin' });
    expect(within(shown).getByRole('textbox')).toHaveValue(
      `${window.location.origin}/restablecer-contrasena#tok_op`,
    );
    await waitFor(() => expect(users.mock.calls.length).toBeGreaterThan(usersCallsBefore));
    await waitFor(() => expect(auditLog.mock.calls.length).toBeGreaterThan(auditCallsBefore));
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('marks a user with a pending reset', async () => {
    users.mockResolvedValue([ADMIN, { ...FISIO, passwordResetExpiresAt: '2026-10-07T15:00:00.000Z' }]);
    renderAt();

    expect((await fila('Fede Fisio')).getByText(/^Restablecimiento pendiente · vence /)).toBeInTheDocument();
    expect((await fila('Ana Admin')).queryByText(/Restablecimiento pendiente/)).not.toBeInTheDocument();
  });

  it('labels the audit action', async () => {
    auditLog.mockResolvedValue([
      {
        ...AUDIT[0],
        id: 'a3',
        action: 'PASSWORD_RESET_LINK_CREATED',
        targetUserId: 'u-fisio',
        targetUser: { email: 'fisio@norte.test', name: 'Fede Fisio' },
        description: 'Generó un enlace para restablecer la contraseña',
      },
    ]);
    renderAt();

    expect(await screen.findByText('Enlace para restablecer contraseña')).toBeInTheDocument();
    expect(screen.queryByText('PASSWORD_RESET_LINK_CREATED')).not.toBeInTheDocument();
  });
});
