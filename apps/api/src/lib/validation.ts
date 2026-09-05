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
