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
});
