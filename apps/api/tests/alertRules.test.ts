import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, signTestToken, sleep, type TestClinic } from './helpers';

// El motor de alertas corre al LEER las alertas, no por un cron: el plan free
// de Render no tiene uno. Antes la única regla que existía vivía en el GET de
// episodios, así que solo se evaluaba al abrir una ficha — el paciente que
// nadie miraba nunca generaba alerta, justo al revés de lo que se quiere.
describe('motor de alertas', () => {
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
    await sleep(300);
    await prisma.clinicalAlert.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.auditLog.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.payment.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.session.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.clinicalEpisode.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await clinic.cleanup();
  });

  /** Permite que el motor vuelva a correr sin esperar el throttle. */
  async function destrabarMotor() {
    await prisma.tenant.update({
      where: { id: clinic.tenantId },
      data: { alertsRefreshedAt: null },
    });
  }

  function haceDias(dias: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - dias);
    return d;
  }

  async function crearPaciente(fullName: string) {
    return prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName },
      select: { id: true },
    });
  }

  /** Un episodio con su última sesión hace `diasAtras`, o sin ninguna. */
  async function crearEpisodio(patientId: string, diasAtras: number | null) {
    const episodio = await prisma.clinicalEpisode.create({
      data: { tenantId: clinic.tenantId, patientId, mainComplaint: 'Lumbalgia' },
      select: { id: true },
    });
    if (diasAtras !== null) {
      await prisma.session.create({
        data: {
          tenantId: clinic.tenantId,
          patientId,
          userId: user.id,
          sessionDate: haceDias(diasAtras),
          episodes: { create: [{ episodeId: episodio.id }] },
        },
      });
    }
    return episodio;
  }

  async function alertasDe(patientId: string, type?: string) {
    return prisma.clinicalAlert.findMany({
      where: { tenantId: clinic.tenantId, patientId, ...(type ? { type } : {}) },
    });
  }

  // ── Inactividad ───────────────────────────────────────────────────────────

  // El punto de mover la regla: nadie abrió la ficha de este paciente.
  it('detecta un episodio inactivo sin que nadie abra su ficha', async () => {
    const paciente = await crearPaciente('Paciente Abandonado');
    await crearEpisodio(paciente.id, 40);
    await destrabarMotor();

    const res = await auth(request(app).get('/api/alerts'));
    expect(res.status).toBe(200);

    const alertas = await alertasDe(paciente.id, 'FOLLOW_UP');
    expect(alertas).toHaveLength(1);
    expect(alertas[0].message).toMatch(/Sin sesiones en 40 días/);
  });

  it('no alerta por un episodio con actividad reciente', async () => {
    const paciente = await crearPaciente('Paciente Al Día');
    await crearEpisodio(paciente.id, 3);
    await destrabarMotor();

    await auth(request(app).get('/api/alerts'));
    expect(await alertasDe(paciente.id)).toHaveLength(0);
  });

  // Un episodio recién abierto no es un tratamiento abandonado: al paciente se
  // lo da de alta justo cuando viene a atenderse.
  it('no alerta por un episodio que todavía no tuvo ninguna sesión', async () => {
    const paciente = await crearPaciente('Paciente Nuevo');
    await crearEpisodio(paciente.id, null);
    await destrabarMotor();

    await auth(request(app).get('/api/alerts'));
    expect(await alertasDe(paciente.id)).toHaveLength(0);
  });

  it('no alerta por un episodio ya cerrado', async () => {
    const paciente = await crearPaciente('Paciente De Alta');
    const episodio = await crearEpisodio(paciente.id, 60);
    await prisma.clinicalEpisode.update({
      where: { id: episodio.id },
      data: { status: 'DISCHARGED' },
    });
    await destrabarMotor();

    await auth(request(app).get('/api/alerts'));
    expect(await alertasDe(paciente.id)).toHaveLength(0);
  });

  // ── Cobros vencidos ───────────────────────────────────────────────────────

  /** Una sesión con su cobro pendiente, fechada `diasAtras`. */
  async function crearCobroPendiente(patientId: string, diasAtras: number, monto: number) {
    const sesion = await prisma.session.create({
      data: {
        tenantId: clinic.tenantId,
        patientId,
        userId: user.id,
        sessionDate: haceDias(diasAtras),
      },
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

  it('avisa por un cobro pendiente viejo', async () => {
    const paciente = await crearPaciente('Paciente Que Debe');
    await crearCobroPendiente(paciente.id, 20, 15000);
    await destrabarMotor();

    await auth(request(app).get('/api/alerts'));

    const alertas = await alertasDe(paciente.id, 'PAYMENT');
    expect(alertas).toHaveLength(1);
    expect(alertas[0].message).toMatch(/Sesión sin cobrar/);
  });

  // Lo que hay que hacer es hablar con la persona una vez, no seis.
  it('agrupa varios cobros del mismo paciente en una sola alerta', async () => {
    const paciente = await crearPaciente('Paciente Con Deuda');
    await crearCobroPendiente(paciente.id, 30, 10000);
    await crearCobroPendiente(paciente.id, 20, 10000);
    await crearCobroPendiente(paciente.id, 5, 10000);
    await destrabarMotor();

    await auth(request(app).get('/api/alerts'));

    const alertas = await alertasDe(paciente.id, 'PAYMENT');
    expect(alertas).toHaveLength(1);
    // Cuenta las tres, aunque solo dos pasen el umbral: la deuda es del
    // paciente, no de cada sesión suelta.
    expect(alertas[0].message).toMatch(/3 sesiones sin cobrar/);
  });

  it('no avisa por un cobro reciente', async () => {
    const paciente = await crearPaciente('Paciente Recién Atendido');
    await crearCobroPendiente(paciente.id, 3, 15000);
    await destrabarMotor();

    await auth(request(app).get('/api/alerts'));
    expect(await alertasDe(paciente.id, 'PAYMENT')).toHaveLength(0);
  });

  it('no avisa por un cobro ya pagado', async () => {
    const paciente = await crearPaciente('Paciente Al Día Con Pagos');
    await crearCobroPendiente(paciente.id, 40, 15000);
    await prisma.payment.updateMany({
      where: { patientId: paciente.id },
      data: { status: 'PAID', paidAt: new Date() },
    });
    await destrabarMotor();

    await auth(request(app).get('/api/alerts'));
    expect(await alertasDe(paciente.id, 'PAYMENT')).toHaveLength(0);
  });

  // Una alerta pide una acción, y sobre un paciente eliminado esa acción es
  // imposible. Mismo criterio que el filtro de lectura del listado.
  it('no avisa por un paciente borrado', async () => {
    const paciente = await crearPaciente('Paciente Borrado');
    await crearCobroPendiente(paciente.id, 40, 15000);
    await prisma.patient.update({
      where: { id: paciente.id },
      data: { deletedAt: new Date() },
    });
    await destrabarMotor();

    await auth(request(app).get('/api/alerts'));
    expect(await alertasDe(paciente.id, 'PAYMENT')).toHaveLength(0);
  });

  // ── Throttle y cooldown ───────────────────────────────────────────────────

  // El badge del layout pide las stats en cada carga de página: sin esto el
  // motor correría decenas de veces por minuto.
  it('no vuelve a correr hasta que pasa el intervalo', async () => {
    const paciente = await crearPaciente('Paciente Throttle');
    await destrabarMotor();
    await auth(request(app).get('/api/alerts'));

    const marca = await prisma.tenant.findUniqueOrThrow({
      where: { id: clinic.tenantId },
      select: { alertsRefreshedAt: true },
    });
    expect(marca.alertsRefreshedAt).not.toBeNull();

    // Ahora aparece un motivo de alerta, pero el motor no debería correr.
    await crearEpisodio(paciente.id, 40);
    await auth(request(app).get('/api/alerts'));
    expect(await alertasDe(paciente.id)).toHaveLength(0);

    // Y en cuanto se destraba, la encuentra.
    await destrabarMotor();
    await auth(request(app).get('/api/alerts'));
    expect(await alertasDe(paciente.id)).toHaveLength(1);
  });

  it('no duplica una alerta que sigue sin leer', async () => {
    const paciente = await crearPaciente('Paciente Repetido');
    await crearEpisodio(paciente.id, 50);

    for (let i = 0; i < 3; i++) {
      await destrabarMotor();
      await auth(request(app).get('/api/alerts'));
    }

    expect(await alertasDe(paciente.id, 'FOLLOW_UP')).toHaveLength(1);
  });

  it('el badge también dispara el motor', async () => {
    const paciente = await crearPaciente('Paciente Del Badge');
    await crearEpisodio(paciente.id, 45);
    await destrabarMotor();

    // Sin pasar por la lista: solo el contador que ve el layout.
    const res = await auth(request(app).get('/api/alerts/stats'));
    expect(res.status).toBe(200);

    expect(await alertasDe(paciente.id, 'FOLLOW_UP')).toHaveLength(1);
  });

  it('las alertas de otra clínica no se mezclan', async () => {
    const otra = await createTestClinic();
    try {
      const otroUser = await otra.createUser();
      const otroPaciente = await prisma.patient.create({
        data: { tenantId: otra.tenantId, fullName: 'Ajeno' },
        select: { id: true },
      });
      await prisma.clinicalEpisode.create({
        data: { tenantId: otra.tenantId, patientId: otroPaciente.id },
      });

      await destrabarMotor();
      await auth(request(app).get('/api/alerts'));

      // Correr el motor de esta clínica no puede tocar la otra.
      const ajenas = await prisma.clinicalAlert.count({
        where: { tenantId: otra.tenantId },
      });
      expect(ajenas).toBe(0);

      const marca = await prisma.tenant.findUniqueOrThrow({
        where: { id: otra.tenantId },
        select: { alertsRefreshedAt: true },
      });
      expect(marca.alertsRefreshedAt).toBeNull();

      await sleep(200);
      await prisma.clinicalAlert.deleteMany({ where: { tenantId: otra.tenantId } });
      await prisma.clinicalEpisode.deleteMany({ where: { tenantId: otra.tenantId } });
      await prisma.patient.deleteMany({ where: { tenantId: otra.tenantId } });
      void otroUser;
    } finally {
      await otra.cleanup();
    }
  });
});
