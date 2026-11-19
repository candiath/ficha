import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PlatformAction, PlatformAuditEntity, Prisma, User } from '@prisma/client';
import { AUDIT_ACTIONS, type AuditActionDef } from '@ficha/shared';
import { prisma } from '../src/lib/prisma';
import {
  createTestClinic,
  createTestOperator,
  deleteAuditRows,
  deleteOperatorAuditRows,
  type TestClinic,
  type TestOperator,
} from './helpers';
import { fixture } from './fixtures';

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
  { encounterType: 'DISCHARGE', changedFields: ['painScaleAfter'] },
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

// The platform actions that make the object their row names: an entity and
// kind 'create' in the catalog. The database keeps one such row per object
// (platform_audit_logs_created_entity_key); every other action may repeat.
const CREATING_PLATFORM_ACTIONS = Object.entries(
  AUDIT_ACTIONS.platform_audit_logs as Readonly<Record<string, AuditActionDef>>,
)
  .filter(([, def]) => def.entity !== undefined && def.kind === 'create')
  .map(([code, def]) => ({ action: code as PlatformAction, entity: def.entity as PlatformAuditEntity }));

describe('audit rows hold codes, and say who acted', () => {
  let clinic: TestClinic;
  let operator: TestOperator;
  let user: User;
  let patientId: string;

  beforeAll(async () => {
    clinic = await createTestClinic();
    operator = await createTestOperator();
    user = await clinic.createUser();
    ({ id: patientId } = await fixture.patient.create({
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

    // TEST_ALERT_SENT is the one action with no clinic
    // (platform_audit_logs_tenant_only_off_platform).
    const creationRow = ({ action, entity }: (typeof CREATING_PLATFORM_ACTIONS)[number], entityId: string) => ({
      action,
      entity,
      entityId,
      tenantId: action === 'TEST_ALERT_SENT' ? null : clinic.tenantId,
    });

    it('is created once: a second creation row for it is refused, by any creating action', async () => {
      expect(CREATING_PLATFORM_ACTIONS.length).toBeGreaterThan(0);
      for (const creating of CREATING_PLATFORM_ACTIONS) {
        const entityId = randomUUID();
        await expect(platform(creationRow(creating, entityId)), creating.action).resolves.toBeTruthy();
        // The same action again, and every other action that creates this kind
        // of object (a link is an invitation or a reset, never both).
        for (const again of CREATING_PLATFORM_ACTIONS.filter((c) => c.entity === creating.entity)) {
          await expect(platform(creationRow(again, entityId)), `${creating.action} then ${again.action}`).rejects.toThrow(
            /Unique constraint failed/,
          );
        }
      }
    });

    // Past the catalog, which gives USER_DEVICES_DISCONNECTED no entity: it
    // stands for a later action on an object, such as revoking a link.
    it('may receive any other action, again and again', async () => {
      const entityId = randomUUID();
      const later = { action: 'USER_DEVICES_DISCONNECTED' as const, entity: 'PASSWORD_RESET_TOKEN' as const, entityId };

      await expect(platform({ ...later, action: 'PASSWORD_RESET_LINK_CREATED' })).resolves.toBeTruthy();
      await expect(platform(later)).resolves.toBeTruthy();
      await expect(platform(later)).resolves.toBeTruthy();
    });

    // A new creating action fails here until the index names it.
    it('the unique index names exactly the creating actions of the catalog', async () => {
      const [{ def }] = await prisma.$queryRaw<{ def: string }[]>`
        SELECT pg_get_indexdef('public.platform_audit_logs_created_entity_key'::regclass) AS def`;
      // An inclusion list on the action, keyed on the object: what the
      // parsing below assumes.
      expect(def).toMatch(/USING btree \(entity, entity_id\) WHERE \(action = ANY \(ARRAY\[/);
      const indexed = [...def.matchAll(/'([A-Z_]+)'::"PlatformAction"/g)].map((m) => m[1]);

      expect(indexed.sort()).toEqual(CREATING_PLATFORM_ACTIONS.map((c) => c.action).sort());
    });
  });
});
