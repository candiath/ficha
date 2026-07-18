import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, signTestToken, sleep, type TestClinic } from './helpers';

// POST /api/patients/:id/sessions con payment y techniques: todo se crea en
// una sola transacción. Antes el frontend encadenaba 3 requests y un fallo
// intermedio dejaba sesiones sin pago (invisibles en Cobros) o sin técnicas.
describe('creación atómica de sesión con pago y técnicas', () => {
  let clinicA: TestClinic;
  let clinicB: TestClinic;
  let userA: User;
  let tokenA: string;

  let patientA: { id: string };
  let episodeA: { id: string };
  let packageA: { id: string };
  let techniqueA: { id: string };
  let techniqueGlobal: { id: string };
  let techniqueB: { id: string };

  const url = () => `/api/patients/${patientA.id}/sessions`;

  function postSession(body: Record<string, unknown> = {}) {
    return request(app)
      .post(url())
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ sessionDate: new Date().toISOString(), ...body });
  }

  beforeAll(async () => {
    clinicA = await createTestClinic();
    clinicB = await createTestClinic();
    userA = await clinicA.createUser();
    tokenA = signTestToken(userA);

    patientA = await prisma.patient.create({
      data: { tenantId: clinicA.tenantId, fullName: 'Paciente Atómico' },
      select: { id: true },
    });
    episodeA = await prisma.clinicalEpisode.create({
      data: { tenantId: clinicA.tenantId, patientId: patientA.id, mainComplaint: 'Lumbalgia' },
      select: { id: true },
    });
    packageA = await prisma.sessionPackage.create({
      data: {
        tenantId: clinicA.tenantId,
        patientId: patientA.id,
        name: 'Paquete atómico',
        totalSessions: 10,
        pricePerSession: 100,
      },
      select: { id: true },
    });
    techniqueA = await prisma.technique.create({
      data: { tenantId: clinicA.tenantId, name: 'Técnica propia' },
      select: { id: true },
    });
    techniqueGlobal = await prisma.technique.create({
      data: { tenantId: null, isGlobal: true, name: `Global de test ${randomUUID().slice(0, 8)}` },
      select: { id: true },
    });
    techniqueB = await prisma.technique.create({
      data: { tenantId: clinicB.tenantId, name: 'Técnica ajena' },
      select: { id: true },
    });
  });

  afterAll(async () => {
    await sleep(300);
    const tenantIds = [clinicA.tenantId, clinicB.tenantId];
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    // session_techniques no tiene onDelete: Cascade — va antes que sessions.
    await prisma.sessionTechnique.deleteMany({
      where: { session: { tenantId: { in: tenantIds } } },
    });
    await prisma.session.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.sessionPackage.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.clinicalEpisode.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.patient.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.technique.deleteMany({ where: { tenantId: { in: tenantIds } } });
    // La global no matchea por tenantId (es null): se borra por id.
    await prisma.technique.delete({ where: { id: techniqueGlobal.id } });
    await clinicA.cleanup();
    await clinicB.cleanup();
  });

  it('crea sesión + pago + técnicas en un solo request', async () => {
    const res = await postSession({
      episodeIds: [episodeA.id],
      payment: { packageId: packageA.id, baseAmount: 100, discount: 20, notes: 'seña' },
      techniques: [
        { techniqueId: techniqueA.id, variantNotes: 'apertura brazo izq.' },
        { techniqueId: techniqueGlobal.id },
      ],
    });

    expect(res.status).toBe(201);
    const sessionId = res.body.data.id;

    const payment = await prisma.payment.findUnique({
      where: { sessionId },
      select: { patientId: true, packageId: true, finalAmount: true, status: true },
    });
    expect(payment).toMatchObject({
      patientId: patientA.id,
      packageId: packageA.id,
      status: 'PENDING',
    });
    expect(Number(payment?.finalAmount)).toBe(80);

    const techniqueCount = await prisma.sessionTechnique.count({ where: { sessionId } });
    expect(techniqueCount).toBe(2);
  });

  it('si algo falla dentro de la transacción no queda sesión huérfana', async () => {
    const before = await prisma.session.count({ where: { patientId: patientA.id } });

    // bodyRegionId inexistente: pasa la validación (solo se validan técnicas)
    // y revienta por FK adentro de la transacción — el rollback debe
    // llevarse la sesión y el pago.
    const res = await postSession({
      payment: { baseAmount: 100 },
      techniques: [{ techniqueId: techniqueA.id, bodyRegionId: randomUUID() }],
    });

    expect(res.status).toBeGreaterThanOrEqual(500);
    const after = await prisma.session.count({ where: { patientId: patientA.id } });
    expect(after).toBe(before);
  });

  it('rechaza técnicas de otro tenant sin crear la sesión', async () => {
    const before = await prisma.session.count({ where: { patientId: patientA.id } });

    const res = await postSession({
      payment: { baseAmount: 100 },
      techniques: [{ techniqueId: techniqueB.id }],
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Técnica inexistente' });
    expect(await prisma.session.count({ where: { patientId: patientA.id } })).toBe(before);
  });

  it('un alta cierra el episodio en el mismo request', async () => {
    const res = await postSession({
      sessionType: 'DISCHARGE',
      episodeIds: [episodeA.id],
    });

    expect(res.status).toBe(201);

    // El cierre ocurre dentro de la transacción: se puede asertar sin waitFor.
    const episode = await prisma.clinicalEpisode.findUnique({
      where: { id: episodeA.id },
      select: { status: true, closedAt: true },
    });
    expect(episode?.status).toBe('DISCHARGED');
    expect(episode?.closedAt).not.toBeNull();
  });
});
