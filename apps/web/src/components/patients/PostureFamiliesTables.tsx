import { useState, type ReactNode } from 'react';
import {
  MARK_STATES,
  POSTURE_TABLES,
  getPostureCell,
  setPostureCell,
  type MarkState,
  type PostureCellValue,
  type PostureColumn,
  type PostureFamilies,
  type PostureTableDef,
} from '@ficha/shared';
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

// Las dos tablas de familias de posturas. Ni la estructura de la grilla ni el
// tipo de cada columna viven acá: los define POSTURE_TABLES en @ficha/shared,
// que es también con lo que la API valida. Este archivo solo decide qué control
// dibuja cada `kind`.

// ── Celda `mark`: botón que cicla vacío → x → X → vacío ───────────────────────
function MarkCell({
  value,
  onChange,
  label,
}: {
  value: PostureCellValue | undefined;
  onChange: (value: MarkState | undefined) => void;
  label: string;
}) {
  const cycle = () => {
    // indexOf da -1 con la celda vacía (o con un valor que no reconocemos), así
    // que +1 arranca en 'x'. Pasado el último estado el índice se va del array y
    // devuelve undefined, que es exactamente "celda vacía".
    const idx = MARK_STATES.indexOf(value as MarkState);
    onChange(MARK_STATES[idx + 1]);
  };

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`${label}: ${value ?? 'vacío'}`}
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

// ── Celda `flag`: checkbox ────────────────────────────────────────────────────
// Usamos un <button> con SVG en vez del Checkbox de Base UI a propósito: ese
// componente renderiza un <input> oculto con position:fixed que, dentro de un
// modal con scroll, hace saltar el scroll al tope. `type="button"` evita además
// que un click envíe el formulario que lo contenga.
function FlagCell({
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

// ── Celda `choice`: dropdown ──────────────────────────────────────────────────
// El valor vacío no es una opción del dominio, así que no vive en la definición
// de la columna: se agrega acá como primer item ('—') para poder desmarcar.
const CLEAR = '';

function ChoiceCell({
  value,
  options,
  onChange,
  label,
}: {
  value: PostureCellValue | undefined;
  options: readonly string[];
  onChange: (value: string | undefined) => void;
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
        {value ?? '—'}
        <ChevronDown className="size-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="min-w-20">
        <DropdownMenuRadioGroup
          value={typeof value === 'string' ? value : CLEAR}
          onValueChange={(next) => onChange(next === CLEAR ? undefined : next)}
        >
          {[CLEAR, ...options].map((opt) => (
            // `closeOnClick` en RadioItem viene en false (Base UI asume menús de
            // selección múltiple). Acá la celda toma un valor único, así que
            // elegir una opción cierra la lista.
            <DropdownMenuRadioItem key={opt} value={opt} closeOnClick>
              {opt === CLEAR ? '—' : opt}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Celda `text`: textarea ────────────────────────────────────────────────────
function TextCell({
  value,
  onChange,
  label,
}: {
  value: PostureCellValue | undefined;
  onChange: (value: string | undefined) => void;
  label: string;
}) {
  return (
    <Textarea
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      aria-label={label}
      rows={1}
      placeholder="…"
      className="min-h-8 w-full px-2 py-1 text-sm"
    />
  );
}

// ── Una tabla de doble entrada ────────────────────────────────────────────────
// Solo se ocupa de la estructura (encabezados + grilla) y delega cada celda en
// `renderCell`. La esquina superior izquierda queda vacía.
function MatrixTable({
  table,
  renderCell,
}: {
  table: PostureTableDef;
  renderCell: (table: PostureTableDef, row: string, col: PostureColumn) => ReactNode;
}) {
  const headCls =
    'border border-border bg-muted/50 px-3 py-1.5 text-center text-xs font-semibold text-muted-foreground';

  // La columna de texto absorbe el ancho sobrante: en una tabla `w-full` con
  // layout automático, darle width:100% a una sola columna la estira con todo el
  // espacio libre y encoge el resto a su contenido. Sale del `kind`, así que una
  // columna de texto nueva se estira sola.
  const expands = (col: PostureColumn) => col.kind === 'text';

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          {/* Esquina vacía */}
          <th className="border border-border bg-muted/50" aria-hidden="true" />
          {table.columns.map((col) => (
            <th
              key={col.id}
              scope="col"
              className={cn(headCls, expands(col) && 'w-full')}
            >
              {col.id}
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
                key={col.id}
                className={cn('border border-border p-1.5', expands(col) && 'w-full')}
              >
                {renderCell(table, row, col)}
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
  /** Valores por celda (modo controlado), anidados tabla → fila → columna. */
  value?: PostureFamilies;
  /** Valores iniciales por celda (modo no controlado). */
  defaultValue?: PostureFamilies;
  /** Se llama con la grilla completa cada vez que cambia una celda. */
  onChange?: (values: PostureFamilies) => void;
  className?: string;
}

export function PostureFamiliesTables({
  value,
  defaultValue = {},
  onChange,
  className,
}: PostureFamiliesTablesProps) {
  const [internal, setInternal] = useState<PostureFamilies>(defaultValue);
  const isControlled = value !== undefined;
  const values = isControlled ? value : internal;

  const update = (
    table: PostureTableDef,
    row: string,
    col: PostureColumn,
    next: PostureCellValue | undefined,
  ) => {
    const updated = setPostureCell(values, table.id, row, col.id, next);
    if (!isControlled) setInternal(updated);
    onChange?.(updated);
  };

  // Una sola función para las dos tablas: qué control va en una celda lo decide
  // el `kind` de su columna, no su nombre ni a qué tabla pertenece.
  const renderCell = (table: PostureTableDef, row: string, col: PostureColumn) => {
    const label = `Fila ${row}, columna ${col.id}`;
    const cell = getPostureCell(values, table.id, row, col.id);
    const onChange = (next: PostureCellValue | undefined) => update(table, row, col, next);

    switch (col.kind) {
      case 'mark':
        return <MarkCell value={cell} onChange={onChange} label={label} />;
      case 'flag':
        return (
          <FlagCell
            checked={cell === true}
            onToggle={() => onChange(cell === true ? undefined : true)}
            label={label}
          />
        );
      case 'choice':
        return (
          <ChoiceCell value={cell} options={col.options} onChange={onChange} label={label} />
        );
      case 'text':
        return <TextCell value={cell} onChange={onChange} label={label} />;
    }
  };

  const [tableA, tableB] = POSTURE_TABLES;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Familias de posturas</CardTitle>
      </CardHeader>
      <CardContent>
        {/* En pantallas chicas las tablas se apilan (una debajo de la otra);
            desde `lg` van lado a lado. Cada tabla va en un contenedor con scroll
            horizontal propio (`overflow-x-auto`) para que, si no entra, scrollee
            la tabla y no rompa el layout. La primera se ajusta a su contenido
            (`lg:flex-none`); la segunda (`flex-1`) ocupa todo el ancho sobrante
            y su columna de texto se estira para darle más lugar al textarea.
            `min-w-0` permite que los contenedores flex se encojan. */}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
          <div className="min-w-0 lg:flex-none overflow-x-auto">
            <MatrixTable table={tableA} renderCell={renderCell} />
          </div>
          <div className="min-w-0 flex-1 overflow-x-auto">
            <MatrixTable table={tableB} renderCell={renderCell} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
