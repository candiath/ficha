import { AlertTriangle } from 'lucide-react';
import type { PlatformTenant } from '@ficha/shared';
import { Badge } from '@/components/ui/badge';

// El estado de una clínica en una palabra. "Sin ADMIN" es el que le importa
// al operador: es la clínica que todavía necesita que alguien la delegue.
export default function TenantStatus({ tenant }: { tenant: PlatformTenant }) {
  if (tenant.deactivatedAt) {
    return (
      <Badge variant="destructive" className="text-xs">
        Desactivada
      </Badge>
    );
  }
  if (tenant.activeAdmins === 0) {
    return (
      <Badge variant="outline" className="text-xs gap-1">
        <AlertTriangle className="h-3 w-3" />
        Sin ADMIN
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-xs">
      Activa
    </Badge>
  );
}
