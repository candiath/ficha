import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { patientRepo } from '../src/repositories';
import type { TenantContext } from '../src/repositories/types';
import { createTestClinic, signTestToken, sleep, type TestClinic } from './helpers';

// Regresión del issue #97: SessionUpdateSchema se deriva con .partial() de
// SessionFieldsSchema, y en Zod un .default() del schema base SOBREVIVE al
// .partial(). Mientras sessionType y episodeIds tuvieron default, un PATCH
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
    token = signTestToken(user);
    ctx = { tenantId: clinic.tenantId, userId: user.id, role: user.role };
    patient = await patientRepo.create(ctx, { fullName: 'Paciente PATCH parcial' });
  });

  afterAll(async () => {
    await sleep(300);
    await prisma.auditLog.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.sessionEpisode.deleteMany({ where: { session: { tenantId: clinic.tenantId } } });
    await prisma.session.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.clinicalEpisode.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await clinic.cleanup();
  });

  // Un alta vinculada a un episodio: el caso donde el bug hacía más daño
  // (DISCHARGE es lo que dispara el cierre de episodios, y NOTE queda fuera
  // de los conteos del dashboard).
  async function crearAltaConEpisodio() {
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
        sessionType: 'DISCHARGE',
        sessionDate: new Date().toISOString(),
        episodeIds: [episode.id],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.sessionType).toBe('DISCHARGE');
    expect(res.body.data.episodeIds).toEqual([episode.id]);

    return { sessionId: res.body.data.id as string, episodeId: episode.id };
  }

  it('un PATCH de solo observations conserva sessionType y los episodios', async () => {
    const { sessionId, episodeId } = await crearAltaConEpisodio();

    const res = await request(app)
      .patch(`/api/patients/${patient.id}/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ observations: 'solo edito notas' });

    expect(res.status).toBe(200);
    expect(res.body.data.observations).toBe('solo edito notas');
    // Antes del fix: 'SESSION' y [].
    expect(res.body.data.sessionType).toBe('DISCHARGE');
    expect(res.body.data.episodeIds).toEqual([episodeId]);
  });

  it('un episodeIds vacío explícito sí desvincula todos los episodios', async () => {
    const { sessionId } = await crearAltaConEpisodio();

    const res = await request(app)
      .patch(`/api/patients/${patient.id}/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ episodeIds: [] });

    expect(res.status).toBe(200);
    expect(res.body.data.episodeIds).toEqual([]);
    // El tipo sigue intacto: el PATCH no lo mencionó.
    expect(res.body.data.sessionType).toBe('DISCHARGE');
  });

  it('un PATCH que sí manda sessionType lo cambia', async () => {
    const { sessionId } = await crearAltaConEpisodio();

    const res = await request(app)
      .patch(`/api/patients/${patient.id}/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sessionType: 'NOTE' });

    expect(res.status).toBe(200);
    expect(res.body.data.sessionType).toBe('NOTE');
  });
});
