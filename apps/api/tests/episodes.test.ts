import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, signTestToken, sleep, type TestClinic } from './helpers';

// El episodio es la unidad de tratamiento: todo lo clínico cuelga de él y su
// estado decide qué mira el motor de alertas (listStale solo recorre los
// ACTIVE). No tenía tests.
//
// Se cubre el alta, el listado y el ciclo cerrar/reabrir tal como lo ejerce la
// web, que manda estado y fecha de cierre juntos: cerrar es {status, closedAt},
// reabrir es {status: 'ACTIVE', closedAt: null}.
//
// Y se cubre la coherencia entre las dos columnas, que hasta este archivo
// sostenía sólo la web: no se cierra sin fecha, no se pone fecha sin cerrar, no
// se cierra antes de abrir, y las dos fechas tienen los mismos topes duros que
// la de sesión. Lo que sigue siendo libre es a qué estado se puede ir desde
// cuál: reabrir un episodio dado de alta es legítimo.
describe('episodios: alta, listado y transiciones de estado', () => {
  let clinic: TestClinic;
  let user: User;
  let token: string;
  let patient: { id: string };

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const url = (patientId = patient.id) => `/api/patients/${patientId}/episodes`;

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser({ role: 'ADMIN' });
    token = signTestToken(user);
    patient = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName: 'Paciente Episodios' },
      select: { id: true },
    });
  });

  afterAll(async () => {
    await sleep(300);
    await prisma.auditLog.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.clinicalEpisode.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await clinic.cleanup();
  });

  async function crearEpisodio(body: Record<string, unknown> = {}) {
    const res = await auth(request(app).post(url())).send({
      mainComplaint: 'Lumbalgia',
      ...body,
    });
    expect(res.status).toBe(201);
    return res.body.data as { id: string; [k: string]: unknown };
  }

  // ── POST ──────────────────────────────────────────────────────────────────

  it('POST abre el episodio en ACTIVE, sin cerrar, y devuelve el DTO', async () => {
    const res = await auth(request(app).post(url())).send({ mainComplaint: 'Cervicalgia' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      patientId: patient.id,
      status: 'ACTIVE',
      mainComplaint: 'Cervicalgia',
      closedAt: null,
    });
    expect(typeof res.body.data.openedAt).toBe('string');
    expect(res.body.data).not.toHaveProperty('tenantId');

    // El tenant sale del token, no del body.
    await expect(
      prisma.clinicalEpisode.findUnique({
        where: { id: res.body.data.id },
        select: { tenantId: true },
      }),
    ).resolves.toEqual({ tenantId: clinic.tenantId });
  });

  it('POST acepta openedAt explícito, para cargar historia clínica vieja', async () => {
    const episode = await crearEpisodio({ openedAt: '2024-03-15T10:00:00.000Z' });
    expect(episode.openedAt).toBe('2024-03-15T10:00:00.000Z');
  });

  it('POST sin mainComplaint abre igual: el motivo se puede cargar después', async () => {
    const episode = await crearEpisodio({ mainComplaint: null });
    expect(episode.mainComplaint).toBeNull();
    expect(episode.status).toBe('ACTIVE');
  });

  it('POST con openedAt que no es una fecha ISO responde 400', async () => {
    const res = await auth(request(app).post(url())).send({ openedAt: '15/03/2024' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Datos inválidos');
  });

  // ── GET ───────────────────────────────────────────────────────────────────

  it('GET lista los episodios del paciente, del más reciente al más viejo', async () => {
    const viejo = await crearEpisodio({ openedAt: '2023-01-10T10:00:00.000Z' });
    const nuevo = await crearEpisodio({ openedAt: '2025-06-20T10:00:00.000Z' });

    const res = await auth(request(app).get(url()));
    expect(res.status).toBe(200);

    const ids = (res.body.data as { id: string }[]).map((e) => e.id);
    expect(ids).toContain(viejo.id);
    expect(ids).toContain(nuevo.id);
    expect(ids.indexOf(nuevo.id)).toBeLessThan(ids.indexOf(viejo.id));
  });

  it('GET de un paciente de otra clínica responde 404, no una lista vacía', async () => {
    const otra = await createTestClinic();
    try {
      const ajeno = await prisma.patient.create({
        data: { tenantId: otra.tenantId, fullName: 'Paciente Ajeno' },
        select: { id: true },
      });
      await prisma.clinicalEpisode.create({
        data: { tenantId: otra.tenantId, patientId: ajeno.id, mainComplaint: 'Secreto' },
      });

      const res = await auth(request(app).get(url(ajeno.id)));
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Paciente no encontrado');

      await prisma.clinicalEpisode.deleteMany({ where: { tenantId: otra.tenantId } });
      await prisma.patient.deleteMany({ where: { tenantId: otra.tenantId } });
    } finally {
      await otra.cleanup();
    }
  });

  it('un paciente borrado no lista ni abre episodios nuevos', async () => {
    const borrado = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName: 'Paciente Borrado', deletedAt: new Date() },
      select: { id: true },
    });

    await expect(auth(request(app).get(url(borrado.id)))).resolves.toMatchObject({
      status: 404,
    });
    const res = await auth(request(app).post(url(borrado.id))).send({ mainComplaint: 'X' });
    expect(res.status).toBe(404);
  });

  // ── PATCH: las transiciones ───────────────────────────────────────────────

  it('da de alta el episodio: status DISCHARGED y la fecha de cierre que manda el cliente', async () => {
    const episode = await crearEpisodio({ openedAt: '2025-06-01T10:00:00.000Z' });
    const closedAt = '2025-08-01T12:00:00.000Z';

    const res = await auth(request(app).patch(`${url()}/${episode.id}`)).send({
      status: 'DISCHARGED',
      closedAt,
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: episode.id, status: 'DISCHARGED', closedAt });
  });

  it('abandona el episodio, y reabrirlo limpia la fecha de cierre con null', async () => {
    const episode = await crearEpisodio({ openedAt: '2025-06-01T10:00:00.000Z' });

    const abandonado = await auth(request(app).patch(`${url()}/${episode.id}`)).send({
      status: 'ABANDONED',
      closedAt: '2025-09-01T12:00:00.000Z',
    });
    expect(abandonado.body.data).toMatchObject({ status: 'ABANDONED' });
    expect(abandonado.body.data.closedAt).not.toBeNull();

    const reabierto = await auth(request(app).patch(`${url()}/${episode.id}`)).send({
      status: 'ACTIVE',
      closedAt: null,
    });
    expect(reabierto.status).toBe(200);
    expect(reabierto.body.data).toMatchObject({ status: 'ACTIVE', closedAt: null });
  });

  it('reabrir sin mandar la fecha igual la borra: no queda ACTIVE con cierre', async () => {
    const episode = await crearEpisodio({ openedAt: '2025-06-01T10:00:00.000Z' });
    await auth(request(app).patch(`${url()}/${episode.id}`)).send({
      status: 'DISCHARGED',
      closedAt: '2025-08-01T12:00:00.000Z',
    });

    const res = await auth(request(app).patch(`${url()}/${episode.id}`)).send({
      status: 'ACTIVE',
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'ACTIVE', closedAt: null });
  });

  // ── PATCH: la coherencia entre el estado y la fecha ───────────────────────

  it('cerrar un episodio sin fecha de cierre es un 400', async () => {
    const episode = await crearEpisodio();

    for (const status of ['DISCHARGED', 'ABANDONED']) {
      const res = await auth(request(app).patch(`${url()}/${episode.id}`)).send({ status });
      expect(res.status).toBe(400);
      expect(res.body.details).toHaveProperty('closedAt');
    }
  });

  it('una fecha de cierre sin el estado que cierra es un 400', async () => {
    const episode = await crearEpisodio();

    const sola = await auth(request(app).patch(`${url()}/${episode.id}`)).send({
      closedAt: new Date().toISOString(),
    });
    const conActivo = await auth(request(app).patch(`${url()}/${episode.id}`)).send({
      status: 'ACTIVE',
      closedAt: new Date().toISOString(),
    });

    expect(sola.status).toBe(400);
    expect(conActivo.status).toBe(400);
    expect(conActivo.body.details).toHaveProperty('status');
  });

  it('borrar la fecha de cierre sin reabrir es un 400', async () => {
    // Dejaría un episodio cerrado sin cuándo, que es la mitad de lo que estas
    // reglas existen para impedir.
    const episode = await crearEpisodio({ openedAt: '2025-06-01T10:00:00.000Z' });
    await auth(request(app).patch(`${url()}/${episode.id}`)).send({
      status: 'DISCHARGED',
      closedAt: '2025-08-01T12:00:00.000Z',
    });

    const res = await auth(request(app).patch(`${url()}/${episode.id}`)).send({ closedAt: null });

    expect(res.status).toBe(400);
    expect(res.body.details).toHaveProperty('status');
  });

  it('un episodio no puede cerrarse antes de abrirse', async () => {
    // La comparación es contra el openedAt guardado, no contra uno que venga
    // en el body: va en el where del update, no en el schema.
    const episode = await crearEpisodio({ openedAt: '2025-06-01T10:00:00.000Z' });

    const res = await auth(request(app).patch(`${url()}/${episode.id}`)).send({
      status: 'DISCHARGED',
      closedAt: '2025-05-31T23:59:59.000Z',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      'La fecha de cierre no puede ser anterior a la apertura del episodio',
    );
    // Y no escribió nada: el estado sigue siendo el de antes.
    const despues = await auth(request(app).get(url()));
    expect(
      (despues.body.data as { id: string; status: string }[]).find((e) => e.id === episode.id),
    ).toMatchObject({ status: 'ACTIVE', closedAt: null });
  });

  it('cerrar en el mismo instante en que se abrió sí se permite', async () => {
    // El caso real: una consulta única que se abre y se cierra el mismo día.
    const openedAt = '2025-06-01T10:00:00.000Z';
    const episode = await crearEpisodio({ openedAt });

    const res = await auth(request(app).patch(`${url()}/${episode.id}`)).send({
      status: 'DISCHARGED',
      closedAt: openedAt,
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'DISCHARGED', closedAt: openedAt });
  });

  it('las dos fechas tienen los mismos topes duros que las sesiones', async () => {
    const futuro = await auth(request(app).post(url())).send({
      openedAt: '2099-01-01T10:00:00.000Z',
    });
    expect(futuro.status).toBe(400);
    expect(futuro.body.details).toHaveProperty('openedAt');

    const prehistorico = await auth(request(app).post(url())).send({
      openedAt: '1999-12-31T10:00:00.000Z',
    });
    expect(prehistorico.status).toBe(400);

    const episode = await crearEpisodio({ openedAt: '2025-06-01T10:00:00.000Z' });
    const cierreFuturo = await auth(request(app).patch(`${url()}/${episode.id}`)).send({
      status: 'DISCHARGED',
      closedAt: '2099-01-01T10:00:00.000Z',
    });
    expect(cierreFuturo.status).toBe(400);
    expect(cierreFuturo.body.details).toHaveProperty('closedAt');
  });

  it('PATCH también corrige el motivo de consulta', async () => {
    const episode = await crearEpisodio({ mainComplaint: 'Lumbalgia' });

    const res = await auth(request(app).patch(`${url()}/${episode.id}`)).send({
      mainComplaint: 'Lumbociatalgia derecha',
    });

    expect(res.body.data).toMatchObject({
      mainComplaint: 'Lumbociatalgia derecha',
      status: 'ACTIVE',
    });
  });

  it('rechaza un estado que no existe en el modelo', async () => {
    const episode = await crearEpisodio();

    // DISCONTINUED es el estado que propone #23: hoy el enum tiene tres.
    const res = await auth(request(app).patch(`${url()}/${episode.id}`)).send({
      status: 'DISCONTINUED',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Datos inválidos');
    expect(res.body.details).toHaveProperty('status');
  });

  it('un episodio de otro paciente de la misma clínica es un 404, no un update', async () => {
    const otroPaciente = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName: 'Otro Paciente' },
      select: { id: true },
    });
    const ajeno = await prisma.clinicalEpisode.create({
      data: { tenantId: clinic.tenantId, patientId: otroPaciente.id, status: 'ACTIVE' },
      select: { id: true },
    });

    const res = await auth(request(app).patch(`${url()}/${ajeno.id}`)).send({
      status: 'ABANDONED',
      closedAt: new Date().toISOString(),
    });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Episodio no encontrado');
    // Y el episodio ajeno quedó intacto.
    await expect(
      prisma.clinicalEpisode.findUnique({ where: { id: ajeno.id }, select: { status: true } }),
    ).resolves.toEqual({ status: 'ACTIVE' });
  });

  it('un episodio inexistente responde 404', async () => {
    const res = await auth(request(app).patch(`${url()}/${randomUUID()}`)).send({
      status: 'DISCHARGED',
      closedAt: new Date().toISOString(),
    });
    expect(res.status).toBe(404);
  });

  // ── Autenticación ─────────────────────────────────────────────────────────

  it('sin token, ninguna de las tres rutas responde', async () => {
    const episode = await crearEpisodio();

    for (const res of await Promise.all([
      request(app).get(url()),
      request(app).post(url()).send({ mainComplaint: 'X' }),
      request(app).patch(`${url()}/${episode.id}`).send({ status: 'DISCHARGED' }),
    ])) {
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('No autenticado');
    }
  });
});
