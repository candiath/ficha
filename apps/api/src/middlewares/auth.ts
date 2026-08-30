import { NextFunction, Request, Response } from 'express';
import { authRepo } from '../repositories';
import { verifyAccessToken } from '../lib/jwt';

// Valida el JWT del header Authorization y adjunta
// req.context = { tenantId, userId } para el resto de los handlers.
//
// Además de verificar la firma, consulta la DB en cada request: así,
// desactivar un usuario (isActive=false) revoca su acceso de inmediato,
// sin esperar a que el token expire. El tenantId también sale de la DB
// (fuente de verdad) y no del token.
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }

  let userId: string;
  let issuedAt: number;
  try {
    const decoded = verifyAccessToken(header.slice('Bearer '.length));
    userId = decoded.sub;
    issuedAt = decoded.iat;
  } catch {
    res.status(401).json({ error: 'Sesión expirada o inválida' });
    return;
  }

  // findForAuth filtra isActive: desactivar un usuario revoca el acceso
  // en el request siguiente, sin esperar a que el token expire.
  const user = await authRepo.findForAuth(userId);

  // Mismo mensaje que un token inválido: no revelamos si el usuario
  // existe pero está desactivado.
  if (!user) {
    res.status(401).json({ error: 'Sesión expirada o inválida' });
    return;
  }

  // Un token emitido antes del último cambio de contraseña ya no vale:
  // cambiar la contraseña revoca todas las sesiones anteriores (el botón
  // de pánico ante un token robado). Se compara en segundos porque iat
  // tiene esa resolución: el token nuevo que devuelve change-password se
  // firma en el mismo segundo del cambio y debe seguir valiendo.
  if (
    user.passwordChangedAt &&
    issuedAt < Math.floor(user.passwordChangedAt.getTime() / 1000)
  ) {
    res.status(401).json({ error: 'Sesión expirada o inválida' });
    return;
  }

  req.context = { tenantId: user.tenantId, userId: user.id, role: user.role };
  next();
}
