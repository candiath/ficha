import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Laptop } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { describeUserAgent } from '@/lib/userAgent';
import { authSessionApi, authSessionKeys } from '@/services/auth';
import type { AuthSessionDTO } from '@ficha/shared';

// Where the user is logged in, and a way to close any of it
// (docs/specs/SPEC-my-sessions.md). In the UI these are "dispositivos":
// "sesión" is the clinical word. Only her own; nobody else sees this list.

// The API refreshes last use at most every 5 minutes: within that window a
// device is simply "active now".
const ACTIVE_NOW_MS = 5 * 60 * 1000;

const relative = new Intl.RelativeTimeFormat('es-AR', { numeric: 'auto' });

function lastActivity(iso: string, now = Date.now()): string {
  const elapsed = now - new Date(iso).getTime();
  if (elapsed < ACTIVE_NOW_MS) return 'Activo ahora';
  const minutes = Math.round(elapsed / 60_000);
  if (minutes < 60) return `Última actividad ${relative.format(-minutes, 'minute')}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Última actividad ${relative.format(-hours, 'hour')}`;
  return `Última actividad ${relative.format(-Math.round(hours / 24), 'day')}`;
}

function startedAt(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'No se pudo completar la acción';
}

export default function ConnectedDevicesCard() {
  const { logout } = useAuth();
  const queryClient = useQueryClient();
  const { data: devices, isLoading, isError } = useQuery({
    queryKey: authSessionKeys.list,
    queryFn: authSessionApi.list,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: authSessionKeys.list });

  const close = useMutation({
    mutationFn: authSessionApi.close,
    onSuccess: () => {
      toast.success('Dispositivo desconectado');
      void refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const untrust = useMutation({
    mutationFn: authSessionApi.untrust,
    onSuccess: () => {
      toast.success('Ya no es un dispositivo de confianza');
      void refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const closeOthers = useMutation({
    mutationFn: authSessionApi.closeOthers,
    onSuccess: ({ revoked }) => {
      toast.success(
        revoked === 1 ? 'Se desconectó 1 dispositivo' : `Se desconectaron ${revoked} dispositivos`,
      );
      void refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  // The API lists most recently used first; the current device goes on top.
  const sorted = [...(devices ?? [])].sort((a, b) => Number(b.current) - Number(a.current));
  const busy = close.isPending || untrust.isPending || closeOthers.isPending;

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Dispositivos conectados</CardTitle>
        {sorted.length > 1 && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => closeOthers.mutate()}
          >
            Desconectar los demás
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <Skeleton className="h-12 w-full" />}
        {isError && (
          <p className="text-sm text-muted-foreground">No se pudieron cargar los dispositivos.</p>
        )}
        {sorted.map((device, i) => (
          <div key={device.id}>
            {i > 0 && <Separator className="mb-4" />}
            <DeviceRow
              device={device}
              busy={busy}
              onClose={() => (device.current ? logout() : close.mutate(device.id))}
              onUntrust={() => untrust.mutate(device.id)}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

interface DeviceRowProps {
  device: AuthSessionDTO;
  busy: boolean;
  onClose: () => void;
  onUntrust: () => void;
}

function DeviceRow({ device, busy, onClose, onUntrust }: DeviceRowProps) {
  return (
    <div className="flex items-start justify-between gap-3" data-testid="device-row">
      <div className="flex items-start gap-3 min-w-0">
        <Laptop className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{describeUserAgent(device.userAgent)}</p>
            {device.current && <Badge className="text-xs">Este dispositivo</Badge>}
            {device.trusted && (
              <Badge variant="secondary" className="text-xs">
                De confianza
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {lastActivity(device.lastUsedAt)}
            {device.ip ? ` · IP ${device.ip}` : ''}
          </p>
          <p className="text-xs text-muted-foreground">Conectado el {startedAt(device.createdAt)}</p>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 shrink-0">
        {device.trusted && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={onUntrust}>
            Dejar de confiar
          </Button>
        )}
        <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>
          {device.current ? 'Cerrar sesión' : 'Desconectar'}
        </Button>
      </div>
    </div>
  );
}
