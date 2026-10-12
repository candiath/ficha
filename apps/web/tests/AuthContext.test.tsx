import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
      <button onClick={() => void auth.login(USER.email, 'clave')}>Log in</button>
    </>
  );
}

async function renderLoggedIn(queryClient = new QueryClient()) {
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
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

  // The next person on the same tab must not see the previous user's records
  // from the cache, which no access log would ever see (#186,
  // SPEC-list-minimization.md §7).
  it('forgets every cached record', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(url.endsWith('/api/auth/me') ? response(200, { data: USER }) : response(204)),
      ),
    );
    const queryClient = new QueryClient();
    await renderLoggedIn(queryClient);
    queryClient.setQueryData(['patients', 'p1', 'sessions'], [{ observations: 'Notas clínicas' }]);

    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(await screen.findByText('logged out')).toBeInTheDocument();
    expect(queryClient.getQueryData(['patients', 'p1', 'sessions'])).toBeUndefined();
  });
});

describe('login', () => {
  // A session that expired (a 401) leaves the cache behind: logging in starts
  // the next user from an empty one.
  it('starts from an empty cache', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          url.endsWith('/api/auth/login')
            ? response(200, { data: { token: 'new-token', user: USER } })
            : response(200, { data: USER }),
        ),
      ),
    );
    const queryClient = new QueryClient();
    await renderLoggedIn(queryClient);
    queryClient.setQueryData(['patients', 'p1', 'sessions'], [{ observations: 'Notas clínicas' }]);

    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(localStorage.getItem('ficha_token')).toBe('new-token'));
    expect(queryClient.getQueryData(['patients', 'p1', 'sessions'])).toBeUndefined();
  });
});
