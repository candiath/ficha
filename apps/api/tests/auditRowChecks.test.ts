import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma, User } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import {
  createTestClinic,
  createTestOperator,
  deleteAuditRows,
  deleteOperatorAuditRows,
  type TestClinic,
  type TestOperator,
} from './helpers';

// What the database enforces on the coded audit rows (#186,
// SPEC-audit-structured-entries.md §2), whatever the code sends: params holds
// codes only, who acted matches the actor columns, and a platform row's object
// comes with its id. These tests write rows directly, past the catalog, as a
// bug or a hand-written query would.

const violates = (constraint: string) => new RegExp(`violates check constraint \\W*${constraint}`);

// What audit_params_are_codes must accept, and what it must refuse.
const ACCEPTED: Prisma.InputJsonObject[] = [
  {},
  { role: 'ADMIN' },
  { scaleType: 'SF36' },
  { changedFields: ['email', 'phone'] },
  { sessionType: 'DISCHARGE', changedFields: ['painScaleAfter'] },
];
const REFUSED: Prisma.InputJsonValue[] = [
  { amount: 15000 },
  { amount: '15000' },
  { x: 'ARS15000' },
  { x: 'DNI30123456' },
  { email: 'juan@x.com' },
  { note: 'dolor lumbar' },
  { x: 'Juan_Perez' },
  { x: 'dolor_lumbar' },
  { id: randomUUID() },
  { a: { b: 'C' } },
  { t: true },
  { f: ['Email'] },
  { f: [1] },
  { Bad: 'X' },
  [],
  'X',
];

describe('audit rows hold codes, and say who acted', () => {
  let clinic: TestClinic;
  let operator: TestOperator;
  let user: User;
  let patientId: string;

  beforeAll(async () => {
    clinic = await createTestClinic();
    operator = await createTestOperator();
    user = await clinic.createUser();
    ({ id: patientId } = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, firstName: 'Checked', lastName: 'Patient' },
      select: { id: true },
    }));
  });

  afterAll(async () => {
    await deleteAuditRows([clinic.tenantId]);
    await deleteOperatorAuditRows(operator.operator.id);
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await clinic.cleanup();
    await operator.cleanup();
  });

  const clinical = (data: Partial<Prisma.AuditLogUncheckedCreateInput> = {}) =>
    prisma.auditLog.create({
      data: {
        tenantId: clinic.tenantId,
        patientId,
        userId: user.id,
        entity: 'PATIENT',
        entityId: patientId,
        action: 'PATIENT_UPDATED',
        ...data,
      },
      select: { id: true },
    });

  const platform = (data: Partial<Prisma.PlatformAuditLogUncheckedCreateInput> = {}) =>
    prisma.platformAuditLog.create({
      data: { operatorId: operator.operator.id, tenantId: clinic.tenantId, action: 'TENANT_CREATED', ...data },
      select: { id: true },
    });

  describe('params', () => {
    it('accepts codes and lists of field names, in both tables', async () => {
      for (const params of ACCEPTED) {
        await expect(clinical({ params })).resolves.toBeTruthy();
        await expect(platform({ params })).resolves.toBeTruthy();
      }
    });

    it('refuses numbers, ids, emails, sentences, lower case and nesting, in both tables', async () => {
      for (const params of REFUSED) {
        await expect(clinical({ params }), JSON.stringify(params)).rejects.toThrow(
          violates('audit_logs_params_are_codes'),
        );
        await expect(platform({ params }), JSON.stringify(params)).rejects.toThrow(
          violates('platform_audit_logs_params_are_codes'),
        );
      }
    });
  });

  describe('actor_type', () => {
    it("a clinical row is the user's exactly when it names one", async () => {
      await expect(clinical({ actorType: 'USER' })).resolves.toBeTruthy();
      await expect(clinical({ actorType: 'SYSTEM', userId: null })).resolves.toBeTruthy();

      await expect(clinical({ actorType: 'USER', userId: null })).rejects.toThrow(
        violates('audit_logs_actor_matches_user'),
      );
      await expect(clinical({ actorType: 'SYSTEM' })).rejects.toThrow(violates('audit_logs_actor_matches_user'));
      await expect(clinical({ actorType: 'OPERATOR' })).rejects.toThrow(violates('audit_logs_actor_matches_user'));
    });

    it('a platform row is always the operator’s', async () => {
      await expect(platform({ actorType: 'SYSTEM' })).rejects.toThrow(
        violates('platform_audit_logs_actor_is_operator'),
      );
      await expect(platform({ actorType: 'USER' })).rejects.toThrow(violates('platform_audit_logs_actor_is_operator'));
    });
  });

  describe("a platform row's object", () => {
    it('comes with its id, or not at all', async () => {
      await expect(platform({ entity: 'PASSWORD_RESET_TOKEN' })).rejects.toThrow(
        violates('platform_audit_logs_entity_with_id'),
      );
      await expect(platform({ entityId: randomUUID() })).rejects.toThrow(
        violates('platform_audit_logs_entity_with_id'),
      );
    });

    it('is acted on once per action, and may be acted on again by another action', async () => {
      const entityId = randomUUID();
      const row = { action: 'PASSWORD_RESET_LINK_CREATED' as const, entity: 'PASSWORD_RESET_TOKEN' as const, entityId };

      await expect(platform(row)).resolves.toBeTruthy();
      await expect(platform(row)).rejects.toThrow(/Unique constraint failed/);
      await expect(platform({ ...row, action: 'USER_DEVICES_DISCONNECTED' })).resolves.toBeTruthy();
    });
  });
});
