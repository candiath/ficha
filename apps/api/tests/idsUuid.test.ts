import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import { Prisma } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { errorHandler } from '../src/middlewares/errorHandler';
import {
  createTestClinic,
  createTestOperator,
  createTestToken,
  sleep,
  type TestClinic,
  type TestOperator,
} from './helpers';

// Las columnas de ids son `uuid` nativo (issue #174). Contra ellas, un id con
// otra forma no es "no encontrado": Prisma tira P2023. Estos tests fijan lo
// que la API hace en su lugar:
//   - en la URL, 404 con el mismo mensaje que un id válido que no existe;
//   - en el body, 400: el cliente mandó un dato inválido;
//   - un id con forma válida que no existe sigue siendo 404 en los dos lados.
const MALFORMADO = 'dev-patient-001';

describe('ids UUID', () => {
  let clinic: TestClinic;
  let admin: User;
  let token: string;
  let patientId: string;
  let operator: TestOperator;

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    clinic = await createTestClinic();
    admin = await clinic.createUser({ role: 'ADMIN' });
    token = await createTestToken(admin);
    operator = await createTestOperator();

    const res = await auth(request(app).post('/api/patients')).send({ fullName: 'Paciente UUID' });
    patientId = res.body.data.id;
  });

  afterAll(async () => {
    await sleep(400);
    await prisma.appointment.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.auditLog.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await operator.cleanup();
    await clinic.cleanup();
  });

  it('los ids que genera la API son UUIDv7', () => {
    // El 13er dígito hexadecimal es la versión.
    expect(patientId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  describe('en la URL: 404 con el mensaje de la entidad', () => {
    // Uno por cada forma de registrar la validación: param del path de
    // montaje (app.param), param del router hijo (router.param), y la capa
    // del operador, que vive en otro router.
    it.each([
      ['GET', `/api/patients/${MALFORMADO}`, 'Paciente no encontrado'],
      ['PATCH', `/api/patients/${MALFORMADO}`, 'Paciente no encontrado'],
      ['DELETE', `/api/patients/${MALFORMADO}`, 'Paciente no encontrado'],
      ['GET', `/api/patients/${MALFORMADO}/episodes`, 'Paciente no encontrado'],
      ['GET', `/api/patients/${MALFORMADO}/audit-log`, 'Paciente no encontrado'],
      ['PATCH', `/api/appointments/${MALFORMADO}`, 'Turno no encontrado'],
      ['DELETE', `/api/packages/${MALFORMADO}`, 'Paquete no encontrado'],
      ['PATCH', `/api/payments/${MALFORMADO}`, 'Pago no encontrado'],
      ['PATCH', `/api/alerts/${MALFORMADO}/read`, 'Alerta no encontrada'],
      ['PATCH', `/api/users/${MALFORMADO}`, 'Usuario no encontrado'],
    ])('%s %s', async (method, path, error) => {
      const res = await auth(request(app)[method.toLowerCase() as 'get'](path)).send({});
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error });
    });

    it('params anidados: el del router hijo y el del montaje', async () => {
      const sesion = await auth(request(app).get(`/api/patients/${patientId}/sessions/${MALFORMADO}`));
      expect(sesion.status).toBe(404);
      expect(sesion.body).toEqual({ error: 'Sesión no encontrada' });

      const evaluacion = await auth(
        request(app).get(`/api/patients/${patientId}/episodes/${MALFORMADO}/evaluation`),
      );
      expect(evaluacion.status).toBe(404);
      expect(evaluacion.body).toEqual({ error: 'Episodio no encontrado' });

      const escala = await auth(request(app).get(`/api/patients/${patientId}/scales/${MALFORMADO}`));
      expect(escala.status).toBe(404);
      expect(escala.body).toEqual({ error: 'Escala no encontrada' });
    });

    it('rutas del operador de plataforma', async () => {
      const opAuth = (r: request.Test) => r.set('Authorization', `Bearer ${operator.token}`);

      const tenant = await opAuth(request(app).get(`/api/platform/tenants/${MALFORMADO}/users`));
      expect(tenant.status).toBe(404);
      expect(tenant.body).toEqual({ error: 'Clínica no encontrada' });

      const user = await opAuth(
        request(app).patch(`/api/platform/tenants/${clinic.tenantId}/users/${MALFORMADO}`),
      ).send({ isActive: false });
      expect(user.status).toBe(404);
      expect(user.body).toEqual({ error: 'Usuario no encontrado' });
    });

    it('un UUID válido que no existe da el mismo 404', async () => {
      const res = await auth(request(app).get(`/api/patients/${randomUUID()}`));
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Paciente no encontrado' });
    });

    // La validación corre después de authenticate: sin token, la respuesta
    // no revela nada sobre el id.
    it('sin token sigue siendo 401', async () => {
      const res = await request(app).get(`/api/patients/${MALFORMADO}`);
      expect(res.status).toBe(401);
    });
  });

  describe('en el body: 400', () => {
    const turno = { date: '2026-10-05', time: '09:00', durationMinutes: 60 };

    it('un id malformado es un dato inválido', async () => {
      const res = await auth(request(app).post('/api/appointments')).send({
        ...turno,
        patientId: MALFORMADO,
      });
      expect(res.status).toBe(400);
      expect(res.body.details.patientId).toBeDefined();
    });

    it('un id opcional malformado también', async () => {
      const res = await auth(request(app).post('/api/appointments')).send({
        ...turno,
        patientId,
        episodeId: MALFORMADO,
      });
      expect(res.status).toBe(400);
      expect(res.body.details.episodeId).toBeDefined();
    });

    it('un id opcional vacío sigue siendo "ninguno"', async () => {
      const res = await auth(request(app).post('/api/appointments')).send({
        ...turno,
        patientId,
        episodeId: '  ',
      });
      expect(res.status).toBe(201);
      expect(res.body.data[0].episodeId).toBeNull();
    });

    it('un UUID válido que no existe sigue siendo 404', async () => {
      const res = await auth(request(app).post('/api/appointments')).send({
        ...turno,
        patientId: randomUUID(),
      });
      expect(res.status).toBe(404);
    });

    it('en el query string, también 400', async () => {
      const res = await auth(request(app).get(`/api/payments?patientId=${MALFORMADO}`));
      expect(res.status).toBe(400);
    });
  });

  // Un token emitido con un id del seed viejo (antes de #174) está bien
  // firmado pero su `sub` no puede estar en la base. Tiene que ser 401 —la
  // web desloguea con eso— y no un error de la consulta.
  it('un token con sub que no es UUID es una sesión inválida', async () => {
    const viejo = await createTestToken({ id: 'dev-user-001', tenantId: clinic.tenantId });
    const res = await request(app).get('/api/patients').set('Authorization', `Bearer ${viejo}`);
    expect(res.status).toBe(401);
  });

  // La red de seguridad: si algún camino sin validar llega a la base con un
  // id malformado, el errorHandler responde 404 en vez de 500.
  it('errorHandler: P2023 es 404, no 500', () => {
    const err = new Prisma.PrismaClientKnownRequestError('Inconsistent column data', {
      code: 'P2023',
      clientVersion: Prisma.prismaVersion.client,
    });
    let status = 0;
    let body: unknown;
    const res = {
      status(s: number) {
        status = s;
        return this;
      },
      json(b: unknown) {
        body = b;
      },
    };
    const original = console.error;
    console.error = () => {};
    try {
      errorHandler(err, {} as never, res as never, () => {});
    } finally {
      console.error = original;
    }
    expect(status).toBe(404);
    expect(body).toEqual({ error: 'No encontrado' });
  });
});
