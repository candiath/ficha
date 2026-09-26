import { z } from 'zod';

// Reglas de validación compartidas entre login, cambio de contraseña y
// gestión de usuarios. Definidas una sola vez para que no diverjan: si
// mañana la política de contraseñas cambia, se toca solo acá.

// Emails siempre normalizados (trim + minúsculas): la columna es @unique
// y "Ana@x.com" y "ana@x.com" deben ser la misma cuenta.
export const EmailSchema = z
  .string()
  .email()
  .transform((e) => e.trim().toLowerCase());

// Política mínima para contraseñas nuevas (alta de usuario y cambio).
// El login NO la usa: ahí se acepta cualquier cosa y decide bcrypt.compare,
// porque rechazar por formato revelaría pistas sobre la política.
export const PasswordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres');

// El id de una fila, tal como llega en un body.
//
// A propósito NO valida formato de UUID. La columna es `String @id
// @default(uuid())`, y ese default es de dónde sale el valor cuando nadie lo
// provee — no una promesa sobre la forma de los ids que existen. El seed lo
// deja a la vista: crea `dev-patient-001` y `dev-episode-001` para que los
// datos de desarrollo sean legibles, y esas filas son tan válidas como
// cualquier otra.
//
// Validar el formato tampoco compraba nada. Un id bien formado que no existe
// termina en 404 igual que uno con cualquier otra forma; lo único que agregaba
// era convertir ese 404 en un 400 para casos que no importan, mientras
// rechazaba ids legítimos. Se descubrió porque agendar un turno a los
// pacientes demo respondía "Datos inválidos".
export const IdSchema = z.string().min(1);

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

// Y para un id opcional que sale de un <select> ("" es "ninguno"). Se llama
// aparte de OptionalTextSchema aunque hoy validen igual, porque lo que cada
// uno promete es distinto: si mañana los ids se validan por formato, el
// cambio va acá y no en todos los campos de texto de la app.
export const OptionalIdSchema = OptionalTextSchema;

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
