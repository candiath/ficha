import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { getToken, setToken, UNAUTHORIZED_EVENT } from '@/lib/api';
import { authApi } from '@/services/auth';
import type { AuthUser } from '@ficha/shared';

interface AuthContextValue {
  user: AuthUser | null;
  // true mientras se valida el token guardado contra /me al arrancar.
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  // Vuelve a pedir /me. Para cuando el perfil cambió del lado del servidor
  // en esta misma sesión: una ADMIN que se cambia el rol a sí misma dejaría
  // de serlo en la API pero seguiría viéndose ADMIN acá hasta recargar.
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  // Arranca en true solo si hay token guardado: hasta validar contra /me
  // no sabemos si esa sesión sigue viva, y ProtectedRoute no debe
  // redirigir al login durante esa ventana (causaría un flash de login
  // en cada recarga para usuarios logueados).
  const [isLoading, setIsLoading] = useState(() => getToken() !== null);

  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    authApi
      .me()
      .then((u) => {
        if (!cancelled) setUser(u);
      })
      .catch(() => {
        // Token vencido o inválido: el cliente HTTP ya lo limpió.
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Cuando cualquier request devuelve 401, el cliente HTTP limpia el token
  // y dispara este evento; acá solo se refleja en el estado de React para
  // que ProtectedRoute redirija al login.
  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { token, user: loggedUser } = await authApi.login(email, password);
    setToken(token);
    setUser(loggedUser);
  }, []);

  // Revokes the session on the server, then forgets it locally whatever the
  // outcome: a failed request (offline, API down, session already gone) must
  // not leave the user logged in on this device. Clearing does not wait for
  // the request, so logging out feels instant.
  const logout = useCallback(() => {
    if (getToken()) {
      authApi.logout().catch(() => {});
    }
    setToken(null);
    setUser(null);
  }, []);

  // Si /me falla con 401 el cliente HTTP ya limpió el token y disparó el
  // evento de arriba; no hay nada más que hacer acá.
  const refresh = useCallback(async () => {
    const u = await authApi.me().catch(() => null);
    if (u) setUser(u);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
