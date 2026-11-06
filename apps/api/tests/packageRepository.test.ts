import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { packageRepo, patientRepo } from '../src/repositories';
import type { AuditEntry } from '../src/repositories/auditLogRepository';
import type { TenantContext } from '../src/repositories/types';
import {
  deleteAuditRows,
  createTestContext,
  createTestClinic,
  createTestToken,
  type TestClinic,
  patientAudit,
} from './helpers';

const created = (p: { id: string; patientId: string }): AuditEntry => ({
  action: 'PACKAGE_CREATED',
  patientId: p.patientId,
  entityId: p.id,
  params: {},
});

const deleted = (p: { id: string; patientId: string }): AuditEntry => ({
  action: 'PACKAGE_DELETED',
  patientId: p.patientId,
  entityId: p.id,
  params: {},
});

// packageRepo concentra la regla "no borrar un paquete con sesiones ya
// usadas": deleteIfUnused lleva la condición en el where del delete (sin
// ventana entre chequeo y borrado) y distingue not_found de in_use solo
// para el mensaje.
describe('packageRepo: deleteIfUnused y pertenencia', () => {
  let clinicA: TestClinic;
  let clinicB: TestClinic;
  let userA: User;
  let ctxA: TenantContext;
  let ctxB: TenantContext;
  let patientA: { id: string };
  let patientA2: { id: string };
  let patientB: { id: string };

  beforeAll(async () => {
    clinicA = await createTestClinic();
    clinicB = await createTestClinic();
    userA = await clinicA.createUser();
    const userB = await clinicB.createUser();
    ctxA = await createTestContext(clinicA.tenantId, userA);
    ctxB = await createTestContext(clinicB.tenantId, userB);

    patientA = await patientRepo.create(ctxA, { firstName: 'Paciente', lastName: 'A' }, patientAudit('CREATED'));
    patientA2 = await patientRepo.create(ctxA, { firstName: 'Paciente', lastName: 'A2' }, patientAudit('CREATED'));
    patientB = await patientRepo.create(ctxB, { firstName: 'Paciente', lastName: 'B' }, patientAudit('CREATED'));
  });

  afterAll(async () => {
    const tenantIds = [clinicA.tenantId, clinicB.tenantId];
    await deleteAuditRows(tenantIds);
    await prisma.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    // A session's blocks (#238) restrict its deletion: they go first.
    await prisma.sessionEpisode.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.session.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.sessionPackage.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.patient.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await clinicA.cleanup();
    await clinicB.cleanup();
  });

  function crearPaquete(ctx: TenantContext, patientId: string) {
    return packageRepo.create(
      ctx,
      {
        patientId,
        name: 'Paquete x10',
        totalSessions: 10,
        pricePerSessionCents: 100,
      },
      created,
    );
  }

  it('creating and deleting a package each leave one row naming it and its patient', async () => {
    const token = await createTestToken(userA);
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

    const res = await auth(request(app).post('/api/packages')).send({
      patientId: patientA.id,
      name: 'Paquete x4',
      totalSessions: 4,
      pricePerSessionCents: 100,
    });
    expect(res.status).toBe(201);
    const id: string = res.body.data.id;

    expect((await auth(request(app).delete(`/api/packages/${id}`))).status).toBe(204);

    const rows = await prisma.auditLog.findMany({
      where: { entityId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(rows.map((r) => r.action)).toEqual(['PACKAGE_CREATED', 'PACKAGE_DELETED']);
    for (const row of rows) {
      expect(row).toMatchObject({ entity: 'PACKAGE', patientId: patientA.id, userId: userA.id, params: {} });
    }
  });

  it('a package that was not deleted leaves no row', async () => {
    const used = await crearPaquete(ctxA, patientA.id);
    const session = await prisma.session.create({
      data: { tenantId: clinicA.tenantId, patientId: patientA.id, userId: userA.id, sessionDate: new Date() },
    });
    await prisma.payment.create({
      data: {
        tenantId: clinicA.tenantId,
        patientId: patientA.id,
        sessionId: session.id,
        packageId: used.id,
        baseAmountCents: 100,
        finalAmountCents: 100,
      },
    });

    await expect(packageRepo.deleteIfUnused(ctxA, used.id, deleted)).resolves.toBe('in_use');

    expect(await prisma.auditLog.count({ where: { entityId: used.id, action: 'PACKAGE_DELETED' } })).toBe(0);
  });

  it('deleteIfUnused: borra un paquete sin pagos y reporta not_found/in_use', async () => {
    await expect(packageRepo.deleteIfUnused(ctxA, randomUUID(), deleted)).resolves.toBe('not_found');

    const fresh = await crearPaquete(ctxA, patientA.id);
    await expect(packageRepo.deleteIfUnused(ctxA, fresh.id, deleted)).resolves.toBe('deleted');

    // Paquete con un pago que lo debitó: in_use, y la fila queda intacta.
    const used = await crearPaquete(ctxA, patientA.id);
    const session = await prisma.session.create({
      data: {
        tenantId: clinicA.tenantId,
        patientId: patientA.id,
        userId: userA.id,
        sessionDate: new Date(),
      },
      select: { id: true },
    });
    await prisma.payment.create({
      data: {
        tenantId: clinicA.tenantId,
        patientId: patientA.id,
        sessionId: session.id,
        packageId: used.id,
        baseAmountCents: 100,
        discountCents: 0,
        finalAmountCents: 100,
      },
    });

    await expect(packageRepo.deleteIfUnused(ctxA, used.id, deleted)).resolves.toBe('in_use');
    const intact = await prisma.sessionPackage.findUnique({ where: { id: used.id } });
    expect(intact).not.toBeNull();
  });

  it('deleteIfUnused: un paquete ajeno cuenta como not_found (no se filtra su existencia)', async () => {
    const foreign = await crearPaquete(ctxB, patientB.id);
    await expect(packageRepo.deleteIfUnused(ctxA, foreign.id, deleted)).resolves.toBe('not_found');
  });

  it('belongsToPatient: exige tenant Y paciente', async () => {
    const pkg = await crearPaquete(ctxA, patientA.id);

    await expect(packageRepo.belongsToPatient(ctxA, pkg.id, patientA.id)).resolves.toBe(true);
    // Del mismo tenant pero de otro paciente: no.
    await expect(packageRepo.belongsToPatient(ctxA, pkg.id, patientA2.id)).resolves.toBe(false);
    // De otro tenant, aunque el paciente sea el dueño real: no.
    await expect(packageRepo.belongsToPatient(ctxB, pkg.id, patientA.id)).resolves.toBe(false);
  });
});
