import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantUser } from '@ficha/shared';
import UsersCard from '@/components/clinic/UsersCard';
import { usersApi } from '@/services/users';

// Se mockea la capa HTTP y la sesión; la tabla, el select de rol, la
// confirmación y la mutación de react-query corren de verdad.
vi.mock('@/services/users', () => ({
  userKeys: { list: ['users'] },
  usersApi: { list: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

const refresh = vi.fn().mockResolvedValue(undefined);
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-yo', email: 'yo@clinica.test', name: 'Yo Admin', role: 'ADMIN' },
    refresh,
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from 'sonner';

const list = vi.mocked(usersApi.list);
const update = vi.mocked(usersApi.update);

const YO: TenantUser = {
  id: 'u-yo',
  email: 'yo@clinica.test',
  name: 'Yo Admin',
  role: 'ADMIN',
  isActive: true,
  lastLoginAt: null,
  tenant: { name: 'Clínica', slug: 'clinica' },
};

const COLEGA: TenantUser = {
  id: 'u-colega',
  email: 'colega@clinica.test',
  name: 'Colega Fisio',
  role: 'THERAPIST',
  isActive: true,
  lastLoginAt: '2026-09-10T12:00:00.000Z',
  tenant: { name: 'Clínica', slug: 'clinica' },
};

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <UsersCard />
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

beforeEach(() => {
  vi.clearAllMocks();
  list.mockResolvedValue([YO, COLEGA]);
});

describe('UsersCard', () => {
  it('lista los usuarios con su rol y marca la cuenta propia', async () => {
    renderCard();

    const yo = await fila('Yo Admin');
    expect(yo.getByText('Vos')).toBeInTheDocument();
    // Solo la fila propia tiene el botón de desactivar deshabilitado: la API
    // lo rechaza con 400, así que no se ofrece.
    expect(yo.getByRole('button', { name: 'Desactivar' })).toBeDisabled();

    const colega = await fila('Colega Fisio');
    expect(colega.getByRole('button', { name: 'Desactivar' })).toBeEnabled();
    expect(colega.getByRole('combobox', { name: 'Rol de Colega Fisio' })).toHaveTextContent(
      'Fisioterapeuta',
    );
  });

  it('ascender a ADMIN llama a la API sin pedir confirmación', async () => {
    update.mockResolvedValue({ ...COLEGA, role: 'ADMIN' });
    renderCard();

    await elegirRol('Colega Fisio', 'Administrador');

    await waitFor(() => expect(update).toHaveBeenCalledWith('u-colega', { role: 'ADMIN' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('degradar pide confirmación y recién ahí llama a la API', async () => {
    list.mockResolvedValue([YO, { ...COLEGA, role: 'ADMIN' }]);
    update.mockResolvedValue({ ...COLEGA, role: 'THERAPIST' });
    renderCard();

    const user = await elegirRol('Colega Fisio', 'Fisioterapeuta');

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('¿Quitarle el rol de administración a Colega Fisio?');
    expect(update).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('u-colega', { role: 'THERAPIST' }),
    );
  });

  it('cancelar la confirmación no toca la API', async () => {
    renderCard();

    const user = userEvent.setup();
    const colega = await fila('Colega Fisio');
    await user.click(colega.getByRole('button', { name: 'Desactivar' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(update).not.toHaveBeenCalled();
  });

  it('el 409 de la última ADMIN se muestra con el mensaje del servidor', async () => {
    update.mockRejectedValue(
      new Error('La clínica tiene que conservar al menos una persona administradora activa'),
    );
    renderCard();

    const user = await elegirRol('Yo Admin', 'Fisioterapeuta');
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmar' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'La clínica tiene que conservar al menos una persona administradora activa',
      ),
    );
    // Nada cambió, así que la sesión no se vuelve a pedir.
    expect(refresh).not.toHaveBeenCalled();
  });

  it('cambiar el rol propio vuelve a pedir la sesión', async () => {
    list.mockResolvedValue([YO, { ...COLEGA, role: 'ADMIN' }]);
    update.mockResolvedValue({ ...YO, role: 'THERAPIST' });
    renderCard();

    const user = await elegirRol('Yo Admin', 'Fisioterapeuta');
    const dialog = await screen.findByRole('dialog');
    // El texto avisa que el cambio es sobre una misma y es inmediato.
    expect(dialog).toHaveTextContent('Vas a dejar de administrar la clínica');
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(update).toHaveBeenCalledWith('u-yo', { role: 'THERAPIST' }));
    // Sin esto el AuthContext seguiría diciendo ADMIN y la tarjeta seguiría
    // visible, con la próxima acción respondiendo 403.
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});
