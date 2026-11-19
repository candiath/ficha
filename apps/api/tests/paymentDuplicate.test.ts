import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createEncounterFixture, deleteAuditRows, createTestClinic, createTestToken, sleep, type TestClinic } from './helpers';
import { fixture } from './fixtures';

// POST /api/payments impone un pago por sesión (unique sobre encounterId).
// Las dos capas de defensa viven en paymentRepo.create: un pre-chequeo
// (findUnique) que atrapa el caso secuencial, y el catch de P2002 sobre el
// create que atrapa la carrera real (dos requests que pasan el pre-chequeo
// antes de que ninguno confirme el INSERT). Ambas salen como reason
// 'duplicate' y la ruta responde el mismo 409.
describe('pago duplicado por sesión', () => {
  let clinicA: TestClinic;
  let userA: User;
  let tokenA: string;
  let patientA: { id: string };
  let encounterA: { id: string };

  function postPayment(encounterId: string, body: Record<string, unknown> = {}) {
    return request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ encounterId, baseAmountCents: 100, ...body });
  }

  async function createEncounter() {
    return createEncounterFixture({
      tenantId: clinicA.tenantId,
      patientId: patientA.id,
      userId: userA.id,
      encounterDate: new Date(),
    });
  }

  beforeAll(async () => {
    clinicA = await createTestClinic();
    userA = await clinicA.createUser();
    tokenA = await createTestToken(userA);

    patientA = await fixture.patient.create({
      data: { tenantId: clinicA.tenantId, firstName: 'Paciente Pago', lastName: 'Dup' },
      select: { id: true },
    });
    encounterA = await createEncounter();
  });

  afterAll(async () => {
    await sleep(300);
    await deleteAuditRows([clinicA.tenantId]);
    await prisma.payment.deleteMany({ where: { tenantId: clinicA.tenantId } });
    // An encounter's blocks (#238) restrict its deletion: they go first.
    await prisma.encounterBlock.deleteMany({ where: { tenantId: clinicA.tenantId } });
    await prisma.encounter.deleteMany({ where: { tenantId: clinicA.tenantId } });
    await prisma.patient.deleteMany({ where: { tenantId: clinicA.tenantId } });
    await clinicA.cleanup();
  });

  it('crea el primer pago de la sesión', async () => {
    const res = await postPayment(encounterA.id);
    expect(res.status).toBe(201);
  });

  // Caso secuencial: lo atrapa el pre-chequeo, no el catch de P2002.
  it('rechaza con 409 un segundo pago secuencial para la misma sesión', async () => {
    const res = await postPayment(encounterA.id);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Ya existe un pago para esta sesión' });

    const count = await prisma.payment.count({ where: { encounterId: encounterA.id } });
    expect(count).toBe(1);
  });

  // Caso concurrente (el fix de A7): dos requests a la vez sobre una sesión
  // sin pago. No es determinístico cuál gana ni cuál 409 se dispara, así que
  // se asertan los invariantes: exactamente un 201, un 409, y un solo pago.
  it('bajo dos requests concurrentes solo uno crea el pago', async () => {
    const encounter = await createEncounter();

    // Nota: cuando la carrera se resuelve por el catch de P2002 (y no por el
    // pre-chequeo), Prisma loguea "prisma:error ... Unique constraint failed
    // on encounter_id". Ese log es ESPERADO: es la evidencia de que el INSERT
    // duplicado se rechazó y el catch lo tradujo a 409. No es un fallo.

    const [r1, r2] = await Promise.all([
      postPayment(encounter.id),
      postPayment(encounter.id),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const count = await prisma.payment.count({ where: { encounterId: encounter.id } });
    expect(count).toBe(1);
  });
});
