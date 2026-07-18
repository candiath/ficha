import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Formatea un instante (Date, normalmente en UTC) como el string `YYYY-MM-DDTHH:mm`
 * que espera un `<input type="datetime-local">`, usando la hora LOCAL del cliente.
 *
 * Un input datetime-local no tiene zona horaria: su valor es hora de pared. Por eso
 * NO se puede usar `date.toISOString()` (eso devuelve UTC y adelanta/atrasa el input
 * según el offset del cliente). Los getters locales (getHours, getDate, ...) ya
 * devuelven la hora en la zona del navegador, que es justo lo que el usuario ve.
 */
export function toLocalDateTimeInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}
