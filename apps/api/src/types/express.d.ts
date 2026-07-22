import type { TenantContext } from '../repositories/types';
import type { TenantScopedClient } from '../lib/tenantScope';

// Extiende el Request de Express con el contexto que setea el middleware
// authenticate. Se tipa como no-opcional para que los handlers usen
// req.context sin chequeos: las rutas de dominio solo se montan detrás
// del middleware, así que en ese punto siempre existe.
//
// req.db es el cliente Prisma scopeado al tenant (B1): lo setea el middleware
// attachTenantDb, montado justo después de authenticate. Las rutas de dominio
// usan req.db en vez del prisma crudo y así no pueden olvidarse el tenantId.
declare global {
  namespace Express {
    interface Request {
      context: TenantContext;
      db: TenantScopedClient;
    }
  }
}

export {};
