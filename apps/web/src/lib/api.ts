// Cliente HTTP centralizado: adjunta el token JWT en cada request y
// maneja el 401 en un solo lugar (en vez de página por página).

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
const TOKEN_KEY = 'ficha_token';

// Evento global que dispara el cliente cuando la API responde 401.
// AuthProvider lo escucha para limpiar la sesión; así este módulo no
// necesita conocer el router ni ningún contexto de React.
export const UNAUTHORIZED_EVENT = 'ficha:unauthorized';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

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

  // Token vencido/inválido o usuario desactivado: la sesión ya no sirve.
  // El 401 del propio login queda excluido: ahí significa "credenciales
  // incorrectas" y se muestra como error en el formulario.
  if (res.status === 401 && !path.startsWith('/api/auth/login')) {
    setToken(null);
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Error ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  const json = await res.json();
  return json.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path: string) => request<void>(path, { method: 'DELETE' }),
};
