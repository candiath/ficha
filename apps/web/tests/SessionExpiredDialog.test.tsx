import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SessionExpiredDialog from '@/components/layout/SessionExpiredDialog';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { useUnsavedChanges } from '@/lib/unsavedChanges';

// A session that ends while a form holds unsaved text must not take the user
// to /login, which would unmount the form and lose a clinical entry. The user
// is kept, a dialog asks for her password over the form, and the text stays.
// Only fetch is mocked: the HTTP client, the token in localStorage, the
// provider and the dialog run for real.

const USER = {
  id: 'u1',
  email: 'ana@example.com',
  name: 'Ana',
  role: 'THERAPIST',
  tenant: { name: 'Clínica', slug: 'clinica' },
};

function response(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: () => Promise.resolve(body ?? {}),
  };
}

// A form like the encounter's: it reports unsaved text while it holds some.
function Form() {
  const [text, setText] = useState('');
  useUnsavedChanges(text !== '');
  return <textarea aria-label="Nota" value={text} onChange={(e) => setText(e.target.value)} />;
}

function Screen() {
  const { user } = useAuth();
  return (
    <>
      <p>{user ? `logged in as ${user.email}` : 'logged out'}</p>
      {user && <Form />}
      <SessionExpiredDialog />
    </>
  );
}

let fetchMock: ReturnType<typeof vi.fn>;
// What the next login answers with: the same user, or another one.
let loginUser = USER;
let loginStatus = 200;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('ficha_token', 'old-token');
  loginUser = USER;
  loginStatus = 200;
  fetchMock = vi.fn((url: string) => {
    if (url.endsWith('/api/auth/me')) return Promise.resolve(response(200, { data: USER }));
    if (url.endsWith('/api/auth/login')) {
      return Promise.resolve(
        loginStatus === 200
          ? response(200, { data: { token: 'new-token', user: loginUser } })
          : response(loginStatus, { error: 'Email o contraseña incorrectos' }),
      );
    }
    if (url.endsWith('/api/auth/logout')) return Promise.resolve(response(204));
    return Promise.resolve(response(401, { error: 'No autenticado' }));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderScreen() {
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <Screen />
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  await screen.findByText(`logged in as ${USER.email}`);
}

// A save the API refuses because the session ended.
async function saveWithExpiredSession() {
  await act(async () => {
    await api.post('/api/patients/p1/encounters', {}).catch(() => {});
  });
}

describe('a session that ends', () => {
  it('logs out as before when no form holds unsaved text', async () => {
    await renderScreen();

    await saveWithExpiredSession();

    expect(await screen.findByText('logged out')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('keeps the form and its text, and asks for the password, when a form holds unsaved text', async () => {
    await renderScreen();
    await userEvent.type(screen.getByLabelText('Nota'), 'Mejoró la movilidad');

    await saveWithExpiredSession();

    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Tu sesión venció');
    expect(screen.getByText(`logged in as ${USER.email}`)).toBeInTheDocument();
    expect(screen.getByLabelText('Nota')).toHaveValue('Mejoró la movilidad');
    expect(localStorage.getItem('ficha_token')).toBeNull();
  });

  it('logs the same user in again with her email, and the text is still there to save', async () => {
    await renderScreen();
    await userEvent.type(screen.getByLabelText('Nota'), 'Mejoró la movilidad');
    await saveWithExpiredSession();
    await screen.findByRole('alertdialog');

    await userEvent.type(screen.getByLabelText(`Contraseña de ${USER.email}`), 'clave');
    await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(localStorage.getItem('ficha_token')).toBe('new-token');
    expect(screen.getByLabelText('Nota')).toHaveValue('Mejoró la movilidad');
    const call = fetchMock.mock.calls.find(([url]) => (url as string).endsWith('/api/auth/login'));
    expect(JSON.parse((call as unknown as [string, RequestInit])[1].body as string)).toEqual({
      email: USER.email,
      password: 'clave',
      trustDevice: false,
    });
  });

  it('shows a wrong password and keeps asking', async () => {
    loginStatus = 401;
    await renderScreen();
    await userEvent.type(screen.getByLabelText('Nota'), 'Mejoró la movilidad');
    await saveWithExpiredSession();
    await screen.findByRole('alertdialog');

    await userEvent.type(screen.getByLabelText(`Contraseña de ${USER.email}`), 'mal');
    await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }));

    expect(await screen.findByText('Email o contraseña incorrectos')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Nota')).toHaveValue('Mejoró la movilidad');
  });

  it('ends the session if the login answers as another user: the form must not save as her', async () => {
    loginUser = { ...USER, id: 'u2' };
    await renderScreen();
    await userEvent.type(screen.getByLabelText('Nota'), 'Mejoró la movilidad');
    await saveWithExpiredSession();
    await screen.findByRole('alertdialog');

    await userEvent.type(screen.getByLabelText(`Contraseña de ${USER.email}`), 'clave');
    await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }));

    expect(await screen.findByText('logged out')).toBeInTheDocument();
    expect(localStorage.getItem('ficha_token')).toBeNull();
  });

  it('lets her leave without saving', async () => {
    await renderScreen();
    await userEvent.type(screen.getByLabelText('Nota'), 'Mejoró la movilidad');
    await saveWithExpiredSession();
    await screen.findByRole('alertdialog');

    await userEvent.click(screen.getByRole('button', { name: 'Salir sin guardar' }));

    expect(await screen.findByText('logged out')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
