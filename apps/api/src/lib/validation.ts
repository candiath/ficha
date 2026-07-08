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
