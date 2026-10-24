import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { deleteAuditRows, createTestClinic, createTestToken, sleep, waitFor, type TestClinic } from './helpers';

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
    token = await createTestToken(user);
  });

  afterAll(async () => {
    await sleep(300);
    await deleteAuditRows([clinic.tenantId]);
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await clinic.cleanup();
  });

  async function crearPaciente(body: Record<string, unknown> = {}) {
    const res = await auth(request(app).post('/api/patients')).send({
      firstName: 'Paciente de', lastName: 'Prueba',
      ...body,
    });
    expect(res.status).toBe(201);
    return res.body.data as { id: string; [k: string]: unknown };
  }

  function auditoria(patientId: string, action: 'PATIENT_CREATED' | 'PATIENT_UPDATED' | 'PATIENT_DELETED') {
    return waitFor(() =>
      prisma.auditLog.findFirst({
        where: { tenantId: clinic.tenantId, entity: 'PATIENT', entityId: patientId, action },
        select: { patientId: true, userId: true, params: true },
      }),
    );
  }

  // ── POST ──────────────────────────────────────────────────────────────────

  it('POST crea el paciente con todos sus campos y devuelve el DTO completo', async () => {
    const res = await auth(request(app).post('/api/patients')).send({
      firstName: 'Ana María', lastName: 'Pérez',
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
      firstName: 'Ana María', lastName: 'Pérez',
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
    const paciente = await crearPaciente({ firstName: 'Solo', lastName: 'Nombre' });

    expect(paciente).toMatchObject({
      firstName: 'Solo', lastName: 'Nombre',
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

  // Given names and surname are both required (#238).
  it('POST rejects a patient without a surname, or without a given name', async () => {
    const sinApellido = await auth(request(app).post('/api/patients')).send({ firstName: 'Ana' });
    expect(sinApellido.status).toBe(400);
    expect(sinApellido.body.error).toBe('Datos inválidos');
    expect(sinApellido.body.details.lastName).toBeDefined();

    const sinNombre = await auth(request(app).post('/api/patients')).send({ firstName: '  ', lastName: 'García' });
    expect(sinNombre.status).toBe(400);
    expect(sinNombre.body.details.firstName).toContain('El nombre es obligatorio');
  });

  it('POST rechaza un sexo fuera del enum y una fecha ilegible', async () => {
    const sexo = await auth(request(app).post('/api/patients')).send({
      firstName: 'Sexo', lastName: 'Inválido',
      sex: 'X',
    });
    expect(sexo.status).toBe(400);
    expect(sexo.body.details.sex).toBeDefined();

    const fecha = await auth(request(app).post('/api/patients')).send({
      firstName: 'Fecha', lastName: 'Inválida',
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
    const creado = await crearPaciente({ firstName: 'Leído', lastName: 'Después', birthDate: '2000-01-01' });

    const res = await auth(request(app).get(`/api/patients/${creado.id}`));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(creado);
  });

  it('GET /:id de un id que no existe da 404', async () => {
    const res = await auth(request(app).get(`/api/patients/${randomUUID()}`));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Paciente no encontrado' });
  });

  // As the clinic looks patients up (#238): by surname, then given names.
  it('GET / lists by surname, then by given names', async () => {
    const zeta = await crearPaciente({ firstName: 'Ana', lastName: 'Zzorden' });
    const alfaBeatriz = await crearPaciente({ firstName: 'Beatriz', lastName: 'Aaorden' });
    const alfaAna = await crearPaciente({ firstName: 'Ana', lastName: 'Aaorden' });

    const res = await auth(request(app).get('/api/patients'));

    expect(res.status).toBe(200);
    const ids = res.body.data.map((p: { id: string }) => p.id);
    const positions = [alfaAna.id, alfaBeatriz.id, zeta.id].map((id) => ids.indexOf(id));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  // ── PATCH ─────────────────────────────────────────────────────────────────

  it('PATCH cambia solo los campos que manda y conserva el resto', async () => {
    const creado = await crearPaciente({
      firstName: 'Antes del', lastName: 'PATCH',
      phone: '111',
      occupation: 'Original',
    });

    const res = await auth(request(app).patch(`/api/patients/${creado.id}`)).send({
      phone: '222',
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: creado.id,
      firstName: 'Antes del', lastName: 'PATCH',
      phone: '222',
      occupation: 'Original',
    });
  });

  // El formulario web manda null en los campos que el usuario vació. Si la
  // API los ignorara, no habría forma de borrar un teléfono viejo.
  it('PATCH con null limpia el campo', async () => {
    const creado = await crearPaciente({
      firstName: 'Con', lastName: 'Datos',
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
      firstName: 'Con', lastName: 'Datos',
    });
  });

  it('PATCH con un nombre inválido se rechaza y deja la fila como estaba', async () => {
    const creado = await crearPaciente({ firstName: 'Nombre', lastName: 'Intacto' });

    const res = await auth(request(app).patch(`/api/patients/${creado.id}`)).send({
      lastName: '   ',
    });

    expect(res.status).toBe(400);
    await expect(
      prisma.patient.findUnique({ where: { id: creado.id }, select: { firstName: true, lastName: true } }),
    ).resolves.toEqual({ firstName: 'Nombre', lastName: 'Intacto' });
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
    const creado = await crearPaciente({ firstName: 'A', lastName: 'Eliminar' });

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
    const creado = await crearPaciente({ firstName: 'Auditado', lastName: 'Test' });
    await auth(request(app).patch(`/api/patients/${creado.id}`)).send({ phone: '555' });
    await auth(request(app).delete(`/api/patients/${creado.id}`));

    const [creada, editada, borrada] = await Promise.all([
      auditoria(creado.id, 'PATIENT_CREATED'),
      auditoria(creado.id, 'PATIENT_UPDATED'),
      auditoria(creado.id, 'PATIENT_DELETED'),
    ]);

    // Las tres apuntan al paciente y al usuario del token.
    for (const entrada of [creada, editada, borrada]) {
      expect(entrada).toMatchObject({ patientId: creado.id, userId: user.id });
    }
    expect(borrada.params).toEqual({});
  });

  // ── Autenticación ─────────────────────────────────────────────────────────

  it('sin token, las cinco rutas responden 401 sin tocar nada', async () => {
    const creado = await crearPaciente({ firstName: 'Protegido', lastName: 'Test' });

    const pedidos = [
      request(app).get('/api/patients'),
      request(app).get(`/api/patients/${creado.id}`),
      request(app).post('/api/patients').send({ firstName: 'Intruso', lastName: 'Test' }),
      request(app).patch(`/api/patients/${creado.id}`).send({ firstName: 'Hackeado', lastName: 'Test' }),
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
        select: { firstName: true, lastName: true, deletedAt: true },
      }),
    ).resolves.toEqual({ firstName: 'Protegido', lastName: 'Test', deletedAt: null });
  });
});
