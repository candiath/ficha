import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { patientRepo, paymentRepo, sessionRepo } from '../src/repositories';
import type { AuditEntry } from '../src/repositories/auditLogRepository';
import type { TenantContext } from '../src/repositories/types';
import { createTestClinic, patientAudit, type TestClinic } from './helpers';

// #188: an audited write and its audit row commit together or not at all.
// Each test forces the audit insert to fail — an entry pointing at a patient
// that does not exist violates audit_logs' foreign key — and checks that the
// write it was recording rolled back with it.

describe('audit rows are written in the same transaction as their action', () => {
  let clinic: TestClinic;
  let user: User;
  let ctx: TenantContext;

  // An audit entry that cannot be inserted.
  const broken = (): AuditEntry => ({
    patientId: randomUUID(),
    entity: 'PATIENT',
    entityId: randomUUID(),
    action: 'UPDATED',
    description: 'test: this insert must fail',
  });

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
    ctx = { tenantId: clinic.tenantId, userId: user.id, role: 'THERAPIST' };
  });

  afterAll(async () => {
    const tenantId = clinic.tenantId;
    await prisma.auditLog.deleteMany({ where: { tenantId } });
    await prisma.payment.deleteMany({ where: { tenantId } });
    await prisma.session.deleteMany({ where: { tenantId } });
    await prisma.patient.deleteMany({ where: { tenantId } });
    await clinic.cleanup();
  });

  it('a patient is not created when its audit row fails', async () => {
    const before = await prisma.patient.count({ where: { tenantId: clinic.tenantId } });

    await expect(patientRepo.create(ctx, { fullName: 'Sin Auditoría' }, broken)).rejects.toThrow();

    expect(await prisma.patient.count({ where: { tenantId: clinic.tenantId } })).toBe(before);
  });

  it('a patient update is rolled back when its audit row fails', async () => {
    const patient = await patientRepo.create(ctx, { fullName: 'Original' }, patientAudit('CREATED'));

    await expect(
      patientRepo.update(ctx, patient.id, { fullName: 'Cambiado' }, broken),
    ).rejects.toThrow();

    const row = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(row.fullName).toBe('Original');
  });

  it('a clinical session and its payment are not created when the audit row fails', async () => {
    const patient = await patientRepo.create(ctx, { fullName: 'Con Sesión' }, patientAudit('CREATED'));

    await expect(
      sessionRepo.create(
        ctx,
        patient.id,
        {
          sessionType: 'SESSION',
          sessionDate: new Date(),
          episodeIds: [],
          payment: { baseAmount: 1000, discount: 0 },
        },
        broken,
      ),
    ).rejects.toThrow();

    expect(await prisma.session.count({ where: { patientId: patient.id } })).toBe(0);
    expect(await prisma.payment.count({ where: { patientId: patient.id } })).toBe(0);
  });

  it('a payment is not created when its audit row fails', async () => {
    const patient = await patientRepo.create(ctx, { fullName: 'Con Cobro' }, patientAudit('CREATED'));
    const session = await prisma.session.create({
      data: {
        tenantId: clinic.tenantId,
        patientId: patient.id,
        userId: user.id,
        sessionDate: new Date(),
      },
    });

    await expect(
      paymentRepo.create(ctx, { sessionId: session.id, baseAmount: 1000, discount: 0 }, broken),
    ).rejects.toThrow();

    expect(await prisma.payment.count({ where: { sessionId: session.id } })).toBe(0);
  });

  it('a successful write leaves exactly one audit row, attributed to the actor', async () => {
    const patient = await patientRepo.create(ctx, { fullName: 'Auditado' }, patientAudit('CREATED'));

    const rows = await prisma.auditLog.findMany({ where: { patientId: patient.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'CREATED', entity: 'PATIENT', userId: user.id });
  });
});
