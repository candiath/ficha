import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { patientRepo } from '../src/repositories';
import type { TenantContext } from '../src/repositories/types';
import { createTestClinic, signTestToken, sleep, type TestClinic } from './helpers';

// El pivote sesión↔episodio es M:N en la base, pero la API acepta un episodio
// como máximo: una sesión aborda un único motivo de consulta.
//
// El límite no es cosmético. El formulario web lee la sesión que va a editar
// con `session.episodeIds[0]` y devuelve ese único id en el PATCH, así que una
// sesión con dos episodios perdía el segundo sin aviso apenas alguien la
// abriera y guardara. Cerrando la escritura en la API, ese caso no puede
// existir; estos tests son los que impiden que el límite se caiga sin querer.
describe('Una sesión aborda un único episodio', () => {
  let clinic: TestClinic;
  let user: User;
  let token: string;
  let ctx: TenantContext;
  let patient: { id: string };
  let episodeA: string;
  let episodeB: string;

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
    token = signTestToken(user);
    ctx = { tenantId: clinic.tenantId, userId: user.id, role: user.role };
    patient = await patientRepo.create(ctx, { fullName: 'Paciente un episodio' });

    const crearEpisodio = async (mainComplaint: string) => {
      const ep = await prisma.clinicalEpisode.create({
        data: { tenantId: clinic.tenantId, patientId: patient.id, mainComplaint },
        select: { id: true },
      });
      return ep.id;
    };

    episodeA = await crearEpisodio('Cervicalgia');
    episodeB = await crearEpisodio('Lumbalgia');
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

  function crearSesion(episodeIds: string[]) {
    return request(app)
      .post(`/api/patients/${patient.id}/sessions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        sessionType: 'SESSION',
        sessionDate: new Date().toISOString(),
        episodeIds,
      });
  }

  it('rechaza el alta de una sesión con dos episodios', async () => {
    const res = await crearSesion([episodeA, episodeB]);

    expect(res.status).toBe(400);
    expect(res.body.details.episodeIds).toContain('Una sesión aborda un único motivo de consulta');
  });

  it('no deja la sesión a medio crear cuando rechaza', async () => {
    const antes = await prisma.session.count({ where: { tenantId: clinic.tenantId } });
    await crearSesion([episodeA, episodeB]);
    const despues = await prisma.session.count({ where: { tenantId: clinic.tenantId } });

    expect(despues).toBe(antes);
  });

  it('rechaza el PATCH que agrega un segundo episodio', async () => {
    const creada = await crearSesion([episodeA]);
    expect(creada.status).toBe(201);

    const res = await request(app)
      .patch(`/api/patients/${patient.id}/sessions/${creada.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ episodeIds: [episodeA, episodeB] });

    expect(res.status).toBe(400);

    // El vínculo original quedó intacto: el rechazo no tocó nada.
    const sinCambios = await request(app)
      .get(`/api/patients/${patient.id}/sessions/${creada.body.data.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(sinCambios.body.data.episodeIds).toEqual([episodeA]);
  });

  // Las dos formas válidas siguen andando: el límite es un techo, no un piso.
  it('acepta un episodio', async () => {
    const res = await crearSesion([episodeA]);

    expect(res.status).toBe(201);
    expect(res.body.data.episodeIds).toEqual([episodeA]);
  });

  it('acepta una sesión sin episodio', async () => {
    const res = await crearSesion([]);

    expect(res.status).toBe(201);
    expect(res.body.data.episodeIds).toEqual([]);
  });
});
