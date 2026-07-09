import { NextFunction, Request, Response } from 'express';
import type { UserRole } from '@prisma/client';

// Autorización por rol. Asume que authenticate ya corrió (usa req.context),
// así que solo debe montarse detrás de él.
//
// 403 y no 401: acá el usuario está bien autenticado, lo que le falta es
// permiso. El mensaje es genérico a propósito: no revela qué rol haría falta.
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!roles.includes(req.context.role)) {
      res.status(403).json({ error: 'No tenés permisos para esta acción' });
      return;
    }
    next();
  };
}
