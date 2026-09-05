import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { addClinicDays, instantToClinicTime } from '../src/lib/clinicTime';
import {
  createTestClinic,
  signTestToken,
  sleep,
  waitFor,
  type TestClinic,
} from './helpers';

const AR = 'America/Argentina/Buenos_Aires';

/** La fecha de hoy en la clínica, más un corrimiento en días. */
function fechaClinica(offsetDias = 0): string {
  const hoy = instantToClinicTime(new Date(), AR).date;
  return addClinicDays(hoy, offsetDias);
}

describe('turnos', () => {
  let clinic: TestClinic;
  let user: User;
  let token: string;
  let patient: { id: string };
  let episode: { id: string };

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
    token = signTestToken(user);
    patient = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName: 'Paciente Turnos' },
      select: { id: true },
    });
    episode = await prisma.clinicalEpisode.create({
      data: {
        tenantId: clinic.tenantId,
        patientId: patient.id,
        mainComplaint: 'Lumbalgia',
      },
      select: { id: true },
    });
  });

  afterAll(async () => {
    await sleep(400);
    await prisma.appointment.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.clinicalAlert.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.auditLog.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.payment.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.session.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.clinicalEpisode.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await clinic.cleanup();
  });

  function agendar(body: Record<string, unknown>) {
    return auth(request(app).post('/api/appointments')).send({
      patientId: patient.id,
      durationMinutes: 60,
      ...body,
    });
  }

  function listar(from: string, to: string) {
    return auth(request(app).get(`/api/appointments?from=${from}&to=${to}`));
  }

  // ── Lo básico ─────────────────────────────────────────────────────────────

  it('agenda un turno y lo devuelve con la hora de pared de la clínica', async () => {
    const date = fechaClinica(3);
    const res = await agendar({ date, time: '09:00', episodeId: episode.id });

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(1);

    const turno = res.body.data[0];
    expect(turno).toMatchObject({
      date,
      startTime: '09:00',
      endTime: '10:00',
      status: 'SCHEDULED',
      patientName: 'Paciente Turnos',
      episodeMainComplaint: 'Lumbalgia',
      seriesId: null,
      sessionId: null,
    });
    // El instante también viaja: 09:00 en Argentina son las 12:00 UTC.
    expect(turno.startsAt).toBe(`${date}T12:00:00.000Z`);
  });

  // El caso que rompe todo si el rango se calcula en UTC: 22:00 en Argentina
  // son las 01:00 UTC del día siguiente, así que un filtro en UTC dejaría este
  // turno fuera del día que le corresponde.
  it('un turno de la noche aparece en su día de la clínica, no en el siguiente', async () => {
    const date = fechaClinica(10);
    const creado = await agendar({ date, time: '22:00' });
    expect(creado.status).toBe(201);
    expect(creado.body.data[0].startsAt).toBe(
      `${addClinicDays(date, 1)}T01:00:00.000Z`,
    );

    const soloEseDia = await listar(date, date);
    const ids = soloEseDia.body.data.map((t: { id: string }) => t.id);
    expect(ids).toContain(creado.body.data[0].id);

    // Y NO aparece en el día siguiente, que es donde caería en UTC.
    const diaSiguiente = await listar(addClinicDays(date, 1), addClinicDays(date, 1));
    const idsSiguiente = diaSiguiente.body.data.map((t: { id: string }) => t.id);
    expect(idsSiguiente).not.toContain(creado.body.data[0].id);
  });

  it('permite pisar turnos: dos a la misma hora se agendan sin error', async () => {
    const date = fechaClinica(15);
    const primero = await agendar({ date, time: '11:00' });
    const segundo = await agendar({ date, time: '11:00' });

    expect(primero.status).toBe(201);
    expect(segundo.status).toBe(201);
  });

  // ── Series ────────────────────────────────────────────────────────────────

  it('una serie crea N turnos con el mismo horario y un seriesId compartido', async () => {
    const date = fechaClinica(30);
    const res = await agendar({
      date,
      time: '15:00',
      repeat: { everyWeeks: 1, occurrences: 4 },
    });

    expect(res.status).toBe(201);
    const turnos = res.body.data;
    expect(turnos).toHaveLength(4);

    const series = new Set(turnos.map((t: { seriesId: string }) => t.seriesId));
    expect(series.size).toBe(1);
    expect([...series][0]).not.toBeNull();

    // Mismo horario, una semana de diferencia cada uno.
    for (const [i, t] of turnos.entries()) {
      expect(t.startTime).toBe('15:00');
      expect(t.date).toBe(addClinicDays(date, i * 7));
    }
  });

  // La serie se creaba con un create por turno dentro de una transacción
  // interactiva: diez viajes de ida y vuelta que contra una base remota se
  // comían el timeout de 5 s de Prisma y hacían fallar la serie entera. Se
  // manifestó en CI y no en local, porque ahí la latencia es real.
  //
  // Ahora es un solo INSERT. Este test no mide tiempo —sería flaky— sino que
  // pide el máximo permitido: si volviera al bucle, sería un año de turnos
  // semanales en una transacción y la diferencia dejaría de ser sutil.
  it('crea una serie del tamaño máximo sin quedarse a mitad de camino', async () => {
    const date = fechaClinica(120);
    const res = await agendar({
      date,
      time: '10:00',
      repeat: { everyWeeks: 1, occurrences: 52 },
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(52);

    // Todos con la misma serie, en orden, y ninguno perdido.
    const series = new Set(res.body.data.map((t: { seriesId: string }) => t.seriesId));
    expect(series.size).toBe(1);
    expect(res.body.data[51].date).toBe(addClinicDays(date, 51 * 7));

    const enBase = await prisma.appointment.count({
      where: { seriesId: res.body.data[0].seriesId },
    });
    expect(enBase).toBe(52);
  });

  it('cada dos semanas separa los turnos catorce días', async () => {
    const date = fechaClinica(60);
    const res = await agendar({
      date,
      time: '08:00',
      repeat: { everyWeeks: 2, occurrences: 3 },
    });

    const fechas = res.body.data.map((t: { date: string }) => t.date);
    expect(fechas).toEqual([date, addClinicDays(date, 14), addClinicDays(date, 28)]);
  });

  // El caso que definió el diseño: diez sesiones, se suspende en la tercera.
  it('cancelar la serie deja intacto lo que ya pasó y cancela lo que falta', async () => {
    // Arranca hace 24 días para que ninguna ocurrencia caiga hoy (sería
    // ambigua según la hora a la que corra el test): quedan 4 pasadas y 6
    // futuras.
    const inicio = fechaClinica(-24);
    const creados = await agendar({
      date: inicio,
      time: '09:00',
      repeat: { everyWeeks: 1, occurrences: 10 },
    });
    expect(creados.status).toBe(201);
    const serie = creados.body.data;
    expect(serie).toHaveLength(10);

    // Las tres primeras ya se atendieron. La cuarta pasó pero quedó sin
    // registrar: es el caso que NO hay que tocar.
    for (const t of serie.slice(0, 3)) {
      const r = await auth(request(app).patch(`/api/appointments/${t.id}`)).send({
        status: 'COMPLETED',
      });
      expect(r.status).toBe(200);
    }

    const res = await auth(
      request(app).post(`/api/appointments/${serie[0].id}/cancel-series`),
    ).send();

    expect(res.status).toBe(200);
    expect(res.body.data.cancelled).toBe(6);

    const filas = await prisma.appointment.findMany({
      where: { seriesId: serie[0].seriesId },
      orderBy: { startsAt: 'asc' },
      select: { status: true },
    });
    expect(filas.map((f) => f.status)).toEqual([
      'COMPLETED', // las tres que se atendieron: historial, no se tocan
      'COMPLETED',
      'COMPLETED',
      'SCHEDULED', // pasada y sin resolver: pudo haber ocurrido, tampoco se toca
      'CANCELLED', // de acá en adelante, lo que faltaba
      'CANCELLED',
      'CANCELLED',
      'CANCELLED',
      'CANCELLED',
      'CANCELLED',
    ]);
  });

  it('un turno suelto no se puede cancelar como serie', async () => {
    const creado = await agendar({ date: fechaClinica(5), time: '16:00' });
    const res = await auth(
      request(app).post(`/api/appointments/${creado.body.data[0].id}/cancel-series`),
    ).send();

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/serie/i);
  });

  // ── Reprogramar ───────────────────────────────────────────────────────────

  it('mover solo la hora conserva la fecha y la duración', async () => {
    const date = fechaClinica(7);
    const creado = await agendar({ date, time: '10:00', durationMinutes: 45 });

    const res = await auth(
      request(app).patch(`/api/appointments/${creado.body.data[0].id}`),
    ).send({ time: '17:30' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      date,
      startTime: '17:30',
      endTime: '18:15', // los 45 minutos originales
    });
  });

  it('cancelar un turno estampa la fecha de cancelación, y reabrirlo la limpia', async () => {
    const creado = await agendar({ date: fechaClinica(8), time: '12:00' });
    const id = creado.body.data[0].id;

    const cancelado = await auth(request(app).patch(`/api/appointments/${id}`)).send({
      status: 'CANCELLED',
    });
    expect(cancelado.body.data.cancelledAt).not.toBeNull();

    const reabierto = await auth(request(app).patch(`/api/appointments/${id}`)).send({
      status: 'SCHEDULED',
    });
    expect(reabierto.body.data.cancelledAt).toBeNull();
  });

  // ── Turno → sesión ────────────────────────────────────────────────────────

  // El punto de todo el módulo: el turno ya sabe quién, cuándo y por qué, así
  // que registrar la sesión no vuelve a pedir nada de eso.
  it('registrar la sesión desde el turno lo deja vinculado y atendido', async () => {
    const creado = await agendar({
      date: fechaClinica(-1),
      time: '09:00',
      episodeId: episode.id,
    });
    const turno = creado.body.data[0];

    const sesion = await auth(
      request(app).post(`/api/patients/${patient.id}/sessions`),
    ).send({
      sessionDate: new Date().toISOString(),
      episodeIds: [episode.id],
      appointmentId: turno.id,
      observations: 'Trabajo de cadena posterior',
    });

    expect(sesion.status).toBe(201);

    const fila = await prisma.appointment.findUniqueOrThrow({
      where: { id: turno.id },
      select: { sessionId: true, status: true },
    });
    expect(fila.sessionId).toBe(sesion.body.data.id);
    expect(fila.status).toBe('COMPLETED');
  });

  // Dos clicks en "registrar sesión", o dos pestañas. Lo que importa no es
  // solo el 409: es que la segunda sesión NO se haya creado.
  it('no deja registrar dos sesiones para el mismo turno', async () => {
    const creado = await agendar({ date: fechaClinica(-2), time: '11:00' });
    const turno = creado.body.data[0];

    const primera = await auth(
      request(app).post(`/api/patients/${patient.id}/sessions`),
    ).send({ sessionDate: new Date().toISOString(), appointmentId: turno.id });
    expect(primera.status).toBe(201);

    const antes = await prisma.session.count({ where: { patientId: patient.id } });

    const segunda = await auth(
      request(app).post(`/api/patients/${patient.id}/sessions`),
    ).send({ sessionDate: new Date().toISOString(), appointmentId: turno.id });

    expect(segunda.status).toBe(409);
    const despues = await prisma.session.count({ where: { patientId: patient.id } });
    expect(despues).toBe(antes);
  });

  it('rechaza vincular el turno de otro paciente', async () => {
    const otro = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName: 'Paciente Sin Turno' },
      select: { id: true },
    });
    const creado = await agendar({ date: fechaClinica(-3), time: '12:00' });

    const res = await auth(request(app).post(`/api/patients/${otro.id}/sessions`)).send({
      sessionDate: new Date().toISOString(),
      appointmentId: creado.body.data[0].id,
    });

    expect(res.status).toBe(404);
  });

  // Hasta que existió la agenda no había turno al que faltar, y por eso la
  // alerta de inactividad se retipó a FOLLOW_UP en #111.
  it('marcar "no vino" genera la alerta de inasistencia, una sola vez', async () => {
    const creado = await agendar({ date: fechaClinica(-4), time: '14:00' });
    const turno = creado.body.data[0];

    await auth(request(app).patch(`/api/appointments/${turno.id}`)).send({
      status: 'NO_SHOW',
    });

    const alerta = await waitFor(() =>
      prisma.clinicalAlert.findFirst({
        where: { tenantId: clinic.tenantId, patientId: patient.id, type: 'NO_SHOW' },
      }),
    );
    expect(alerta.message).toMatch(/Faltó sin avisar/);

    // Marcar y desmarcar no puede generar una alerta por click.
    await auth(request(app).patch(`/api/appointments/${turno.id}`)).send({
      status: 'SCHEDULED',
    });
    await auth(request(app).patch(`/api/appointments/${turno.id}`)).send({
      status: 'NO_SHOW',
    });
    await sleep(600);

    const cuantas = await prisma.clinicalAlert.count({
      where: { tenantId: clinic.tenantId, type: 'NO_SHOW' },
    });
    expect(cuantas).toBe(1);
  });

  // ── Validación y aislamiento ──────────────────────────────────────────────

  it('rechaza agendar sobre un paciente inexistente', async () => {
    const res = await auth(request(app).post('/api/appointments')).send({
      patientId: randomUUID(),
      date: fechaClinica(1),
      time: '09:00',
      durationMinutes: 60,
    });
    expect(res.status).toBe(404);
  });

  it('rechaza un episodio que no es del paciente', async () => {
    const otro = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName: 'Otro Paciente' },
      select: { id: true },
    });
    const episodioAjeno = await prisma.clinicalEpisode.create({
      data: { tenantId: clinic.tenantId, patientId: otro.id },
      select: { id: true },
    });

    const res = await agendar({
      date: fechaClinica(1),
      time: '09:00',
      episodeId: episodioAjeno.id,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/[Ee]pisodio/);
  });

  it('rechaza un rango de fechas demasiado grande', async () => {
    const res = await listar('2026-01-01', '2026-12-31');
    expect(res.status).toBe(400);
  });

  it('rechaza un rango al revés', async () => {
    const res = await listar(fechaClinica(10), fechaClinica(3));
    expect(res.status).toBe(400);
  });

  it('rechaza una hora con formato inválido', async () => {
    expect((await agendar({ date: fechaClinica(1), time: '25:00' })).status).toBe(400);
    expect((await agendar({ date: fechaClinica(1), time: '9am' })).status).toBe(400);
  });

  it('los turnos de otra clínica no se ven ni se tocan', async () => {
    const otra = await createTestClinic();
    try {
      const otroUser = await otra.createUser();
      const otroToken = signTestToken(otroUser);
      const otroPaciente = await prisma.patient.create({
        data: { tenantId: otra.tenantId, fullName: 'Paciente Ajeno' },
        select: { id: true },
      });

      const date = fechaClinica(2);
      const ajeno = await request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${otroToken}`)
        .send({ patientId: otroPaciente.id, date, time: '09:00', durationMinutes: 60 });
      expect(ajeno.status).toBe(201);
      const ajenoId = ajeno.body.data[0].id;

      // No aparece en el listado de la otra clínica...
      const listado = await listar(date, date);
      const ids = listado.body.data.map((t: { id: string }) => t.id);
      expect(ids).not.toContain(ajenoId);

      // ...ni se puede modificar.
      const intento = await auth(request(app).patch(`/api/appointments/${ajenoId}`)).send({
        status: 'CANCELLED',
      });
      expect(intento.status).toBe(404);
    } finally {
      await prisma.appointment.deleteMany({ where: { tenantId: otra.tenantId } });
      await prisma.patient.deleteMany({ where: { tenantId: otra.tenantId } });
      await otra.cleanup();
    }
  });
});
