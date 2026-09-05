import type { TenantContext } from './types';

// ─── DTOs ────────────────────────────────────────────────────────────────────

// Sin id: el cliente ya sabe en qué clínica está (viaja en el token y lo
// resuelve el middleware). Mismo criterio que el tenant anidado de /api/auth/me.
//
// El slug tampoco es editable y por eso no aparece en el input de abajo: es un
// identificador, no un dato de contacto.
export interface TenantDTO {
  name: string;
  slug: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  cuit: string | null;
  specialty: string | null;
  timezone: string;
  workdayStart: string;
  workdayEnd: string;
  workdays: number[];
}

export interface TenantUpdateInput {
  name?: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  cuit?: string | null;
  specialty?: string | null;
  timezone?: string;
  workdayStart?: string;
  workdayEnd?: string;
  workdays?: number[];
}

// ─── Port ────────────────────────────────────────────────────────────────────

export interface TenantRepository {
  /**
   * La clínica del contexto. No devuelve null: `authenticate` carga al usuario
   * de la base y su `tenantId` es una FK, así que si acá no hay fila la base
   * está rota — y eso es un 500 legítimo, no un 404.
   */
  get(ctx: TenantContext): Promise<TenantDTO>;
  update(ctx: TenantContext, input: TenantUpdateInput): Promise<TenantDTO>;
}
