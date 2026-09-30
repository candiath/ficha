import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { PlatformAuthProvider, usePlatformAuth } from '@/contexts/PlatformAuthContext';
import PlatformLayout from '@/pages/platform/PlatformLayout';
import PlatformLoginPage from '@/pages/platform/PlatformLoginPage';
import PlatformTenantDetailPage from '@/pages/platform/PlatformTenantDetailPage';
import PlatformTenantsPage from '@/pages/platform/PlatformTenantsPage';

// El subárbol /platform/* entero, en un solo chunk (App.tsx lo carga con
// lazy): su provider de sesión, su login y sus pantallas. No comparte nada
// con la app clínica salvo los componentes de UI. Un operador logueado no
// tiene un solo link a /patients, y aunque tipee la URL, RequireAuth no
// encuentra el token de la clínica y lo manda a /login.

// Espejo de RequireAuth, contra la sesión de plataforma.
function RequirePlatformAuth() {
  const { operator, isLoading } = usePlatformAuth();
  const location = useLocation();

  if (isLoading) return null;
  if (!operator) {
    return <Navigate to="/platform/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

export default function PlatformApp() {
  return (
    <PlatformAuthProvider>
      <Routes>
        <Route path="login" element={<PlatformLoginPage />} />
        <Route element={<RequirePlatformAuth />}>
          <Route element={<PlatformLayout />}>
            <Route index element={<Navigate to="tenants" replace />} />
            <Route path="tenants" element={<PlatformTenantsPage />} />
            <Route path="tenants/:tenantId" element={<PlatformTenantDetailPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/platform/tenants" replace />} />
      </Routes>
    </PlatformAuthProvider>
  );
}
