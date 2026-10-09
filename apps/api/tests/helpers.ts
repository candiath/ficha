import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { PlatformOperator, User, UserRole } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { generateOpaqueToken, hashOpaqueToken } from '../src/lib/opaqueToken';
import type { TenantContext } from '../src/repositories/types';

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
  /** Nombre y slug del tenant: /api/auth/me y el login los devuelven. */
  name: string;
  slug: string;
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
    // Las acciones del operador de plataforma sobre esta clínica apuntan al
    // tenant con FK RESTRICT: van antes que él.
    await prisma.platformAuditLog.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.user.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } });
  }

  return { tenantId: tenant.id, name: tenant.name, slug: tenant.slug, email, createUser, cleanup };
}

interface CreateTestTokenOptions {
  /** Absolute lifetime from now, in ms; negative creates an already expired session. */
  ttlMs?: number;
  /** Trusted-device profile (longer idle timeout). */
  trusted?: boolean;
  /** When the session was last used; in the past to test idle expiry. */
  lastUsedAt?: Date;
}

// The bearer token for a clinic user: inserts an auth_sessions row directly,
// without going through /login (no rate limiter budget spent). The session is
// deleted with the user by the clinic's cleanup (ON DELETE CASCADE).
export async function createTestToken(
  user: { id: string },
  opts: CreateTestTokenOptions = {},
): Promise<string> {
  return (await createTestAuthSession(user, opts)).token;
}

// The session row behind createTestToken, for tests that also need its id.
export async function createTestAuthSession(
  user: { id: string },
  opts: CreateTestTokenOptions = {},
): Promise<{ token: string; authSessionId: string }> {
  const token = generateOpaqueToken();
  const session = await prisma.authSession.create({
    data: {
      userId: user.id,
      tokenHash: hashOpaqueToken(token),
      expiresAt: new Date(Date.now() + (opts.ttlMs ?? 60 * 60 * 1000)),
      trusted: opts.trusted ?? false,
      ...(opts.lastUsedAt && { lastUsedAt: opts.lastUsedAt }),
    },
    select: { id: true },
  });
  return { token, authSessionId: session.id };
}

// A TenantContext as authenticate builds it, for tests that call repositories
// directly: backed by a real session of the user, so audited writes record a
// session that exists (#186).
export async function createTestContext(
  tenantId: string,
  user: { id: string; role: UserRole },
): Promise<TenantContext> {
  const { authSessionId } = await createTestAuthSession(user);
  return { tenantId, userId: user.id, role: user.role, authSessionId };
}

// ─── Operador de plataforma ─────────────────────────────────────────────────

export interface TestOperator {
  operator: PlatformOperator;
  token: string;
  cleanup(): Promise<void>;
}

// Un operador de plataforma con su token. No pertenece a ninguna clínica:
// se limpia aparte de createTestClinic, y sus filas de auditoría se borran
// por operador (las de una clínica de test ya las borra cleanup de ésta).
export async function createTestOperator(
  opts: { isActive?: boolean; password?: string } = {},
): Promise<TestOperator> {
  const runId = randomUUID().slice(0, 8);
  const operator = await prisma.platformOperator.create({
    data: {
      email: `operador-${runId}@test.ficha.local`,
      name: 'Operador de Prueba',
      passwordHash: await bcrypt.hash(opts.password ?? TEST_PASSWORD, 4),
      isActive: opts.isActive ?? true,
    },
  });

  async function cleanup(): Promise<void> {
    await sleep(200);
    await prisma.loginEvent.deleteMany({ where: { email: { contains: runId } } });
    await prisma.platformAuditLog.deleteMany({ where: { operatorId: operator.id } });
    await prisma.platformOperator.delete({ where: { id: operator.id } });
  }

  return { operator, token: signOperatorTestToken(operator.id), cleanup };
}

// Firma un token de operador con el secreto de plataforma, sin pasar por el
// login. `secret` permite firmar a propósito con el secreto equivocado para
// probar que el otro middleware lo rechaza.
export function signOperatorTestToken(
  operatorId: string,
  opts: { secret?: string } = {},
): string {
  return jwt.sign(
    { kind: 'platform' },
    opts.secret ?? (process.env.PLATFORM_JWT_SECRET as string),
    { subject: operatorId, expiresIn: '1h' },
  );
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

// ─── Audit entries for direct repository calls ──────────────────────────────
// Audited repository writes take their audit entry as an argument (#188);
// tests that call them directly pass one of these.

export function patientAudit(action: 'CREATED' | 'UPDATED') {
  return (p: { id: string }) => ({
    patientId: p.id,
    entity: 'PATIENT' as const,
    entityId: p.id,
    action,
    description: `test: patient ${action.toLowerCase()}`,
  });
}

export function patientDeleteAudit(patientId: string) {
  return {
    patientId,
    entity: 'PATIENT' as const,
    entityId: patientId,
    action: 'DELETED' as const,
    description: 'test: patient deleted',
  };
}
