import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { forTenant } from '../src/lib/tenantScope';
import type { TenantContext } from '../src/repositories/types';
import { createTestClinic, type TestClinic } from './helpers';

// B1-core: la extension forTenant debe hacer estructuralmente imposible tocar
// filas de otro tenant, sin que el handler escriba tenantId a mano. Se prueba
// el cliente scopeado directo (sin pasar por HTTP): dos clínicas, y el cliente
// de A no puede leer, contar, actualizar ni borrar filas de B; y al crear,
// el tenantId se inyecta solo.
describe('forTenant: guardia estructural de multi-tenancy', () => {
  let clinicA: TestClinic;
  let clinicB: TestClinic;
  let ctxA: TenantContext;
  let dbA: ReturnType<typeof forTenant>;
  let patientA: { id: string };
  let patientB: { id: string };

  beforeAll(async () => {
    clinicA = await createTestClinic();
    clinicB = await createTestClinic();
    const userA = await clinicA.createUser({ role: 'ADMIN' });
    ctxA = { tenantId: clinicA.tenantId, userId: userA.id, role: 'ADMIN' };
    dbA = forTenant(ctxA);

    patientA = await prisma.patient.create({
      data: { tenantId: clinicA.tenantId, fullName: 'Paciente A' },
      select: { id: true },
    });
    patientB = await prisma.patient.create({
      data: { tenantId: clinicB.tenantId, fullName: 'Paciente B' },
      select: { id: true },
    });
  });

  afterAll(async () => {
    await prisma.patient.deleteMany({
      where: { tenantId: { in: [clinicA.tenantId, clinicB.tenantId] } },
    });
    await clinicA.cleanup();
    await clinicB.cleanup();
  });

  it('findMany solo devuelve filas del propio tenant', async () => {
    const patients = await dbA.patient.findMany({ select: { id: true } });
    const ids = patients.map((p) => p.id);
    expect(ids).toContain(patientA.id);
    expect(ids).not.toContain(patientB.id);
  });

  it('findFirst por id ajeno devuelve null', async () => {
    const found = await dbA.patient.findFirst({ where: { id: patientB.id } });
    expect(found).toBeNull();
  });

  // Caso load-bearing: en Prisma 5 el WhereUniqueInput acepta el tenantId
  // extra, así que findUnique con el filtro inyectado no explota y no cruza.
  it('findUnique por id ajeno devuelve null (no explota con el tenantId extra)', async () => {
    const found = await dbA.patient.findUnique({ where: { id: patientB.id } });
    expect(found).toBeNull();
  });

  it('count solo cuenta filas del propio tenant', async () => {
    const [scoped, real] = await Promise.all([
      dbA.patient.count(),
      prisma.patient.count({ where: { tenantId: clinicA.tenantId } }),
    ]);
    expect(scoped).toBe(real);
  });

  it('create inyecta el tenantId del contexto (no hace falta pasarlo)', async () => {
    const created = await dbA.patient.create({
      data: { fullName: 'Creado sin tenantId' } as { fullName: string },
      select: { id: true, tenantId: true },
    });
    expect(created.tenantId).toBe(clinicA.tenantId);
    await prisma.patient.delete({ where: { id: created.id } });
  });

  it('update por id ajeno no toca la fila (RecordNotFound)', async () => {
    await expect(
      dbA.patient.update({
        where: { id: patientB.id },
        data: { fullName: 'hackeado' },
      }),
    ).rejects.toThrow();

    const untouched = await prisma.patient.findUnique({
      where: { id: patientB.id },
      select: { fullName: true },
    });
    expect(untouched?.fullName).toBe('Paciente B');
  });

  it('delete por id ajeno no borra la fila (RecordNotFound)', async () => {
    await expect(
      dbA.patient.delete({ where: { id: patientB.id } }),
    ).rejects.toThrow();

    const stillThere = await prisma.patient.findUnique({
      where: { id: patientB.id },
      select: { id: true },
    });
    expect(stillThere).not.toBeNull();
  });
});
