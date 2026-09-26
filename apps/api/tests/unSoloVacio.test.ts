import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, signTestToken, sleep, type TestClinic } from './helpers';

// Hay un solo vacío en la API y es `null`. Un formulario web no tiene null:
// tiene "". Hasta ahora esa traducción la hacía React, con un `.trim() || null`
// repetido en más de quince pantallas — o sea, una regla sobre qué significa un
// dato viviendo en el componente que lo dibuja.
//
// Estos tests fijan la regla del lado de la API, para los cuatro tipos de campo
// que la usan (texto, fecha, enum, id): "" y "   " entran como null, el campo
// ausente no se toca, y el texto obligatorio se mide después del trim.
describe('un solo vacío: "" entra como null', () => {
  let clinic: TestClinic;
  let user: User;
  let token: string;

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser({ role: 'ADMIN' });
    token = signTestToken(user);
  });

  afterAll(async () => {
    await sleep(300);
    await prisma.auditLog.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.appointment.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.clinicalEpisode.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await clinic.cleanup();
  });

  async function crearPaciente(body: Record<string, unknown> = {}) {
    const res = await auth(request(app).post('/api/patients')).send({
      fullName: 'Paciente de Prueba',
      ...body,
    });
    expect(res.status).toBe(201);
    return res.body.data as { id: string; [k: string]: unknown };
  }

  // ── Texto ─────────────────────────────────────────────────────────────────

  it('un texto vacío se guarda como null, no como cadena vacía', async () => {
    const patient = await crearPaciente({ phone: '', occupation: '   ' });

    expect(patient.phone).toBeNull();
    expect(patient.occupation).toBeNull();

    // Y en la base tampoco quedó un '' que después haya que distinguir de null.
    await expect(
      prisma.patient.findUnique({
        where: { id: patient.id },
        select: { phone: true, occupation: true },
      }),
    ).resolves.toEqual({ phone: null, occupation: null });
  });

  it('un texto con espacios de más se guarda trimeado', async () => {
    const patient = await crearPaciente({ occupation: '  Docente  ' });
    expect(patient.occupation).toBe('Docente');
  });

  it('el PATCH borra un campo con "" y no toca los que no vienen', async () => {
    const patient = await crearPaciente({ phone: '11-5555-0000', occupation: 'Docente' });

    const res = await auth(request(app).patch(`/api/patients/${patient.id}`)).send({
      phone: '',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBeNull();
    // occupation no viajó en el body: sigue como estaba.
    expect(res.body.data.occupation).toBe('Docente');
  });

  it('null sigue siendo la forma explícita de borrar', async () => {
    const patient = await crearPaciente({ occupation: 'Docente' });

    const res = await auth(request(app).patch(`/api/patients/${patient.id}`)).send({
      occupation: null,
    });

    expect(res.body.data.occupation).toBeNull();
  });

  // ── Texto obligatorio ─────────────────────────────────────────────────────

  it('un nombre de solo espacios es 400, no un paciente sin nombre', async () => {
    const res = await auth(request(app).post('/api/patients')).send({ fullName: '   ' });

    expect(res.status).toBe(400);
    expect(res.body.details).toHaveProperty('fullName');
  });

  it('el nombre se guarda trimeado', async () => {
    const patient = await crearPaciente({ fullName: '  Ana María Pérez  ' });
    expect(patient.fullName).toBe('Ana María Pérez');
  });

  // ── Fecha y enum ──────────────────────────────────────────────────────────

  it('una fecha vacía es null, no una fecha inválida', async () => {
    const patient = await crearPaciente({ birthDate: '' });

    expect(patient.birthDate).toBeNull();

    // Lo que no es una fecha sigue siendo 400: "" es ausencia, "ayer" es error.
    const invalida = await auth(request(app).post('/api/patients')).send({
      fullName: 'Paciente Fecha',
      birthDate: 'ayer',
    });
    expect(invalida.status).toBe(400);
  });

  it('un select sin elegir es null, y un valor que no existe sigue siendo 400', async () => {
    const patient = await crearPaciente({ sex: '' });
    expect(patient.sex).toBeNull();

    const invalido = await auth(request(app).post('/api/patients')).send({
      fullName: 'Paciente Sexo',
      sex: 'NO_EXISTE',
    });
    expect(invalido.status).toBe(400);
  });

  // ── Id opcional ───────────────────────────────────────────────────────────

  it('un id opcional vacío es "ninguno", no un id que no existe', async () => {
    const patient = await crearPaciente();

    const res = await auth(request(app).post('/api/appointments')).send({
      patientId: patient.id,
      episodeId: '',
      notes: '  ',
      date: '2026-03-10',
      time: '10:00',
      durationMinutes: 45,
    });

    // El alta de turnos devuelve la serie, aunque sea de uno solo.
    expect(res.status).toBe(201);
    expect(res.body.data[0].episodeId).toBeNull();
    expect(res.body.data[0].notes).toBeNull();
  });
});
