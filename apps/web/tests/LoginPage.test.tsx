import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from '@/pages/LoginPage';

// The "trusted device" checkbox (docs/specs/SPEC-my-sessions.md): unchecked
// by default, and its value reaches login().
const login = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, isLoading: false, login }),
}));

function renderLogin() {
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

async function fillAndSubmit(trust: boolean) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), 'ana@example.com');
  await user.type(screen.getByLabelText('Contraseña'), 'secreta-123');
  if (trust) {
    await user.click(screen.getByRole('checkbox', { name: /Mantener la sesión iniciada/ }));
  }
  await user.click(screen.getByRole('button', { name: 'Ingresar' }));
}

beforeEach(() => {
  login.mockReset().mockResolvedValue(undefined);
});

describe('LoginPage: trusted device', () => {
  it('starts unchecked and logs in without trusting the device', async () => {
    renderLogin();
    expect(screen.getByRole('checkbox', { name: /Mantener la sesión iniciada/ })).not.toBeChecked();

    await fillAndSubmit(false);

    await waitFor(() => expect(login).toHaveBeenCalledWith('ana@example.com', 'secreta-123', false));
  });

  it('when checked, asks to trust this device', async () => {
    renderLogin();

    await fillAndSubmit(true);

    await waitFor(() => expect(login).toHaveBeenCalledWith('ana@example.com', 'secreta-123', true));
  });
});
