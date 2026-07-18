import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SESSION_DATE_TOLERANCES,
  getSessionDateWarnings,
} from '@/lib/sessionDateTolerances';

// getSessionDateWarnings compara contra Date.now(), así que congelamos el reloj
// a un "ahora" fijo y en punto. Todos los inputs se construyen relativos a él.
const NOW = new Date(2026, 6, 17, 12, 0, 0, 0); // 17-jul-2026 12:00:00 local

// Arma el string "YYYY-MM-DDTHH:mm" (hora local, como un input datetime-local)
// desplazado `offsetMinutes` respecto del ahora congelado. Negativo = pasado.
function localInput(offsetMinutes: number): string {
  const d = new Date(Date.now() + offsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`);
}

describe('getSessionDateWarnings', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('no avisa para la hora actual', () => {
    expect(
      getSessionDateWarnings(localInput(0), DEFAULT_SESSION_DATE_TOLERANCES),
    ).toHaveLength(0);
  });

  it('no avisa por un adelanto dentro de la tolerancia (16:00 estando 15:55)', () => {
    // +5 min está por debajo de los 15 min de tolerancia futura.
    expect(
      getSessionDateWarnings(localInput(5), DEFAULT_SESSION_DATE_TOLERANCES),
    ).toHaveLength(0);
  });

  it('avisa cuando el futuro supera la tolerancia', () => {
    const result = getSessionDateWarnings(
      localInput(30),
      DEFAULT_SESSION_DATE_TOLERANCES,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/futuro/i);
  });

  it('no avisa por un registro tardío dentro del día', () => {
    // -2 horas: el médico carga la sesión un rato después de atender.
    expect(
      getSessionDateWarnings(localInput(-120), DEFAULT_SESSION_DATE_TOLERANCES),
    ).toHaveLength(0);
  });

  it('no lanza ni avisa con un string inválido', () => {
    expect(
      getSessionDateWarnings('no-es-una-fecha', DEFAULT_SESSION_DATE_TOLERANCES),
    ).toHaveLength(0);
  });

  it('avisa cuando el pasado supera el umbral', () => {

    const result = getSessionDateWarnings(
      localInput(-2 * 24 * 60), // -2 días
      DEFAULT_SESSION_DATE_TOLERANCES
    )
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/pasado|tiempo/i);
  });
});
