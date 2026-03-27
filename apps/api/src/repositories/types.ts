// Tipos de contexto que un adaptador necesita para filtrar por tenant.
// Cuando se implemente JWT, este ctx vendrá del middleware de auth.
export interface TenantContext {
  tenantId: string;
  userId?: string;
}
