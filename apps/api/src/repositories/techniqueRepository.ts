import type { TenantContext } from './types';

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface TechniqueDTO {
  id: string;
  name: string;
  isGlobal: boolean;
  tenantId: string | null;
  createdAt: string;
}

// ─── Port ────────────────────────────────────────────────────────────────────

// Política del repositorio: una técnica es UTILIZABLE por un tenant si es
// global (catálogo compartido) o le pertenece; y solo las propias son
// editables/borrables — las globales se administran por seed.
//
// Ojo: Technique tiene tenantId nullable y NO está en TENANT_SCOPED_MODELS,
// así que el guard de forTenant no la cubre. Este repo es el único lugar
// donde ese filtro se escribe a mano; fuera de acá no hay red.
export interface TechniqueRepository {
  /** Globales + propias del tenant, globales primero. */
  list(ctx: TenantContext): Promise<TechniqueDTO[]>;
  /** Crea una técnica propia del tenant (isGlobal: false). */
  create(ctx: TenantContext, input: { name: string }): Promise<TechniqueDTO>;
  /** null si no existe, es de otro tenant o es global (no editable). */
  update(ctx: TenantContext, id: string, input: { name: string }): Promise<TechniqueDTO | null>;
  /** Borrado físico. false si no había técnica propia del tenant que borrar. */
  delete(ctx: TenantContext, id: string): Promise<boolean>;
  /** true si TODAS las técnicas existen y son utilizables (propias o globales). */
  allUsableByTenant(ctx: TenantContext, techniqueIds: string[]): Promise<boolean>;
}
