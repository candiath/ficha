// Cliente HTTP centralizado: adjunta el token JWT en cada request y
// maneja el 401 en un solo lugar (en vez de página por página).
//
// Hay dos instancias, una por sesión: la de la clínica (`api`) y la del
// operador de plataforma (`platformApi`). Cada una guarda su token bajo su
// propia clave y avisa el 401 con su propio evento, así que un 401 de
// plataforma no desloguea la clínica ni al revés — son dos logins distintos
// contra dos secretos distintos, y acá también tienen que estar separados.

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

interface ApiClientConfig {
  /** Clave de localStorage donde vive el token de esta sesión. */
  tokenKey: string;
  /** Evento que se dispara en window cuando la API responde 401. */
  unauthorizedEvent: string;
  /**
   * Path del login de esta sesión. Su 401 queda excluido del manejo global:
   * ahí significa "credenciales incorrectas" y se muestra en el formulario.
   */
  loginPath: string;
}

export interface ApiClient {
  getToken(): string | null;
  setToken(token: string | null): void;
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  delete(path: string): Promise<void>;
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const getToken = () => localStorage.getItem(config.tokenKey);

  const setToken = (token: string | null) => {
    if (token) {
      localStorage.setItem(config.tokenKey, token);
    } else {
      localStorage.removeItem(config.tokenKey);
    }
  };

  async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const token = getToken();
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options?.headers,
      },
    });

    // Token vencido/inválido o cuenta desactivada: la sesión ya no sirve.
    if (res.status === 401 && !path.startsWith(config.loginPath)) {
      setToken(null);
      window.dispatchEvent(new Event(config.unauthorizedEvent));
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Error ${res.status}`);
    }

    if (res.status === 204) return undefined as T;
    const json = await res.json();
    return json.data as T;
  }

  return {
    getToken,
    setToken,
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body: unknown) =>
      request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
    put: <T>(path: string, body: unknown) =>
      request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
    patch: <T>(path: string, body: unknown) =>
      request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (path: string) => request<void>(path, { method: 'DELETE' }),
  };
}

// ── Sesión de la clínica ─────────────────────────────────────────────────────

// Evento global que dispara el cliente cuando la API responde 401.
// AuthProvider lo escucha para limpiar la sesión; así este módulo no
// necesita conocer el router ni ningún contexto de React.
export const UNAUTHORIZED_EVENT = 'ficha:unauthorized';

export const api = createApiClient({
  tokenKey: 'ficha_token',
  unauthorizedEvent: UNAUTHORIZED_EVENT,
  loginPath: '/api/auth/login',
});

export const getToken = api.getToken;
export const setToken = api.setToken;

// ── Sesión del operador de plataforma ────────────────────────────────────────

export const PLATFORM_UNAUTHORIZED_EVENT = 'ficha:platform-unauthorized';

export const platformApi = createApiClient({
  tokenKey: 'ficha_platform_token',
  unauthorizedEvent: PLATFORM_UNAUTHORIZED_EVENT,
  loginPath: '/api/platform/auth/login',
});
