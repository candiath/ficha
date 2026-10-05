import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChangePasswordDialog from '@/components/account/ChangePasswordDialog';
import { authApi } from '@/services/auth';

// Only the HTTP layer is mocked: the form, the zod validation and the
// react-query mutation run for real — they are what these tests cover.
vi.mock('@/services/auth', () => ({
  authApi: { changePassword: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from 'sonner';

const changePassword = vi.mocked(authApi.changePassword);

function renderDialog(props?: { open?: boolean; onClose?: () => void }) {
  const onClose = props?.onClose ?? vi.fn();
  // retry: false — el default de react-query reintenta 3 veces con backoff
  // y el test del camino de error tardaría segundos en ver el onError.
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ChangePasswordDialog open={props?.open ?? true} onClose={onClose} />
    </QueryClientProvider>
  );
  return { view, onClose, queryClient };
}

async function fillForm(values: { current?: string; nueva?: string; repetir?: string }) {
  const user = userEvent.setup();
  if (values.current) {
    await user.type(screen.getByLabelText('Contraseña actual'), values.current);
  }
  if (values.nueva) {
    await user.type(screen.getByLabelText('Contraseña nueva'), values.nueva);
  }
  if (values.repetir) {
    await user.type(screen.getByLabelText('Repetir contraseña nueva'), values.repetir);
  }
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('validación (sin tocar la API)', () => {
  it('submit vacío muestra los mensajes y no llama a la API', async () => {
    renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Ingresá tu contraseña actual')).toBeInTheDocument();
    expect(
      screen.getByText('La contraseña debe tener al menos 8 caracteres')
    ).toBeInTheDocument();
    expect(screen.getByText('Repetí la contraseña nueva')).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('contraseñas que no coinciden', async () => {
    renderDialog();
    const user = await fillForm({
      current: 'actual-123',
      nueva: 'nueva-segura-1',
      repetir: 'nueva-segura-2',
    });

    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Las contraseñas no coinciden')).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('nueva igual a la actual', async () => {
    renderDialog();
    const user = await fillForm({
      current: 'misma-clave-1',
      nueva: 'misma-clave-1',
      repetir: 'misma-clave-1',
    });

    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(
      await screen.findByText('La contraseña nueva debe ser distinta de la actual')
    ).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });
});

describe('flujo exitoso', () => {
  it('calls the API, keeps the current session token and closes', async () => {
    changePassword.mockResolvedValue(undefined);
    localStorage.setItem('ficha_token', 'session-token');
    const { onClose } = renderDialog();
    const user = await fillForm({
      current: 'actual-123',
      nueva: 'nueva-segura-1',
      repetir: 'nueva-segura-1',
    });

    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(changePassword).toHaveBeenCalledWith('actual-123', 'nueva-segura-1');
    // The session that made the change survives it: the token is untouched.
    expect(localStorage.getItem('ficha_token')).toBe('session-token');
    expect(toast.success).toHaveBeenCalledWith('Contraseña actualizada');
  });

  it('deshabilita el botón mientras la request está en vuelo', async () => {
    // Promesa que nunca resuelve: congela la mutación en estado pending.
    changePassword.mockImplementation(() => new Promise(() => {}));
    renderDialog();
    const user = await fillForm({
      current: 'actual-123',
      nueva: 'nueva-segura-1',
      repetir: 'nueva-segura-1',
    });

    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    const boton = await screen.findByRole('button', { name: 'Guardando…' });
    expect(boton).toBeDisabled();
  });
});

describe('camino de error', () => {
  it('muestra el mensaje del servidor y no cierra el diálogo', async () => {
    changePassword.mockRejectedValue(new Error('La contraseña actual no es correcta'));
    localStorage.setItem('ficha_token', 'token-viejo');
    const { onClose } = renderDialog();
    const user = await fillForm({
      current: 'actual-mal',
      nueva: 'nueva-segura-1',
      repetir: 'nueva-segura-1',
    });

    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('La contraseña actual no es correcta')
    );
    // Un typo no debe costar lo escrito ni la sesión.
    expect(onClose).not.toHaveBeenCalled();
    expect(localStorage.getItem('ficha_token')).toBe('token-viejo');
  });
});

describe('higiene del formulario', () => {
  it('al reabrir, los campos del intento anterior quedan vacíos', async () => {
    changePassword.mockRejectedValue(new Error('La contraseña actual no es correcta'));
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <ChangePasswordDialog open onClose={vi.fn()} />
      </QueryClientProvider>
    );
    await fillForm({ current: 'algo-escrito', nueva: 'nueva-segura-1' });

    rerender(
      <QueryClientProvider client={queryClient}>
        <ChangePasswordDialog open={false} onClose={vi.fn()} />
      </QueryClientProvider>
    );
    rerender(
      <QueryClientProvider client={queryClient}>
        <ChangePasswordDialog open onClose={vi.fn()} />
      </QueryClientProvider>
    );

    expect(screen.getByLabelText('Contraseña actual')).toHaveValue('');
    expect(screen.getByLabelText('Contraseña nueva')).toHaveValue('');
  });
});

// The same dialog serves the platform operator by injecting the call. What
// matters is that nothing crosses over: the injected session is the one
// called, and the clinic's token stays untouched.
describe('con otra sesión inyectada', () => {
  it('uses that session\'s changePassword, not the clinic\'s', async () => {
    const otraChangePassword = vi.fn().mockResolvedValue(undefined);
    localStorage.setItem('ficha_token', 'token-clinica');
    const onClose = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <ChangePasswordDialog
          open
          onClose={onClose}
          session={{ changePassword: otraChangePassword }}
        />
      </QueryClientProvider>
    );
    const user = await fillForm({
      current: 'actual-123',
      nueva: 'nueva-segura-1',
      repetir: 'nueva-segura-1',
    });

    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(otraChangePassword).toHaveBeenCalledWith('actual-123', 'nueva-segura-1');
    expect(changePassword).not.toHaveBeenCalled();
    expect(localStorage.getItem('ficha_token')).toBe('token-clinica');
  });
});
