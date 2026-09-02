import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { packageRepo, patientRepo } from '../src/repositories';
import type { TenantContext } from '../src/repositories/types';
import { createTestClinic, type TestClinic } from './helpers';

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
    ctxA = { tenantId: clinicA.tenantId, userId: userA.id, role: userA.role };
    ctxB = { tenantId: clinicB.tenantId, userId: userB.id, role: userB.role };

    patientA = await patientRepo.create(ctxA, { fullName: 'Paciente A' });
    patientA2 = await patientRepo.create(ctxA, { fullName: 'Paciente A2' });
    patientB = await patientRepo.create(ctxB, { fullName: 'Paciente B' });
  });

  afterAll(async () => {
    const tenantIds = [clinicA.tenantId, clinicB.tenantId];
    await prisma.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.session.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.sessionPackage.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.patient.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await clinicA.cleanup();
    await clinicB.cleanup();
  });

  function crearPaquete(ctx: TenantContext, patientId: string) {
    return packageRepo.create(ctx, {
      patientId,
      name: 'Paquete x10',
      totalSessions: 10,
      pricePerSession: 100,
    });
  }

  it('deleteIfUnused: borra un paquete sin pagos y reporta not_found/in_use', async () => {
    await expect(packageRepo.deleteIfUnused(ctxA, randomUUID())).resolves.toBe('not_found');

    const fresh = await crearPaquete(ctxA, patientA.id);
    await expect(packageRepo.deleteIfUnused(ctxA, fresh.id)).resolves.toBe('deleted');

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
        baseAmount: 100,
        discount: 0,
        finalAmount: 100,
      },
    });

    await expect(packageRepo.deleteIfUnused(ctxA, used.id)).resolves.toBe('in_use');
    const intact = await prisma.sessionPackage.findUnique({ where: { id: used.id } });
    expect(intact).not.toBeNull();
  });

  it('deleteIfUnused: un paquete ajeno cuenta como not_found (no se filtra su existencia)', async () => {
    const foreign = await crearPaquete(ctxB, patientB.id);
    await expect(packageRepo.deleteIfUnused(ctxA, foreign.id)).resolves.toBe('not_found');
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
