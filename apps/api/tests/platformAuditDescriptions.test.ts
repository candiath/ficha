import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app';
import { createTestClinic, createTestOperator, type TestClinic, type TestOperator } from './helpers';

const PLATFORM = '/api/platform';

// The operator's audit rows name the action, never a person or a clinic
// (#186, docs/specs/SPEC-audit-hardening.md §4): audit rows can never change,
// so an email or a name in one could never be erased. Who was affected is
// resolved when the list is read, from the row's target, so an anonymized
// user would show as anonymized.
describe('platform audit descriptions carry no names', { timeout: 30_000 }, () => {
  let op: TestOperator;
  let clinic: TestClinic;

  const asOperator = (r: request.Test) => r.set('Authorization', `Bearer ${op.token}`);
  const users = () => `${PLATFORM}/tenants/${clinic.tenantId}/users`;

  type AuditRow = {
    action: string;
    description: string;
    targetUserId: string | null;
    targetUser: { email: string; name: string | null } | null;
  };

  let rows: AuditRow[];
  let admin: { id: string; email: string };

  beforeAll(async () => {
    op = await createTestOperator();
    clinic = await createTestClinic();

    const create = (local: string, name: string) =>
      asOperator(request(app).post(users())).send({
        email: clinic.email(local),
        name,
        password: 'clave-larga-123',
      });
    const first = await create('first-admin', 'First Admin');
    const second = await create('second-admin', 'Second Admin');
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    admin = first.body.data;

    const patchUser = (body: object) =>
      asOperator(request(app).patch(`${users()}/${second.body.data.id}`)).send(body);
    expect((await patchUser({ role: 'THERAPIST' })).status).toBe(200);
    expect((await patchUser({ isActive: false })).status).toBe(200);
    expect(
      (await asOperator(request(app).post(`${users()}/${admin.id}/disconnect-devices`))).status,
    ).toBe(204);
    expect(
      (await asOperator(request(app).post(`${users()}/${admin.id}/password-reset`))).status,
    ).toBe(201);

    const tenant = (active: boolean) =>
      asOperator(request(app).patch(`${PLATFORM}/tenants/${clinic.tenantId}`)).send({ active });
    expect((await tenant(false)).status).toBe(200);
    expect((await tenant(true)).status).toBe(200);

    const res = await asOperator(request(app).get(`${PLATFORM}/tenants/${clinic.tenantId}/audit-log`));
    expect(res.status).toBe(200);
    rows = res.body.data;
  });

  afterAll(async () => {
    await clinic.cleanup();
    await op.cleanup();
  });

  it('records every action', () => {
    expect(rows.map((r) => r.action).sort()).toEqual([
      'ADMIN_CREATED',
      'ADMIN_CREATED',
      'PASSWORD_RESET_LINK_CREATED',
      'TENANT_DEACTIVATED',
      'TENANT_REACTIVATED',
      'USER_ACTIVE_CHANGED',
      'USER_DEVICES_DISCONNECTED',
      'USER_ROLE_CHANGED',
    ]);
  });

  it('no description carries an email or the clinic name', () => {
    for (const row of rows) {
      expect(row.description).not.toMatch(/@/);
      expect(row.description).not.toContain(clinic.name);
    }
  });

  it('the new role stays: it is what the audit must show', () => {
    const roleChange = rows.find((r) => r.action === 'USER_ROLE_CHANGED');
    expect(roleChange?.description).toBe('Cambió el rol a fisioterapeuta');
  });

  it('who was affected is resolved from the target', () => {
    const reset = rows.find((r) => r.action === 'PASSWORD_RESET_LINK_CREATED');
    expect(reset?.targetUser).toEqual({ email: admin.email, name: 'First Admin' });

    const tenantRows = rows.filter((r) => r.action.startsWith('TENANT_'));
    for (const row of tenantRows) expect(row.targetUser).toBeNull();
  });
});
