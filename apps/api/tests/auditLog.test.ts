import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, signTestToken, sleep, waitFor, type TestClinic } from './helpers';

// El historial de una ficha: quién tocó qué y cuándo. Es la única parte de la
// app que nadie puede editar ni borrar desde la UI, así que lo que importa es
// que no mienta — ni de más (filas de otra clínica o de otro paciente) ni de
// menos (una escritura que no dejó rastro).
//
// Los tests de cada ruta ya verifican que su escritura audita; acá va la
// lectura, que no tenía ninguno.
describe('historial de auditoría de un paciente', () => {
  let clinic: TestClinic;
  let user: User;
  let token: string;
  let patient: { id: string };

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const url = (patientId: string) => `/api/patients/${patientId}/audit-log`;

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser({ role: 'ADMIN' });
    token = signTestToken(user);
    patient = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName: 'Paciente Auditado' },
      select: { id: true },
    });
  });

  afterAll(async () => {
    await sleep(300);
    await prisma.auditLog.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await clinic.cleanup();
  });

  // Filas escritas a mano: la fecha es el eje de este endpoint y así se
  // controla sin depender de cuándo corrió cada request.
  function entrada(
    patientId: string,
    tenantId: string,
    description: string,
    createdAt: Date,
    userId: string | null = user.id,
  ) {
    return prisma.auditLog.create({
      data: {
        tenantId,
        patientId,
        userId,
        entity: 'PATIENT',
        entityId: patientId,
        action: 'UPDATED',
        description,
        createdAt,
      },
      select: { id: true },
    });
  }

  it('lista el historial del paciente, de lo más nuevo a lo más viejo', async () => {
    const propio = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName: 'Paciente Orden' },
      select: { id: true },
    });
    await entrada(propio.id, clinic.tenantId, 'Primero', new Date('2025-01-01T10:00:00Z'));
    await entrada(propio.id, clinic.tenantId, 'Segundo', new Date('2025-02-01T10:00:00Z'));
    await entrada(propio.id, clinic.tenantId, 'Tercero', new Date('2025-03-01T10:00:00Z'));

    const res = await auth(request(app).get(url(propio.id)));

    expect(res.status).toBe(200);
    expect((res.body.data as { description: string }[]).map((e) => e.description)).toEqual([
      'Tercero',
      'Segundo',
      'Primero',
    ]);
  });

  it('cada entrada dice qué se tocó y quién, y no expone el tenant', async () => {
    const propio = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName: 'Paciente Forma' },
      select: { id: true },
    });
    await entrada(propio.id, clinic.tenantId, 'Datos actualizados', new Date());

    const res = await auth(request(app).get(url(propio.id)));

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      patientId: propio.id,
      userId: user.id,
      entity: 'PATIENT',
      entityId: propio.id,
      action: 'UPDATED',
      description: 'Datos actualizados',
    });
    expect(typeof res.body.data[0].createdAt).toBe('string');
    expect(res.body.data[0]).not.toHaveProperty('tenantId');
  });

  it('no mezcla el historial de otro paciente de la misma clínica', async () => {
    const otro = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName: 'Paciente Vecino' },
      select: { id: true },
    });
    await entrada(patient.id, clinic.tenantId, 'Del paciente mirado', new Date());
    await entrada(otro.id, clinic.tenantId, 'Del vecino', new Date());

    const res = await auth(request(app).get(url(patient.id)));

    const descripciones = (res.body.data as { description: string }[]).map((e) => e.description);
    expect(descripciones).toContain('Del paciente mirado');
    expect(descripciones).not.toContain('Del vecino');
  });

  it('el historial de un paciente de otra clínica se lee vacío', async () => {
    const otra = await createTestClinic();
    try {
      const ajeno = await prisma.patient.create({
        data: { tenantId: otra.tenantId, fullName: 'Paciente Ajeno' },
        select: { id: true },
      });
      await entrada(ajeno.id, otra.tenantId, 'Historia de otra clínica', new Date(), null);

      // Con el id exacto del paciente de la otra clínica: lo que filtra es el
      // guard de tenant, no que el id sea difícil de adivinar.
      const res = await auth(request(app).get(url(ajeno.id)));

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);

      await prisma.auditLog.deleteMany({ where: { tenantId: otra.tenantId } });
      await prisma.patient.deleteMany({ where: { tenantId: otra.tenantId } });
    } finally {
      await otra.cleanup();
    }
  });

  it('un paciente inexistente devuelve una lista vacía, no un 404', async () => {
    // A diferencia de episodios o sesiones, esta ruta no llama a
    // patientRepo.exists: "sin historial" y "no existe" se responden igual.
    const res = await auth(request(app).get(url(randomUUID())));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('borrar un paciente no borra su historial: sigue siendo legible', async () => {
    // Misma línea que #72: el borrado es lógico y el historial es pasado, no
    // trabajo pendiente. Lo que ya pasó se sigue pudiendo auditar.
    const borrado = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName: 'Paciente Borrado' },
      select: { id: true },
    });
    await entrada(borrado.id, clinic.tenantId, 'Ficha creada', new Date());
    await prisma.patient.update({
      where: { id: borrado.id },
      data: { deletedAt: new Date() },
    });

    const res = await auth(request(app).get(url(borrado.id)));

    expect(res.status).toBe(200);
    expect((res.body.data as { description: string }[]).map((e) => e.description)).toContain(
      'Ficha creada',
    );
  });

  it('una escritura real aparece en el historial, con el usuario que la hizo', async () => {
    // El resto del archivo escribe las filas a mano; este test cierra el
    // circuito: crear y editar por HTTP tiene que verse acá.
    const creado = await auth(request(app).post('/api/patients')).send({
      fullName: 'Paciente Recién Creado',
    });
    expect(creado.status).toBe(201);
    const id = creado.body.data.id as string;

    await auth(request(app).patch(`/api/patients/${id}`)).send({ occupation: 'Docente' });

    await waitFor(async () => {
      const res = await auth(request(app).get(url(id)));
      const acciones = (res.body.data as { action: string }[]).map((e) => e.action);
      return acciones.includes('CREATED') && acciones.includes('UPDATED') ? res : null;
    });

    const res = await auth(request(app).get(url(id)));
    expect(res.body.data.every((e: { userId: string }) => e.userId === user.id)).toBe(true);
  });

  it('sin token no se lee el historial', async () => {
    const res = await request(app).get(url(patient.id));

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('No autenticado');
  });
});
