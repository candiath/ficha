import { NextFunction, Request, Response } from 'express';
import { LAST_USED_THROTTLE_MS } from '../lib/authSessionPolicy';
import { platformRepo } from '../repositories';

// The platform operator's authenticate (docs/specs/SPEC-operator-sessions.md).
// Same contract as middlewares/auth.ts: the token is opaque and only names a
// row, here in platform_operator_sessions; whether it still grants access
// (session unrevoked, within its idle and absolute timeouts, operator active)
// is decided by one query on every request.
//
// Isolation from the clinic rests on the two tables: an operator token is
// looked up only here, a clinic token only in auth_sessions. Attaches
// req.operator, never req.context: without a TenantContext the domain
// repositories accept not even a read from her.
export async function authenticateOperator(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }

  const session = await platformRepo.findValidOperatorSession(header.slice('Bearer '.length));

  // One message for every failure: telling them apart would leak state.
  if (!session) {
    res.status(401).json({ error: 'Sesión expirada o inválida' });
    return;
  }

  // At most once per throttle window, fire-and-forget: a failure only means
  // the session may idle out a few minutes early.
  if (Date.now() - session.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    platformRepo
      .touchOperatorSession(session.operatorSessionId)
      .catch((err) => console.error('[platform-auth] lastUsedAt', err));
  }

  req.operator = { operatorId: session.operatorId, operatorSessionId: session.operatorSessionId };
  next();
}
