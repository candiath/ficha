import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { DAY_MS } from '../src/lib/sessionDate';
import { createTestClinic, signTestToken, sleep, type TestClinic } from './helpers';

// GET /api/sessions es la vista de "todas las sesiones" de la clínica: sin un
// paciente en la URL, con el nombre de cada uno y el motivo de cada episodio.
// No tenía ni un test. Lo que importa acá es qué filas entran (solo las del
// tenant, solo las vigentes) y qué trae cada una.
describe('GET /api/sessions: el listado global de la clínica', () => {
  let clinic: TestClinic;
  let clinicB: TestClinic;
  let user: User;
  let token: string;
  let patient: { id: string };
  let episode: { id: string };
  let sessionConEpisodio: string;
  let sessionSinEpisodio: string;
  let sessionBorrada: string;
  let sessionDeB: string;

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    clinic = await createTestClinic();
    clinicB = await createTestClinic();
    user = await clinic.createUser();
    token = signTestToken(user);

    patient = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName: 'Paciente Global' },
      select: { id: true },
    });
    episode = await prisma.clinicalEpisode.create({
      data: { tenantId: clinic.tenantId, patientId: patient.id, mainComplaint: 'Dorsalgia' },
      select: { id: true },
    });

    const crear = async (patientId: string, body: Record<string, unknown> = {}) => {
      const res = await auth(request(app).post(`/api/patients/${patientId}/sessions`)).send({
        sessionDate: new Date().toISOString(),
        ...body,
      });
      expect(res.status).toBe(201);
      return res.body.data.id as string;
    };

    sessionConEpisodio = await crear(patient.id, {
      episodeIds: [episode.id],
      sessionDate: new Date(Date.now() - 2 * DAY_MS).toISOString(),
    });
    sessionSinEpisodio = await crear(patient.id, {
      sessionDate: new Date(Date.now() - 1 * DAY_MS).toISOString(),
    });
    sessionBorrada = await crear(patient.id);
    expect(
      (await auth(request(app).delete(`/api/patients/${patient.id}/sessions/${sessionBorrada}`)))
        .status,
    ).toBe(204);

    // La sesión de la otra clínica se inserta directo: su usuario no hace
    // falta para nada más.
    const userB = await clinicB.createUser();
    const patientB = await prisma.patient.create({
      data: { tenantId: clinicB.tenantId, fullName: 'Paciente de B' },
      select: { id: true },
    });
    sessionDeB = (
      await prisma.session.create({
        data: {
          tenantId: clinicB.tenantId,
          patientId: patientB.id,
          userId: userB.id,
          sessionDate: new Date(),
        },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    await sleep(300);
    const tenantIds = [clinic.tenantId, clinicB.tenantId];
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.session.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.clinicalEpisode.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.patient.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await clinic.cleanup();
    await clinicB.cleanup();
  });

  it('lista las sesiones vigentes de la clínica y ninguna de otra', async () => {
    const res = await auth(request(app).get('/api/sessions'));

    expect(res.status).toBe(200);
    const ids = res.body.data.map((s: { id: string }) => s.id);
    expect(ids).toContain(sessionConEpisodio);
    expect(ids).toContain(sessionSinEpisodio);
    expect(ids).not.toContain(sessionBorrada);
    expect(ids).not.toContain(sessionDeB);
  });

  it('cada sesión trae el paciente y sus episodios con el motivo', async () => {
    const res = await auth(request(app).get('/api/sessions'));
    const porId = new Map(res.body.data.map((s: { id: string }) => [s.id, s]));

    expect(porId.get(sessionConEpisodio)).toMatchObject({
      patientId: patient.id,
      patient: { id: patient.id, fullName: 'Paciente Global' },
      episodes: [{ id: episode.id, mainComplaint: 'Dorsalgia' }],
      episodeIds: [episode.id],
    });
    expect(porId.get(sessionSinEpisodio)).toMatchObject({
      patient: { id: patient.id, fullName: 'Paciente Global' },
      episodes: [],
      episodeIds: [],
    });
  });

  it('viene ordenado de la más reciente a la más vieja', async () => {
    const res = await auth(request(app).get('/api/sessions'));

    const fechas = res.body.data.map((s: { sessionDate: string }) => s.sessionDate);
    expect(fechas).toEqual([...fechas].sort((a, b) => b.localeCompare(a)));
    const ids = res.body.data.map((s: { id: string }) => s.id);
    expect(ids.indexOf(sessionSinEpisodio)).toBeLessThan(ids.indexOf(sessionConEpisodio));
  });

  // Issue #72, cerrado by design: borrar un paciente lo oculta, no reescribe
  // el pasado. Sus sesiones siguen en el historial, con su nombre.
  it('sigue nombrando al paciente aunque se lo haya borrado', async () => {
    const borrado = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName: 'Paciente Que Se Borra' },
      select: { id: true },
    });
    const sesion = await auth(request(app).post(`/api/patients/${borrado.id}/sessions`)).send({
      sessionDate: new Date().toISOString(),
    });
    expect(sesion.status).toBe(201);
    expect((await auth(request(app).delete(`/api/patients/${borrado.id}`))).status).toBe(204);

    const res = await auth(request(app).get('/api/sessions'));
    const fila = res.body.data.find((s: { id: string }) => s.id === sesion.body.data.id);

    expect(fila).toBeDefined();
    expect(fila.patient).toEqual({ id: borrado.id, fullName: 'Paciente Que Se Borra' });
  });

  it('sin token responde 401', async () => {
    const res = await request(app).get('/api/sessions');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'No autenticado' });
  });
});
