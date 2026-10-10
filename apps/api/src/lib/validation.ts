import { z } from 'zod';

// Reglas de validación compartidas entre login, cambio de contraseña y
// gestión de usuarios. Definidas una sola vez para que no diverjan: si
// mañana la política de contraseñas cambia, se toca solo acá.

// Emails siempre normalizados (trim + minúsculas): la columna es @unique
// y "Ana@x.com" y "ana@x.com" deben ser la misma cuenta. El trim va antes de
// validar: si no, " ana@x.com" es un email inválido en vez de uno con un
// espacio de más.
export const EmailSchema = z.string().trim().toLowerCase().pipe(z.email());

// Política mínima para contraseñas nuevas (alta de usuario y cambio).
// El login NO la usa: ahí se acepta cualquier cosa y decide bcrypt.compare,
// porque rechazar por formato revelaría pistas sobre la política.
export const PasswordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres');

// El id de una fila, tal como llega en un body o en un query string: un UUID.
//
// Las columnas de ids son `uuid` nativo (issue #174), y contra esa columna un
// id con otra forma no es "no encontrado": Prisma tira P2023 y la consulta
// muere. Así que el formato se valida antes de consultar, en dos lugares con
// dos respuestas distintas:
//   - en el body o el query, 400: el cliente mandó un dato inválido;
//   - en la URL, 404 (middlewares/idParam.ts): un id con forma imposible es
//     un recurso que no existe, y responder otra cosa cambiaría el contrato.
export const IdSchema = z.uuid('Id inválido');

export function isId(value: unknown): value is string {
  return IdSchema.safeParse(value).success;
}

// ─── Un solo vacío ───────────────────────────────────────────────────────────

// Hay un único vacío en la API y es `null`: "este campo no tiene dato".
//
// El problema que resuelve: un formulario web no tiene `null`, tiene `""`. Si
// la API sólo aceptara null, cada pantalla tendría que traducir —y de hecho lo
// hacía, con un `.trim() || null` repetido en más de quince lugares de React—.
// Esa traducción es una regla sobre qué significa un dato, así que vive acá:
// el cliente manda lo que tiene en la mano y la API decide.
//
// Las tres reglas, iguales para todos los tipos:
//   - campo ausente  → no se toca (lo decide cada ruta con su update parcial)
//   - "" o "   "     → null, el campo queda sin dato
//   - null           → null, explícito
//
// El trim no es decorativo: sin él " " es un nombre válido y la ficha queda
// con un paciente sin nombre que igual pasó la validación.
//
// `max` es el largo máximo cuando el campo tiene uno; se mide después del trim,
// así unos espacios de más no gastan presupuesto.
export function optionalText({ max }: { max?: number } = {}) {
  const base = max === undefined ? z.string().trim() : z.string().trim().max(max);
  return base
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();
}

export const OptionalTextSchema = optionalText();

// Misma regla para una fecha opcional: el `<input type="date">` vacío manda
// "", que no es una fecha inválida sino la ausencia de una.
export const OptionalDateSchema = z
  .union([z.literal('').transform(() => null), z.coerce.date()])
  .nullable()
  .optional();

// Una fecha-hora opcional que se guarda como vino (ISO), no coercionada: el
// "" de un input vacío entra como null igual que en los demás.
export const OptionalDateTimeSchema = z
  .union([z.literal('').transform(() => null), z.iso.datetime()])
  .nullable()
  .optional();

// Y para un id opcional que sale de un <select> ("" es "ninguno"). Mismas
// tres reglas del vacío; lo que no es vacío tiene que ser un UUID.
export const OptionalIdSchema = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .pipe(IdSchema.nullable())
  .nullable()
  .optional();

// Texto obligatorio: se trimea antes de medir, para que " " no pase por tener
// longitud. El mínimo y el mensaje los pone cada campo.
export function requiredText(min: number, message: string) {
  return z.string().trim().min(min, message);
}

// Y para un <select> que puede quedar sin elegir. Mismo criterio: "" no es un
// valor inválido del enum, es la ausencia de valor.
export function optionalEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z
    .union([z.literal('').transform(() => null), z.enum(values)])
    .nullable()
    .optional();
}
