import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { User, UserRole } from '@prisma/client';
import { prisma } from '../src/lib/prisma';

// Los tests corren contra la DB real de desarrollo (Neon): cada suite crea
// su propia clínica con emails únicos y la borra al final, así no se pisa
// con otras suites ni ensucia los datos del seed.

// Contraseña por defecto de los usuarios de prueba (cumple el mínimo de 8).
export const TEST_PASSWORD = 'clave-de-test-123';

interface CreateUserOptions {
  role?: UserRole;
  isActive?: boolean;
  password?: string;
  name?: string;
}

export interface TestClinic {
  tenantId: string;
  /** `algo` → `algo-<runId>@test.ficha.local`: único entre corridas y rastreable al limpiar. */
  email(local: string): string;
  createUser(opts?: CreateUserOptions): Promise<User>;
  cleanup(): Promise<void>;
}

export async function createTestClinic(): Promise<TestClinic> {
  const runId = randomUUID().slice(0, 8);
  const tenant = await prisma.tenant.create({
    data: { name: `Clínica Test ${runId}`, slug: `test-${runId}` },
  });

  const email = (local: string) => `${local}-${runId}@test.ficha.local`;

  // Cost 4 (el mínimo) en vez de 10: bcrypt.compare usa el costo del hash
  // guardado, y acá no protegemos nada real — solo aceleramos los tests.
  const defaultHash = await bcrypt.hash(TEST_PASSWORD, 4);

  let counter = 0;
  async function createUser(opts: CreateUserOptions = {}): Promise<User> {
    const passwordHash = opts.password ? await bcrypt.hash(opts.password, 4) : defaultHash;
    return prisma.user.create({
      data: {
        email: email(`user${counter++}`),
        name: opts.name ?? 'Usuario de Prueba',
        passwordHash,
        role: opts.role ?? 'THERAPIST',
        isActive: opts.isActive ?? true,
        tenantId: tenant.id,
      },
    });
  }

  async function cleanup(): Promise<void> {
    // Los inserts de login_events son fire-and-forget: darles un instante
    // a aterrizar antes de borrar, para no dejar filas huérfanas.
    await sleep(200);
    // El runId viaja en todos los emails de la suite, incluso en intentos
    // de login con emails que no existen (esos eventos no tienen tenantId).
    await prisma.loginEvent.deleteMany({ where: { email: { contains: runId } } });
    await prisma.user.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } });
  }

  return { tenantId: tenant.id, email, createUser, cleanup };
}

interface SignTestTokenOptions {
  /** Corrimiento del iat en segundos (negativo = emitido en el pasado). */
  iatOffsetSeconds?: number;
}

// Firma tokens con el mismo secreto que la API pero sin pasar por /login:
// no gasta el presupuesto del rate limiter y permite fabricar tokens con
// iat en el pasado para probar la invalidación por passwordChangedAt
// (jsonwebtoken usa el iat del payload como base si se lo pasás).
export function signTestToken(
  user: { id: string; tenantId: string },
  opts: SignTestTokenOptions = {},
): string {
  const iat = Math.floor(Date.now() / 1000) + (opts.iatOffsetSeconds ?? 0);
  return jwt.sign({ tenantId: user.tenantId, iat }, process.env.JWT_SECRET as string, {
    subject: user.id,
    expiresIn: '1h',
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Reintenta una consulta hasta que devuelva algo truthy: para asertar sobre
// escrituras fire-and-forget (login_events, lastLoginAt) sin depender de un
// sleep de duración adivinada.
export async function waitFor<T>(
  query: () => Promise<T | null | undefined | false>,
  { timeoutMs = 5000, intervalMs = 100 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await query();
    if (result) return result;
    if (Date.now() > deadline) {
      throw new Error(`waitFor: la condición no se cumplió en ${timeoutMs}ms`);
    }
    await sleep(intervalMs);
  }
}
