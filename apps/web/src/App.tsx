import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'

const LabPage = import.meta.env.DEV ? lazy(() => import('@/pages/LabPage')) : null;
import { AlertTriangle } from 'lucide-react'
import AppLayout from '@/components/layout/AppLayout'
import { useAuth } from '@/contexts/AuthContext'
import AccountPage from '@/pages/AccountPage'
import ClinicPage from '@/pages/ClinicPage'
import DashboardPage from '@/pages/DashboardPage'
import LandingPage from '@/pages/LandingPage'
import LoginPage from '@/pages/LoginPage'
import PatientDetailPage from '@/pages/PatientDetailPage'
import PatientsPage from '@/pages/PatientsPage'
import PaymentsPage from '@/pages/PaymentsPage'
import SessionsPage from '@/pages/SessionsPage'
import AlertsPage from '@/pages/AlertsPage'

// Pantallas que todavía son maqueta: no tienen modelo ni endpoint detrás, así
// que lo único que pueden mostrar son datos inventados. Fuera de desarrollo no
// se montan —el ítem del menú queda deshabilitado (ver AppLayout) y la URL cae
// en el catch-all— pero siguen accesibles en local para seguir trabajándolas.
//
// Van por lazy() como LabPage: así Vite las deja afuera del bundle de
// producción junto con mock-data.ts, en vez de embarcar código muerto.
const DRAFT_PAGES = import.meta.env.DEV
  ? [
      { path: 'agenda', Component: lazy(() => import('@/pages/AgendaPage')) },
      { path: 'turnos', Component: lazy(() => import('@/pages/TurnosPage')) },
      { path: 'exercises', Component: lazy(() => import('@/pages/EjerciciosPage')) },
      { path: 'messages', Component: lazy(() => import('@/pages/MensajesPage')) },
    ]
  : [];

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

function ApiStatusBanner() {
  const [down, setDown] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(4000) });
        if (!cancelled) setDown(!res.ok);
      } catch {
        if (!cancelled) setDown(true);
      }
    }

    check();
    const id = setInterval(check, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!down) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-center gap-2 bg-destructive/10 border-t border-destructive/30 px-4 py-2 text-sm text-destructive">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      No se puede conectar con el servidor. Verificá que la API y la base de datos estén corriendo.
    </div>
  );
}

// Protege todo lo que se renderice dentro. Mientras se valida el token
// guardado no se decide nada (evita el flash de login al recargar); sin
// sesión, redirige a /login recordando a dónde quería ir el usuario.
function RequireAuth() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return null;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

export default function App() {
  return (
    <>
      <ApiStatusBanner />
      <Routes>
      <Route index element={<LandingPage />} />
      <Route path="login" element={<LoginPage />} />
      {import.meta.env.DEV && LabPage && (
        <Route path="lab" element={<Suspense fallback={null}><LabPage /></Suspense>} />
      )}
      <Route element={<RequireAuth />}>
      <Route element={<AppLayout />}>
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="patients" element={<PatientsPage />} />
        <Route path="patients/:id" element={<PatientDetailPage />} />
        <Route path="sessions" element={<SessionsPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="alerts" element={<AlertsPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="clinic" element={<ClinicPage />} />
        {DRAFT_PAGES.map(({ path, Component }) => (
          <Route
            key={path}
            path={path}
            element={<Suspense fallback={null}><Component /></Suspense>}
          />
        ))}
      </Route>
      </Route>
      {/* Cualquier ruta desconocida vuelve al dashboard. Sin esto, una URL que
          no matchea (p. ej. /turnos en producción, o un link viejo) renderiza
          una pantalla en blanco sin ningún indicio de qué pasó. */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </>
  )
}
