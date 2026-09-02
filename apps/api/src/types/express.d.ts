import type { TenantContext } from '../repositories/types';

// Extiende el Request de Express con el contexto que setea el middleware
// authenticate. Se tipa como no-opcional para que los handlers usen
// req.context sin chequeos: las rutas de dominio solo se montan detrás
// del middleware, así que en ese punto siempre existe.
//
// Las rutas no tienen acceso a la base: le pasan este contexto a los
// repositorios de src/repositories, que son los únicos que hablan con Prisma
// (lo hace cumplir la regla no-restricted-imports de eslint.config.mjs).
declare global {
  namespace Express {
    interface Request {
      context: TenantContext;
    }
  }
}

export {};
