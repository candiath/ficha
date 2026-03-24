import { useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import AppLayout from '@/components/layout/AppLayout'
import AccountPage from '@/pages/AccountPage'
import ClinicPage from '@/pages/ClinicPage'
import LandingPage from '@/pages/LandingPage'
import PatientDetailPage from '@/pages/PatientDetailPage'
import PatientsPage from '@/pages/PatientsPage'
import PaymentsPage from '@/pages/PaymentsPage'
import SessionsPage from '@/pages/SessionsPage'
import TechniquesPage from '@/pages/TechniquesPage'

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

export default function App() {
  return (
    <>
      <ApiStatusBanner />
      <Routes>
      <Route index element={<LandingPage />} />
      <Route element={<AppLayout />}>
        <Route path="patients" element={<PatientsPage />} />
        <Route path="patients/:id" element={<PatientDetailPage />} />
        <Route path="sessions" element={<SessionsPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="techniques" element={<TechniquesPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="clinic" element={<ClinicPage />} />
      </Route>
      </Routes>
    </>
  )
}
