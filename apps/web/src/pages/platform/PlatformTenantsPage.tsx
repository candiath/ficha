import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Building2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { SLUG_PATTERN, slugify } from '@ficha/shared';
import TenantStatus from '@/components/platform/TenantStatus';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { cn } from '@/lib/utils';
import { platformKeys, platformTenantsApi } from '@/services/platform';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function PlatformTenantsPage() {
  useEffect(() => {
    document.title = 'Clínicas — Plataforma';
  }, []);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: tenants, isLoading, isError } = useQuery({
    queryKey: platformKeys.tenants,
    queryFn: platformTenantsApi.list,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clínicas</h1>
          <p className="text-sm text-muted-foreground">
            Cada clínica es un espacio aislado; desde acá solo se crean y se les nombra quién
            las administra.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Nueva clínica
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Cargando...</p>}
      {isError && <p className="text-sm text-destructive">No se pudieron cargar las clínicas.</p>}

      {tenants && tenants.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Todavía no hay clínicas. Creá la primera con el botón de arriba.
          </CardContent>
        </Card>
      )}

      {tenants && tenants.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {tenants.map((t) => (
                <li key={t.id}>
                  <Link
                    to={`/platform/tenants/${t.id}`}
                    className={cn(
                      'flex items-center gap-4 px-4 py-3 hover:bg-muted/50 transition-colors',
                      t.deactivatedAt && 'opacity-60',
                    )}
                  >
                    <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{t.name}</p>
                      <p className="text-xs text-muted-foreground font-mono truncate">{t.slug}</p>
                    </div>
                    <div className="hidden sm:block text-xs text-muted-foreground shrink-0">
                      {t.activeAdmins} admin{t.activeAdmins === 1 ? '' : 's'} · desde{' '}
                      {formatDate(t.createdAt)}
                    </div>
                    <TenantStatus tenant={t} />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <CreateTenantDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function CreateTenantDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        {/* Remontar el form en cada apertura, como ClinicEditDialog. */}
        {open && <CreateTenantForm onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function CreateTenantForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');

  // La misma slugify que usa la API (packages/shared): lo que se muestra acá
  // es exactamente lo que va a quedar.
  const derivado = slugify(name);
  const error =
    name.trim().length < 2
      ? 'El nombre debe tener al menos 2 caracteres'
      : slug.trim()
        ? SLUG_PATTERN.test(slug.trim())
          ? null
          : 'El identificador solo admite minúsculas, números y guiones simples'
        : derivado
          ? null
          : 'No se puede derivar un identificador del nombre; escribí uno';

  const mutation = useMutation({
    mutationFn: () =>
      platformTenantsApi.create({
        name: name.trim(),
        ...(slug.trim() && { slug: slug.trim() }),
      }),
    onSuccess: (tenant) => {
      queryClient.invalidateQueries({ queryKey: platformKeys.tenants });
      toast.success(`Clínica "${tenant.name}" creada. Ahora nombrale una ADMIN.`);
      onClose();
    },
    onError: (err: Error) => toast.error(err.message || 'No se pudo crear la clínica'),
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Nueva clínica</DialogTitle>
        <DialogDescription>
          Nace vacía y sin nadie adentro: el paso siguiente es crearle su primera ADMIN.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="pt-name">Nombre</Label>
          <Input
            id="pt-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Clínica San Martín"
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pt-slug">Identificador (slug)</Label>
          <Input
            id="pt-slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder={derivado || 'se deriva del nombre'}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Opcional. Queda fijo: después no se puede cambiar. Vacío, se usa{' '}
            <span className="font-mono">{derivado || '…'}</span>.
          </p>
        </div>
        {error && name && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={() => mutation.mutate()} disabled={!!error || mutation.isPending}>
          {mutation.isPending ? 'Creando...' : 'Crear clínica'}
        </Button>
      </DialogFooter>
    </>
  );
}
