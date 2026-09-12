import type { PaymentStatus } from '@prisma/client';

/**
 * Cómo queda liquidado un cobro: el monto final y el estado que le corresponde.
 *
 * Las dos cosas se deciden juntas porque dependen del mismo dato. Antes
 * `baseAmount - discount` estaba escrito en los tres lugares que crean o editan
 * un cobro (el alta de la sesión, POST /api/payments y el update), y agregar
 * ahí una segunda regla —el estado— era sembrar el mismo criterio tres veces.
 */
export interface Settlement {
  finalAmount: number;
  status: PaymentStatus;
}

/**
 * Un cobro sin monto no es una deuda.
 *
 * Una cuenta por cobrar es plata que alguien debe; si el descuento cancela el
 * costo entero —o la sesión se dio sin cargo desde el vamos— no hay nada que
 * cobrar, y dejarlo en PENDING hace que la app registre una deuda inexistente:
 * infla el contador del dashboard y, a los 14 días, la regla de cobros vencidos
 * emite una alerta pidiendo que se reclame $0.
 *
 * El estado correcto es WAIVED ("Eximido") y no PAID: marcarlo pagado obliga a
 * inventar un `paidAt` y un `method`, o sea a registrar un movimiento de caja
 * que nunca ocurrió. Eso rompe la pregunta más básica que se le hace al
 * sistema —cuánta plata entró— y no cierra contra la caja real. Además PAID
 * volvería indeleble la sesión: softDelete solo borra el cobro si NO está
 * pagado, así que una sesión de cortesía cargada por error quedaría trabada
 * detrás de un 409 que pide revertir un cobro que nunca existió.
 *
 * La derivación va en UNA sola dirección. Pasar a "no hay nada que cobrar" es
 * un hecho aritmético, pero volver a "hay que cobrar esto" es una decisión
 * comercial que no le toca al sistema: WAIVED conviene distinguir el cobro de
 * monto cero del que sí tenía monto y se perdonó a mano, y si la derivación
 * fuera simétrica, editar uno de esos últimos —subirle la base, corregir un
 * tipeo— lo devolvería solo a PENDING y la alerta terminaría reclamándole al
 * paciente una deuda que alguien decidió condonar.
 *
 * Un PAID no se toca nunca: ahí se movió plata de verdad.
 *
 * @param baseAmount monto antes del descuento
 * @param discount   descuento aplicado; quien llama ya validó que no supere la base
 * @param current    estado actual del cobro; ausente al crearlo
 */
export function settle(
  baseAmount: number,
  discount: number,
  current?: PaymentStatus,
): Settlement {
  const finalAmount = baseAmount - discount;

  if (current === 'PAID') return { finalAmount, status: 'PAID' };

  if (finalAmount === 0 && (current === undefined || current === 'PENDING')) {
    return { finalAmount, status: 'WAIVED' };
  }

  return { finalAmount, status: current ?? 'PENDING' };
}
