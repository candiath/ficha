import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { DAY_MS } from '../src/lib/clinicalDate';
import { createTestClinic, signTestToken, sleep, waitFor, type TestClinic } from './helpers';

// El CRUD de sesiones por HTTP: los caminos que las otras suites no cubren.
//
// Lo que ya está fijado en otro lado y acá no se repite: la transacción del
// POST con cobro (sessionAtomicCreate), la semántica parcial del PATCH
// (sessionPatchPartial), el borrado lógico y su regla de "cobrada no se borra"
// (sessionSoftDelete), el tope de un episodio (sessionUnEpisodio), la fecha
// (sessionDateValidation), los episodeIds ajenos (tenantIsolation) y el vínculo
// con el turno (appointments).
//
// Acá va el resto: la forma completa del DTO y la atribución al usuario, la
// validación de los campos clínicos, el cruce entre pacientes de la MISMA
// clínica (el que el guard de tenant no puede atajar), el filtro por episodio,
// el orden, el PATCH de fecha y de episodio, la auditoría, y qué pasa con el
// turno cuando la sesión que salió de él se borra.
describe('CRUD de sesiones por HTTP', () => {
  let clinic: TestClinic;
  let clinicB: TestClinic;
  let user: User;
  let token: string;

  // Dos pacientes de la misma clínica: el segundo prueba el cruce dentro del
  // tenant, que es justo lo que el scope por tenantId no puede detectar.
  let patient: { id: string };
  let otroPaciente: { id: string };
  let episodeA: { id: string };
  let episodeB: { id: string };
  let episodeDelOtro: { id: string };
  let packageDelOtro: { id: string };
  let packageDeB: { id: string };

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const url = (patientId = patient.id) => `/api/patients/${patientId}/sessions`;

  beforeAll(async () => {
    clinic = await createTestClinic();
    clinicB = await createTestClinic();
    user = await clinic.createUser();
    token = signTestToken(user);

    patient = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName: 'Paciente CRUD Sesiones' },
      select: { id: true },
    });
    otroPaciente = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName: 'Otro Paciente Misma Clínica' },
      select: { id: true },
    });

    const crearEpisodio = (patientId: string, tenantId: string, mainComplaint: string) =>
      prisma.clinicalEpisode.create({
        data: { tenantId, patientId, mainComplaint },
        select: { id: true },
      });
    episodeA = await crearEpisodio(patient.id, clinic.tenantId, 'Cervicalgia');
    episodeB = await crearEpisodio(patient.id, clinic.tenantId, 'Lumbalgia');
    episodeDelOtro = await crearEpisodio(otroPaciente.id, clinic.tenantId, 'Del otro');

    packageDelOtro = await prisma.sessionPackage.create({
      data: {
        tenantId: clinic.tenantId,
        patientId: otroPaciente.id,
        name: 'Paquete del otro paciente',
        totalSessions: 10,
        pricePerSession: 100,
      },
      select: { id: true },
    });

    const patientB = await prisma.patient.create({
      data: { tenantId: clinicB.tenantId, fullName: 'Paciente de B' },
      select: { id: true },
    });
    packageDeB = await prisma.sessionPackage.create({
      data: {
        tenantId: clinicB.tenantId,
        patientId: patientB.id,
        name: 'Paquete de B',
        totalSessions: 10,
        pricePerSession: 100,
      },
      select: { id: true },
    });
  });

  afterAll(async () => {
    await sleep(300);
    const tenantIds = [clinic.tenantId, clinicB.tenantId];
    await prisma.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.appointment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.session.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.sessionPackage.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.clinicalEpisode.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.patient.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await clinic.cleanup();
    await clinicB.cleanup();
  });

  async function crearSesion(body: Record<string, unknown> = {}, patientId = patient.id) {
    const res = await auth(request(app).post(url(patientId))).send({
      sessionDate: new Date().toISOString(),
      ...body,
    });
    expect(res.status).toBe(201);
    return res.body.data as { id: string; [k: string]: unknown };
  }

  function filaCruda(id: string) {
    return prisma.session.findUnique({
      where: { id },
      select: {
        tenantId: true,
        userId: true,
        patientId: true,
        sessionType: true,
        sessionDate: true,
        observations: true,
        painScaleBefore: true,
        painScaleAfter: true,
        deletedAt: true,
        episodes: { select: { episodeId: true } },
      },
    });
  }

  // ── POST: forma y defaults ────────────────────────────────────────────────

  it('POST con todos los campos clínicos devuelve el DTO completo', async () => {
    const fecha = new Date('2026-03-10T14:30:00.000Z').toISOString();
    const res = await auth(request(app).post(url())).send({
      sessionType: 'SESSION',
      sessionDate: fecha,
      episodeIds: [episodeA.id],
      preSesionState: 'Rigidez matinal',
      reEvaluationNotes: 'Mejora el rango',
      patientResponse: 'Bien tolerado',
      painScaleBefore: 7,
      painScaleAfter: 3,
      observations: 'Trabajo de cadena posterior',
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      patientId: patient.id,
      sessionType: 'SESSION',
      sessionDate: fecha,
      episodeIds: [episodeA.id],
      preSesionState: 'Rigidez matinal',
      reEvaluationNotes: 'Mejora el rango',
      patientResponse: 'Bien tolerado',
      painScaleBefore: 7,
      painScaleAfter: 3,
      observations: 'Trabajo de cadena posterior',
    });
    expect(typeof res.body.data.id).toBe('string');
    expect(typeof res.body.data.createdAt).toBe('string');
    expect(typeof res.body.data.updatedAt).toBe('string');
    // Internos: no viajan.
    expect(res.body.data).not.toHaveProperty('tenantId');
    expect(res.body.data).not.toHaveProperty('userId');
    expect(res.body.data).not.toHaveProperty('deletedAt');
  });

  it('POST atribuye la sesión al usuario del token y al tenant de la clínica', async () => {
    const creada = await crearSesion();

    await expect(filaCruda(creada.id)).resolves.toMatchObject({
      tenantId: clinic.tenantId,
      userId: user.id,
      patientId: patient.id,
      deletedAt: null,
    });
  });

  it('POST con solo la fecha nace como SESSION, sin episodio y con el resto en null', async () => {
    const creada = await crearSesion();

    expect(creada).toMatchObject({
      sessionType: 'SESSION',
      episodeIds: [],
      preSesionState: null,
      reEvaluationNotes: null,
      patientResponse: null,
      painScaleBefore: null,
      painScaleAfter: null,
      observations: null,
    });
    // Sin payment en el body no se inventa ningún cobro.
    await expect(
      prisma.payment.findUnique({ where: { sessionId: creada.id } }),
    ).resolves.toBeNull();
  });

  it('POST acepta NOTE y DISCHARGE como tipos', async () => {
    const nota = await crearSesion({ sessionType: 'NOTE' });
    const alta = await crearSesion({ sessionType: 'DISCHARGE' });

    expect(nota.sessionType).toBe('NOTE');
    expect(alta.sessionType).toBe('DISCHARGE');
  });

  // ── POST: validación ──────────────────────────────────────────────────────

  it('POST rechaza un sessionType fuera del enum', async () => {
    const res = await auth(request(app).post(url())).send({
      sessionDate: new Date().toISOString(),
      sessionType: 'CONSULTA',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Datos inválidos');
    expect(res.body.details.sessionType).toBeDefined();
  });

  it('POST rechaza escalas de dolor fuera de 0..10 o no enteras', async () => {
    for (const [campo, valor] of [
      ['painScaleBefore', 11],
      ['painScaleBefore', -1],
      ['painScaleAfter', 3.5],
      ['painScaleAfter', '5'],
    ] as const) {
      const res = await auth(request(app).post(url())).send({
        sessionDate: new Date().toISOString(),
        [campo]: valor,
      });
      expect(res.status, `${campo}=${valor}`).toBe(400);
      expect(res.body.details[campo], `${campo}=${valor}`).toBeDefined();
    }
  });

  it('POST sin sessionDate se rechaza', async () => {
    const res = await auth(request(app).post(url())).send({ observations: 'sin fecha' });

    expect(res.status).toBe(400);
    expect(res.body.details.sessionDate).toBeDefined();
  });

  it('POST con un body inválido no deja sesión a medias', async () => {
    const antes = await prisma.session.count({ where: { patientId: patient.id } });

    await auth(request(app).post(url())).send({
      sessionDate: new Date().toISOString(),
      painScaleBefore: 99,
    });

    await expect(prisma.session.count({ where: { patientId: patient.id } })).resolves.toBe(
      antes,
    );
  });

  // ── POST: el paquete del cobro embebido ───────────────────────────────────

  // tenantIsolation cubre el packageId ajeno en POST /api/payments; ésta es la
  // otra puerta —el cobro que viaja dentro del alta de la sesión— y la que la
  // app usa de verdad.
  it('POST rechaza un packageId de otro paciente de la misma clínica, sin dejar sesión ni cobro', async () => {
    const antes = await prisma.session.count({ where: { patientId: patient.id } });

    const res = await auth(request(app).post(url())).send({
      sessionDate: new Date().toISOString(),
      payment: { packageId: packageDelOtro.id, baseAmount: 100 },
    });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Paquete no encontrado' });
    await expect(prisma.session.count({ where: { patientId: patient.id } })).resolves.toBe(
      antes,
    );
    await expect(
      prisma.payment.count({ where: { packageId: packageDelOtro.id } }),
    ).resolves.toBe(0);
  });

  it('POST rechaza un packageId de otra clínica', async () => {
    const res = await auth(request(app).post(url())).send({
      sessionDate: new Date().toISOString(),
      payment: { packageId: packageDeB.id, baseAmount: 100 },
    });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Paquete no encontrado' });
  });

  // ── GET lista ─────────────────────────────────────────────────────────────

  it('GET lista solo las sesiones de ese paciente, de la más reciente a la más vieja', async () => {
    const vieja = await crearSesion({
      sessionDate: new Date(Date.now() - 30 * DAY_MS).toISOString(),
    });
    const reciente = await crearSesion({
      sessionDate: new Date(Date.now() - 1 * DAY_MS).toISOString(),
    });
    const delOtro = await crearSesion({}, otroPaciente.id);

    const res = await auth(request(app).get(url()));

    expect(res.status).toBe(200);
    const ids = res.body.data.map((s: { id: string }) => s.id);
    expect(ids).toContain(vieja.id);
    expect(ids).toContain(reciente.id);
    expect(ids).not.toContain(delOtro.id);
    expect(ids.indexOf(reciente.id)).toBeLessThan(ids.indexOf(vieja.id));

    const fechas = res.body.data.map((s: { sessionDate: string }) => s.sessionDate);
    const ordenadas = [...fechas].sort((a, b) => b.localeCompare(a));
    expect(fechas).toEqual(ordenadas);
  });

  // queryParams.test.ts prueba que el filtro se valida; acá, que filtra.
  it('GET ?episodeId= devuelve solo las sesiones vinculadas a ese episodio', async () => {
    const deA = await crearSesion({ episodeIds: [episodeA.id] });
    const deB = await crearSesion({ episodeIds: [episodeB.id] });
    const sinEpisodio = await crearSesion();

    const res = await auth(request(app).get(`${url()}?episodeId=${episodeA.id}`));

    expect(res.status).toBe(200);
    const ids = res.body.data.map((s: { id: string }) => s.id);
    expect(ids).toContain(deA.id);
    expect(ids).not.toContain(deB.id);
    expect(ids).not.toContain(sinEpisodio.id);
  });

  it('GET ?episodeId= de un episodio de otro paciente devuelve vacío, no las del otro', async () => {
    const delOtro = await crearSesion({ episodeIds: [episodeDelOtro.id] }, otroPaciente.id);

    const res = await auth(request(app).get(`${url()}?episodeId=${episodeDelOtro.id}`));

    expect(res.status).toBe(200);
    expect(res.body.data.map((s: { id: string }) => s.id)).not.toContain(delOtro.id);
  });

  // ── GET una ───────────────────────────────────────────────────────────────

  it('GET /:sessionId devuelve lo mismo que devolvió el POST', async () => {
    const creada = await crearSesion({ episodeIds: [episodeA.id], observations: 'leer' });

    const res = await auth(request(app).get(`${url()}/${creada.id}`));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(creada);
  });

  // La sesión existe y es de la clínica, pero la URL la pide bajo otro
  // paciente. Es el cruce que el scope por tenant no ve.
  it('GET /:sessionId bajo otro paciente de la misma clínica da 404', async () => {
    const delOtro = await crearSesion({}, otroPaciente.id);

    const res = await auth(request(app).get(`${url()}/${delOtro.id}`));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Sesión no encontrada' });
  });

  it('GET /:sessionId inexistente da 404', async () => {
    const res = await auth(request(app).get(`${url()}/${randomUUID()}`));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Sesión no encontrada' });
  });

  // ── PATCH ─────────────────────────────────────────────────────────────────

  it('PATCH cambia la fecha', async () => {
    const creada = await crearSesion();
    const nueva = new Date(Date.now() - 3 * DAY_MS).toISOString();

    const res = await auth(request(app).patch(`${url()}/${creada.id}`)).send({
      sessionDate: nueva,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.sessionDate).toBe(nueva);
  });

  it('PATCH con una fecha inválida se rechaza y no toca la fila', async () => {
    const creada = await crearSesion();
    const original = (await filaCruda(creada.id))!.sessionDate;

    for (const fecha of [
      'mañana',
      new Date(Date.now() + 400 * DAY_MS).toISOString(),
      '1025-01-01T10:00:00.000Z',
    ]) {
      const res = await auth(request(app).patch(`${url()}/${creada.id}`)).send({
        sessionDate: fecha,
      });
      expect(res.status, fecha).toBe(400);
    }

    await expect(filaCruda(creada.id)).resolves.toMatchObject({ sessionDate: original });
  });

  it('PATCH cambia las escalas de dolor y el texto clínico', async () => {
    const creada = await crearSesion({ painScaleBefore: 8, observations: 'antes' });

    const res = await auth(request(app).patch(`${url()}/${creada.id}`)).send({
      painScaleBefore: 6,
      painScaleAfter: 2,
      observations: 'después',
      patientResponse: 'Refiere alivio',
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      painScaleBefore: 6,
      painScaleAfter: 2,
      observations: 'después',
      patientResponse: 'Refiere alivio',
    });
  });

  // El formulario web manda null en lo que el usuario vació: la API tiene que
  // limpiar, no ignorar.
  it('PATCH con null limpia el campo', async () => {
    const creada = await crearSesion({
      painScaleBefore: 8,
      painScaleAfter: 4,
      observations: 'a borrar',
    });

    const res = await auth(request(app).patch(`${url()}/${creada.id}`)).send({
      painScaleBefore: null,
      painScaleAfter: null,
      observations: null,
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      painScaleBefore: null,
      painScaleAfter: null,
      observations: null,
    });
  });

  it('PATCH rechaza una escala fuera de rango y deja la fila intacta', async () => {
    const creada = await crearSesion({ painScaleBefore: 5 });

    const res = await auth(request(app).patch(`${url()}/${creada.id}`)).send({
      painScaleBefore: 12,
    });

    expect(res.status).toBe(400);
    await expect(filaCruda(creada.id)).resolves.toMatchObject({ painScaleBefore: 5 });
  });

  it('PATCH reemplaza el episodio vinculado por otro del mismo paciente', async () => {
    const creada = await crearSesion({ episodeIds: [episodeA.id] });

    const res = await auth(request(app).patch(`${url()}/${creada.id}`)).send({
      episodeIds: [episodeB.id],
    });

    expect(res.status).toBe(200);
    expect(res.body.data.episodeIds).toEqual([episodeB.id]);
    // En la base quedó UNA fila del pivote, la nueva: no se acumulan.
    await expect(filaCruda(creada.id)).resolves.toMatchObject({
      episodes: [{ episodeId: episodeB.id }],
    });
  });

  it('PATCH con el episodio de otro paciente de la misma clínica da 400 y no toca el vínculo', async () => {
    const creada = await crearSesion({ episodeIds: [episodeA.id] });

    const res = await auth(request(app).patch(`${url()}/${creada.id}`)).send({
      episodeIds: [episodeDelOtro.id],
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Episodio inexistente o de otro paciente' });
    await expect(filaCruda(creada.id)).resolves.toMatchObject({
      episodes: [{ episodeId: episodeA.id }],
    });
  });

  it('PATCH bajo otro paciente de la misma clínica da 404 y deja la fila intacta', async () => {
    const delOtro = await crearSesion({ observations: 'del otro' }, otroPaciente.id);

    const res = await auth(request(app).patch(`${url()}/${delOtro.id}`)).send({
      observations: 'pisado desde otro paciente',
    });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Sesión no encontrada' });
    await expect(filaCruda(delOtro.id)).resolves.toMatchObject({ observations: 'del otro' });
  });

  it('PATCH inexistente da 404', async () => {
    const res = await auth(request(app).patch(`${url()}/${randomUUID()}`)).send({
      observations: 'nada',
    });

    expect(res.status).toBe(404);
  });

  // payment queda afuera del PATCH a propósito: el cobro se edita por
  // /api/payments. Un cliente que lo mande igual no tiene que romper nada ni
  // modificar el cobro.
  it('PATCH ignora un payment en el body y no toca el cobro', async () => {
    const creada = await crearSesion({ payment: { baseAmount: 5000 } });

    const res = await auth(request(app).patch(`${url()}/${creada.id}`)).send({
      observations: 'con payment colado',
      payment: { baseAmount: 1 },
    });

    expect(res.status).toBe(200);
    const cobro = await prisma.payment.findUnique({
      where: { sessionId: creada.id },
      select: { baseAmount: true },
    });
    expect(Number(cobro?.baseAmount)).toBe(5000);
  });

  // ── DELETE ────────────────────────────────────────────────────────────────

  it('DELETE bajo otro paciente de la misma clínica da 404 y no borra', async () => {
    const delOtro = await crearSesion({}, otroPaciente.id);

    const res = await auth(request(app).delete(`${url()}/${delOtro.id}`));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Sesión no encontrada' });
    await expect(filaCruda(delOtro.id)).resolves.toMatchObject({ deletedAt: null });
  });

  it('DELETE de una sesión con episodio la saca del filtro por episodio', async () => {
    const creada = await crearSesion({ episodeIds: [episodeA.id] });

    expect((await auth(request(app).delete(`${url()}/${creada.id}`))).status).toBe(204);

    const res = await auth(request(app).get(`${url()}?episodeId=${episodeA.id}`));
    expect(res.body.data.map((s: { id: string }) => s.id)).not.toContain(creada.id);
  });

  // La sesión salió de un turno y se borra porque se cargó por error. Si el
  // turno quedara apuntando a la sesión borrada, la agenda diría para siempre
  // "la sesión de este turno ya está registrada" y el POST con ese
  // appointmentId daría 409: un turno atendido sin ninguna sesión que se pueda
  // ver ni volver a registrar.
  it('DELETE libera el turno del que salió la sesión, para poder registrarla de nuevo', async () => {
    const turno = await prisma.appointment.create({
      data: {
        tenantId: clinic.tenantId,
        patientId: patient.id,
        userId: user.id,
        startsAt: new Date(Date.now() - DAY_MS),
        endsAt: new Date(Date.now() - DAY_MS + 60 * 60 * 1000),
      },
      select: { id: true },
    });
    const primera = await crearSesion({ appointmentId: turno.id });
    await expect(
      prisma.appointment.findUnique({ where: { id: turno.id }, select: { sessionId: true } }),
    ).resolves.toEqual({ sessionId: primera.id });

    expect((await auth(request(app).delete(`${url()}/${primera.id}`))).status).toBe(204);

    // El turno ya no apunta a nada...
    await expect(
      prisma.appointment.findUnique({ where: { id: turno.id }, select: { sessionId: true } }),
    ).resolves.toEqual({ sessionId: null });

    // ...y se puede registrar la sesión correcta.
    const segunda = await auth(request(app).post(url())).send({
      sessionDate: new Date().toISOString(),
      appointmentId: turno.id,
    });
    expect(segunda.status).toBe(201);
    await expect(
      prisma.appointment.findUnique({
        where: { id: turno.id },
        select: { sessionId: true, status: true },
      }),
    ).resolves.toEqual({ sessionId: segunda.body.data.id, status: 'COMPLETED' });
  });

  // ── Bajo un paciente borrado ──────────────────────────────────────────────

  // patientRepository.test.ts cubre GET y POST bajo un paciente borrado; acá
  // van las otras dos escrituras, que también pasan por patientRepo.exists.
  it('PATCH y DELETE de una sesión de un paciente borrado dan 404 y no tocan nada', async () => {
    const borrado = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName: 'Paciente Borrado Con Sesión' },
      select: { id: true },
    });
    const sesion = await crearSesion({ observations: 'previa al borrado' }, borrado.id);
    expect((await auth(request(app).delete(`/api/patients/${borrado.id}`))).status).toBe(204);

    const editada = await auth(request(app).patch(`${url(borrado.id)}/${sesion.id}`)).send({
      observations: 'post mortem',
    });
    expect(editada.status).toBe(404);
    expect(editada.body).toEqual({ error: 'Paciente no encontrado' });

    const borrada = await auth(request(app).delete(`${url(borrado.id)}/${sesion.id}`));
    expect(borrada.status).toBe(404);
    expect(borrada.body).toEqual({ error: 'Paciente no encontrado' });

    await expect(filaCruda(sesion.id)).resolves.toMatchObject({
      observations: 'previa al borrado',
      deletedAt: null,
    });
  });

  // ── Auditoría ─────────────────────────────────────────────────────────────

  it('crear, editar y borrar dejan su entrada de auditoría, con el dolor en la de alta', async () => {
    const creada = await crearSesion({ painScaleBefore: 7, painScaleAfter: 3 });
    await auth(request(app).patch(`${url()}/${creada.id}`)).send({ observations: 'x' });
    await auth(request(app).delete(`${url()}/${creada.id}`));

    const buscar = (action: 'CREATED' | 'UPDATED' | 'DELETED') =>
      waitFor(() =>
        prisma.auditLog.findFirst({
          where: { tenantId: clinic.tenantId, entity: 'SESSION', entityId: creada.id, action },
          select: { patientId: true, userId: true, description: true },
        }),
      );

    const [alta, edicion, borrado] = await Promise.all([
      buscar('CREATED'),
      buscar('UPDATED'),
      buscar('DELETED'),
    ]);

    for (const entrada of [alta, edicion, borrado]) {
      expect(entrada).toMatchObject({ patientId: patient.id, userId: user.id });
    }
    expect(alta.description).toBe('Sesión RPG registrada — Dolor 7 → 3');
  });

  it('el alta de una NOTE y de un DISCHARGE se describen como tales', async () => {
    const nota = await crearSesion({ sessionType: 'NOTE' });
    const alta = await crearSesion({ sessionType: 'DISCHARGE' });

    const descripcion = (entityId: string) =>
      waitFor(() =>
        prisma.auditLog.findFirst({
          where: { entity: 'SESSION', entityId, action: 'CREATED' },
          select: { description: true },
        }),
      );

    await expect(descripcion(nota.id)).resolves.toEqual({
      description: 'Nota clínica registrada',
    });
    await expect(descripcion(alta.id)).resolves.toEqual({ description: 'Alta registrada' });
  });

  // ── Autenticación ─────────────────────────────────────────────────────────

  it('sin token, las cinco rutas responden 401', async () => {
    const creada = await crearSesion();

    const pedidos = [
      request(app).get(url()),
      request(app).get(`${url()}/${creada.id}`),
      request(app).post(url()).send({ sessionDate: new Date().toISOString() }),
      request(app).patch(`${url()}/${creada.id}`).send({ observations: 'intruso' }),
      request(app).delete(`${url()}/${creada.id}`),
    ];

    for (const pedido of pedidos) {
      const res = await pedido;
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'No autenticado' });
    }
  });
});
