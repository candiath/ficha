import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, signTestToken, sleep, type TestClinic } from './helpers';

// Aislamiento entre clínicas en las rutas de dominio: los ids que viajan en
// el body (episodeIds, packageId, patientId) no deben poder apuntar a datos
// de otro tenant ni de otro paciente. Estos tests cubren los agujeros
// corregidos: episodios en sesiones, paciente/paquete en pagos y paciente
// en alertas.
describe('aislamiento de tenant en sesiones, pagos y alertas', () => {
  let clinicA: TestClinic;
  let clinicB: TestClinic;
  let userA: User;
  let tokenA: string;

  // Clínica A: dos pacientes (el segundo prueba el cruce dentro del mismo
  // tenant), cada uno con su episodio; un paquete del segundo paciente.
  let patientA: { id: string };
  let patientA2: { id: string };
  let episodeA: { id: string };
  let episodeA2: { id: string };
  let packageA2: { id: string };
  // Clínica B: el "otro tenant".
  let patientB: { id: string };
  let episodeB: { id: string };
  let packageB: { id: string };

  const sessionsUrl = (patientId: string) => `/api/patients/${patientId}/sessions`;

  function createSession(patientId: string, body: Record<string, unknown> = {}) {
    return request(app)
      .post(sessionsUrl(patientId))
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ sessionDate: new Date().toISOString(), ...body });
  }

  beforeAll(async () => {
    clinicA = await createTestClinic();
    clinicB = await createTestClinic();
    userA = await clinicA.createUser();
    tokenA = signTestToken(userA);

    async function createPatientWithEpisode(tenantId: string, fullName: string) {
      const patient = await prisma.patient.create({
        data: { tenantId, fullName },
        select: { id: true },
      });
      const episode = await prisma.clinicalEpisode.create({
        data: { tenantId, patientId: patient.id, mainComplaint: `Motivo de ${fullName}` },
        select: { id: true },
      });
      return { patient, episode };
    }

    ({ patient: patientA, episode: episodeA } = await createPatientWithEpisode(
      clinicA.tenantId,
      'Paciente A',
    ));
    ({ patient: patientA2, episode: episodeA2 } = await createPatientWithEpisode(
      clinicA.tenantId,
      'Paciente A2',
    ));
    ({ patient: patientB, episode: episodeB } = await createPatientWithEpisode(
      clinicB.tenantId,
      'Paciente B',
    ));

    packageA2 = await prisma.sessionPackage.create({
      data: {
        tenantId: clinicA.tenantId,
        patientId: patientA2.id,
        name: 'Paquete A2',
        totalSessions: 10,
        pricePerSession: 100,
      },
      select: { id: true },
    });
    packageB = await prisma.sessionPackage.create({
      data: {
        tenantId: clinicB.tenantId,
        patientId: patientB.id,
        name: 'Paquete B',
        totalSessions: 10,
        pricePerSession: 100,
      },
      select: { id: true },
    });
  });

  afterAll(async () => {
    // Los audit logs se insertan fire-and-forget: darles un instante a
    // aterrizar antes de borrar (mismo criterio que loginEvents en helpers).
    await sleep(300);
    const tenantIds = [clinicA.tenantId, clinicB.tenantId];
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.clinicalAlert.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    // Borrar sesiones arrastra session_episodes por el onDelete: Cascade.
    await prisma.session.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.sessionPackage.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.clinicalEpisode.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.patient.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await clinicA.cleanup();
    await clinicB.cleanup();
  });

  it('rechaza episodeIds de otro tenant al crear una sesión', async () => {
    const res = await createSession(patientA.id, { episodeIds: [episodeB.id] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Episodio inexistente o de otro paciente' });
  });

  it('rechaza episodeIds de otro paciente del mismo tenant', async () => {
    const res = await createSession(patientA.id, { episodeIds: [episodeA2.id] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Episodio inexistente o de otro paciente' });
  });

  it('acepta y vincula episodios del propio paciente', async () => {
    const res = await createSession(patientA.id, { episodeIds: [episodeA.id] });

    expect(res.status).toBe(201);
    expect(res.body.data.episodeIds).toEqual([episodeA.id]);
  });

  it('rechaza episodeIds ajenos también en el PATCH', async () => {
    const created = await createSession(patientA.id);
    expect(created.status).toBe(201);

    const res = await request(app)
      .patch(`${sessionsUrl(patientA.id)}/${created.body.data.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ episodeIds: [episodeB.id] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Episodio inexistente o de otro paciente' });
  });

  it('ignora el patientId del body al crear un pago: usa el de la sesión', async () => {
    const session = await createSession(patientA.id);
    expect(session.status).toBe(201);

    // patientId apunta a un paciente de otra clínica: antes del fix el pago
    // se creaba con ese id y el GET exponía su fullName.
    const res = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ sessionId: session.body.data.id, patientId: patientB.id, baseAmount: 100 });

    expect(res.status).toBe(201);
    expect(res.body.data.patientId).toBe(patientA.id);
  });

  it('rechaza un packageId de otro tenant al crear un pago', async () => {
    const session = await createSession(patientA.id);
    expect(session.status).toBe(201);

    const res = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ sessionId: session.body.data.id, packageId: packageB.id, baseAmount: 100 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Paquete no encontrado' });
  });

  it('rechaza un patientId de otro tenant al crear una alerta', async () => {
    // Antes del fix la alerta se creaba con el FK ajeno y el GET /api/alerts
    // devolvía el fullName del paciente de la otra clínica vía el join.
    const res = await request(app)
      .post('/api/alerts')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId: patientB.id, type: 'CUSTOM', message: 'Cruce de tenant' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Paciente no encontrado' });

    const leaked = await prisma.clinicalAlert.findFirst({
      where: { patientId: patientB.id },
      select: { id: true },
    });
    expect(leaked).toBeNull();
  });

  it('crea la alerta para un paciente del propio tenant', async () => {
    const res = await request(app)
      .post('/api/alerts')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ patientId: patientA.id, type: 'CUSTOM', message: 'Control pendiente' });

    expect(res.status).toBe(201);
    expect(res.body.data.patientName).toBe('Paciente A');
  });

  it('rechaza en el PATCH un packageId de otro paciente del mismo tenant', async () => {
    const session = await createSession(patientA.id);
    expect(session.status).toBe(201);

    const payment = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ sessionId: session.body.data.id, baseAmount: 100 });
    expect(payment.status).toBe(201);

    const res = await request(app)
      .patch(`/api/payments/${payment.body.data.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ packageId: packageA2.id });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Paquete no encontrado' });
  });
});
