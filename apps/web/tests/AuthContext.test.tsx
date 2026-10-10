import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';

// Logout revokes the session on the server and forgets it locally. Only fetch
// is mocked: the HTTP client, the token in localStorage and the provider run
// for real.

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
    json: () => Promise.resolve(body ?? {}),
  };
}

function Probe() {
  const auth = useAuth();
  return (
    <>
      <p>{auth.user ? `logged in as ${auth.user.email}` : 'logged out'}</p>
      <button onClick={auth.logout}>Log out</button>
    </>
  );
}

async function renderLoggedIn() {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await screen.findByText(`logged in as ${USER.email}`);
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('ficha_token', 'session-token');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('logout', () => {
  it('revokes the session on the server with the current token, then clears it', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(url.endsWith('/api/auth/me') ? response(200, { data: USER }) : response(204)),
    );
    vi.stubGlobal('fetch', fetchMock);
    await renderLoggedIn();

    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(await screen.findByText('logged out')).toBeInTheDocument();
    expect(localStorage.getItem('ficha_token')).toBeNull();
    const call = fetchMock.mock.calls.find(([url]) => url.endsWith('/api/auth/logout'));
    expect(call).toBeDefined();
    const init = (call as unknown as [string, RequestInit])[1];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer session-token');
  });

  it('logs out locally even when the server cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.endsWith('/api/auth/me')
          ? Promise.resolve(response(200, { data: USER }))
          : Promise.reject(new TypeError('Failed to fetch')),
      ),
    );
    await renderLoggedIn();

    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(await screen.findByText('logged out')).toBeInTheDocument();
    expect(localStorage.getItem('ficha_token')).toBeNull();
    // Let the rejected request settle: it must not surface as an error.
    await waitFor(() => expect(localStorage.getItem('ficha_token')).toBeNull());
  });
});
