import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ResetPasswordPage from '@/pages/ResetPasswordPage';
import { passwordResetApi } from '@/services/auth';

// The public reset page (docs/specs/SPEC-password-reset.md). Only the HTTP
// layer is mocked; routing runs for real, so the address after load and the
// landing on /login are what a user would see.
vi.mock('@/services/auth', () => ({
  passwordResetApi: { check: vi.fn(), reset: vi.fn() },
}));

const check = vi.mocked(passwordResetApi.check);
const reset = vi.mocked(passwordResetApi.reset);

// The address as the user would see it in the bar.
function LocationProbe() {
  const { pathname, search, hash } = useLocation();
  return <output aria-label="address">{pathname + search + hash}</output>;
}
const address = () => screen.getByLabelText('address').textContent;

function LoginStub() {
  const { state } = useLocation();
  return <p>login: {(state as { notice?: string } | null)?.notice}</p>;
}

function renderAt(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <LocationProbe />
      <Routes>
        <Route path="restablecer-contrasena" element={<ResetPasswordPage />} />
        <Route path="login" element={<LoginStub />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fill(password: string, confirmation: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Contraseña nueva'), password);
  await user.type(screen.getByLabelText('Repetí la contraseña nueva'), confirmation);
  await user.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  check.mockResolvedValue({ email: 'fisio@clinica.test', name: 'Fede Fisio' });
  reset.mockResolvedValue(undefined);
});

describe('ResetPasswordPage', () => {
  it('checks the token from the fragment, then takes it out of the address bar', async () => {
    renderAt('/restablecer-contrasena#tok_abc');

    expect(await screen.findByText('fisio@clinica.test')).toBeInTheDocument();
    expect(check).toHaveBeenCalledWith('tok_abc');
    await waitFor(() => expect(address()).toBe('/restablecer-contrasena'));
  });

  it('an invalid link shows the API message and who to ask', async () => {
    check.mockRejectedValue(new Error('El enlace no es válido o ya venció'));
    renderAt('/restablecer-contrasena#tok_viejo');

    expect(await screen.findByText('El enlace no es válido o ya venció')).toBeInTheDocument();
    expect(screen.getByText('Pedile un enlace nuevo a quien te lo envió.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Contraseña nueva')).not.toBeInTheDocument();
  });

  it('without a token, says the link is invalid and calls nothing', async () => {
    renderAt('/restablecer-contrasena');

    expect(await screen.findByText('El enlace no es válido o ya venció')).toBeInTheDocument();
    expect(check).not.toHaveBeenCalled();
  });

  it('catches a short password before submitting', async () => {
    renderAt('/restablecer-contrasena#tok_abc');

    await fill('corta', 'corta');

    expect(await screen.findByText('La contraseña debe tener al menos 8 caracteres')).toBeInTheDocument();
    expect(reset).not.toHaveBeenCalled();
  });

  it('catches a mismatched confirmation before submitting', async () => {
    renderAt('/restablecer-contrasena#tok_abc');

    await fill('una-larga-1', 'una-larga-2');

    expect(await screen.findByText('Las contraseñas no coinciden')).toBeInTheDocument();
    expect(reset).not.toHaveBeenCalled();
  });

  it('shows the API error, e.g. a link used meanwhile', async () => {
    reset.mockRejectedValue(new Error('El enlace no es válido o ya venció'));
    renderAt('/restablecer-contrasena#tok_abc');

    await fill('una-larga-1', 'una-larga-1');

    expect(await screen.findByText('El enlace no es válido o ya venció')).toBeInTheDocument();
    expect(address()).toBe('/restablecer-contrasena');
  });

  it('on success sends the token in the body and lands on /login with the message', async () => {
    renderAt('/restablecer-contrasena#tok_abc');

    await fill('una-larga-1', 'una-larga-1');

    expect(reset).toHaveBeenCalledWith('tok_abc', 'una-larga-1');
    expect(
      await screen.findByText('login: Listo, ya podés ingresar con tu contraseña nueva'),
    ).toBeInTheDocument();
    expect(address()).toBe('/login');
  });
});
