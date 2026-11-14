import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VersionSkewNotice, { RECHECK_INTERVAL_MS } from '@/components/layout/VersionSkewNotice';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { api, setToken } from '@/lib/api';
import { recordApiVersion, resetVersionSkewForTests, VersionSkewError } from '@/lib/buildVersion';
import { useUnsavedChanges } from '@/lib/unsavedChanges';

const WEB = '1762700000';
const OLDER = '1762600000';
const NEWER = '1762800000';

// A response of the API client's fetch, with the API's build version.
function respond(apiVersion: string | null, init: { status?: number; body?: unknown } = {}) {
  const status = init.status ?? 200;
  const headers = new Headers(apiVersion ? { 'X-Build-Version': apiVersion } : {});
  return {
    ok: status < 400,
    status,
    headers,
    json: () => Promise.resolve(init.body ?? { data: { answer: 42 } }),
  };
}

function stubFetch(apiVersion: string | null, init?: { status?: number; body?: unknown }) {
  const fetch = vi.fn().mockResolvedValue(respond(apiVersion, init));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

beforeEach(() => {
  vi.stubEnv('VITE_BUILD_VERSION', WEB);
});

afterEach(() => {
  act(() => resetVersionSkewForTests());
  sessionStorage.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the API client, against an API of another build', () => {
  it('reads the response when both come from the same build', async () => {
    stubFetch(WEB);

    await expect(api.get('/api/anything')).resolves.toEqual({ answer: 42 });
  });

  it('refuses to read from a newer API: this web is the old one', async () => {
    stubFetch(NEWER);

    const read = api.get('/api/anything');

    await expect(read).rejects.toBeInstanceOf(VersionSkewError);
    await expect(read).rejects.toThrow('Hay una versión nueva de Ficha. Recargá para seguir.');
  });

  it('refuses to read from an older API: its deploy has not finished', async () => {
    stubFetch(OLDER);

    await expect(api.get('/api/anything')).rejects.toThrow('Estamos actualizando Ficha, probá en unos minutos.');
  });

  it('lets a write through: it already happened on the server', async () => {
    stubFetch(NEWER);

    await expect(api.post('/api/anything', {})).resolves.toEqual({ answer: 42 });
  });

  it('does not check without a version of the web (the dev server)', async () => {
    vi.stubEnv('VITE_BUILD_VERSION', '');
    stubFetch(NEWER);

    await expect(api.get('/api/anything')).resolves.toEqual({ answer: 42 });
  });

  it('does not check without a version of the API (`npm run dev:api`)', async () => {
    stubFetch(null);

    await expect(api.get('/api/anything')).resolves.toEqual({ answer: 42 });
  });
});

function DirtyForm() {
  useUnsavedChanges(true);
  return null;
}

describe('the notice of a web out of step with the API', () => {
  it('says nothing while both agree', () => {
    render(<VersionSkewNotice />);

    act(() => void recordApiVersion(WEB));

    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asks for a reload when the web is older, and reloads only on the button', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    render(<VersionSkewNotice />);

    act(() => void recordApiVersion(NEWER));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('Hay una versión nueva de Ficha');
    expect(dialog.textContent).toContain('Recargá para seguir.');
    expect(dialog.textContent).not.toContain('sin guardar');
    expect(reload).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Recargar' }));

    expect(reload).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem('ficha:reloaded-for-build')).toBe(NEWER);
  });

  it('warns about unsaved changes, and lets the user go back to the form', async () => {
    render(
      <>
        <DirtyForm />
        <VersionSkewNotice />
      </>,
    );

    act(() => void recordApiVersion(NEWER));

    expect(screen.getByRole('alertdialog').textContent).toContain('Tenés cambios sin guardar: si recargás, se pierden.');

    await userEvent.click(screen.getByRole('button', { name: 'Volver al formulario' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Hay una versión nueva de Ficha');
    expect(screen.getByRole('button', { name: 'Recargar' })).toBeInTheDocument();
  });

  it('does not ask for a second reload when the first one brought back the same web', () => {
    sessionStorage.setItem('ficha:reloaded-for-build', NEWER);
    render(<VersionSkewNotice />);

    act(() => void recordApiVersion(NEWER));

    expect(screen.getByRole('alertdialog').textContent).toContain('Estamos actualizando Ficha');
  });

  it('waits for an older API without a reload button, and goes away when its deploy finishes', async () => {
    vi.useFakeTimers();
    const fetch = stubFetch(OLDER);
    render(<VersionSkewNotice />);

    act(() => void recordApiVersion(OLDER));

    expect(screen.getByRole('alertdialog').textContent).toContain('Estamos actualizando Ficha');
    expect(screen.queryByRole('button', { name: 'Recargar' })).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(RECHECK_INTERVAL_MS));
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/health$/));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    fetch.mockResolvedValue(respond(WEB));
    await act(() => vi.advanceTimersByTimeAsync(RECHECK_INTERVAL_MS));

    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

function WhoIsLoggedIn() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <p>cargando</p>;
  return <p>{user ? user.email : 'sin sesión'}</p>;
}

describe('the session, while the API deploy is running', () => {
  afterEach(() => {
    setToken(null);
  });

  it('is not taken for logged out: /me is asked again once the API catches up', async () => {
    setToken('a-session-token');
    const fetch = stubFetch(OLDER);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <WhoIsLoggedIn />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await screen.findByText('cargando');
    await act(() => Promise.resolve());
    expect(fetch).toHaveBeenCalledOnce();
    expect(screen.getByText('cargando')).toBeInTheDocument();

    fetch.mockResolvedValue(respond(WEB, { body: { data: { email: 'admin@ficha.dev' } } }));
    act(() => void recordApiVersion(WEB));

    expect(await screen.findByText('admin@ficha.dev')).toBeInTheDocument();
  });
});
