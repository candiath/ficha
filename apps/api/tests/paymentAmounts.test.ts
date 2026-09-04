import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, signTestToken, sleep, type TestClinic } from './helpers';

// Corregir un cobro se expuso en la UI, así que la combinación "descuento
// mayor al monto base" —que dejaba finalAmount negativo, un cobro que devuelve
// plata— pasó de teórica a alcanzable con dos clicks (issue #73, A6).
//
// El chequeo del PATCH no puede vivir en Zod: el body es parcial, así que
// mandar solo `discount` hay que compararlo contra el monto base GUARDADO,
// que el schema no conoce. Por eso está en el repositorio y estos tests
// atacan las dos direcciones.
describe('cobros: montos coherentes', () => {
  let clinic: TestClinic;
  let user: User;
  let token: string;
  let patient: { id: string };

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
    token = signTestToken(user);
    patient = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName: 'Paciente Cobros' },
      select: { id: true },
    });
  });

  afterAll(async () => {
    await sleep(300);
    await prisma.auditLog.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.payment.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.session.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await clinic.cleanup();
  });

  /** Crea una sesión con su cobro y devuelve el cobro. */
  async function crearCobro(baseAmount: number, discount = 0) {
    const sesion = await auth(
      request(app).post(`/api/patients/${patient.id}/sessions`),
    ).send({
      sessionDate: new Date().toISOString(),
      payment: { baseAmount, discount },
    });
    expect(sesion.status).toBe(201);

    const cobros = await auth(request(app).get(`/api/payments?patientId=${patient.id}`));
    return cobros.body.data.find(
      (p: { sessionId: string }) => p.sessionId === sesion.body.data.id,
    );
  }

  it('rechaza al crear un cobro con descuento mayor al monto base', async () => {
    const sesion = await auth(
      request(app).post(`/api/patients/${patient.id}/sessions`),
    ).send({
      sessionDate: new Date().toISOString(),
      payment: { baseAmount: 10000, discount: 15000 },
    });

    expect(sesion.status).toBe(400);
  });

  it('rechaza subir el descuento por encima del monto base guardado', async () => {
    const cobro = await crearCobro(10000, 1000);

    // Solo el descuento: Zod no puede validar esto, el monto base está en la DB.
    const res = await auth(request(app).patch(`/api/payments/${cobro.id}`)).send({
      discount: 12000,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/descuento/i);

    // Y no cambió nada.
    const fila = await prisma.payment.findUnique({ where: { id: cobro.id } });
    expect(Number(fila?.discount)).toBe(1000);
    expect(Number(fila?.finalAmount)).toBe(9000);
  });

  it('rechaza bajar el monto base por debajo del descuento guardado', async () => {
    const cobro = await crearCobro(20000, 8000);

    const res = await auth(request(app).patch(`/api/payments/${cobro.id}`)).send({
      baseAmount: 5000,
    });

    expect(res.status).toBe(400);
    const fila = await prisma.payment.findUnique({ where: { id: cobro.id } });
    expect(Number(fila?.baseAmount)).toBe(20000);
  });

  it('acepta un descuento igual al monto base (cobro en cero)', async () => {
    const cobro = await crearCobro(7000);

    const res = await auth(request(app).patch(`/api/payments/${cobro.id}`)).send({
      discount: 7000,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.finalAmount).toBe(0);
  });

  it('una corrección válida recalcula el total', async () => {
    const cobro = await crearCobro(10000, 0);

    const res = await auth(request(app).patch(`/api/payments/${cobro.id}`)).send({
      baseAmount: 18000,
      discount: 3000,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.finalAmount).toBe(15000);
  });

  it('revertir un cobro marcado por error limpia método y fecha de cobro', async () => {
    const cobro = await crearCobro(12000);

    const pagado = await auth(request(app).patch(`/api/payments/${cobro.id}`)).send({
      status: 'PAID',
      method: 'CASH',
    });
    expect(pagado.status).toBe(200);
    expect(pagado.body.data.paidAt).not.toBeNull();

    // Lo que manda la UI al sacar el cobro de PAGADO.
    const revertido = await auth(request(app).patch(`/api/payments/${cobro.id}`)).send({
      status: 'PENDING',
      method: null,
      paidAt: null,
    });

    expect(revertido.status).toBe(200);
    expect(revertido.body.data.status).toBe('PENDING');
    expect(revertido.body.data.method).toBeNull();
    expect(revertido.body.data.paidAt).toBeNull();
  });
});
