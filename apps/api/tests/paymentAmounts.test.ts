import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { deleteAuditRows, createTestClinic, createTestToken, sleep, type TestClinic } from './helpers';

// Corregir un cobro se expuso en la UI, así que la combinación "descuento
// mayor al monto base" —que dejaba finalAmountCents negativo, un cobro que devuelve
// plata— pasó de teórica a alcanzable con dos clicks (issue #73, A6).
//
// El chequeo del PATCH no puede vivir en Zod: el body es parcial, así que
// mandar solo `discountCents` hay que compararlo contra el monto base GUARDADO,
// que el schema no conoce. Por eso está en el repositorio y estos tests
// atacan las dos direcciones.
describe('cobros: montos coherentes', () => {
  let clinic: TestClinic;
  let user: User;
  let token: string;
  let patient: { id: string };
  let episode: { id: string };

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
    token = await createTestToken(user);
    patient = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, firstName: 'Paciente', lastName: 'Cobros' },
      select: { id: true },
    });
    // Every session treats an episode (#238).
    episode = await prisma.clinicalEpisode.create({
      data: { tenantId: clinic.tenantId, patientId: patient.id },
      select: { id: true },
    });
  });

  afterAll(async () => {
    await sleep(300);
    await deleteAuditRows([clinic.tenantId]);
    await prisma.payment.deleteMany({ where: { tenantId: clinic.tenantId } });
    // A session's blocks (#238) restrict its deletion: they go first.
    await prisma.sessionEpisode.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.session.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.clinicalEpisode.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await clinic.cleanup();
  });

  /** Crea una sesión con su cobro y devuelve el cobro. */
  async function crearCobro(baseAmountCents: number, discountCents = 0) {
    const sesion = await auth(
      request(app).post(`/api/patients/${patient.id}/sessions`),
    ).send({
      sessionDate: new Date().toISOString(),
      episodes: [{ episodeId: episode.id }],
      payment: { baseAmountCents, discountCents },
    });
    expect(sesion.status).toBe(201);

    const cobros = await auth(request(app).get(`/api/payments?patientId=${patient.id}`));
    return cobros.body.data.find(
      (p: { sessionId: string }) => p.sessionId === sesion.body.data.id,
    );
  }

  // Amounts travel in integer cents: a fraction of a cent is a client that
  // still sends pesos, and is refused instead of rounded.
  it('refuses an amount that is not a whole number of cents', async () => {
    const sesion = await auth(
      request(app).post(`/api/patients/${patient.id}/sessions`),
    ).send({
      sessionDate: new Date().toISOString(),
      episodes: [{ episodeId: episode.id }],
      payment: { baseAmountCents: 1234.5 },
    });

    expect(sesion.status).toBe(400);
  });

  it('keeps the amounts exact: base minus discount, in cents', async () => {
    const cobro = await crearCobro(123_456, 10);

    expect(cobro).toMatchObject({ baseAmountCents: 123_456, discountCents: 10, finalAmountCents: 123_446 });
  });

  it('rechaza al crear un cobro con descuento mayor al monto base', async () => {
    const sesion = await auth(
      request(app).post(`/api/patients/${patient.id}/sessions`),
    ).send({
      sessionDate: new Date().toISOString(),
      episodes: [{ episodeId: episode.id }],
      payment: { baseAmountCents: 10000, discountCents: 15000 },
    });

    expect(sesion.status).toBe(400);
  });

  it('rechaza subir el descuento por encima del monto base guardado', async () => {
    const cobro = await crearCobro(10000, 1000);

    // Solo el descuento: Zod no puede validar esto, el monto base está en la DB.
    const res = await auth(request(app).patch(`/api/payments/${cobro.id}`)).send({
      discountCents: 12000,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/descuento/i);

    // Y no cambió nada.
    const fila = await prisma.payment.findUnique({ where: { id: cobro.id } });
    expect(Number(fila?.discountCents)).toBe(1000);
    expect(Number(fila?.finalAmountCents)).toBe(9000);
  });

  it('rechaza bajar el monto base por debajo del descuento guardado', async () => {
    const cobro = await crearCobro(20000, 8000);

    const res = await auth(request(app).patch(`/api/payments/${cobro.id}`)).send({
      baseAmountCents: 5000,
    });

    expect(res.status).toBe(400);
    const fila = await prisma.payment.findUnique({ where: { id: cobro.id } });
    expect(Number(fila?.baseAmountCents)).toBe(20000);
  });

  it('acepta un descuento igual al monto base (cobro en cero)', async () => {
    const cobro = await crearCobro(7000);

    const res = await auth(request(app).patch(`/api/payments/${cobro.id}`)).send({
      discountCents: 7000,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.finalAmountCents).toBe(0);
  });

  it('una corrección válida recalcula el total', async () => {
    const cobro = await crearCobro(10000, 0);

    const res = await auth(request(app).patch(`/api/payments/${cobro.id}`)).send({
      baseAmountCents: 18000,
      discountCents: 3000,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.finalAmountCents).toBe(15000);
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

  // The fix for #238's review: leaving PAID with only the status used to keep
  // the date of a payment that did not come in.
  it('leaving PAID clears method and date even when only the status is sent', async () => {
    const cobro = await crearCobro(12000);
    const patch = (body: object) => auth(request(app).patch(`/api/payments/${cobro.id}`)).send(body);

    expect((await patch({ status: 'PAID', method: 'TRANSFER' })).status).toBe(200);
    const revertido = await patch({ status: 'PENDING' });

    expect(revertido.status).toBe(200);
    expect(revertido.body.data).toMatchObject({ status: 'PENDING', method: null, paidAt: null });
  });

  it('a payment that stays PAID keeps its method and date', async () => {
    const cobro = await crearCobro(12000);
    const patch = (body: object) => auth(request(app).patch(`/api/payments/${cobro.id}`)).send(body);

    const pagado = await patch({ status: 'PAID', method: 'CASH' });
    const editado = await patch({ notes: 'Pagó en dos veces' });

    expect(editado.status).toBe(200);
    expect(editado.body.data).toMatchObject({ status: 'PAID', method: 'CASH', paidAt: pagado.body.data.paidAt });
  });

  it('refuses a PAID payment without its method or its date, and a method on one that is not PAID', async () => {
    const cobro = await crearCobro(12000);
    const patch = (body: object) => auth(request(app).patch(`/api/payments/${cobro.id}`)).send(body);

    expect((await patch({ status: 'PAID' })).status).toBe(400);
    expect((await patch({ status: 'PAID', method: 'CASH', paidAt: null })).status).toBe(400);
    expect((await patch({ method: 'CASH' })).status).toBe(400);
    expect((await patch({ paidAt: new Date().toISOString() })).status).toBe(400);
  });
});
