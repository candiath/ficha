import type { Prisma } from '@prisma/client';
import type { UserUpdateInput } from '../userRepository';

// La clínica nunca se queda sin una ADMIN activa.
//
// Antes el único freno era "no podés desactivar tu propia cuenta", en la ruta,
// y con una sola admin alcanzaba de casualidad: ella misma era la última. En
// cuanto el rol es editable deja de alcanzar — una admin puede degradarse, o
// dos degradarse mutuamente, y nadie queda para revertirlo.
//
// La regla va en el `where` de la escritura y no como chequeo previo: la
// existencia de otra admin se decide en la misma query que escribe, sin
// ventana entre mirar y tocar. Devuelve el fragmento de where para que cada
// llamador lo combine con el suyo: userRepository lo usa detrás del guard de
// tenant, y el operador de plataforma (#153) con el tenantId explícito. Una
// regla, un lugar.
//
// Solo restringe las escrituras que pueden QUITAR una admin activa. Subir de
// rol o reactivar nunca deja a la clínica peor de lo que estaba.
//
// Carrera residual, conocida y aceptada: dos admins degradándose en el mismo
// instante pasan las dos (READ COMMITTED: cada updateMany ve a la otra todavía
// ADMIN). Cerrarla exige una transacción Serializable con reintento de P2034;
// la ventana es de milisegundos y exige dos admins coordinadas, así que no se
// paga ese costo hoy.
export function whereConservaAdmin(id: string, input: UserUpdateInput): Prisma.UserWhereInput {
  const quitaAdminActiva = input.role === 'THERAPIST' || input.isActive === false;
  if (!quitaAdminActiva) return {};

  return {
    OR: [
      // No era ADMIN, o ya estaba inactiva: la escritura no cambia cuántas
      // admins activas quedan.
      { role: 'THERAPIST' },
      { isActive: false },
      // O queda otra.
      { tenant: { users: { some: { id: { not: id }, role: 'ADMIN', isActive: true } } } },
    ],
  };
}
