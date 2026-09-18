import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, signTestToken, sleep, waitFor, type TestClinic } from './helpers';

// El CRUD de pacientes por HTTP, camino por camino. patientRepository.test.ts
// fija la política de vigencia (qué se ve y qué no después de un borrado);
// acá se cubre lo que quedaba sin probar: la validación del body, la forma de
// la respuesta, que el PATCH escriba lo que dice y limpie lo que se manda en
// null, la auditoría que deja cada escritura y el 401 sin token.
describe('CRUD de pacientes por HTTP', () => {
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

  function auditoria(patientId: string, action: 'CREATED' | 'UPDATED' | 'DELETED') {
    return waitFor(() =>
      prisma.auditLog.findFirst({
        where: { tenantId: clinic.tenantId, entity: 'PATIENT', entityId: patientId, action },
        select: { patientId: true, userId: true, description: true },
      }),
    );
  }

  // ── POST ──────────────────────────────────────────────────────────────────

  it('POST crea el paciente con todos sus campos y devuelve el DTO completo', async () => {
    const res = await auth(request(app).post('/api/patients')).send({
      fullName: 'Ana María Pérez',
      // El formulario web manda la fecha como YYYY-MM-DD: la API la coerciona
      // a medianoche UTC y la devuelve como ISO. La web la muestra con
      // timeZone: 'UTC' justamente para que no se corra un día.
      birthDate: '1985-11-23',
      sex: 'FEMALE',
      phone: '11-5555-0000',
      occupation: 'Docente',
      referringDoctor: 'Dr. Gómez',
      insuranceName: 'OSDE',
      insuranceNumber: '123456',
      insurancePlan: '210',
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      fullName: 'Ana María Pérez',
      birthDate: '1985-11-23T00:00:00.000Z',
      sex: 'FEMALE',
      phone: '11-5555-0000',
      occupation: 'Docente',
      referringDoctor: 'Dr. Gómez',
      insuranceName: 'OSDE',
      insuranceNumber: '123456',
      insurancePlan: '210',
    });
    expect(typeof res.body.data.id).toBe('string');
    expect(typeof res.body.data.createdAt).toBe('string');
    expect(res.body.data).not.toHaveProperty('tenantId');
    expect(res.body.data).not.toHaveProperty('deletedAt');

    // El tenant sale del token, no del body.
    await expect(
      prisma.patient.findUnique({
        where: { id: res.body.data.id },
        select: { tenantId: true, deletedAt: true },
      }),
    ).resolves.toEqual({ tenantId: clinic.tenantId, deletedAt: null });
  });

  it('POST con solo el nombre deja el resto en null', async () => {
    const paciente = await crearPaciente({ fullName: 'Solo Nombre' });

    expect(paciente).toMatchObject({
      fullName: 'Solo Nombre',
      birthDate: null,
      sex: null,
      phone: null,
      occupation: null,
      referringDoctor: null,
      insuranceName: null,
      insuranceNumber: null,
      insurancePlan: null,
    });
  });

  it('POST rechaza un nombre de menos de dos caracteres', async () => {
    const res = await auth(request(app).post('/api/patients')).send({ fullName: 'A' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Datos inválidos');
    expect(res.body.details.fullName).toContain('El nombre debe tener al menos 2 caracteres');
  });

  it('POST rechaza un sexo fuera del enum y una fecha ilegible', async () => {
    const sexo = await auth(request(app).post('/api/patients')).send({
      fullName: 'Sexo Inválido',
      sex: 'X',
    });
    expect(sexo.status).toBe(400);
    expect(sexo.body.details.sex).toBeDefined();

    const fecha = await auth(request(app).post('/api/patients')).send({
      fullName: 'Fecha Inválida',
      birthDate: 'ayer',
    });
    expect(fecha.status).toBe(400);
    expect(fecha.body.details.birthDate).toBeDefined();
  });

  it('POST sin nombre se rechaza y no deja fila', async () => {
    const antes = await prisma.patient.count({ where: { tenantId: clinic.tenantId } });

    const res = await auth(request(app).post('/api/patients')).send({ phone: '123' });

    expect(res.status).toBe(400);
    await expect(
      prisma.patient.count({ where: { tenantId: clinic.tenantId } }),
    ).resolves.toBe(antes);
  });

  // ── GET ───────────────────────────────────────────────────────────────────

  it('GET /:id devuelve exactamente lo que devolvió el POST', async () => {
    const creado = await crearPaciente({ fullName: 'Leído Después', birthDate: '2000-01-01' });

    const res = await auth(request(app).get(`/api/patients/${creado.id}`));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(creado);
  });

  it('GET /:id de un id que no existe da 404', async () => {
    const res = await auth(request(app).get(`/api/patients/${randomUUID()}`));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Paciente no encontrado' });
  });

  it('GET / lista los recién creados, el más nuevo primero', async () => {
    const primero = await crearPaciente({ fullName: 'Creado Primero' });
    const segundo = await crearPaciente({ fullName: 'Creado Segundo' });

    const res = await auth(request(app).get('/api/patients'));

    expect(res.status).toBe(200);
    const ids = res.body.data.map((p: { id: string }) => p.id);
    expect(ids.indexOf(segundo.id)).toBeLessThan(ids.indexOf(primero.id));
  });

  // ── PATCH ─────────────────────────────────────────────────────────────────

  it('PATCH cambia solo los campos que manda y conserva el resto', async () => {
    const creado = await crearPaciente({
      fullName: 'Antes del PATCH',
      phone: '111',
      occupation: 'Original',
    });

    const res = await auth(request(app).patch(`/api/patients/${creado.id}`)).send({
      phone: '222',
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: creado.id,
      fullName: 'Antes del PATCH',
      phone: '222',
      occupation: 'Original',
    });
  });

  // El formulario web manda null en los campos que el usuario vació. Si la
  // API los ignorara, no habría forma de borrar un teléfono viejo.
  it('PATCH con null limpia el campo', async () => {
    const creado = await crearPaciente({
      fullName: 'Con Datos',
      birthDate: '1990-06-15',
      phone: '333',
      insuranceName: 'Obra Social',
    });

    const res = await auth(request(app).patch(`/api/patients/${creado.id}`)).send({
      birthDate: null,
      phone: null,
      insuranceName: null,
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      birthDate: null,
      phone: null,
      insuranceName: null,
      fullName: 'Con Datos',
    });
  });

  it('PATCH con un nombre inválido se rechaza y deja la fila como estaba', async () => {
    const creado = await crearPaciente({ fullName: 'Nombre Intacto' });

    const res = await auth(request(app).patch(`/api/patients/${creado.id}`)).send({
      fullName: 'A',
    });

    expect(res.status).toBe(400);
    await expect(
      prisma.patient.findUnique({ where: { id: creado.id }, select: { fullName: true } }),
    ).resolves.toEqual({ fullName: 'Nombre Intacto' });
  });

  it('PATCH de un id que no existe da 404', async () => {
    const res = await auth(request(app).patch(`/api/patients/${randomUUID()}`)).send({
      phone: '444',
    });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Paciente no encontrado' });
  });

  // ── DELETE ────────────────────────────────────────────────────────────────

  it('DELETE lo saca de la lista y su ficha pasa a dar 404', async () => {
    const creado = await crearPaciente({ fullName: 'A Eliminar' });

    const res = await auth(request(app).delete(`/api/patients/${creado.id}`));
    expect(res.status).toBe(204);

    const lista = await auth(request(app).get('/api/patients'));
    expect(lista.body.data.map((p: { id: string }) => p.id)).not.toContain(creado.id);

    const ficha = await auth(request(app).get(`/api/patients/${creado.id}`));
    expect(ficha.status).toBe(404);
  });

  it('DELETE de un id que no existe da 404', async () => {
    const res = await auth(request(app).delete(`/api/patients/${randomUUID()}`));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Paciente no encontrado' });
  });

  // ── Auditoría ─────────────────────────────────────────────────────────────

  // Cada escritura deja su entrada. Es fire-and-forget en la ruta, así que se
  // espera con waitFor en vez de asertar de inmediato.
  it('crear, editar y borrar dejan cada uno su entrada de auditoría', async () => {
    const creado = await crearPaciente({ fullName: 'Auditado' });
    await auth(request(app).patch(`/api/patients/${creado.id}`)).send({ phone: '555' });
    await auth(request(app).delete(`/api/patients/${creado.id}`));

    const [creada, editada, borrada] = await Promise.all([
      auditoria(creado.id, 'CREATED'),
      auditoria(creado.id, 'UPDATED'),
      auditoria(creado.id, 'DELETED'),
    ]);

    // Las tres apuntan al paciente y al usuario del token.
    for (const entrada of [creada, editada, borrada]) {
      expect(entrada).toMatchObject({ patientId: creado.id, userId: user.id });
    }
    expect(borrada.description).toMatch(/borrado lógico/i);
  });

  // ── Autenticación ─────────────────────────────────────────────────────────

  it('sin token, las cinco rutas responden 401 sin tocar nada', async () => {
    const creado = await crearPaciente({ fullName: 'Protegido' });

    const pedidos = [
      request(app).get('/api/patients'),
      request(app).get(`/api/patients/${creado.id}`),
      request(app).post('/api/patients').send({ fullName: 'Intruso' }),
      request(app).patch(`/api/patients/${creado.id}`).send({ fullName: 'Hackeado' }),
      request(app).delete(`/api/patients/${creado.id}`),
    ];

    for (const pedido of pedidos) {
      const res = await pedido;
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'No autenticado' });
    }

    await expect(
      prisma.patient.findUnique({
        where: { id: creado.id },
        select: { fullName: true, deletedAt: true },
      }),
    ).resolves.toEqual({ fullName: 'Protegido', deletedAt: null });
  });
});
