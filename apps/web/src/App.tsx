import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'

const LabPage = import.meta.env.DEV ? lazy(() => import('@/pages/LabPage')) : null;
import { AlertTriangle } from 'lucide-react'
import AppLayout from '@/components/layout/AppLayout'
import { useAuth } from '@/contexts/AuthContext'
import AccountPage from '@/pages/AccountPage'
import AgendaPage from '@/pages/AgendaPage'
import ClinicPage from '@/pages/ClinicPage'
import DashboardPage from '@/pages/DashboardPage'
import EjerciciosPage from '@/pages/EjerciciosPage'
import LandingPage from '@/pages/LandingPage'
import LoginPage from '@/pages/LoginPage'
import MensajesPage from '@/pages/MensajesPage'
import PatientDetailPage from '@/pages/PatientDetailPage'
import PatientsPage from '@/pages/PatientsPage'
import PaymentsPage from '@/pages/PaymentsPage'
import SessionsPage from '@/pages/SessionsPage'
import TechniquesPage from '@/pages/TechniquesPage'
import TurnosPage from '@/pages/TurnosPage'
import AlertsPage from '@/pages/AlertsPage'

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
        <Route path="agenda" element={<AgendaPage />} />
        <Route path="patients" element={<PatientsPage />} />
        <Route path="patients/:id" element={<PatientDetailPage />} />
        <Route path="turnos" element={<TurnosPage />} />
        <Route path="sessions" element={<SessionsPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="alerts" element={<AlertsPage />} />
        <Route path="techniques" element={<TechniquesPage />} />
        <Route path="exercises" element={<EjerciciosPage />} />
        <Route path="messages" element={<MensajesPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="clinic" element={<ClinicPage />} />
      </Route>
      </Route>
      </Routes>
    </>
  )
}
