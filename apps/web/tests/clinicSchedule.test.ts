import { describe, expect, it } from 'vitest';
import { formatSchedule, formatWorkdays } from '@/lib/clinicSchedule';

// Los días se guardan con la convención de Date#getDay() (0 domingo … 6
// sábado), pero se leen en una semana que arranca el lunes. Ese desfasaje es
// donde aparecen los errores de un día, así que conviene fijarlo.
describe('formatWorkdays', () => {
  it('abrevia un rango corrido con "a"', () => {
    expect(formatWorkdays([1, 2, 3, 4, 5])).toBe('Lunes a viernes');
    expect(formatWorkdays([2, 3, 4])).toBe('Martes a jueves');
  });

  it('enumera los días salteados', () => {
    expect(formatWorkdays([1, 3, 5])).toBe('Lunes, miércoles y viernes');
  });

  it('con dos días usa "y" aunque sean consecutivos', () => {
    // "Lunes a martes" suena mal; con dos días la enumeración es más natural.
    expect(formatWorkdays([1, 2])).toBe('Lunes y martes');
  });

  it('un solo día va sin conectores', () => {
    expect(formatWorkdays([6])).toBe('Sábado');
    expect(formatWorkdays([0])).toBe('Domingo');
  });

  // El caso que delata si la semana se ordena desde el domingo: sábado y
  // domingo son consecutivos para quien mira un calendario, y con getDay()
  // están en los extremos opuestos (6 y 0).
  it('sábado y domingo salen juntos, no partidos', () => {
    expect(formatWorkdays([0, 6])).toBe('Sábado y domingo');
  });

  it('la semana completa se dice de una', () => {
    expect(formatWorkdays([0, 1, 2, 3, 4, 5, 6])).toBe('Todos los días');
  });

  it('sin días no inventa un horario', () => {
    expect(formatWorkdays([])).toBe('Sin días de atención');
  });

  it('no depende del orden en que vengan', () => {
    expect(formatWorkdays([5, 1, 3])).toBe('Lunes, miércoles y viernes');
  });
});

describe('formatSchedule', () => {
  it('junta los días con el rango horario', () => {
    expect(formatSchedule([1, 2, 3, 4, 5], '08:00', '20:00')).toBe(
      'Lunes a viernes, 08:00 a 20:00',
    );
  });
});
