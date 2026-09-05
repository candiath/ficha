import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMinutesToTime,
  daysFrom,
  formatRange,
  hourSlotOf,
  hourSlots,
  isSameMonth,
  mondayOf,
  monthGrid,
  overlaps,
  todayInClinic,
  weekdayOf,
} from '@/lib/agendaDates';

// Toda la agenda se apoya en esto. Si la aritmética de fechas se corre un día,
// los turnos aparecen en la casilla equivocada y ningún otro test lo atrapa.
describe('aritmética de fechas', () => {
  it('suma y resta días cruzando meses y años', () => {
    expect(addDays('2026-09-07', 7)).toBe('2026-09-14');
    expect(addDays('2026-09-28', 7)).toBe('2026-10-05');
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('maneja el 29 de febrero de un año bisiesto', () => {
    // 2028 es bisiesto; 2026 no.
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('usa la convención de getDay(): 0 domingo … 6 sábado', () => {
    expect(weekdayOf('2026-09-07')).toBe(1); // lunes
    expect(weekdayOf('2026-09-06')).toBe(0); // domingo
    expect(weekdayOf('2026-09-12')).toBe(6); // sábado
  });
});

describe('mondayOf', () => {
  it('un lunes es su propio lunes', () => {
    expect(mondayOf('2026-09-07')).toBe('2026-09-07');
  });

  it('cualquier día de la semana devuelve el mismo lunes', () => {
    for (const d of ['2026-09-08', '2026-09-10', '2026-09-12']) {
      expect(mondayOf(d)).toBe('2026-09-07');
    }
  });

  // El caso que se rompe si se resta `getDay() - 1` sin pensar: el domingo
  // pertenece a la semana que arrancó seis días antes, no a la siguiente.
  it('el domingo pertenece a la semana que termina, no a la que empieza', () => {
    expect(mondayOf('2026-09-13')).toBe('2026-09-07');
  });

  it('funciona cruzando el fin de mes', () => {
    expect(mondayOf('2026-10-01')).toBe('2026-09-28');
  });
});

describe('monthGrid', () => {
  it('siempre devuelve 42 celdas, arranque el mes el día que arranque', () => {
    for (let mes = 0; mes < 12; mes++) {
      expect(monthGrid(2026, mes)).toHaveLength(42);
    }
  });

  it('empieza siempre en lunes', () => {
    for (let mes = 0; mes < 12; mes++) {
      expect(weekdayOf(monthGrid(2026, mes)[0])).toBe(1);
    }
  });

  it('contiene todos los días del mes', () => {
    // Septiembre 2026 tiene 30 días.
    const grilla = monthGrid(2026, 8);
    const delMes = grilla.filter((d) => isSameMonth(d, 2026, 8));
    expect(delMes).toHaveLength(30);
    expect(delMes[0]).toBe('2026-09-01');
    expect(delMes[29]).toBe('2026-09-30');
  });

  it('los días de relleno son del mes anterior y el siguiente', () => {
    const grilla = monthGrid(2026, 8);
    expect(grilla[0]).toBe('2026-08-31'); // el 1° cae martes
    expect(grilla[41]).toBe('2026-10-11');
  });

  it('las celdas son consecutivas, sin huecos ni repetidos', () => {
    const grilla = monthGrid(2026, 1);
    for (let i = 1; i < grilla.length; i++) {
      expect(grilla[i]).toBe(addDays(grilla[i - 1], 1));
    }
  });
});

describe('daysFrom', () => {
  it('devuelve los días consecutivos pedidos', () => {
    expect(daysFrom('2026-09-07', 6)).toEqual([
      '2026-09-07', '2026-09-08', '2026-09-09',
      '2026-09-10', '2026-09-11', '2026-09-12',
    ]);
  });
});

describe('hourSlots', () => {
  it('va de la apertura al cierre, sin incluir el cierre', () => {
    // A las 20:00 ya no se atiende, así que esa fila no se dibuja.
    expect(hourSlots('08:00', '12:00')).toEqual(['08:00', '09:00', '10:00', '11:00']);
  });

  it('un horario invertido no dibuja nada en vez de romperse', () => {
    expect(hourSlots('20:00', '08:00')).toEqual([]);
    expect(hourSlots('09:00', '09:00')).toEqual([]);
  });

  it('un turno cae en la hora en punto de su franja', () => {
    expect(hourSlotOf('09:00')).toBe('09:00');
    expect(hourSlotOf('09:45')).toBe('09:00');
    expect(hourSlotOf('23:59')).toBe('23:00');
  });
});

describe('overlaps', () => {
  it('detecta el solapamiento parcial en las dos direcciones', () => {
    expect(overlaps('09:00', '10:00', '09:30', '10:30')).toBe(true);
    expect(overlaps('09:30', '10:30', '09:00', '10:00')).toBe(true);
  });

  it('uno contenido en el otro se pisa', () => {
    expect(overlaps('09:00', '11:00', '09:30', '10:00')).toBe(true);
  });

  // El borde que importa: un turno de 9 a 10 y otro de 10 a 11 NO se pisan.
  it('pegados no es pisarse', () => {
    expect(overlaps('09:00', '10:00', '10:00', '11:00')).toBe(false);
    expect(overlaps('10:00', '11:00', '09:00', '10:00')).toBe(false);
  });

  it('separados no se pisan', () => {
    expect(overlaps('09:00', '10:00', '15:00', '16:00')).toBe(false);
  });
});

describe('addMinutesToTime', () => {
  it('suma la duración del turno', () => {
    expect(addMinutesToTime('09:00', 45)).toBe('09:45');
    expect(addMinutesToTime('09:30', 45)).toBe('10:15');
    expect(addMinutesToTime('09:00', 90)).toBe('10:30');
  });
});

describe('formatRange', () => {
  it('un solo mes no lo repite', () => {
    expect(formatRange('2026-09-07', '2026-09-12')).toBe('7 – 12 de septiembre de 2026');
  });

  it('una semana a caballo de dos meses nombra los dos', () => {
    expect(formatRange('2026-09-28', '2026-10-03')).toBe(
      '28 de septiembre – 3 de octubre de 2026',
    );
  });

  it('una semana a caballo de dos años nombra los dos', () => {
    expect(formatRange('2026-12-28', '2027-01-02')).toBe(
      '28 de diciembre 2026 – 2 de enero 2027',
    );
  });
});

describe('todayInClinic', () => {
  it('devuelve una fecha con formato YYYY-MM-DD', () => {
    expect(todayInClinic('America/Argentina/Buenos_Aires')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // La prueba de que lee la zona de la clínica y no la del navegador: a esta
  // hora del día, Buenos Aires y Auckland están en fechas distintas.
  it('dos zonas suficientemente lejanas pueden estar en días distintos', () => {
    const ar = todayInClinic('America/Argentina/Buenos_Aires');
    const nz = todayInClinic('Pacific/Auckland');
    // No siempre difieren, pero nunca pueden estar a más de un día.
    const diff = Math.abs(Date.parse(`${nz}T00:00:00Z`) - Date.parse(`${ar}T00:00:00Z`));
    expect(diff).toBeLessThanOrEqual(86_400_000);
  });
});
