import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { deleteAuditRows, createTestClinic, createTestToken, sleep, type TestClinic } from './helpers';
import { fixture } from './fixtures';

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
    token = await createTestToken(user);
    patient = await fixture.patient.create({
      data: { tenantId: clinic.tenantId, firstName: 'Paciente', lastName: 'Episodios' },
      select: { id: true },
    });
  });

  afterAll(async () => {
    await sleep(300);
    await deleteAuditRows([clinic.tenantId]);
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
      const ajeno = await fixture.patient.create({
        data: { tenantId: otra.tenantId, firstName: 'Paciente', lastName: 'Ajeno' },
        select: { id: true },
      });
      await fixture.clinicalEpisode.create({
        data: { tenantId: otra.tenantId, patientId: ajeno.id, mainComplaint: 'Secreto' },
      });

      const res = await auth(request(app).get(url(ajeno.id)));
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Paciente no encontrado');

      await deleteAuditRows([otra.tenantId]);
      await prisma.clinicalEpisode.deleteMany({ where: { tenantId: otra.tenantId } });
      await prisma.patient.deleteMany({ where: { tenantId: otra.tenantId } });
    } finally {
      await otra.cleanup();
    }
  });

  it('un paciente borrado no lista ni abre episodios nuevos', async () => {
    const borrado = await fixture.patient.create({
      data: { tenantId: clinic.tenantId, firstName: 'Paciente', lastName: 'Borrado', deletedAt: new Date() },
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

  it('a closing from a clock running behind is refused as sent, with what the client needs to fix it', async () => {
    // Opened just now, closed by a device ten minutes behind: its "now" is
    // before the opening. The API neither stores it nor moves it.
    const episode = await crearEpisodio();
    const before = Date.now();

    const res = await auth(request(app).patch(`${url()}/${episode.id}`)).send({
      status: 'ABANDONED',
      closedAt: new Date(before - 10 * 60 * 1000).toISOString(),
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'closed_before_opened', openedAt: episode.openedAt });
    const serverTime = new Date(res.body.serverTime as string).getTime();
    expect(serverTime).toBeGreaterThanOrEqual(before);
    expect(serverTime).toBeLessThanOrEqual(Date.now());

    const despues = await auth(request(app).get(url()));
    expect(
      (despues.body.data as { id: string; status: string }[]).find((e) => e.id === episode.id),
    ).toMatchObject({ status: 'ACTIVE', closedAt: null });
  });

  it('an episode opens by the API clock, the one a close right after it reads', async () => {
    // Not the column's default: Prisma's engine evaluates it, and it can be a
    // millisecond ahead of the API. Moving the API's clock tells them apart.
    const apiNow = new Date(Date.now() - 60 * 60 * 1000);
    vi.useFakeTimers({ toFake: ['Date'], now: apiNow });
    try {
      const episode = await crearEpisodio();

      expect(episode.openedAt).toBe(apiNow.toISOString());

      const res = await auth(request(app).patch(`${url()}/${episode.id}`)).send({
        status: 'ABANDONED',
        closedAt: apiNow.toISOString(),
      });
      expect(res.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it('every response carries the API clock, readable by the web across origins', async () => {
    const before = Date.now();

    const res = await auth(request(app).get(url())).set('Origin', 'http://localhost:5173');

    const serverTime = new Date(res.headers['x-server-time']).getTime();
    expect(serverTime).toBeGreaterThanOrEqual(before);
    expect(serverTime).toBeLessThanOrEqual(Date.now());
    expect(res.headers['access-control-expose-headers']).toContain('X-Server-Time');
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
      reason: 'DATA_ENTRY_ERROR',
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
    const otroPaciente = await fixture.patient.create({
      data: { tenantId: clinic.tenantId, firstName: 'Otro', lastName: 'Paciente' },
      select: { id: true },
    });
    const ajeno = await fixture.clinicalEpisode.create({
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

  // ── Audit (SPEC-clinical-revisions.md §4) ─────────────────────────────────
  //
  // A change of status is a fact with its own action and no reason; anything
  // else is a correction, which names the fields it changed. Which one a
  // request is, is decided against the stored row.

  const rowsOf = (entityId: string) =>
    prisma.auditLog.findMany({
      where: { tenantId: clinic.tenantId, entityId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { action: true, entity: true, params: true },
    });
  const patchEpisode = (id: string, body: Record<string, unknown>) =>
    auth(request(app).patch(`${url()}/${id}`)).send(body);

  it('opening an episode records one row', async () => {
    const episode = await crearEpisodio();

    const rows = await prisma.auditLog.findMany({ where: { tenantId: clinic.tenantId, entityId: episode.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'EPISODE_OPENED',
      entity: 'EPISODE',
      patientId: patient.id,
      params: {},
      actorType: 'USER',
      userId: user.id,
    });
  });

  it('closing and reopening are actions of their own, with the status they closed with', async () => {
    const discharged = await crearEpisodio({ openedAt: '2025-06-01T10:00:00.000Z' });
    const abandoned = await crearEpisodio({ openedAt: '2025-06-01T10:00:00.000Z' });

    await patchEpisode(discharged.id, { status: 'DISCHARGED', closedAt: '2025-08-01T12:00:00.000Z' });
    await patchEpisode(abandoned.id, { status: 'ABANDONED', closedAt: '2025-09-01T12:00:00.000Z' });
    expect((await patchEpisode(abandoned.id, { status: 'ACTIVE', closedAt: null })).status).toBe(200);

    expect(await rowsOf(discharged.id)).toEqual([
      { action: 'EPISODE_OPENED', entity: 'EPISODE', params: {} },
      { action: 'EPISODE_CLOSED', entity: 'EPISODE', params: { status: 'DISCHARGED' } },
    ]);
    expect(await rowsOf(abandoned.id)).toEqual([
      { action: 'EPISODE_OPENED', entity: 'EPISODE', params: {} },
      { action: 'EPISODE_CLOSED', entity: 'EPISODE', params: { status: 'ABANDONED' } },
      { action: 'EPISODE_REOPENED', entity: 'EPISODE', params: {} },
    ]);
  });

  it('a correction names the fields it changed, never their values', async () => {
    const episode = await crearEpisodio({ mainComplaint: 'Lumbalgia', openedAt: '2025-06-01T10:00:00.000Z' });
    await patchEpisode(episode.id, { status: 'DISCHARGED', closedAt: '2025-08-01T12:00:00.000Z' });

    // Same status: correcting the closing date of a closed episode is a
    // correction, not a second closing.
    const date = await patchEpisode(episode.id, {
      status: 'DISCHARGED',
      closedAt: '2025-08-02T12:00:00.000Z',
      reason: 'DATA_ENTRY_ERROR',
    });
    const complaint = await patchEpisode(episode.id, { mainComplaint: 'Lumbociatalgia derecha', reason: 'LATE_INFORMATION' });
    expect(date.status).toBe(200);
    expect(complaint.status).toBe(200);

    const rows = await rowsOf(episode.id);
    expect(rows.slice(2)).toEqual([
      { action: 'EPISODE_UPDATED', entity: 'EPISODE', params: { changedFields: ['closedAt'], reason: 'DATA_ENTRY_ERROR' } },
      { action: 'EPISODE_UPDATED', entity: 'EPISODE', params: { changedFields: ['mainComplaint'], reason: 'LATE_INFORMATION' } },
    ]);
    expect(JSON.stringify(rows)).not.toContain('Lumbociatalgia');
  });

  it('a request that changes the status and corrects the complaint answers 400 and writes nothing', async () => {
    const episode = await crearEpisodio({ mainComplaint: 'Lumbalgia', openedAt: '2025-06-01T10:00:00.000Z' });

    const res = await patchEpisode(episode.id, {
      status: 'DISCHARGED',
      closedAt: '2025-08-01T12:00:00.000Z',
      mainComplaint: 'Otra cosa',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(
      'Cerrar o reabrir el episodio y corregir su motivo de consulta se guardan por separado',
    );
    await expect(
      prisma.clinicalEpisode.findUnique({
        where: { id: episode.id },
        select: { status: true, mainComplaint: true, closedAt: true },
      }),
    ).resolves.toEqual({ status: 'ACTIVE', mainComplaint: 'Lumbalgia', closedAt: null });
    expect((await rowsOf(episode.id)).map((r) => r.action)).toEqual(['EPISODE_OPENED']);
  });

  it('a status change that sends the complaint unchanged is only the status change', async () => {
    const episode = await crearEpisodio({ mainComplaint: 'Lumbalgia', openedAt: '2025-06-01T10:00:00.000Z' });

    const res = await patchEpisode(episode.id, {
      status: 'ABANDONED',
      closedAt: '2025-08-01T12:00:00.000Z',
      mainComplaint: 'Lumbalgia',
    });

    expect(res.status).toBe(200);
    expect((await rowsOf(episode.id)).map((r) => r.action)).toEqual(['EPISODE_OPENED', 'EPISODE_CLOSED']);
  });

  it('an update that changes nothing records nothing', async () => {
    const episode = await crearEpisodio({ mainComplaint: 'Lumbalgia' });

    const same = await patchEpisode(episode.id, { mainComplaint: 'Lumbalgia' });
    const stillActive = await patchEpisode(episode.id, { status: 'ACTIVE' });
    const empty = await patchEpisode(episode.id, {});
    expect([same.status, stillActive.status, empty.status]).toEqual([200, 200, 200]);

    expect((await rowsOf(episode.id)).map((r) => r.action)).toEqual(['EPISODE_OPENED']);
  });

  it('a refused update records nothing', async () => {
    const episode = await crearEpisodio({ openedAt: '2025-06-01T10:00:00.000Z' });

    const res = await patchEpisode(episode.id, { status: 'DISCHARGED', closedAt: '2025-05-31T23:59:59.000Z' });

    expect(res.status).toBe(400);
    expect((await rowsOf(episode.id)).map((r) => r.action)).toEqual(['EPISODE_OPENED']);
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
