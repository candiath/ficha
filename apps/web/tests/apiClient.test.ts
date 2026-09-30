import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, platformApi, PLATFORM_UNAUTHORIZED_EVENT, UNAUTHORIZED_EVENT } from '@/lib/api';

// Las dos sesiones —clínica y operador de plataforma— comparten el módulo
// pero no el token ni el evento de 401. Si esto se rompe, un 401 de un lado
// desloguea al otro, o peor: un request de plataforma sale con el token de
// la clínica.

function mockFetch(status: number, body: unknown = {}) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function authHeader(fetchMock: ReturnType<typeof vi.fn>): string | undefined {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return (init.headers as Record<string, string>).Authorization;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('dos clientes, dos sesiones', () => {
  it('cada uno guarda y manda su propio token', async () => {
    api.setToken('token-clinica');
    platformApi.setToken('token-plataforma');

    expect(localStorage.getItem('ficha_token')).toBe('token-clinica');
    expect(localStorage.getItem('ficha_platform_token')).toBe('token-plataforma');

    let fetchMock = mockFetch(200, { data: [] });
    await api.get('/api/patients');
    expect(authHeader(fetchMock)).toBe('Bearer token-clinica');

    fetchMock = mockFetch(200, { data: [] });
    await platformApi.get('/api/platform/tenants');
    expect(authHeader(fetchMock)).toBe('Bearer token-plataforma');
  });

  it('un 401 de plataforma borra solo el token de plataforma y avisa solo a su sesión', async () => {
    api.setToken('token-clinica');
    platformApi.setToken('token-plataforma');
    const clinica = vi.fn();
    const plataforma = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, clinica);
    window.addEventListener(PLATFORM_UNAUTHORIZED_EVENT, plataforma);

    mockFetch(401, { error: 'Sesión expirada o inválida' });
    await expect(platformApi.get('/api/platform/tenants')).rejects.toThrow();

    expect(localStorage.getItem('ficha_platform_token')).toBeNull();
    expect(localStorage.getItem('ficha_token')).toBe('token-clinica');
    expect(plataforma).toHaveBeenCalledTimes(1);
    expect(clinica).not.toHaveBeenCalled();

    window.removeEventListener(UNAUTHORIZED_EVENT, clinica);
    window.removeEventListener(PLATFORM_UNAUTHORIZED_EVENT, plataforma);
  });

  it('un 401 de la clínica no toca la sesión de plataforma', async () => {
    api.setToken('token-clinica');
    platformApi.setToken('token-plataforma');
    const plataforma = vi.fn();
    window.addEventListener(PLATFORM_UNAUTHORIZED_EVENT, plataforma);

    mockFetch(401, { error: 'Sesión expirada o inválida' });
    await expect(api.get('/api/auth/me')).rejects.toThrow();

    expect(localStorage.getItem('ficha_token')).toBeNull();
    expect(localStorage.getItem('ficha_platform_token')).toBe('token-plataforma');
    expect(plataforma).not.toHaveBeenCalled();

    window.removeEventListener(PLATFORM_UNAUTHORIZED_EVENT, plataforma);
  });

  // En el login el 401 significa "credenciales incorrectas": se muestra en el
  // formulario y no debe disparar el cierre de sesión.
  it('el 401 del propio login de plataforma no dispara el evento', async () => {
    const plataforma = vi.fn();
    window.addEventListener(PLATFORM_UNAUTHORIZED_EVENT, plataforma);

    mockFetch(401, { error: 'Email o contraseña incorrectos' });
    await expect(
      platformApi.post('/api/platform/auth/login', { email: 'a@b.c', password: 'x' }),
    ).rejects.toThrow('Email o contraseña incorrectos');

    expect(plataforma).not.toHaveBeenCalled();
    window.removeEventListener(PLATFORM_UNAUTHORIZED_EVENT, plataforma);
  });
});
