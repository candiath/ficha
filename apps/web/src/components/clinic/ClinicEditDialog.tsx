import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { TenantConfig } from '@ficha/shared';
import { Button } from '@/components/ui/button';
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
import { ARGENTINA_TIMEZONES, WEEKDAYS_MONDAY_FIRST } from '@/lib/clinicSchedule';
import { cn } from '@/lib/utils';
import { tenantApi, tenantKeys } from '@/services/tenant';

export default function ClinicEditDialog({
  tenant,
  open,
  onClose,
}: {
  tenant: TenantConfig;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        {/* key: el formulario se remonta con los valores guardados cada vez que
            se abre, en vez de sincronizarse con un efecto. */}
        {open && <EditForm key={tenant.slug} tenant={tenant} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function EditForm({ tenant, onClose }: { tenant: TenantConfig; onClose: () => void }) {
  const queryClient = useQueryClient();

  const [name, setName] = useState(tenant.name);
  const [email, setEmail] = useState(tenant.email ?? '');
  const [phone, setPhone] = useState(tenant.phone ?? '');
  const [address, setAddress] = useState(tenant.address ?? '');
  const [cuit, setCuit] = useState(tenant.cuit ?? '');
  const [specialty, setSpecialty] = useState(tenant.specialty ?? '');
  const [timezone, setTimezone] = useState(tenant.timezone);
  const [workdayStart, setWorkdayStart] = useState(tenant.workdayStart);
  const [workdayEnd, setWorkdayEnd] = useState(tenant.workdayEnd);
  const [workdays, setWorkdays] = useState<number[]>(tenant.workdays);

  function toggleDay(value: number) {
    setWorkdays((prev) =>
      prev.includes(value) ? prev.filter((d) => d !== value) : [...prev, value],
    );
  }

  // Los mismos invariantes que la API rechaza, avisados antes de mandar. Allá
  // se validan igual: un cliente directo no pasa por acá.
  const error =
    name.trim().length < 2
      ? 'El nombre de la clínica es obligatorio'
      : cuit.trim() !== '' && cuit.replace(/\D/g, '').length !== 11
        ? 'El CUIT debe tener 11 dígitos'
        : workdays.length === 0
          ? 'Elegí al menos un día de atención'
          : workdayStart >= workdayEnd
            ? 'El horario de cierre tiene que ser posterior al de apertura'
            : null;

  const mutation = useMutation({
    mutationFn: () =>
      tenantApi.update({
        name: name.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        cuit: cuit.trim() || null,
        specialty: specialty.trim() || null,
        timezone,
        workdayStart,
        workdayEnd,
        workdays,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tenantKeys.config });
      toast.success('Datos de la clínica actualizados');
      onClose();
    },
    onError: (err: Error) => toast.error(err.message || 'Error al guardar los datos'),
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Datos de la clínica</DialogTitle>
        <DialogDescription>
          El identificador ({tenant.slug}) no se puede cambiar.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="cl-name">Nombre</Label>
          <Input id="cl-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="cl-phone">Teléfono</Label>
            <Input
              id="cl-phone"
              placeholder="+54 11 1234-5678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cl-email">Email</Label>
            <Input
              id="cl-email"
              type="email"
              placeholder="contacto@clinica.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="cl-address">Dirección</Label>
          <Input
            id="cl-address"
            placeholder="Av. Corrientes 1234, CABA"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="cl-cuit">CUIT</Label>
            <Input
              id="cl-cuit"
              placeholder="30-12345678-9"
              value={cuit}
              onChange={(e) => setCuit(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cl-specialty">Especialidad</Label>
            <Input
              id="cl-specialty"
              placeholder="Reeducación Postural Global"
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Zona horaria</Label>
          <Select
            value={timezone}
            onValueChange={(v) => v !== null && setTimezone(v as string)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ARGENTINA_TIMEZONES.map((tz) => (
                <SelectItem key={tz.value} value={tz.value}>
                  {tz.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Con qué hora se muestran las fechas y, cuando exista la agenda, en qué día
            cae cada turno.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Días de atención</Label>
          {/* Botones y no checkboxes: el Checkbox de Base UI hace saltar el
              scroll del modal al tope, y para elegir días una fila de píldoras
              se lee mejor que siete casillas. */}
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS_MONDAY_FIRST.map((d) => {
              const activo = workdays.includes(d.value);
              return (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDay(d.value)}
                  aria-pressed={activo}
                  className={cn(
                    'px-3 h-8 rounded-lg border text-sm transition-colors',
                    activo
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-input text-muted-foreground hover:bg-muted',
                  )}
                >
                  {d.short}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="cl-start">Abre</Label>
            <Input
              id="cl-start"
              type="time"
              value={workdayStart}
              onChange={(e) => setWorkdayStart(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cl-end">Cierra</Label>
            <Input
              id="cl-end"
              type="time"
              value={workdayEnd}
              onChange={(e) => setWorkdayEnd(e.target.value)}
            />
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={() => mutation.mutate()} disabled={!!error || mutation.isPending}>
          {mutation.isPending ? 'Guardando...' : 'Guardar cambios'}
        </Button>
      </DialogFooter>
    </>
  );
}
