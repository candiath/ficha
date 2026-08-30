import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { patientRepo } from '../src/repositories';
import type { TenantContext } from '../src/repositories/types';
import { createTestClinic, signTestToken, sleep, type TestClinic } from './helpers';

// La política de vigencia llega a las escalas: cada handler exige paciente
// vigente vía patientRepo.exists (antes esta ruta no validaba el paciente en
// absoluto). Además el detalle deja de exponer tenantId: antes devolvía la
// fila cruda entera.
describe('escalas funcionales: vigencia del paciente y contrato', () => {
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
    // El audit del POST es fire-and-forget: darle un instante a aterrizar.
    await sleep(300);
    await prisma.auditLog.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.functionalScale.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await clinic.cleanup();
  });

  const responses = { q1: 3, q2: 2, q3: 4, q4: 1, q5: 0 };

  it('responde 404 para un paciente borrado', async () => {
    const patient = await patientRepo.create(ctx, { fullName: 'Paciente Sin Escalas' });
    await patientRepo.softDelete(ctx, patient.id);

    const list = await request(app)
      .get(`/api/patients/${patient.id}/scales`)
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(404);

    const post = await request(app)
      .post(`/api/patients/${patient.id}/scales`)
      .set('Authorization', `Bearer ${token}`)
      .send({ scaleType: 'OSWESTRY', responses });
    expect(post.status).toBe(404);
  });

  it('crea la escala y el detalle no expone tenantId', async () => {
    const patient = await patientRepo.create(ctx, { fullName: 'Paciente Con Escala' });

    const post = await request(app)
      .post(`/api/patients/${patient.id}/scales`)
      .set('Authorization', `Bearer ${token}`)
      .send({ scaleType: 'OSWESTRY', responses });

    expect(post.status).toBe(201);
    // 3+2+4+1+0 = 10 sobre 25 posibles → 40%
    expect(post.body.data.score).toBe(40);
    expect(post.body.data).not.toHaveProperty('tenantId');

    const detail = await request(app)
      .get(`/api/patients/${patient.id}/scales/${post.body.data.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(detail.status).toBe(200);
    expect(detail.body.data).not.toHaveProperty('tenantId');
    expect(detail.body.data.responses).toEqual(responses);
  });
});
