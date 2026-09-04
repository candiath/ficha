import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, signTestToken, sleep, type TestClinic } from './helpers';

// Una sesión cargada por error no se podía sacar de ningún lado: no existía
// DELETE ni método de borrado en el repositorio. Ahora se borra lógicamente,
// con una sola regla dura: si ya se cobró, no. Estos tests fijan esa regla y
// el alcance del borrado (listados, lectura, edición y métricas).
describe('borrado lógico de sesiones', () => {
  let clinic: TestClinic;
  let user: User;
  let token: string;
  let patient: { id: string };

  const sessionsUrl = () => `/api/patients/${patient.id}/sessions`;
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
    token = signTestToken(user);
    patient = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName: 'Paciente Borrado de Sesión' },
      select: { id: true },
    });
  });

  afterAll(async () => {
    // Los audit logs se escriben fire-and-forget: darles un instante.
    await sleep(300);
    await prisma.auditLog.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.payment.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.session.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await clinic.cleanup();
  });

  /** Crea una sesión vía la API y devuelve su id. */
  async function crearSesion(payment?: { baseAmount: number; discount?: number }) {
    const res = await auth(request(app).post(sessionsUrl())).send({
      sessionDate: new Date().toISOString(),
      observations: 'Sesión de prueba',
      ...(payment ? { payment } : {}),
    });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  }

  function borrar(sessionId: string) {
    return auth(request(app).delete(`${sessionsUrl()}/${sessionId}`)).send();
  }

  async function cobroDe(sessionId: string) {
    const res = await auth(request(app).get(`/api/payments?patientId=${patient.id}`));
    return res.body.data.find((p: { sessionId: string }) => p.sessionId === sessionId);
  }

  it('borra una sesión sin cobro y deja de listarla, pero conserva la fila', async () => {
    const id = await crearSesion();

    const res = await borrar(id);
    expect(res.status).toBe(204);

    const listado = await auth(request(app).get(sessionsUrl()));
    expect(listado.body.data.map((s: { id: string }) => s.id)).not.toContain(id);

    // Borrado lógico: la fila sigue existiendo, con su marca.
    const fila = await prisma.session.findUnique({ where: { id } });
    expect(fila).not.toBeNull();
    expect(fila?.deletedAt).not.toBeNull();
  });

  it('se lleva el cobro pendiente: no queda un cobro por una sesión que no existió', async () => {
    const id = await crearSesion({ baseAmount: 15000 });
    expect(await cobroDe(id)).toBeDefined();

    expect((await borrar(id)).status).toBe(204);

    // El cobro se elimina de verdad: no hubo plata, así que no es historial.
    expect(await cobroDe(id)).toBeUndefined();
    const fila = await prisma.payment.findFirst({ where: { sessionId: id } });
    expect(fila).toBeNull();
  });

  it('rechaza con 409 una sesión ya cobrada y no la borra', async () => {
    const id = await crearSesion({ baseAmount: 20000 });
    const cobro = await cobroDe(id);

    const pagado = await auth(request(app).patch(`/api/payments/${cobro.id}`)).send({
      status: 'PAID',
      method: 'CASH',
    });
    expect(pagado.status).toBe(200);

    const res = await borrar(id);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/cobro/i);

    // Ni la sesión ni el cobro se tocaron.
    const fila = await prisma.session.findUnique({ where: { id } });
    expect(fila?.deletedAt).toBeNull();
    expect(await cobroDe(id)).toBeDefined();

    const listado = await auth(request(app).get(sessionsUrl()));
    expect(listado.body.data.map((s: { id: string }) => s.id)).toContain(id);
  });

  it('una sesión eximida sí se puede borrar: no entró plata', async () => {
    const id = await crearSesion({ baseAmount: 9000 });
    const cobro = await cobroDe(id);
    await auth(request(app).patch(`/api/payments/${cobro.id}`)).send({ status: 'WAIVED' });

    expect((await borrar(id)).status).toBe(204);
    expect(await cobroDe(id)).toBeUndefined();
  });

  it('una sesión borrada no se puede leer, editar ni volver a borrar', async () => {
    const id = await crearSesion();
    expect((await borrar(id)).status).toBe(204);

    const leida = await auth(request(app).get(`${sessionsUrl()}/${id}`));
    expect(leida.status).toBe(404);

    const editada = await auth(request(app).patch(`${sessionsUrl()}/${id}`)).send({
      observations: 'no debería entrar',
    });
    expect(editada.status).toBe(404);

    expect((await borrar(id)).status).toBe(404);
  });

  it('responde 404 al borrar una sesión inexistente', async () => {
    const res = await borrar(randomUUID());
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Sesión no encontrada' });
  });

  it('deja de contar en las métricas del dashboard', async () => {
    const antes = await auth(request(app).get('/api/dashboard/stats'));
    const totalAntes = antes.body.data.totalSessions as number;

    const id = await crearSesion();
    const conLaSesion = await auth(request(app).get('/api/dashboard/stats'));
    expect(conLaSesion.body.data.totalSessions).toBe(totalAntes + 1);

    expect((await borrar(id)).status).toBe(204);

    const despues = await auth(request(app).get('/api/dashboard/stats'));
    expect(despues.body.data.totalSessions).toBe(totalAntes);
  });
});
