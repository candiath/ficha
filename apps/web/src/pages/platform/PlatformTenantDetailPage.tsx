import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ShieldPlus } from 'lucide-react';
import { toast } from 'sonner';
import type { PlatformUser, UpdateUserInput, UserRole } from '@ficha/shared';
import TenantStatus from '@/components/platform/TenantStatus';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ROLE_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { platformKeys, platformTenantsApi } from '@/services/platform';

const ROLES: UserRole[] = ['ADMIN', 'THERAPIST'];

const ACTION_LABELS: Record<string, string> = {
  TENANT_CREATED: 'Clínica creada',
  TENANT_DEACTIVATED: 'Clínica desactivada',
  TENANT_REACTIVATED: 'Clínica reactivada',
  ADMIN_CREATED: 'ADMIN creada',
  USER_ROLE_CHANGED: 'Cambio de rol',
  USER_ACTIVE_CHANGED: 'Cambio de estado',
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Un cambio que quita acceso o permisos pide confirmación; uno que los da,
// no. Igual que UsersCard en la clínica: el efecto es inmediato.
interface PendingChange {
  title: string;
  description: string;
  run: () => void;
}

export default function PlatformTenantDetailPage() {
  const { tenantId = '' } = useParams();
  const queryClient = useQueryClient();
  const [createAdminOpen, setCreateAdminOpen] = useState(false);
  const [pending, setPending] = useState<PendingChange | null>(null);

  // La lista trae todo lo que hace falta de la clínica; una ruta de detalle
  // no agregaría campos, solo un request.
  const { data: tenants } = useQuery({
    queryKey: platformKeys.tenants,
    queryFn: platformTenantsApi.list,
  });
  const tenant = tenants?.find((t) => t.id === tenantId);

  useEffect(() => {
    document.title = tenant ? `${tenant.name} — Plataforma` : 'Clínica — Plataforma';
  }, [tenant]);

  const { data: users, isLoading, isError } = useQuery({
    queryKey: platformKeys.users(tenantId),
    queryFn: () => platformTenantsApi.users(tenantId),
    enabled: !!tenantId,
  });

  const { data: audit } = useQuery({
    queryKey: platformKeys.audit(tenantId),
    queryFn: () => platformTenantsApi.auditLog(tenantId),
    enabled: !!tenantId,
  });

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: platformKeys.tenants });
    queryClient.invalidateQueries({ queryKey: platformKeys.users(tenantId) });
    queryClient.invalidateQueries({ queryKey: platformKeys.audit(tenantId) });
  }

  const setActive = useMutation({
    mutationFn: (active: boolean) => platformTenantsApi.setActive(tenantId, active),
    onSuccess: (t) => {
      invalidateAll();
      toast.success(t.deactivatedAt ? 'Clínica desactivada' : 'Clínica reactivada');
      setPending(null);
    },
    onError: (err: Error) => {
      toast.error(err.message || 'No se pudo cambiar el estado de la clínica');
      setPending(null);
    },
  });

  const updateUser = useMutation({
    mutationFn: ({ userId, input }: { userId: string; input: UpdateUserInput }) =>
      platformTenantsApi.updateUser(tenantId, userId, input),
    onSuccess: () => {
      invalidateAll();
      setPending(null);
    },
    // El 409 de "última ADMIN activa" llega con el mensaje del servidor.
    onError: (err: Error) => {
      toast.error(err.message || 'No se pudo guardar el cambio');
      setPending(null);
    },
  });

  const busy = setActive.isPending || updateUser.isPending;

  function onRoleChange(u: PlatformUser, role: UserRole) {
    if (role === u.role) return;
    if (role === 'ADMIN') {
      updateUser.mutate({ userId: u.id, input: { role } });
      return;
    }
    setPending({
      title: `¿Quitarle el rol de administración a ${u.name ?? u.email}?`,
      description: 'Deja de poder gestionar usuarios y configuración de la clínica al instante.',
      run: () => updateUser.mutate({ userId: u.id, input: { role } }),
    });
  }

  function onToggleActive(u: PlatformUser) {
    if (!u.isActive) {
      updateUser.mutate({ userId: u.id, input: { isActive: true } });
      return;
    }
    setPending({
      title: `¿Desactivar a ${u.name ?? u.email}?`,
      description: 'Pierde el acceso en su próximo request. Se puede reactivar desde acá.',
      run: () => updateUser.mutate({ userId: u.id, input: { isActive: false } }),
    });
  }

  function onToggleTenant() {
    if (!tenant) return;
    if (tenant.deactivatedAt) {
      setActive.mutate(true);
      return;
    }
    setPending({
      title: `¿Desactivar la clínica "${tenant.name}"?`,
      description:
        'Todo su personal pierde el acceso en el próximo request, aunque tenga la sesión abierta. No se borra nada: reactivarla lo devuelve tal cual.',
      run: () => setActive.mutate(false),
    });
  }

  return (
    <div className="space-y-4">
      <Link
        to="/platform/tenants"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Clínicas
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{tenant?.name ?? '…'}</h1>
          <p className="text-sm text-muted-foreground font-mono">{tenant?.slug}</p>
        </div>
        {tenant && (
          <div className="flex items-center gap-2">
            <TenantStatus tenant={tenant} />
            <Button
              variant={tenant.deactivatedAt ? 'default' : 'outline'}
              size="sm"
              onClick={onToggleTenant}
              disabled={busy}
            >
              {tenant.deactivatedAt ? 'Reactivar clínica' : 'Desactivar clínica'}
            </Button>
          </div>
        )}
      </div>

      {tenant?.deactivatedAt && (
        <p className="text-sm text-destructive">
          Desactivada desde {formatDateTime(tenant.deactivatedAt)}: nadie de esta clínica puede
          entrar.
        </p>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Usuarios</CardTitle>
            <Button variant="outline" size="sm" onClick={() => setCreateAdminOpen(true)}>
              <ShieldPlus className="h-4 w-4" />
              Crear ADMIN
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-muted-foreground">Cargando...</p>}
          {isError && <p className="text-sm text-destructive">No se pudieron cargar los usuarios.</p>}
          {users && users.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Todavía no hay nadie. Creá la primera ADMIN: ella crea al resto desde su propia
              pantalla de Clínica.
            </p>
          )}
          {users && users.length > 0 && (
            <ul className="divide-y">
              {users.map((u) => (
                <li
                  key={u.id}
                  className={cn(
                    'flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between',
                    !u.isActive && 'opacity-60',
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{u.name ?? u.email}</p>
                      {!u.isActive && (
                        <Badge variant="outline" className="text-xs">
                          Inactivo
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Último acceso: {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'nunca'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Select
                      items={ROLE_LABELS}
                      value={u.role}
                      onValueChange={(v) => v !== null && onRoleChange(u, v as UserRole)}
                      disabled={busy}
                    >
                      <SelectTrigger size="sm" aria-label={`Rol de ${u.name ?? u.email}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onToggleActive(u)}
                      disabled={busy}
                    >
                      {u.isActive ? 'Desactivar' : 'Reactivar'}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Historial de la plataforma</CardTitle>
        </CardHeader>
        <CardContent>
          {audit && audit.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin acciones registradas.</p>
          )}
          {audit && audit.length > 0 && (
            <ul className="space-y-2">
              {audit.map((a) => (
                <li key={a.id} className="text-sm flex flex-col sm:flex-row sm:gap-3">
                  <span className="text-xs text-muted-foreground shrink-0 sm:w-36">
                    {formatDateTime(a.createdAt)}
                  </span>
                  <span>
                    <span className="font-medium">{ACTION_LABELS[a.action] ?? a.action}</span>
                    <span className="text-muted-foreground"> · {a.description}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <CreateAdminDialog
        tenantId={tenantId}
        open={createAdminOpen}
        onClose={() => setCreateAdminOpen(false)}
        onCreated={invalidateAll}
      />

      <Dialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending?.title}</DialogTitle>
            <DialogDescription>{pending?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => pending?.run()} disabled={busy}>
              {busy ? 'Guardando...' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateAdminDialog({
  tenantId,
  open,
  onClose,
  onCreated,
}: {
  tenantId: string;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        {open && <CreateAdminForm tenantId={tenantId} onClose={onClose} onCreated={onCreated} />}
      </DialogContent>
    </Dialog>
  );
}

function CreateAdminForm({
  tenantId,
  onClose,
  onCreated,
}: {
  tenantId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Los mismos mínimos que la API; allá se validan igual.
  const error =
    name.trim().length < 2
      ? 'El nombre debe tener al menos 2 caracteres'
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
        ? 'Ingresá un email válido'
        : password.length < 8
          ? 'La contraseña debe tener al menos 8 caracteres'
          : null;

  const mutation = useMutation({
    mutationFn: () =>
      platformTenantsApi.createAdmin(tenantId, {
        name: name.trim(),
        email: email.trim(),
        password,
      }),
    onSuccess: (user) => {
      onCreated();
      toast.success(`${user.email} ya puede entrar como ADMIN`);
      onClose();
    },
    onError: (err: Error) => toast.error(err.message || 'No se pudo crear el ADMIN'),
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Crear ADMIN</DialogTitle>
        <DialogDescription>
          Quien administra la clínica: crea al resto del personal y edita la configuración.
          Pasale la contraseña inicial por un canal seguro; la cambia desde Mi cuenta.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="pa-name">Nombre</Label>
          <Input id="pa-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pa-email">Email</Label>
          <Input
            id="pa-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pa-password">Contraseña inicial</Label>
          <Input
            id="pa-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (name || email || password) && (
          <p className="text-sm text-destructive">{error}</p>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={() => mutation.mutate()} disabled={!!error || mutation.isPending}>
          {mutation.isPending ? 'Creando...' : 'Crear ADMIN'}
        </Button>
      </DialogFooter>
    </>
  );
}
