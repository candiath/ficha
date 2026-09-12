import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { settle } from '../src/lib/paymentSettlement';
import { createTestClinic, signTestToken, sleep, type TestClinic } from './helpers';

// Un cobro de monto cero no es una deuda: si el descuento cancela el costo
// entero, o la sesión se dio sin cargo, no hay nada que cobrar. Dejarlo en
// PENDING hacía que la app registrara una deuda inexistente, y a los 14 días
// el motor de alertas pedía reclamar $0.
//
// El estado es WAIVED y no PAID: marcarlo pagado obligaría a inventar un
// paidAt y un method — un movimiento de caja que nunca ocurrió — y además
// dejaría la sesión indeleble, porque softDelete solo borra el cobro si no
// está pagado.

describe('settle(): monto y estado se deciden juntos', () => {
  it('un cobro con monto nace pendiente', () => {
    expect(settle(5000, 0)).toEqual({ finalAmount: 5000, status: 'PENDING' });
  });

  it('un cobro sin cargo desde el vamos nace eximido', () => {
    expect(settle(0, 0)).toEqual({ finalAmount: 0, status: 'WAIVED' });
  });

  it('un descuento que cancela el costo entero exime', () => {
    expect(settle(5000, 5000)).toEqual({ finalAmount: 0, status: 'WAIVED' });
  });

  it('un descuento parcial no exime', () => {
    expect(settle(5000, 1000)).toEqual({ finalAmount: 4000, status: 'PENDING' });
  });

  // La derivación va en una sola dirección. Volver a "hay que cobrar esto" es
  // una decisión comercial, no un hecho aritmético: si fuera simétrica,
  // corregirle el monto a un cobro perdonado a mano lo reabriría solo, y la
  // alerta terminaría reclamándole al paciente una deuda condonada.
  it('un eximido a mano no vuelve a pendiente aunque suba el monto', () => {
    expect(settle(5000, 0, 'WAIVED')).toEqual({ finalAmount: 5000, status: 'WAIVED' });
  });

  it('un cobro ya pagado no se toca nunca', () => {
    expect(settle(5000, 5000, 'PAID')).toEqual({ finalAmount: 0, status: 'PAID' });
  });
});

describe('cobros de monto cero, de punta a punta', () => {
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
      data: { tenantId: clinic.tenantId, fullName: 'Paciente Bonificado' },
      select: { id: true },
    });
  });

  afterAll(async () => {
    await sleep(300);
    await prisma.clinicalAlert.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.auditLog.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.payment.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.session.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await clinic.cleanup();
  });

  /** Crea una sesión con su cobro embebido y devuelve el cobro. */
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

  it('el cobro embebido en el alta de la sesión nace eximido si da cero', async () => {
    const cobro = await crearCobro(5000, 5000);

    expect(cobro.finalAmount).toBe(0);
    expect(cobro.status).toBe('WAIVED');
    // No se inventa un movimiento de caja que no ocurrió.
    expect(cobro.paidAt).toBeNull();
    expect(cobro.method).toBeNull();
  });

  it('una sesión sin cargo desde el vamos también', async () => {
    const cobro = await crearCobro(0, 0);

    expect(cobro.status).toBe('WAIVED');
  });

  it('un cobro con monto sigue naciendo pendiente', async () => {
    const cobro = await crearCobro(5000, 1000);

    expect(cobro.finalAmount).toBe(4000);
    expect(cobro.status).toBe('PENDING');
  });

  it('editar el descuento hasta cancelar el costo exime el cobro', async () => {
    const cobro = await crearCobro(5000);
    expect(cobro.status).toBe('PENDING');

    const res = await auth(request(app).patch(`/api/payments/${cobro.id}`)).send({
      discount: 5000,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.finalAmount).toBe(0);
    expect(res.body.data.status).toBe('WAIVED');
  });

  it('subirle el monto a un cobro eximido no lo reabre', async () => {
    const cobro = await crearCobro(5000, 5000);
    expect(cobro.status).toBe('WAIVED');

    const res = await auth(request(app).patch(`/api/payments/${cobro.id}`)).send({
      discount: 0,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.finalAmount).toBe(5000);
    expect(res.body.data.status).toBe('WAIVED');
  });

  // La derivación es un default, no una imposición: quien manda un status
  // explícito está diciendo qué quiere.
  it('un status explícito en el body gana sobre lo derivado', async () => {
    const cobro = await crearCobro(5000);

    const res = await auth(request(app).patch(`/api/payments/${cobro.id}`)).send({
      discount: 5000,
      status: 'PENDING',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.finalAmount).toBe(0);
    expect(res.body.data.status).toBe('PENDING');
  });

  // El filtro de la alerta es un arreglo aparte del estado derivado: cubre las
  // filas anteriores a este cambio y las que alguien vuelva a PENDING a mano,
  // que es exactamente lo que se construye acá.
  describe('la alerta de cobros vencidos ignora los montos en cero', () => {
    async function cobroPendienteViejo(patientId: string, monto: number) {
      const hace20Dias = new Date();
      hace20Dias.setDate(hace20Dias.getDate() - 20);

      const sesion = await prisma.session.create({
        data: { tenantId: clinic.tenantId, patientId, userId: user.id, sessionDate: hace20Dias },
        select: { id: true },
      });
      await prisma.payment.create({
        data: {
          tenantId: clinic.tenantId,
          patientId,
          sessionId: sesion.id,
          baseAmount: monto,
          discount: 0,
          finalAmount: monto,
          status: 'PENDING',
        },
      });
    }

    async function correrMotor() {
      await prisma.tenant.update({
        where: { id: clinic.tenantId },
        data: { alertsRefreshedAt: null },
      });
      await auth(request(app).get('/api/alerts'));
    }

    it('no alerta por un pendiente de $0', async () => {
      const paciente = await prisma.patient.create({
        data: { tenantId: clinic.tenantId, fullName: 'Paciente Sin Deuda' },
        select: { id: true },
      });
      await cobroPendienteViejo(paciente.id, 0);

      await correrMotor();

      const alertas = await prisma.clinicalAlert.findMany({
        where: { tenantId: clinic.tenantId, patientId: paciente.id, type: 'PAYMENT' },
      });
      expect(alertas).toHaveLength(0);
    });

    it('no cuenta el de $0 al agrupar con una deuda real', async () => {
      const paciente = await prisma.patient.create({
        data: { tenantId: clinic.tenantId, fullName: 'Paciente Con Una Deuda' },
        select: { id: true },
      });
      await cobroPendienteViejo(paciente.id, 0);
      await cobroPendienteViejo(paciente.id, 5000);

      await correrMotor();

      const alertas = await prisma.clinicalAlert.findMany({
        where: { tenantId: clinic.tenantId, patientId: paciente.id, type: 'PAYMENT' },
      });
      expect(alertas).toHaveLength(1);
      // Singular: una sola sesión adeuda. Antes decía "2 sesiones sin cobrar
      // por $5.000", donde el número no cerraba con el total.
      expect(alertas[0].message).toMatch(/^Sesión sin cobrar/);
      expect(alertas[0].message).not.toMatch(/2 sesiones/);
    });
  });
});
