import { NextFunction, Request, Response } from 'express';
import { LAST_USED_THROTTLE_MS } from '../lib/authSessionPolicy';
import { authRepo } from '../repositories';

// Validates the session token from the Authorization header and attaches
// req.context = { tenantId, userId, role, authSessionId } for the rest of the
// handlers.
//
// The token is opaque: it only names a row in auth_sessions. Whether it still
// grants access is decided by one query on every request (session unrevoked,
// not past its absolute or idle timeout, user active, clinic active), so
// revoking a session,
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

  const session = await authRepo.findValidAuthSession(header.slice('Bearer '.length));

  // Same message for every failure (unknown token, expired, revoked, user or
  // clinic deactivated): telling them apart would leak account state.
  if (!session) {
    res.status(401).json({ error: 'Sesión expirada o inválida' });
    return;
  }

  // Refresh last use at most once per throttle window: it drives idle expiry
  // and the session list, but must not turn every request into a write.
  // Fire-and-forget like touchLastLogin: a failure only means the session may
  // idle out a few minutes early, never a failed request.
  if (Date.now() - session.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    authRepo
      .touchAuthSession(session.authSessionId)
      .catch((err) => console.error('[auth] lastUsedAt', err));
  }

  req.context = {
    tenantId: session.tenantId,
    userId: session.userId,
    role: session.role,
    authSessionId: session.authSessionId,
  };
  next();
}
