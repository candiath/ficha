import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getToken, setToken, UNAUTHORIZED_EVENT } from '@/lib/api';
import { useVersionSkew, VersionSkewError } from '@/lib/buildVersion';
import { authApi } from '@/services/auth';
import type { AuthUser } from '@ficha/shared';

interface AuthContextValue {
  user: AuthUser | null;
  // true mientras se valida el token guardado contra /me al arrancar.
  isLoading: boolean;
  // trustDevice: "Mantener la sesión iniciada en este dispositivo".
  login: (email: string, password: string, trustDevice?: boolean) => Promise<void>;
  logout: () => void;
  // Vuelve a pedir /me. Para cuando el perfil cambió del lado del servidor
  // en esta misma sesión: una ADMIN que se cambia el rol a sí misma dejaría
  // de serlo en la API pero seguiría viéndose ADMIN acá hasta recargar.
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  // Arranca en true solo si hay token guardado: hasta validar contra /me
  // no sabemos si esa sesión sigue viva, y ProtectedRoute no debe
  // redirigir al login durante esa ventana (causaría un flash de login
  // en cada recarga para usuarios logueados).
  const [isLoading, setIsLoading] = useState(() => getToken() !== null);

  // While the web is out of step with the API, /me is refused
  // (lib/buildVersion.ts) and says nothing about the session: it stays loading
  // behind the notice, and /me is asked again once the two agree. Otherwise an
  // API deploy that finishes by itself would leave the user on the login page.
  const versionSkewed = useVersionSkew() !== null;

  useEffect(() => {
    if (!isLoading || versionSkewed || !getToken()) return;
    let cancelled = false;
    authApi
      .me()
      .then((u) => {
        if (cancelled) return;
        setUser(u);
        setIsLoading(false);
      })
      .catch((err) => {
        if (cancelled || err instanceof VersionSkewError) return;
        // Token vencido o inválido: el cliente HTTP ya lo limpió.
        setUser(null);
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isLoading, versionSkewed]);

  // Cuando cualquier request devuelve 401, el cliente HTTP limpia el token
  // y dispara este evento; acá solo se refleja en el estado de React para
  // que ProtectedRoute redirija al login.
  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const login = useCallback(async (email: string, password: string, trustDevice = false) => {
    const { token, user: loggedUser } = await authApi.login(email, password, trustDevice);
    // A session that ended with a 401 leaves its cache behind: the next user
    // starts from an empty one (#186, SPEC-list-minimization.md §7).
    queryClient.clear();
    setToken(token);
    setUser(loggedUser);
  }, [queryClient]);

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
    // Records read in this session stay out of reach of the next person on
    // this tab, whose views no access log would ever see (#186).
    queryClient.clear();
  }, [queryClient]);

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
