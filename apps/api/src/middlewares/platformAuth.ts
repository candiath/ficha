import { NextFunction, Request, Response } from 'express';
import { platformRepo } from '../repositories';
import { verifyOperatorToken } from '../lib/platformJwt';

// El authenticate del operador de plataforma. Mismo contrato que
// middlewares/auth.ts —firma, isActive en cada request, passwordChangedAt
// contra el iat— pero verifica con PLATFORM_JWT_SECRET y busca en
// platform_operators, así que un token de usuario de clínica no pasa por acá
// ni uno de operador por authenticate. Adjunta req.operator, nunca
// req.context: sin TenantContext, los repositorios de dominio no le aceptan
// ni una lectura.
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

  let operatorId: string;
  let issuedAt: number;
  try {
    const decoded = verifyOperatorToken(header.slice('Bearer '.length));
    operatorId = decoded.sub;
    issuedAt = decoded.iat;
  } catch {
    res.status(401).json({ error: 'Sesión expirada o inválida' });
    return;
  }

  const operator = await platformRepo.findOperatorForAuth(operatorId);
  if (!operator) {
    res.status(401).json({ error: 'Sesión expirada o inválida' });
    return;
  }

  if (
    operator.passwordChangedAt &&
    issuedAt < Math.floor(operator.passwordChangedAt.getTime() / 1000)
  ) {
    res.status(401).json({ error: 'Sesión expirada o inválida' });
    return;
  }

  req.operator = { operatorId: operator.id };
  next();
}
