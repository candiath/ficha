import { NextFunction, Request, Response } from 'express';
import { forTenant } from '../lib/tenantScope';

// Adopción de B1 (guardia estructural de multi-tenancy).
//
// Corre justo después de authenticate: toma el req.context ya validado y
// adjunta req.db = forTenant(context), el cliente Prisma scopeado al tenant.
// A partir de acá las rutas de dominio usan req.db y nunca escriben tenantId
// a mano; la client extension lo inyecta sola en cada query.
//
// forTenant() no abre conexiones nuevas: envuelve el pool del prisma base,
// así que instanciarlo por request es barato.
export function attachTenantDb(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  req.db = forTenant(req.context);
  next();
}
