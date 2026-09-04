import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CreditCard,
  Pencil,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import PaymentEditDialog from '@/components/payments/PaymentEditDialog';
import { paymentApi, paymentKeys } from '@/services/payments';
import { PAYMENT_METHOD_CLASS, PAYMENT_METHOD_LABELS, PAYMENT_STATUS_CLASS, PAYMENT_STATUS_LABELS } from '@/lib/labels';
import type { Payment } from '@/types/payment';
import { toast } from 'sonner';

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatMoney(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n);
}

function buildColumns(
  onMarkPaid: (p: Payment) => void,
  onEdit: (p: Payment) => void,
): ColumnDef<Payment>[] {
  return [
    {
      accessorKey: 'patient.fullName',
      id: 'patientName',
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          Paciente
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => (
        <Link
          to={`/patients/${row.original.patientId}`}
          className="font-medium hover:underline"
        >
          {row.original.patient.fullName}
        </Link>
      ),
    },
    {
      accessorKey: 'session.sessionDate',
      id: 'sessionDate',
      header: 'Fecha sesión',
      cell: ({ row }) => formatDate(row.original.session.sessionDate),
    },
    {
      id: 'package',
      header: 'Paquete',
      cell: ({ row }) =>
        row.original.package ? (
          <Badge variant="outline">{row.original.package.name}</Badge>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        ),
    },
    {
      accessorKey: 'baseAmount',
      header: 'Base',
      cell: ({ row }) => formatMoney(row.original.baseAmount),
    },
    {
      accessorKey: 'discount',
      header: 'Descuento',
      cell: ({ row }) =>
        row.original.discount > 0 ? (
          <span className="text-destructive">− {formatMoney(row.original.discount)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      accessorKey: 'finalAmount',
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          Total
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => (
        <span className="font-semibold">{formatMoney(row.original.finalAmount)}</span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Estado',
      cell: ({ row }) => (
        <Badge variant="outline" className={PAYMENT_STATUS_CLASS[row.original.status]}>
          {PAYMENT_STATUS_LABELS[row.original.status]}
        </Badge>
      ),
    },
    {
      accessorKey: 'method',
      header: 'Método',
      cell: ({ row }) =>
        row.original.method ? (
          <Badge variant="outline" className={PAYMENT_METHOD_CLASS[row.original.method]}>{PAYMENT_METHOD_LABELS[row.original.method]}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'actions',
      enableHiding: false,
      cell: ({ row }) => {
        const p = row.original;
        return (
          <div className="flex items-center justify-end gap-1">
            {p.status === 'PENDING' && (
              <Button size="sm" variant="outline" onClick={() => onMarkPaid(p)}>
                <CreditCard className="h-3.5 w-3.5 mr-1" />
                Cobrar
              </Button>
            )}
            {/* Disponible en cualquier estado: corregir un monto mal cargado y
                revertir un cobro marcado por error son el mismo botón. */}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onEdit(p)}
              aria-label={`Corregir el cobro de ${p.patient.fullName}`}
              title="Corregir"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      },
    },
  ];
}

export default function PaymentsPage() {
  useEffect(() => { document.title = 'Pagos'; }, []);
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [paymentToCharge, setPaymentToCharge] = useState<Payment | null>(null);
  const [paymentToEdit, setPaymentToEdit] = useState<Payment | null>(null);

  const { data: payments = [], isLoading, isError } = useQuery({
    queryKey: paymentKeys.list(statusFilter !== 'all' ? { status: statusFilter } : undefined),
    queryFn: () =>
      paymentApi.list(statusFilter !== 'all' ? { status: statusFilter } : undefined),
  });

  const markPaidMutation = useMutation({
    mutationFn: ({ id, method }: { id: string; method: 'CASH' | 'TRANSFER' }) =>
      paymentApi.update(id, { status: 'PAID', method, paidAt: new Date().toISOString() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: paymentKeys.all });
      toast.success('Cobro registrado');
      setPaymentToCharge(null);
    },
    onError: () => toast.error('Error al registrar el cobro'),
  });

  function handleMarkPaid(payment: Payment) {
    setPaymentToCharge(payment);
  }

  function confirmCharge(method: 'CASH' | 'TRANSFER') {
    if (!paymentToCharge) return;
    markPaidMutation.mutate({ id: paymentToCharge.id, method });
  }

  const columns = buildColumns(handleMarkPaid, setPaymentToEdit);

  const table = useReactTable({
    data: payments,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 15 } },
    state: { sorting, columnFilters },
  });

  const pendingTotal = payments
    .filter((p) => p.status === 'PENDING')
    .reduce((sum, p) => sum + p.finalAmount, 0);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Cobros</h2>
          <p className="text-muted-foreground text-sm mt-1">
            {payments.filter((p) => p.status === 'PENDING').length} pendiente
            {payments.filter((p) => p.status === 'PENDING').length !== 1 ? 's' : ''} ·{' '}
            <span className="text-destructive font-medium">{formatMoney(pendingTotal)}</span>
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <Input
          placeholder="Buscar paciente..."
          value={(table.getColumn('patientName')?.getFilterValue() as string) ?? ''}
          onChange={(e) => table.getColumn('patientName')?.setFilterValue(e.target.value)}
          className="max-w-xs"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? 'all')}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="PENDING">Pendientes</SelectItem>
            <SelectItem value="PAID">Pagados</SelectItem>
            <SelectItem value="WAIVED">Eximidos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading && <p className="text-muted-foreground text-sm">Cargando...</p>}
      {isError && (
        <p className="text-destructive text-sm">Error al cargar cobros. ¿Está corriendo la API?</p>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-32 text-center text-muted-foreground"
                >
                  {isLoading ? '' : 'No hay cobros registrados.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4">
        <p className="text-sm text-muted-foreground">
          {table.getFilteredRowModel().rows.length} registro
          {table.getFilteredRowModel().rows.length !== 1 ? 's' : ''}
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground px-2">
            {table.getState().pagination.pageIndex + 1} / {table.getPageCount() || 1}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Corrección de un cobro ya registrado: montos, estado y método. */}
      <PaymentEditDialog payment={paymentToEdit} onClose={() => setPaymentToEdit(null)} />

      {/* Registro de cobro: reemplaza el doble confirm() nativo por un diálogo
          con dos opciones claras de método de pago */}
      <Dialog
        open={!!paymentToCharge}
        onOpenChange={(open) => !open && setPaymentToCharge(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar cobro</DialogTitle>
            <DialogDescription>
              {paymentToCharge && (
                <>
                  Cobro de{' '}
                  <span className="font-medium text-foreground">
                    {formatMoney(paymentToCharge.finalAmount)}
                  </span>{' '}
                  a{' '}
                  <span className="font-medium text-foreground">
                    {paymentToCharge.patient.fullName}
                  </span>
                  . Elegí el método de pago.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-between gap-2">
            <Button
              variant="outline"
              onClick={() => confirmCharge('CASH')}
              disabled={markPaidMutation.isPending}
              className="flex-1"
            >
              Efectivo
            </Button>
            <Button
              onClick={() => confirmCharge('TRANSFER')}
              disabled={markPaidMutation.isPending}
              className="flex-1"
            >
              Transferencia
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
