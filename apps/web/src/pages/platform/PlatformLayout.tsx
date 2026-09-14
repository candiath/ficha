import { LogOut, ShieldCheck } from 'lucide-react';
import { Link, Outlet } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { usePlatformAuth } from '@/contexts/PlatformAuthContext';

// Layout mínimo del operador: una barra con quién está logueado y salir.
// Sin sidebar y sin un solo link a la app clínica, a propósito.
export default function PlatformLayout() {
  const { operator, logout } = usePlatformAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto max-w-4xl px-4 h-12 flex items-center gap-3">
          <Link to="/platform/tenants" className="flex items-center gap-2 font-semibold tracking-tight">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Ficha · Plataforma
          </Link>
          <div className="flex-1" />
          <span className="text-xs text-muted-foreground truncate max-w-48">
            {operator?.name ?? operator?.email}
          </span>
          <Button variant="ghost" size="sm" onClick={logout}>
            <LogOut className="h-4 w-4" />
            Salir
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
