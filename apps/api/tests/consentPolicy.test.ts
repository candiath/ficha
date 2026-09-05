import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { patientRepo } from '../src/repositories';
import type { TenantContext } from '../src/repositories/types';
import { createTestClinic, signTestToken, type TestClinic } from './helpers';

// Consentimiento era la única ruta bajo /api/patients/:patientId que no
// pasaba por patientRepo.exists(). El patientId de la URL entraba directo a
// la query, con tres consecuencias distintas — un 500 por FK, la firma sobre
// un paciente borrado, y un bloqueo permanente cross-tenant por el @unique
// de patientId. Los tres se cierran con el mismo chequeo, y este archivo
// fija los tres para que no vuelva a abrirse.
describe('consentimiento: vigencia y pertenencia del paciente', () => {
  let clinic: TestClinic;
  let otherClinic: TestClinic;
  let token: string;
  let otherToken: string;
  let ctx: TenantContext;
  let otherCtx: TenantContext;

  beforeAll(async () => {
    clinic = await createTestClinic();
    otherClinic = await createTestClinic();

    const user = await clinic.createUser();
    const otherUser = await otherClinic.createUser();

    token = signTestToken(user);
    otherToken = signTestToken(otherUser);
    ctx = { tenantId: clinic.tenantId, userId: user.id, role: user.role };
    otherCtx = {
      tenantId: otherClinic.tenantId,
      userId: otherUser.id,
      role: otherUser.role,
    };
  });

  afterAll(async () => {
    for (const c of [clinic, otherClinic]) {
      await prisma.informedConsent.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.auditLog.deleteMany({ where: { tenantId: c.tenantId } });
      await prisma.patient.deleteMany({ where: { tenantId: c.tenantId } });
      await c.cleanup();
    }
  });

  function sign(patientId: string, as = token) {
    return request(app)
      .post(`/api/patients/${patientId}/consent`)
      .set('Authorization', `Bearer ${as}`)
      .send();
  }

  function revoke(patientId: string, as = token) {
    return request(app)
      .delete(`/api/patients/${patientId}/consent`)
      .set('Authorization', `Bearer ${as}`)
      .send();
  }

  it('responde 404 (no 500) al firmar sobre un paciente inexistente', async () => {
    const missingId = randomUUID();

    const res = await sign(missingId);

    // Antes: el create violaba la FK con P2003, que el error handler no
    // conoce, y salía un 500 genérico.
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Paciente no encontrado' });

    const leaked = await prisma.informedConsent.findFirst({
      where: { patientId: missingId },
    });
    expect(leaked).toBeNull();
  });

  it('rechaza firmar sobre un paciente borrado y no crea la fila', async () => {
    const patient = await patientRepo.create(ctx, { fullName: 'Paciente Borrado' });
    await patientRepo.softDelete(ctx, patient.id);

    const res = await sign(patient.id);

    expect(res.status).toBe(404);
    const leaked = await prisma.informedConsent.findFirst({
      where: { patientId: patient.id },
    });
    expect(leaked).toBeNull();
  });

  it('no deja firmar el consentimiento de un paciente de otra clínica', async () => {
    const ajeno = await patientRepo.create(otherCtx, { fullName: 'Paciente Ajeno' });

    const intruso = await sign(ajeno.id);
    expect(intruso.status).toBe(404);

    // Lo que se protege no es solo la lectura: patientId es @unique global en
    // InformedConsent, así que una fila creada por la clínica equivocada le
    // bloqueaba la firma al dueño real (su upsert no matcheaba por tenantId,
    // y el create posterior chocaba contra el unique → 500 para siempre).
    const duenio = await sign(ajeno.id, otherToken);
    expect(duenio.status).toBe(201);
    expect(duenio.body.data.signed).toBe(true);
  });

  it('responde 404 al revocar un consentimiento que no existe', async () => {
    const patient = await patientRepo.create(ctx, { fullName: 'Nunca Firmó' });

    // Antes: el update sin fila tiraba P2025 y terminaba en 500.
    const res = await revoke(patient.id);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Consentimiento no encontrado' });
  });

  it('el camino feliz sigue intacto: firmar, leer y revocar', async () => {
    const patient = await patientRepo.create(ctx, { fullName: 'Paciente Vigente' });

    const firmado = await sign(patient.id);
    expect(firmado.status).toBe(201);
    expect(firmado.body.data.signed).toBe(true);

    const leido = await request(app)
      .get(`/api/patients/${patient.id}/consent`)
      .set('Authorization', `Bearer ${token}`);
    expect(leido.status).toBe(200);
    expect(leido.body.data.signed).toBe(true);

    const revocado = await revoke(patient.id);
    expect(revocado.status).toBe(200);
    expect(revocado.body.data.signed).toBe(false);
    expect(revocado.body.data.revokedAt).not.toBeNull();
  });

  it('el GET de un paciente inexistente da 404 en vez de un consentimiento nulo', async () => {
    const res = await request(app)
      .get(`/api/patients/${randomUUID()}/consent`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});
