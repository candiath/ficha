import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, signTestToken, sleep, type TestClinic } from './helpers';

// POST /api/patients/:id/sessions con payment: sesión, cobro y cierre de
// episodios se crean en una sola transacción. Antes el frontend encadenaba
// varios requests y un fallo intermedio dejaba sesiones sin pago (invisibles
// en Cobros).
describe('creación atómica de sesión con pago', () => {
  let clinicA: TestClinic;
  let userA: User;
  let tokenA: string;

  let patientA: { id: string };
  let episodeA: { id: string };
  let packageA: { id: string };

  const url = () => `/api/patients/${patientA.id}/sessions`;

  function postSession(body: Record<string, unknown> = {}) {
    return request(app)
      .post(url())
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ sessionDate: new Date().toISOString(), ...body });
  }

  beforeAll(async () => {
    clinicA = await createTestClinic();
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
  });

  afterAll(async () => {
    await sleep(300);
    const tenantIds = [clinicA.tenantId];
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.session.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.sessionPackage.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.clinicalEpisode.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.patient.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await clinicA.cleanup();
  });

  it('crea sesión + pago en un solo request', async () => {
    const res = await postSession({
      episodeIds: [episodeA.id],
      payment: { packageId: packageA.id, baseAmount: 100, discount: 20, notes: 'seña' },
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
  });

  it('si algo falla dentro de la transacción no queda sesión huérfana', async () => {
    const before = await prisma.session.count({ where: { patientId: patientA.id } });

    // Monto fuera del Decimal(10,2) de payments: pasa la validación de la ruta
    // (solo exige nonnegative) y revienta al insertar el pago, ya con la sesión
    // creada — el rollback debe llevarse las dos filas.
    const res = await postSession({ payment: { baseAmount: 99_999_999_999 } });

    expect(res.status).toBeGreaterThanOrEqual(500);
    const after = await prisma.session.count({ where: { patientId: patientA.id } });
    expect(after).toBe(before);
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
