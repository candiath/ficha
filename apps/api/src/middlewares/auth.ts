import { NextFunction, Request, Response } from 'express';
import { authRepo } from '../repositories';

// Validates the session token from the Authorization header and attaches
// req.context = { tenantId, userId, role } for the rest of the handlers, plus
// req.authSessionId for the routes that act on the current session.
//
// The token is opaque: it only names a row in auth_sessions. Whether it still
// grants access is decided by one query on every request (session unrevoked
// and unexpired, user active, clinic active), so revoking a session,
// deactivating a user or deactivating a clinic takes effect on the next
// request. Role and tenant come from the database, never from the token.
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

  const session = await authRepo.findSessionForAuth(header.slice('Bearer '.length));

  // Same message for every failure (unknown token, expired, revoked, user or
  // clinic deactivated): telling them apart would leak account state.
  if (!session) {
    res.status(401).json({ error: 'Sesión expirada o inválida' });
    return;
  }

  req.context = { tenantId: session.tenantId, userId: session.userId, role: session.role };
  req.authSessionId = session.sessionId;
  next();
}
