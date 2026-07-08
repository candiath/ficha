// Contexto del usuario autenticado. Lo construye el middleware authenticate
// a partir del JWT y se adjunta a req.context; los repos lo usan para
// filtrar por tenant y atribuir cada acción a quien la hizo.
export interface TenantContext {
  tenantId: string;
  userId: string;
}
