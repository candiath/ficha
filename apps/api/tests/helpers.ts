import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { expect } from 'vitest';
import { Prisma, type PlatformOperator, type SessionType, type User, type UserRole } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { generateOpaqueToken, hashOpaqueToken } from '../src/lib/opaqueToken';
import type { TenantContext } from '../src/repositories/types';
import { auditEntityOf, auditEntryProblem, SESSION_SNAPSHOT_VERSION } from '@ficha/shared';
import { sessionSnapshot } from '../src/repositories/prisma/sessionSnapshot';
import { unwatchClinic, watchClinic } from './revisionInvariant';
import type { AuditBuilder, AuditEntry, AuditUpdateBuilder } from '../src/repositories/auditLogRepository';
import type { PatientAuditField } from '../src/repositories/patientRepository';
import type { RevisionTable } from '../src/repositories/prisma/recordRevision';

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

  watchClinic(tenant.id);

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
    unwatchClinic(tenant.id);
    // Los inserts de login_events son fire-and-forget: darles un instante
    // a aterrizar antes de borrar, para no dejar filas huérfanas.
    await sleep(200);
    // El runId viaja en todos los emails de la suite, incluso en intentos
    // de login con emails que no existen (esos eventos no tienen tenantId).
    await prisma.loginEvent.deleteMany({ where: { email: { contains: runId } } });
    // Las acciones del operador de plataforma sobre esta clínica apuntan al
    // tenant con FK RESTRICT: van antes que él.
    await deleteAuditRows([tenant.id]);
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
  /** When the session was created; out of order to test a clock that stepped back. */
  createdAt?: Date;
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
      ...(opts.createdAt && { createdAt: opts.createdAt }),
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
    await deleteOperatorAuditRows(operator.id);
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

// A delete refused by the ON DELETE RESTRICT key `constraint`. Postgres 16
// reports it as a foreign key violation (23503, Prisma's P2003); 18 as a
// restrict violation (23001), which Prisma 5 does not map, so it arrives as an
// unknown request error naming the key. Both are accepted until every Neon
// branch is on 18 (PLAN-clinical-revisions.md, step 0); then the P2003 case goes.
export async function expectRestrictedDelete(action: Promise<unknown>, constraint: string): Promise<void> {
  const error = await action.then(
    () => {
      throw new Error(`the delete went through: ${constraint} did not restrict it`);
    },
    (e: unknown) => e,
  );
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    expect(error).toMatchObject({ code: 'P2003', meta: { field_name: expect.stringContaining(constraint) } });
    return;
  }
  expect(error).toBeInstanceOf(Prisma.PrismaClientUnknownRequestError);
  const { message } = error as Error;
  expect(message).toContain('code: "23001"');
  expect(message).toMatch(new RegExp(`violates RESTRICT setting of foreign key constraint \\\\?"${constraint}\\\\?"`));
}

// ─── Audit entries for direct repository calls ──────────────────────────────
// Audited repository writes take their audit entry as an argument (#188);
// tests that call them directly pass one of these.

export function patientAudit(action: 'CREATED'): AuditBuilder<{ id: string }>;
export function patientAudit(action: 'UPDATED'): AuditUpdateBuilder<{ id: string }, PatientAuditField>;
export function patientAudit(action: 'CREATED' | 'UPDATED') {
  return action === 'CREATED'
    ? (p: { id: string }): AuditEntry => ({ action: 'PATIENT_CREATED', patientId: p.id, entityId: p.id, params: {} })
    : (p: { id: string }, changedFields: [PatientAuditField, ...PatientAuditField[]]): AuditEntry => ({
        action: 'PATIENT_UPDATED',
        patientId: p.id,
        entityId: p.id,
        params: { changedFields, reason: 'DATA_ENTRY_ERROR' },
      });
}

export function patientDeleteAudit(patientId: string): AuditEntry {
  return { action: 'PATIENT_DELETED', patientId, entityId: patientId, params: {} };
}

// ─── Audit rows ─────────────────────────────────────────────────────────────

// The only test code that deletes or backdates audit rows (#186,
// docs/specs/SPEC-audit-hardening.md §1). Each helper runs one transaction
// that first turns on the maintenance switch, tied to that transaction's id
// so a leaked value never matches. The append-only triggers honour it only on
// branches that carry the maintenance flag (development and ci).
export async function inAuditMaintenance<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const [{ flagged }] = await tx.$queryRaw<{ flagged: boolean }[]>`
      SELECT to_regclass('ficha_ops.audit_maintenance_allowed') IS NOT NULL AS flagged`;
    if (!flagged) {
      throw new Error(
        'This database has no audit maintenance flag, so tests cannot clean up audit rows. ' +
          'Only development and ci get it: CREATE SCHEMA IF NOT EXISTS ficha_ops; ' +
          'CREATE TABLE IF NOT EXISTS ficha_ops.audit_maintenance_allowed (); (see docs/infra.md).',
      );
    }
    await tx.$queryRaw`SELECT set_config('ficha.audit_maintenance', pg_current_xact_id()::text, true)`;
    return work(tx);
  });
}

// Fails closed: an empty list, or an empty id in it, throws instead of
// becoming "every row".
function requireIds(ids: string[], what: string): void {
  if (ids.length === 0 || ids.some((id) => !id)) {
    throw new Error(`audit cleanup needs at least one ${what}, and no empty ones`);
  }
}

// Every audit row of these clinics, clinical and platform. Their clinical
// revisions go first: each one restricts deleting the audit row it names, and
// the session it versions (SPEC-clinical-revisions.md, *Test cleanup*).
export async function deleteAuditRows(tenantIds: string[]): Promise<void> {
  requireIds(tenantIds, 'tenant id');
  await inAuditMaintenance(async (tx) => {
    const clinics = { where: { tenantId: { in: tenantIds } } };
    await tx.sessionRevision.deleteMany(clinics);
    await tx.patientRevision.deleteMany(clinics);
    await tx.episodeRevision.deleteMany(clinics);
    await tx.evaluationRevision.deleteMany(clinics);
    await tx.consentRevision.deleteMany(clinics);
    await tx.patientEventRevision.deleteMany(clinics);
    await tx.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await tx.platformAuditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
  });
}

// The revisions of a few aggregates, for a test that deletes one in the middle
// of a file, while its clinic's audit rows stay.
export async function deleteRevisions(table: RevisionTable, aggregateIds: string[]): Promise<void> {
  requireIds(aggregateIds, 'aggregate id');
  const ids = { in: aggregateIds };
  await inAuditMaintenance(async (tx) => {
    switch (table) {
      case 'session_revisions':
        return tx.sessionRevision.deleteMany({ where: { sessionId: ids } });
      case 'patient_revisions':
        return tx.patientRevision.deleteMany({ where: { patientId: ids } });
      case 'episode_revisions':
        return tx.episodeRevision.deleteMany({ where: { episodeId: ids } });
      case 'evaluation_revisions':
        return tx.evaluationRevision.deleteMany({ where: { evaluationId: ids } });
      case 'consent_revisions':
        return tx.consentRevision.deleteMany({ where: { consentId: ids } });
      case 'patient_event_revisions':
        return tx.patientEventRevision.deleteMany({ where: { patientEventId: ids } });
    }
  });
}

// The platform audit rows of one operator, and the test alerts she sent
// (with their deliveries): both restrict deleting her.
export async function deleteOperatorAuditRows(operatorId: string): Promise<void> {
  requireIds([operatorId], 'operator id');
  await inAuditMaintenance(async (tx) => {
    await tx.sysadminAlertDelivery.deleteMany({ where: { alert: { operatorId } } });
    await tx.sysadminAlert.deleteMany({ where: { operatorId } });
    await tx.platformAuditLog.deleteMany({ where: { operatorId } });
  });
}

// Sysadmin alerts a test raised, with their deliveries (#186,
// SPEC-sysadmin-alerts.md). Alerts carry no clinic, so a test deletes its own
// by id.
export async function deleteSysadminAlerts(alertIds: string[]): Promise<void> {
  requireIds(alertIds, 'alert id');
  await inAuditMaintenance(async (tx) => {
    await tx.sysadminAlertDelivery.deleteMany({ where: { alertId: { in: alertIds } } });
    await tx.sysadminAlert.deleteMany({ where: { id: { in: alertIds } } });
  });
}

// Audit rows with a chosen date, for tests about ordering. A row with an
// author names one of her sessions, as the database will require (#186).
export type BackdatedAuditRow = Prisma.AuditLogCreateManyInput & { createdAt: Date };

export async function insertAuditRowsAt(rows: BackdatedAuditRow[]): Promise<{ id: string }[]> {
  if (rows.length === 0) throw new Error('insertAuditRowsAt needs at least one row');
  // Checked against the catalog like any audit write, so a fixture cannot
  // drift from it (SPEC-audit-structured-entries.md §4).
  for (const row of rows) {
    const problem = auditEntryProblem('audit_logs', row.action, row.params ?? {});
    if (problem) throw new Error(`insertAuditRowsAt: ${problem}`);
    if (row.entity !== auditEntityOf('audit_logs', row.action)) {
      throw new Error(`insertAuditRowsAt: entity ${row.entity} does not match ${row.action}`);
    }
  }
  return inAuditMaintenance((tx) => tx.auditLog.createManyAndReturn({ data: rows, select: { id: true } }));
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

type SessionBlockFixture = Prisma.SessionEpisodeUncheckedCreateWithoutSessionInput;

interface SessionFixture {
  tenantId: string;
  patientId: string;
  userId: string;
  sessionDate: Date;
  sessionType?: SessionType;
  observations?: string | null;
  deletedAt?: Date | null;
  blocks?: SessionBlockFixture[];
}

// A session written straight to the database, for tests about what reads it. It
// comes as the app leaves one: with its blocks, its audit row and version 1,
// which is what the revision invariant checks (tests/revisionInvariant.ts).
export async function createSessionFixture(fixture: SessionFixture): Promise<{ id: string }> {
  const { blocks = [], ...fields } = fixture;
  const { tenantId, patientId, userId } = fields;
  return prisma.$transaction(async (tx) => {
    const row = await tx.session.create({
      data: {
        ...fields,
        episodes: { create: blocks },
      },
      select: {
        id: true,
        userId: true,
        sessionType: true,
        sessionDate: true,
        observations: true,
        episodes: { orderBy: { episodeId: 'asc' } },
      },
    });
    const action = (
      { SESSION: 'SESSION_RECORDED', NOTE: 'NOTE_RECORDED', DISCHARGE: 'DISCHARGE_RECORDED' } as const
    )[row.sessionType];
    const { id: auditLogId } = await tx.auditLog.create({
      data: { tenantId, patientId, userId, entity: 'SESSION', entityId: row.id, action },
      select: { id: true },
    });
    await tx.sessionRevision.create({
      data: {
        tenantId,
        patientId,
        sessionId: row.id,
        version: 1,
        auditLogId,
        schemaVersion: SESSION_SNAPSHOT_VERSION,
        snapshot: sessionSnapshot(row),
      },
    });
    return { id: row.id };
  });
}

/**
 * A test's one-string patient name as the two columns (#238): the last word is
 * the surname. A one-word name gets the surname "Test".
 */
export function splitName(name: string): { firstName: string; lastName: string } {
  const trimmed = name.trim();
  const at = trimmed.lastIndexOf(' ');
  return at === -1
    ? { firstName: trimmed, lastName: 'Test' }
    : { firstName: trimmed.slice(0, at), lastName: trimmed.slice(at + 1) };
}
