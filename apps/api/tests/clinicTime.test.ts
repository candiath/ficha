import { describe, expect, it } from 'vitest';
import {
  addMinutes,
  clinicDayRange,
  clinicTimeToInstant,
  clinicWeekday,
  instantToClinicTime,
  zoneOffsetMs,
} from '../src/lib/clinicTime';

// Sin DB: son funciones puras y son la base de todo el modelo de turnos. Si
// esto se corre una hora, los turnos aparecen el día equivocado y no hay
// ningún otro test que lo atrape.
const AR = 'America/Argentina/Buenos_Aires';
const MADRID = 'Europe/Madrid';

describe('zoneOffsetMs', () => {
  it('Argentina está tres horas detrás de UTC', () => {
    const enero = new Date('2026-01-15T12:00:00.000Z');
    const julio = new Date('2026-07-15T12:00:00.000Z');

    // Sin horario de verano desde 2009: el mismo offset todo el año.
    expect(zoneOffsetMs(enero, AR)).toBe(-3 * 60 * 60 * 1000);
    expect(zoneOffsetMs(julio, AR)).toBe(-3 * 60 * 60 * 1000);
  });

  it('una zona con horario de verano cambia según la fecha', () => {
    // Madrid: UTC+1 en invierno, UTC+2 en verano. Es la prueba de que el
    // offset sale de Intl y no de una constante.
    expect(zoneOffsetMs(new Date('2026-01-15T12:00:00.000Z'), MADRID)).toBe(3600_000);
    expect(zoneOffsetMs(new Date('2026-07-15T12:00:00.000Z'), MADRID)).toBe(2 * 3600_000);
  });
});

describe('clinicTimeToInstant', () => {
  it('las 9 de la mañana en Argentina son las 12 UTC', () => {
    const i = clinicTimeToInstant('2026-09-07', '09:00', AR);
    expect(i.toISOString()).toBe('2026-09-07T12:00:00.000Z');
  });

  // El caso que rompe si se agrupa en UTC: un turno de la noche cae al día
  // siguiente en UTC, pero sigue siendo del mismo día para la clínica.
  it('un turno de las 22:00 queda en el día siguiente en UTC', () => {
    const i = clinicTimeToInstant('2026-09-07', '22:00', AR);
    expect(i.toISOString()).toBe('2026-09-08T01:00:00.000Z');
  });

  it('la medianoche local es el comienzo del día, no del anterior', () => {
    const i = clinicTimeToInstant('2026-09-07', '00:00', AR);
    expect(i.toISOString()).toBe('2026-09-07T03:00:00.000Z');
  });

  it('respeta el horario de verano de la zona', () => {
    // Mismo horario de pared, dos instantes distintos según la época.
    expect(clinicTimeToInstant('2026-01-15', '10:00', MADRID).toISOString()).toBe(
      '2026-01-15T09:00:00.000Z',
    );
    expect(clinicTimeToInstant('2026-07-15', '10:00', MADRID).toISOString()).toBe(
      '2026-07-15T08:00:00.000Z',
    );
  });

  it('rechaza una fecha ilegible en vez de devolver un Invalid Date', () => {
    expect(() => clinicTimeToInstant('no-es-fecha', '09:00', AR)).toThrow();
  });
});

describe('instantToClinicTime', () => {
  it('es la inversa de clinicTimeToInstant', () => {
    for (const [date, time] of [
      ['2026-09-07', '09:00'],
      ['2026-09-07', '22:00'],
      ['2026-09-07', '00:00'],
      ['2026-12-31', '23:59'],
    ]) {
      const instante = clinicTimeToInstant(date, time, AR);
      expect(instantToClinicTime(instante, AR)).toEqual({ date, time });
    }
  });

  it('la medianoche se lee como 00:00 y no como 24:00', () => {
    const medianoche = clinicTimeToInstant('2026-09-07', '00:00', AR);
    expect(instantToClinicTime(medianoche, AR).time).toBe('00:00');
  });

  it('el mismo instante se lee distinto en cada zona', () => {
    const i = new Date('2026-09-07T12:00:00.000Z');
    expect(instantToClinicTime(i, AR)).toEqual({ date: '2026-09-07', time: '09:00' });
    expect(instantToClinicTime(i, MADRID)).toEqual({ date: '2026-09-07', time: '14:00' });
  });
});

describe('clinicDayRange', () => {
  it('cubre desde la medianoche local del primer día', () => {
    const { desde } = clinicDayRange('2026-09-07', '2026-09-12', AR);
    expect(desde.toISOString()).toBe('2026-09-07T03:00:00.000Z');
  });

  // Medio abierto: el fin es la medianoche del día SIGUIENTE al último.
  it('el fin es exclusivo, así que un turno a medianoche no cae en dos semanas', () => {
    const { hasta } = clinicDayRange('2026-09-07', '2026-09-12', AR);
    expect(hasta.toISOString()).toBe('2026-09-13T03:00:00.000Z');

    const siguiente = clinicDayRange('2026-09-13', '2026-09-19', AR);
    // El fin de una semana es exactamente el comienzo de la otra: sin hueco
    // ni superposición.
    expect(siguiente.desde.toISOString()).toBe(hasta.toISOString());
  });

  it('un solo día es un rango de 24 horas', () => {
    const { desde, hasta } = clinicDayRange('2026-09-07', '2026-09-07', AR);
    expect(hasta.getTime() - desde.getTime()).toBe(24 * 3600_000);
  });

  it('cruza el fin de mes sin romperse', () => {
    const { hasta } = clinicDayRange('2026-09-28', '2026-09-30', AR);
    expect(hasta.toISOString()).toBe('2026-10-01T03:00:00.000Z');
  });

  it('cruza el fin de año sin romperse', () => {
    const { hasta } = clinicDayRange('2026-12-30', '2026-12-31', AR);
    expect(hasta.toISOString()).toBe('2027-01-01T03:00:00.000Z');
  });
});

describe('clinicWeekday', () => {
  it('usa la convención de getDay(): 0 domingo … 6 sábado', () => {
    // 2026-09-07 es lunes.
    const lunes = clinicTimeToInstant('2026-09-07', '09:00', AR);
    expect(clinicWeekday(lunes, AR)).toBe(1);

    const domingo = clinicTimeToInstant('2026-09-06', '09:00', AR);
    expect(clinicWeekday(domingo, AR)).toBe(0);

    const sabado = clinicTimeToInstant('2026-09-12', '09:00', AR);
    expect(clinicWeekday(sabado, AR)).toBe(6);
  });

  // El mismo instante puede ser dos días distintos según la zona: por eso el
  // día de la semana se calcula con la zona de la clínica y no con la del
  // servidor.
  it('un turno de la noche sigue siendo del mismo día para la clínica', () => {
    const lunesTarde = clinicTimeToInstant('2026-09-07', '22:00', AR);
    expect(lunesTarde.toISOString()).toBe('2026-09-08T01:00:00.000Z'); // martes en UTC
    expect(clinicWeekday(lunesTarde, AR)).toBe(1); // lunes para la clínica
  });
});

describe('addMinutes', () => {
  it('suma la duración del turno', () => {
    const desde = clinicTimeToInstant('2026-09-07', '09:00', AR);
    expect(instantToClinicTime(addMinutes(desde, 45), AR).time).toBe('09:45');
    expect(instantToClinicTime(addMinutes(desde, 60), AR).time).toBe('10:00');
    expect(instantToClinicTime(addMinutes(desde, 90), AR).time).toBe('10:30');
  });
});
