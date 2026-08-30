import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { patientRepo } from '../src/repositories';
import type { TenantContext } from '../src/repositories/types';
import { createTestClinic, signTestToken, type TestClinic } from './helpers';

// Política de alertas centralizada en los repos: el chequeo de paciente de
// POST /api/alerts pasa por patientRepo.exists, que además del tenant filtra
// borrados (el findFirst propio que había en la ruta no lo hacía). El caso
// cross-tenant ya está cubierto en tenantIsolation.test.ts.
describe('alertas: vigencia del paciente', () => {
  let clinic: TestClinic;
  let token: string;
  let ctx: TenantContext;

  beforeAll(async () => {
    clinic = await createTestClinic();
    const user = await clinic.createUser();
    token = signTestToken(user);
    ctx = { tenantId: clinic.tenantId, userId: user.id, role: user.role };
  });

  afterAll(async () => {
    await prisma.clinicalAlert.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await clinic.cleanup();
  });

  function postAlert(patientId: string) {
    return request(app)
      .post('/api/alerts')
      .set('Authorization', `Bearer ${token}`)
      .send({ patientId, type: 'CUSTOM', message: 'Alerta de prueba' });
  }

  it('rechaza con 404 la alerta sobre un paciente borrado y no crea la fila', async () => {
    const patient = await patientRepo.create(ctx, { fullName: 'Paciente Borrado' });
    await patientRepo.softDelete(ctx, patient.id);

    const res = await postAlert(patient.id);

    expect(res.status).toBe(404);
    const leaked = await prisma.clinicalAlert.findFirst({
      where: { patientId: patient.id },
    });
    expect(leaked).toBeNull();
  });

  it('responde 404 al marcar como leída una alerta inexistente', async () => {
    // Antes markAsRead tiraba un Error genérico y esto era un 500.
    const res = await request(app)
      .patch(`/api/alerts/${randomUUID()}/read`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Alerta no encontrada' });
  });

  // Las alertas son trabajo pendiente, no historial: a diferencia de cobros y
  // sesiones (que conservan el nombre del paciente borrado a propósito, issue
  // #72), una alerta sobre un paciente eliminado pide una acción imposible.
  it('las alertas de un paciente borrado desaparecen de la lista y del contador', async () => {
    const patient = await patientRepo.create(ctx, { fullName: 'Paciente A Borrar' });
    const created = await postAlert(patient.id);
    expect(created.status).toBe(201);
    const alertId = created.body.data.id as string;

    const listar = () =>
      request(app).get('/api/alerts').set('Authorization', `Bearer ${token}`);
    const stats = () =>
      request(app).get('/api/alerts/stats').set('Authorization', `Bearer ${token}`);

    // Antes de borrar: la alerta se ve y suma al badge.
    const antes = await listar();
    expect(antes.body.data.some((a: { id: string }) => a.id === alertId)).toBe(true);
    const statsAntes = await stats();
    const unreadAntes = statsAntes.body.data.unread as number;
    const customAntes = antes.body.data.filter(
      (a: { type: string }) => a.type === 'CUSTOM',
    ).length;

    await patientRepo.softDelete(ctx, patient.id);

    // Después: no aparece ni cuenta, aunque la fila sigue existiendo (el
    // borrado es lógico: se filtra en la lectura, no se destruye la alerta).
    const despues = await listar();
    expect(despues.body.data.some((a: { id: string }) => a.id === alertId)).toBe(false);
    expect(
      despues.body.data.filter((a: { type: string }) => a.type === 'CUSTOM').length,
    ).toBe(customAntes - 1);

    const statsDespues = await stats();
    expect(statsDespues.body.data.unread).toBe(unreadAntes - 1);

    const fila = await prisma.clinicalAlert.findUnique({ where: { id: alertId } });
    expect(fila).not.toBeNull();
  });

  it('marca como leída una alerta del tenant', async () => {
    const patient = await patientRepo.create(ctx, { fullName: 'Paciente Con Alerta' });
    const created = await postAlert(patient.id);
    expect(created.status).toBe(201);

    const res = await request(app)
      .patch(`/api/alerts/${created.body.data.id}/read`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.data.isRead).toBe(true);
    expect(res.body.data.readAt).not.toBeNull();
  });
});
