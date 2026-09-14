import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import type { TenantUser, UpdateUserInput, UserRole } from '@ficha/shared';
import UserCreateDialog from '@/components/clinic/UserCreateDialog';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { ROLE_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { userKeys, usersApi } from '@/services/users';

const ROLES: UserRole[] = ['ADMIN', 'THERAPIST'];

function formatLastLogin(iso: string | null): string {
  if (!iso) return 'Nunca ingresó';
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Un cambio que le quita acceso o permisos a alguien pide confirmación; uno
// que se los da, no. Desactivar y degradar son reversibles, pero al instante:
// authenticate lee rol y estado de la DB en cada request.
interface PendingChange {
  user: TenantUser;
  input: UpdateUserInput;
  title: string;
  description: string;
}

/**
 * Usuarios de la clínica: alta, rol y estado. Solo se monta para ADMIN —
 * ClinicPage lo decide — porque toda la ruta /api/users responde 403 al resto.
 */
export default function UsersCard() {
  const { user: me, refresh } = useAuth();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [pending, setPending] = useState<PendingChange | null>(null);

  const { data: users, isLoading, isError } = useQuery({
    queryKey: userKeys.list,
    queryFn: usersApi.list,
  });

  const mutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateUserInput }) =>
      usersApi.update(id, input),
    onSuccess: async (updated) => {
      queryClient.invalidateQueries({ queryKey: userKeys.list });
      // Si el cambio fue sobre la propia cuenta, el AuthContext sigue con el
      // rol viejo hasta volver a pedir /me. Sin esto, una ADMIN que se
      // degrada seguiría viendo esta tarjeta y la próxima acción daría 403.
      if (updated.id === me?.id) await refresh();
      setPending(null);
    },
    // El 409 de "última ADMIN activa" llega con el mensaje del servidor: es
    // la explicación exacta de por qué no se aplicó.
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar el cambio');
      setPending(null);
    },
  });

  function onRoleChange(u: TenantUser, role: UserRole) {
    if (role === u.role) return;
    if (role === 'ADMIN') {
      mutation.mutate({ id: u.id, input: { role } });
      return;
    }
    setPending({
      user: u,
      input: { role },
      title: `¿Quitarle el rol de administración a ${u.name ?? u.email}?`,
      description:
        u.id === me?.id
          ? 'Vas a dejar de administrar la clínica en este mismo momento: no vas a poder gestionar usuarios ni editar la configuración hasta que otra persona administradora te devuelva el rol.'
          : 'Deja de poder gestionar usuarios y configuración al instante. Se puede revertir desde acá.',
    });
  }

  function onToggleActive(u: TenantUser) {
    if (!u.isActive) {
      mutation.mutate({ id: u.id, input: { isActive: true } });
      return;
    }
    setPending({
      user: u,
      input: { isActive: false },
      title: `¿Desactivar a ${u.name ?? u.email}?`,
      description:
        'Pierde el acceso en su próximo request, aunque tenga la sesión abierta. Sus sesiones y registros quedan intactos y se puede reactivar desde acá.',
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Usuarios</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
            <UserPlus className="h-4 w-4" />
            Nuevo usuario
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">Cargando...</p>}
        {isError && (
          <p className="text-sm text-destructive">No se pudieron cargar los usuarios.</p>
        )}
        {users && (
          <ul className="divide-y">
            {users.map((u) => {
              const esYo = u.id === me?.id;
              return (
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
                      {esYo && (
                        <Badge variant="secondary" className="text-xs">
                          Vos
                        </Badge>
                      )}
                      {!u.isActive && (
                        <Badge variant="outline" className="text-xs">
                          Inactivo
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Último acceso: {formatLastLogin(u.lastLoginAt)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Select
                      items={ROLE_LABELS}
                      value={u.role}
                      onValueChange={(v) => v !== null && onRoleChange(u, v as UserRole)}
                      disabled={mutation.isPending}
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
                    {/* La API rechaza desactivarse a uno mismo (400): mejor
                        no ofrecerlo que dejarlo fallar. */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onToggleActive(u)}
                      disabled={esYo || mutation.isPending}
                      title={esYo ? 'No podés desactivar tu propia cuenta' : undefined}
                    >
                      {u.isActive ? 'Desactivar' : 'Reactivar'}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <UserCreateDialog open={createOpen} onClose={() => setCreateOpen(false)} />

      <Dialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending?.title}</DialogTitle>
            <DialogDescription>{pending?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPending(null)}
              disabled={mutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                pending && mutation.mutate({ id: pending.user.id, input: pending.input })
              }
              disabled={mutation.isPending}
            >
              {mutation.isPending ? 'Guardando...' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
