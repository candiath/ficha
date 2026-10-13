import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { patientRepo } from '../src/repositories';
import type { TenantContext } from '../src/repositories/types';
import { deleteAuditRows, createTestContext, createTestClinic, createTestToken, sleep, type TestClinic, patientAudit } from './helpers';

// Regresión del issue #97: SessionUpdateSchema se deriva con .partial() de
// SessionFieldsSchema, y en Zod un .default() del schema base SOBREVIVE al
// .partial(). Mientras sessionType y los episodios tuvieron default, un PATCH
// que los omitía reseteaba el tipo a SESSION y desvinculaba todos los
// episodios ([] es truthy y entraba en la rama del deleteMany).
//
// Los defaults viven ahora solo en SessionCreateSchema. Estos tests fijan las
// dos mitades de la semántica PATCH: campo ausente = no tocar, campo presente
// = aplicar (incluido el arreglo vacío).
describe('PATCH de sesiones: campos ausentes no pisan datos', () => {
  let clinic: TestClinic;
  let user: User;
  let token: string;
  let ctx: TenantContext;
  let patient: { id: string };

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
    token = await createTestToken(user);
    ctx = await createTestContext(clinic.tenantId, user);
    patient = await patientRepo.create(ctx, { fullName: 'Paciente PATCH parcial' }, patientAudit('CREATED'));
  });

  afterAll(async () => {
    await sleep(300);
    await deleteAuditRows([clinic.tenantId]);
    // A session's blocks (#238) restrict its deletion: they go first.
    await prisma.sessionEpisode.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.session.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.clinicalEpisode.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await clinic.cleanup();
  });

  // Un alta vinculada a un episodio: el caso donde el bug hacía más daño
  // (DISCHARGE es lo que dispara el cierre de episodios, y NOTE queda fuera
  // de los conteos del dashboard).
  async function crearConEpisodio(sessionType: 'DISCHARGE' | 'NOTE' = 'DISCHARGE') {
    const episode = await prisma.clinicalEpisode.create({
      data: {
        tenantId: clinic.tenantId,
        patientId: patient.id,
        mainComplaint: 'Motivo de prueba',
      },
      select: { id: true },
    });

    const res = await request(app)
      .post(`/api/patients/${patient.id}/sessions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        sessionType,
        sessionDate: new Date().toISOString(),
        episodes: [{ episodeId: episode.id }],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.sessionType).toBe(sessionType);
    expect(res.body.data.episodes.map((b: { episodeId: string }) => b.episodeId)).toEqual([episode.id]);

    return { sessionId: res.body.data.id as string, episodeId: episode.id };
  }

  it('un PATCH de solo observations conserva sessionType y los episodios', async () => {
    const { sessionId, episodeId } = await crearConEpisodio();

    const res = await request(app)
      .patch(`/api/patients/${patient.id}/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ observations: 'solo edito notas' });

    expect(res.status).toBe(200);
    expect(res.body.data.observations).toBe('solo edito notas');
    // Antes del fix: 'SESSION' y [].
    expect(res.body.data.sessionType).toBe('DISCHARGE');
    expect(res.body.data.episodes.map((b: { episodeId: string }) => b.episodeId)).toEqual([episodeId]);
  });

  // Solo una nota puede quedar sin episodios (#238).
  it('una lista de episodios vacía explícita sí desvincula todos los episodios', async () => {
    const { sessionId } = await crearConEpisodio('NOTE');

    const res = await request(app)
      .patch(`/api/patients/${patient.id}/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ episodes: [] });

    expect(res.status).toBe(200);
    expect(res.body.data.episodes).toEqual([]);
    // El tipo sigue intacto: el PATCH no lo mencionó.
    expect(res.body.data.sessionType).toBe('NOTE');
  });

  it('un PATCH que sí manda sessionType lo cambia', async () => {
    const { sessionId } = await crearConEpisodio();

    const res = await request(app)
      .patch(`/api/patients/${patient.id}/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sessionType: 'NOTE' });

    expect(res.status).toBe(200);
    expect(res.body.data.sessionType).toBe('NOTE');
  });
});
