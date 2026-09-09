import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, signTestToken, type TestClinic } from './helpers';

// Los filtros de la query venían casteados (`req.query.status as PaymentStatus`)
// en vez de validados. Un valor inválido llegaba crudo al where de Prisma, que
// lo rechazaba con un error de validación que el error handler no conoce: 500
// en vez de 400 (issue #75).
//
// Un query param viene del cliente igual que el body, así que merece el mismo
// trato: se valida con Zod y un valor imposible es un 400 con detalle.
describe('filtros de query validados', () => {
  let clinic: TestClinic;
  let user: User;
  let token: string;

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
    token = signTestToken(user);
  });

  afterAll(async () => {
    await clinic.cleanup();
  });

  it('un estado de cobro inválido da 400 y no 500', async () => {
    const res = await auth(request(app).get('/api/payments?status=BASURA'));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Datos inválidos');
    expect(res.body.details.status).toBeDefined();
  });

  it('un tipo de alerta inválido da 400', async () => {
    const res = await auth(request(app).get('/api/alerts?type=NO_EXISTE'));
    expect(res.status).toBe(400);
  });

  // Un booleano de query llega como texto. Antes cualquier cosa que no fuera
  // "true" o "false" se trataba como "sin filtro", en silencio.
  it('un isRead que no es true ni false da 400', async () => {
    expect((await auth(request(app).get('/api/alerts?isRead=1'))).status).toBe(400);
    expect((await auth(request(app).get('/api/alerts?isRead=si'))).status).toBe(400);
  });

  it('los filtros válidos siguen funcionando', async () => {
    for (const url of [
      '/api/payments?status=PENDING',
      '/api/payments',
      '/api/alerts?type=FOLLOW_UP',
      '/api/alerts?isRead=false',
      '/api/alerts',
      '/api/packages',
    ]) {
      const res = await auth(request(app).get(url));
      expect(res.status, url).toBe(200);
    }
  });

  it('un filtro vacío se rechaza en vez de buscar por cadena vacía', async () => {
    const res = await auth(request(app).get('/api/payments?patientId='));
    expect(res.status).toBe(400);
  });

  it('el filtro por episodio de las sesiones también se valida', async () => {
    const patient = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName: 'Paciente Filtros' },
      select: { id: true },
    });

    const ok = await auth(
      request(app).get(`/api/patients/${patient.id}/sessions`),
    );
    expect(ok.status).toBe(200);

    const vacio = await auth(
      request(app).get(`/api/patients/${patient.id}/sessions?episodeId=`),
    );
    expect(vacio.status).toBe(400);

    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
  });
});
