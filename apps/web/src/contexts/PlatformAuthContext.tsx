import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { platformApi, PLATFORM_UNAUTHORIZED_EVENT } from '@/lib/api';
import { platformAuthApi } from '@/services/platform';
import type { PlatformOperator } from '@ficha/shared';

// La sesión del operador de plataforma. Es un contexto aparte de
// AuthContext a propósito: no comparten token, ni evento de 401, ni estado.
// Un operador logueado no tiene forma de "ser" un usuario de clínica desde
// acá, y la app clínica no sabe que este contexto existe. Solo se monta
// debajo de /platform.
interface PlatformAuthContextValue {
  operator: PlatformOperator | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const PlatformAuthContext = createContext<PlatformAuthContextValue | null>(null);

export function PlatformAuthProvider({ children }: { children: ReactNode }) {
  const [operator, setOperator] = useState<PlatformOperator | null>(null);
  const [isLoading, setIsLoading] = useState(() => platformApi.getToken() !== null);

  useEffect(() => {
    if (!platformApi.getToken()) return;
    let cancelled = false;
    platformAuthApi
      .me()
      .then((op) => {
        if (!cancelled) setOperator(op);
      })
      .catch(() => {
        if (!cancelled) setOperator(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onUnauthorized = () => setOperator(null);
    window.addEventListener(PLATFORM_UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(PLATFORM_UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { token, operator: op } = await platformAuthApi.login(email, password);
    platformApi.setToken(token);
    setOperator(op);
  }, []);

  const logout = useCallback(() => {
    platformApi.setToken(null);
    setOperator(null);
  }, []);

  return (
    <PlatformAuthContext.Provider value={{ operator, isLoading, login, logout }}>
      {children}
    </PlatformAuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePlatformAuth(): PlatformAuthContextValue {
  const ctx = useContext(PlatformAuthContext);
  if (!ctx) throw new Error('usePlatformAuth debe usarse dentro de <PlatformAuthProvider>');
  return ctx;
}
