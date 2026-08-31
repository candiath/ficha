import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// ── Definición de las dos tablas ──────────────────────────────────────────────
// Las tablas representan las familias de posturas. Cada una es de doble entrada:
// las columnas y las filas son etiquetas fijas. Lo que va en cada celda depende
// de la tabla (ver los `renderCell` más abajo).
interface PostureTable {
  id: string;
  columns: readonly string[];
  rows: readonly string[];
}

const TABLE_A: PostureTable = {
  id: 't1',
  columns: ['A', 'P'],
  rows: ['1', '2', '3', '4', '5', '6', 'R'],
};

const TABLE_B: PostureTable = {
  id: 't2',
  columns: ['F6', 'I', 'ELR', 'Reeq', 'R', 'Pistas'],
  rows: ['1', '2', '3', '4'],
};

// Estados por los que ciclan los botones de ambas tablas: vacío → x → X → vacío.
const CYCLE_STATES = ['', 'x', 'X'] as const;

// Compat: F6/I/ELR eran checkboxes y guardaban 'on'. Una tilde vieja se lee como
// marca fuerte; desde el primer click el botón cicla normal. No migramos la base:
// el valor se normaliza al guardar el siguiente cambio de la evaluación.
const toCycleValue = (raw: string) =>
  CYCLE_STATES.includes(raw as (typeof CYCLE_STATES)[number]) ? raw : 'X';

// Opciones del dropdown de la columna 'Reeq' (Tabla 2).
const REEQ_OPTIONS = ['', '000', 'XXX', 'XX', 'X'] as const;

// Clave única para cada celda: identifica tabla + fila + columna.
const cellKey = (tableId: string, row: string, col: string) =>
  `${tableId}:${row}:${col}`;

// ── Celda que cicla x / X / vacío (Tabla 1 completa; Tabla 2 salvo 'R') ────────
function CycleCell({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const cycle = () => {
    const idx = CYCLE_STATES.indexOf(value as (typeof CYCLE_STATES)[number]);
    // Si el valor no está en la lista (idx === -1), (idx + 1) % 3 === 0 → vacío.
    onChange(CYCLE_STATES[(idx + 1) % CYCLE_STATES.length]);
  };

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`${label}: ${value || 'vacío'}`}
      className={cn(
        'mx-auto flex size-6 items-center justify-center rounded-[4px] border font-mono text-sm leading-none transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        value
          ? 'border-primary/40 bg-primary/5 text-foreground'
          : 'border-input hover:border-primary/50',
      )}
    >
      {value}
    </button>
  );
}

// ── Celda de la columna 'R' de la Tabla 2: checkbox ───────────────────────────
// Usamos un <button> con SVG en vez del Checkbox de Base UI a propósito: ese
// componente renderiza un <input> oculto con position:fixed que, dentro de un
// modal con scroll, hace saltar el scroll al tope. `type="button"` evita además
// que un click envíe el formulario que lo contenga.
function CheckboxCell({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        'mx-auto flex size-5 items-center justify-center rounded-[4px] border transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        checked
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-input hover:border-primary/50',
      )}
    >
      {checked && (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </button>
  );
}

// ── Celda de la columna 'Reeq': dropdown de shadcn ────────────────────────────
function ReeqCell({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        className={cn(
          'mx-auto flex h-7 min-w-14 items-center justify-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          value
            ? 'border-primary/40 bg-primary/5 text-foreground'
            : 'border-input text-muted-foreground hover:border-primary/50',
        )}
      >
        {value || '—'}
        <ChevronDown className="size-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="min-w-20">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {REEQ_OPTIONS.map((opt) => (
            <DropdownMenuRadioItem key={opt} value={opt}>
              {opt}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Celda de la columna 'Pistas': textarea ───────────────────────────────────
function PistasCell({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <Textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      rows={1}
      placeholder="…"
      className="min-h-8 w-full px-2 py-1 text-sm"
    />
  );
}

// ── Una tabla de doble entrada ────────────────────────────────────────────────
// Componente reutilizable: solo se ocupa de la estructura (encabezados + grilla).
// Qué control va en cada celda lo decide `renderCell`, que le pasa el padre. La
// esquina superior izquierda queda vacía.
function MatrixTable({
  table,
  renderCell,
  expandColumn,
}: {
  table: PostureTable;
  renderCell: (tableId: string, row: string, col: string) => ReactNode;
  /**
   * Columna que absorbe el ancho sobrante. En una tabla `w-full` con layout
   * automático, darle `w-full` (width:100%) a una sola columna hace que esa
   * columna se estire con todo el espacio libre y el resto se encojan a su
   * contenido. Se usa para que la columna 'Pistas' le dé más lugar al textarea.
   */
  expandColumn?: string;
}) {
  const headCls =
    'border border-border bg-muted/50 px-3 py-1.5 text-center text-xs font-semibold text-muted-foreground';

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          {/* Esquina vacía */}
          <th className="border border-border bg-muted/50" aria-hidden="true" />
          {table.columns.map((col) => (
            <th
              key={col}
              scope="col"
              className={cn(headCls, col === expandColumn && 'w-full')}
            >
              {col}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row) => (
          <tr key={row}>
            <th scope="row" className={headCls}>
              {row}
            </th>
            {table.columns.map((col) => (
              <td
                key={col}
                className={cn(
                  'border border-border p-1.5',
                  col === expandColumn && 'w-full',
                )}
              >
                {renderCell(table.id, row, col)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export interface PostureFamiliesTablesProps {
  /** Valores por celda (modo controlado). Clave `cellKey` → valor de la celda. */
  value?: Record<string, string>;
  /** Valores iniciales por celda (modo no controlado). */
  defaultValue?: Record<string, string>;
  /** Se llama con el mapa completo de valores cada vez que cambia una celda. */
  onChange?: (values: Record<string, string>) => void;
  className?: string;
}

export function PostureFamiliesTables({
  value,
  defaultValue = {},
  onChange,
  className,
}: PostureFamiliesTablesProps) {
  // Patrón controlado/no controlado: si nos pasan `value`, el padre manda; si no,
  // el componente maneja su propio estado. Cada celda guarda un string: '' (o
  // ausente) = vacío; para la Tabla 1 es 'x'/'X', para el checkbox es 'on', y
  // para 'Reeq' es una de las opciones del dropdown.
  const [internal, setInternal] = useState<Record<string, string>>(defaultValue);
  const isControlled = value !== undefined;
  const values = isControlled ? value : internal;

  const getValue = (tableId: string, row: string, col: string) =>
    values[cellKey(tableId, row, col)] ?? '';

  const setValue = (tableId: string, row: string, col: string, next: string) => {
    const key = cellKey(tableId, row, col);
    const updated = { ...values };
    if (next) updated[key] = next;
    else delete updated[key]; // sin valor = celda vacía; no la guardamos
    if (!isControlled) setInternal(updated);
    onChange?.(updated);
  };

  // Tabla 1: todas las celdas ciclan x / X / vacío.
  const renderCellA = (tableId: string, row: string, col: string) => (
    <CycleCell
      value={getValue(tableId, row, col)}
      onChange={(next) => setValue(tableId, row, col, next)}
      label={`Fila ${row}, columna ${col}`}
    />
  );

  // Tabla 2: 'Reeq' es un dropdown, 'Pistas' un textarea y 'R' un checkbox
  // (es binaria); el resto cicla x / X / vacío, igual que la Tabla 1.
  const renderCellB = (tableId: string, row: string, col: string) => {
    const label = `Fila ${row}, columna ${col}`;
    if (col === 'Reeq') {
      return (
        <ReeqCell
          value={getValue(tableId, row, col)}
          onChange={(next) => setValue(tableId, row, col, next)}
          label={label}
        />
      );
    }
    if (col === 'Pistas') {
      return (
        <PistasCell
          value={getValue(tableId, row, col)}
          onChange={(next) => setValue(tableId, row, col, next)}
          label={label}
        />
      );
    }
    if (col === 'R') {
      const checked = getValue(tableId, row, col) === 'on';
      return (
        <CheckboxCell
          checked={checked}
          onToggle={() => setValue(tableId, row, col, checked ? '' : 'on')}
          label={label}
        />
      );
    }
    return (
      <CycleCell
        value={toCycleValue(getValue(tableId, row, col))}
        onChange={(next) => setValue(tableId, row, col, next)}
        label={label}
      />
    );
  };

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Familias de posturas</CardTitle>
      </CardHeader>
      <CardContent>
        {/* En pantallas chicas las tablas se apilan (una debajo de la otra);
            desde `lg` van lado a lado. Cada tabla va en un contenedor con scroll
            horizontal propio (`overflow-x-auto`) para que, si no entra, scrollee
            la tabla y no rompa el layout. TABLE_A se ajusta a su contenido
            (`lg:flex-none`); TABLE_B (`flex-1`) ocupa todo el ancho sobrante y su
            columna 'Pistas' se estira para darle más lugar al textarea.
            `min-w-0` permite que los contenedores flex se encojan. */}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
          <div className="min-w-0 lg:flex-none overflow-x-auto">
            <MatrixTable table={TABLE_A} renderCell={renderCellA} />
          </div>
          <div className="min-w-0 flex-1 overflow-x-auto">
            <MatrixTable
              table={TABLE_B}
              renderCell={renderCellB}
              expandColumn="Pistas"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
