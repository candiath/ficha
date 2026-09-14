import type { UserRole } from '@prisma/client';

// Contexto del usuario autenticado. Lo construye el middleware authenticate
// a partir del JWT y se adjunta a req.context; los repos lo usan para
// filtrar por tenant y atribuir cada acción a quien la hizo.
// El role sale de la DB (no del token): un cambio de rol aplica de inmediato,
// sin esperar a que el JWT expire.
export interface TenantContext {
  tenantId: string;
  userId: string;
  role: UserRole;
}

// Contexto del operador de plataforma autenticado (middleware
// authenticateOperator, en req.operator). A propósito NO es un
// TenantContext: el operador no pertenece a ninguna clínica, y que los
// repositorios de dominio no lo acepten es lo que le impide tocar datos
// clínicos por accidente. Solo lo recibe platformRepository.
export interface OperatorContext {
  operatorId: string;
}
