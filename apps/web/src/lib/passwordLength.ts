// bcrypt reads only the first 72 bytes of a password, so the API refuses a
// longer one (PasswordSchema); checked here too so the form says so first.
export const PASSWORD_TOO_LONG =
  'La contraseña es demasiado larga (hasta 72 caracteres, menos si usa acentos o símbolos)';

export function passwordTooLong(password: string): boolean {
  return new TextEncoder().encode(password).length > 72;
}
