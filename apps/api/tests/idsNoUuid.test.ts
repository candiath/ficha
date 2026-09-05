import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, signTestToken, sleep, type TestClinic } from './helpers';

// Varias rutas validaban los ids del body con `z.string().uuid()`. El id de
// una fila es un identificador opaco: la columna es `String @id
// @default(uuid())`, y ese default dice de dónde sale el valor cuando nadie lo
// provee — no promete nada sobre la forma de los ids que existen.
//
// El seed lo deja a la vista: crea `dev-patient-001` y `dev-episode-001` para
// que los datos de desarrollo sean legibles. Agendarle un turno a un paciente
// demo respondía "Datos inválidos", y lo mismo pasaba con las escalas, las
// alertas y los episodios de una sesión.
//
// Estas filas usan ids con esa misma forma a propósito: son el caso que se
// rompía.
describe('ids que no son UUID', () => {
  let clinic: TestClinic;
  let user: User;
  let token: string;
  let patientId: string;
  let episodeId: string;

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
    token = signTestToken(user);

    const sufijo = clinic.slug;
    patientId = `demo-patient-${sufijo}`;
    episodeId = `demo-episode-${sufijo}`;

    await prisma.patient.create({
      data: { id: patientId, tenantId: clinic.tenantId, fullName: 'Paciente Demo' },
    });
    await prisma.clinicalEpisode.create({
      data: {
        id: episodeId,
        tenantId: clinic.tenantId,
        patientId,
        mainComplaint: 'Lumbalgia',
      },
    });
  });

  afterAll(async () => {
    await sleep(400);
    await prisma.appointment.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.clinicalAlert.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.auditLog.deleteMany({ where: { tenantId: clinic.tenantId } });
    // El orden importa: las FKs son RESTRICT, así que cada tabla se borra
    // antes que aquella a la que apunta.
    await prisma.payment.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.sessionPackage.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.session.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.clinicalEpisode.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await clinic.cleanup();
  });

  // El caso reportado: agendar a un paciente demo devolvía 400.
  it('se le puede agendar un turno', async () => {
    const res = await auth(request(app).post('/api/appointments')).send({
      patientId,
      episodeId,
      date: '2026-10-05',
      time: '09:00',
      durationMinutes: 60,
    });

    expect(res.status).toBe(201);
    expect(res.body.data[0].patientId).toBe(patientId);
    expect(res.body.data[0].episodeMainComplaint).toBe('Lumbalgia');
  });

  it('se le puede registrar una sesión contra su episodio', async () => {
    const res = await auth(request(app).post(`/api/patients/${patientId}/sessions`)).send({
      sessionDate: new Date().toISOString(),
      episodeIds: [episodeId],
      observations: 'Sesión sobre un episodio con id legible',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.episodeIds).toEqual([episodeId]);
  });

  it('se le puede crear una alerta', async () => {
    const res = await auth(request(app).post('/api/alerts')).send({
      patientId,
      type: 'CUSTOM',
      message: 'Alerta sobre un paciente con id legible',
    });

    expect(res.status).toBe(201);
  });

  it('se le puede cobrar contra un paquete', async () => {
    const paquete = await auth(request(app).post('/api/packages')).send({
      patientId,
      name: 'Paquete demo',
      totalSessions: 5,
      pricePerSession: 10000,
    });
    expect(paquete.status).toBe(201);

    const sesion = await auth(
      request(app).post(`/api/patients/${patientId}/sessions`),
    ).send({
      sessionDate: new Date().toISOString(),
      payment: { packageId: paquete.body.data.id, baseAmount: 10000 },
    });

    expect(sesion.status).toBe(201);
  });

  // Lo que sí se sigue rechazando: un id vacío no identifica nada.
  it('un id vacío se rechaza igual', async () => {
    const res = await auth(request(app).post('/api/appointments')).send({
      patientId: '',
      date: '2026-10-05',
      time: '09:00',
      durationMinutes: 60,
    });
    expect(res.status).toBe(400);
  });

  // Y un id con forma válida pero inexistente sigue siendo 404, no 400: la
  // diferencia entre "no me entendiste" y "no existe" se mantiene.
  it('un id inexistente sigue dando 404 y no 400', async () => {
    const res = await auth(request(app).post('/api/appointments')).send({
      patientId: 'no-existe-este-paciente',
      date: '2026-10-05',
      time: '09:00',
      durationMinutes: 60,
    });
    expect(res.status).toBe(404);
  });
});
