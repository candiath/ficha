import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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
import { Textarea } from '@/components/ui/textarea';
import { paymentApi, paymentKeys } from '@/services/payments';
import type { Payment, PaymentMethod, PaymentStatus } from '@/types/payment';

function formatMoney(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n);
}

function formatSessionDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Corregir un cobro mal cargado.
 *
 * La API ya aceptaba editar monto, descuento, estado y método, pero la
 * pantalla solo exponía "marcar como pagado": un monto equivocado no se podía
 * arreglar desde la app, y un cobro marcado como pagado por error tampoco se
 * podía volver atrás.
 */
export default function PaymentEditDialog({
  payment,
  onClose,
}: {
  payment: Payment | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!payment} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {/* key: al abrir sobre otro cobro, el formulario se remonta con sus
            valores. Sincronizarlo con un useEffect + setState sería una
            cascada de renders (react-hooks/set-state-in-effect). */}
        {payment && <EditForm key={payment.id} payment={payment} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function EditForm({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const queryClient = useQueryClient();

  const [baseAmount, setBaseAmount] = useState(String(payment.baseAmount));
  const [discount, setDiscount] = useState(String(payment.discount));
  const [status, setStatus] = useState<PaymentStatus>(payment.status);
  const [method, setMethod] = useState<PaymentMethod | ''>(payment.method ?? '');
  const [notes, setNotes] = useState(payment.notes ?? '');

  const base = Number(baseAmount);
  const disc = Number(discount);
  const montosValidos =
    baseAmount.trim() !== '' &&
    discount.trim() !== '' &&
    Number.isFinite(base) &&
    Number.isFinite(disc) &&
    base >= 0 &&
    disc >= 0;

  // El mismo invariante que valida la API (issue #73): un descuento mayor al
  // monto base dejaría un cobro que devuelve plata. Acá se avisa antes de
  // mandar; allá se rechaza igual, porque el PATCH es parcial y un cliente
  // directo podría mandar solo el descuento.
  const error = !montosValidos
    ? 'Los montos tienen que ser números positivos'
    : disc > base
      ? 'El descuento no puede superar el monto base'
      : status === 'PAID' && !method
        ? 'Elegí con qué método se cobró'
        : null;

  const mutation = useMutation({
    mutationFn: () =>
      paymentApi.update(payment.id, {
        baseAmount: base,
        discount: disc,
        status,
        notes: notes.trim() || null,
        // Al salir de PAGADO se limpian método y fecha de cobro: si el cobro
        // se marcó por error, no puede quedar rastro de una plata que no
        // entró. Al entrar en PAGADO, la ruta pone paidAt sola si no la
        // mandamos, así que solo hace falta el método.
        ...(status === 'PAID'
          ? { method: method as PaymentMethod }
          : { method: null, paidAt: null }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: paymentKeys.all });
      toast.success('Cobro actualizado');
      onClose();
    },
    onError: (err: Error) => toast.error(err.message || 'Error al actualizar el cobro'),
  });

  const total = montosValidos ? base - disc : 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Corregir cobro</DialogTitle>
        <DialogDescription>
          Sesión del {formatSessionDate(payment.session.sessionDate)} de{' '}
          <span className="font-medium text-foreground">{payment.patient.fullName}</span>.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="pay-base">Monto base</Label>
            <Input
              id="pay-base"
              type="number"
              min="0"
              step="0.01"
              value={baseAmount}
              onChange={(e) => setBaseAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pay-discount">Descuento</Label>
            <Input
              id="pay-discount"
              type="number"
              min="0"
              step="0.01"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
          <span className="text-sm text-muted-foreground">Total</span>
          <span className="text-sm font-semibold tabular-nums">{formatMoney(total)}</span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Estado</Label>
            <Select
              value={status}
              onValueChange={(v) => v !== null && setStatus(v as PaymentStatus)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PENDING">Pendiente</SelectItem>
                <SelectItem value="PAID">Pagado</SelectItem>
                <SelectItem value="WAIVED">Eximido</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Método</Label>
            <Select
              value={method}
              onValueChange={(v) => v !== null && setMethod(v as PaymentMethod)}
              disabled={status !== 'PAID'}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={status === 'PAID' ? 'Elegir' : '—'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CASH">Efectivo</SelectItem>
                <SelectItem value="TRANSFER">Transferencia</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pay-notes">
            Notas <span className="text-muted-foreground font-normal">(opcional)</span>
          </Label>
          <Textarea
            id="pay-notes"
            rows={2}
            placeholder="Ej: pagó mitad hoy, resto la próxima"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
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
