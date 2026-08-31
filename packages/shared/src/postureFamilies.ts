// Familias de posturas: la grilla de la evaluación inicial.
//
// Este archivo es la única fuente de verdad de las dos tablas. La web dibuja la
// grilla a partir de `POSTURE_TABLES` y la API valida el body con
// `postureFamiliesSchema`, que se deriva de esa misma definición. Agregar una
// columna es agregar una entrada en la lista; ni el componente ni la ruta se
// enteran.
import { z } from 'zod';

// ── Definición de la grilla ───────────────────────────────────────────────────

// El `kind` de una columna dice qué guarda la celda, y con eso alcanza para
// saber qué control dibujar y qué valores son válidos:
//
//   mark    marca de intensidad     'x' | 'X'
//   flag    marcado / no marcado    true (no marcado = celda ausente)
//   choice  una opción de una lista fija
//   text    texto libre
export type PostureColumn =
  | { readonly id: string; readonly kind: 'mark' }
  | { readonly id: string; readonly kind: 'flag' }
  | { readonly id: string; readonly kind: 'choice'; readonly options: readonly string[] }
  | { readonly id: string; readonly kind: 'text' };

export interface PostureTableDef {
  readonly id: string;
  readonly rows: readonly string[];
  readonly columns: readonly PostureColumn[];
}

// Los dos estados de una marca, en el orden en que cicla el botón.
export const MARK_STATES = ['x', 'X'] as const;
export type MarkState = (typeof MARK_STATES)[number];

export const POSTURE_TABLES = [
  {
    id: 'tabla1',
    rows: ['1', '2', '3', '4', '5', '6', 'R'],
    columns: [
      { id: 'A', kind: 'mark' },
      { id: 'P', kind: 'mark' },
    ],
  },
  {
    id: 'tabla2',
    rows: ['1', '2', '3', '4'],
    columns: [
      { id: 'F6', kind: 'mark' },
      { id: 'I', kind: 'mark' },
      { id: 'ELR', kind: 'mark' },
      { id: 'Reeq', kind: 'choice', options: ['000', 'XXX', 'XX', 'X'] },
      { id: 'R', kind: 'flag' },
      { id: 'Pistas', kind: 'text' },
    ],
  },
] as const satisfies readonly PostureTableDef[];

// ── Schema ────────────────────────────────────────────────────────────────────

function cellSchema(col: PostureColumn) {
  switch (col.kind) {
    case 'mark':
      return z.enum(MARK_STATES);
    case 'flag':
      // Solo `true`: "no marcado" se representa con la ausencia de la celda, así
      // que un `false` guardado sería una segunda forma de decir lo mismo.
      return z.literal(true);
    case 'choice':
      return z.enum([...col.options]);
    case 'text':
      // Una celda de texto vacía se borra, no se guarda como "".
      return z.string().min(1);
  }
}

const rowSchema = (table: PostureTableDef) =>
  z.strictObject(
    Object.fromEntries(table.columns.map((col) => [col.id, cellSchema(col).optional()])),
  );

const tableSchema = (table: PostureTableDef) =>
  z.strictObject(Object.fromEntries(table.rows.map((row) => [row, rowSchema(table).optional()])));

/**
 * Valida la grilla completa: tabla → fila → columna → valor.
 *
 * Es `strictObject` en los tres niveles, así que una tabla, fila o columna que
 * no esté en `POSTURE_TABLES` da 400 en vez de guardarse callada. Eso es lo que
 * convierte a la definición de arriba en la autoridad real sobre qué se puede
 * guardar, en vez de una lista que el renderer usa por convención.
 */
export const postureFamiliesSchema = z.strictObject(
  Object.fromEntries(POSTURE_TABLES.map((table) => [table.id, tableSchema(table).optional()])),
);

/**
 * Lo guardado, anidado tabla → fila → columna. Es sparse en los tres niveles: una
 * celda vacía no se guarda, y una fila o una tabla que se quedan sin celdas
 * tampoco. Una grilla sin ninguna celda se guarda como NULL, no como `{}`.
 *
 * El tipo sale del schema en vez de declararse aparte: son la misma cosa vista
 * en tiempo de compilación y en runtime, y así no pueden divergir.
 */
export type PostureFamilies = z.infer<typeof postureFamiliesSchema>;

/** Lo que puede guardar una celda. `true` es exclusivo de las columnas `flag`. */
export type PostureCellValue = string | true;

// ── Acceso a las celdas ───────────────────────────────────────────────────────

export function getPostureCell(
  values: PostureFamilies,
  tableId: string,
  rowId: string,
  colId: string,
): PostureCellValue | undefined {
  return values[tableId]?.[rowId]?.[colId];
}

/**
 * Devuelve una copia con la celda puesta en `next`. `undefined` la borra.
 *
 * Poda hacia arriba: si la fila queda sin celdas se borra la fila, y si la tabla
 * queda sin filas se borra la tabla. Sin eso quedarían restos como
 * `{"tabla2":{"3":{}}}`, que ocupan lugar, no significan nada y romperían el
 * "¿está vacía?" con el que el formulario decide si guardar NULL.
 */
export function setPostureCell(
  values: PostureFamilies,
  tableId: string,
  rowId: string,
  colId: string,
  next: PostureCellValue | undefined,
): PostureFamilies {
  const table = { ...values[tableId] };
  const row = { ...table[rowId] };

  if (next === undefined || next === '') delete row[colId];
  else row[colId] = next;

  if (Object.keys(row).length) table[rowId] = row;
  else delete table[rowId];

  const result = { ...values };
  if (Object.keys(table).length) result[tableId] = table;
  else delete result[tableId];

  return result;
}

export const isPostureFamiliesEmpty = (values: PostureFamilies): boolean =>
  Object.keys(values).length === 0;

// ── Dolor en familia ──────────────────────────────────────────────────────────

/**
 * Las familias que ofrece el card "Dolor en familia".
 *
 * Coinciden en numeración con las filas de `tabla2`, pero se declaran aparte a
 * propósito: no está confirmado que sean el mismo concepto del dominio. Unificar
 * después es barato; separar algo que se unió indebidamente, no.
 */
export const FAMILY_PAIN_OPTIONS = ['1', '2', '3', '4'] as const;
export type FamilyPainOption = (typeof FAMILY_PAIN_OPTIONS)[number];

export const familyPainSchema = z.array(z.enum(FAMILY_PAIN_OPTIONS));
