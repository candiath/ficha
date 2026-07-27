import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, signTestToken, type TestClinic } from './helpers';

// Stats del dashboard: además de los conteos, lo que se prueba es que las
// agregaciones (count/groupBy/findMany) queden acotadas al tenant del token.
// Son las operaciones que el guard de tenantScope intercepta sin que la ruta
// mencione tenantId, así que una regresión ahí sería silenciosa.

// Día 15 al mediodía UTC de un mes relativo al actual: lejos de los bordes,
// para que la fecha caiga en el mismo mes UTC sin importar la TZ del runner.
function midMonthUtc(monthsAgo: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 15, 12));
}

function monthKey(monthsAgo: number): string {
  return midMonthUtc(monthsAgo).toISOString().slice(0, 7);
}

describe('GET /api/dashboard/stats', () => {
  let clinicA: TestClinic;
  let clinicB: TestClinic;
  let userA: User;
  let tokenA: string;
  let body: {
    activePatients: number;
    totalSessions: number;
    sessionsThisMonth: number;
    pendingPayments: number;
    pathologies: { name: string; count: number }[];
    sessionsByMonth: { month: string; count: number }[];
  };

  // Clínica A (la que se mide):
  //   - patientActive:    episodio ACTIVE + 3 sesiones clínicas + 1 nota
  //   - patientDischarged: episodio DISCHARGED (no cuenta como activo)
  //   - patientNoEpisode:  sin episodios (no cuenta como activo)
  //   - patientDeleted:    episodio ACTIVE pero borrado lógico (no cuenta)
  // Clínica B: el mismo tipo de datos, para verificar que no se filtren.
  beforeAll(async () => {
    clinicA = await createTestClinic();
    clinicB = await createTestClinic();
    userA = await clinicA.createUser();
    tokenA = signTestToken(userA);

    async function createPatient(
      tenantId: string,
      fullName: string,
      opts: { deleted?: boolean } = {},
    ) {
      return prisma.patient.create({
        data: { tenantId, fullName, deletedAt: opts.deleted ? new Date() : null },
        select: { id: true },
      });
    }

    const patientActive = await createPatient(clinicA.tenantId, 'Paciente Activo');
    const patientDischarged = await createPatient(clinicA.tenantId, 'Paciente de Alta');
    await createPatient(clinicA.tenantId, 'Paciente Sin Episodio');
    const patientDeleted = await createPatient(clinicA.tenantId, 'Paciente Borrado', {
      deleted: true,
    });

    // Dos episodios con el mismo mainComplaint para probar el agrupado, y uno
    // con complaint vacío que debe quedar fuera del top de patologías.
    await prisma.clinicalEpisode.createMany({
      data: [
        {
          tenantId: clinicA.tenantId,
          patientId: patientActive.id,
          status: 'ACTIVE',
          mainComplaint: 'Lumbalgia',
        },
        {
          tenantId: clinicA.tenantId,
          patientId: patientDischarged.id,
          status: 'DISCHARGED',
          mainComplaint: 'Lumbalgia',
        },
        {
          tenantId: clinicA.tenantId,
          patientId: patientDischarged.id,
          status: 'DISCHARGED',
          mainComplaint: 'Cervicalgia',
        },
        {
          tenantId: clinicA.tenantId,
          patientId: patientDeleted.id,
          status: 'ACTIVE',
          mainComplaint: '',
        },
      ],
    });

    // Sesiones de A: 2 este mes + 1 hace 3 meses. La nota rápida y la sesión
    // vieja (fuera de la ventana de 6 meses) no deben aparecer en el gráfico.
    await prisma.session.createMany({
      data: [
        {
          tenantId: clinicA.tenantId,
          patientId: patientActive.id,
          userId: userA.id,
          sessionType: 'SESSION',
          sessionDate: midMonthUtc(0),
        },
        {
          tenantId: clinicA.tenantId,
          patientId: patientActive.id,
          userId: userA.id,
          sessionType: 'DISCHARGE',
          sessionDate: midMonthUtc(0),
        },
        {
          tenantId: clinicA.tenantId,
          patientId: patientActive.id,
          userId: userA.id,
          sessionType: 'SESSION',
          sessionDate: midMonthUtc(3),
        },
        {
          tenantId: clinicA.tenantId,
          patientId: patientActive.id,
          userId: userA.id,
          sessionType: 'NOTE',
          sessionDate: midMonthUtc(0),
        },
        {
          tenantId: clinicA.tenantId,
          patientId: patientActive.id,
          userId: userA.id,
          sessionType: 'SESSION',
          sessionDate: midMonthUtc(10),
        },
      ],
    });

    // Un pago PENDING y uno PAID: solo el primero cuenta.
    const sessionsA = await prisma.session.findMany({
      where: { tenantId: clinicA.tenantId, sessionType: 'SESSION' },
      select: { id: true },
      orderBy: { sessionDate: 'desc' },
    });
    await prisma.payment.createMany({
      data: [
        {
          tenantId: clinicA.tenantId,
          patientId: patientActive.id,
          sessionId: sessionsA[0].id,
          baseAmount: 100,
          finalAmount: 100,
          status: 'PENDING',
        },
        {
          tenantId: clinicA.tenantId,
          patientId: patientActive.id,
          sessionId: sessionsA[1].id,
          baseAmount: 100,
          finalAmount: 100,
          status: 'PAID',
        },
      ],
    });

    // Ruido de la clínica B: nada de esto debe aparecer en las stats de A.
    const userB = await clinicB.createUser();
    const patientB = await createPatient(clinicB.tenantId, 'Paciente B');
    await prisma.clinicalEpisode.create({
      data: {
        tenantId: clinicB.tenantId,
        patientId: patientB.id,
        status: 'ACTIVE',
        mainComplaint: 'Escoliosis de otra clínica',
      },
    });
    const sessionB = await prisma.session.create({
      data: {
        tenantId: clinicB.tenantId,
        patientId: patientB.id,
        userId: userB.id,
        sessionType: 'SESSION',
        sessionDate: midMonthUtc(0),
      },
      select: { id: true },
    });
    await prisma.payment.create({
      data: {
        tenantId: clinicB.tenantId,
        patientId: patientB.id,
        sessionId: sessionB.id,
        baseAmount: 100,
        finalAmount: 100,
        status: 'PENDING',
      },
    });

    const res = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    body = res.body.data;
  });

  afterAll(async () => {
    const tenantIds = [clinicA.tenantId, clinicB.tenantId];
    await prisma.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.session.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.clinicalEpisode.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.patient.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await clinicA.cleanup();
    await clinicB.cleanup();
  });

  it('exige autenticación', async () => {
    const res = await request(app).get('/api/dashboard/stats');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'No autenticado' });
  });

  it('cuenta como activos solo a los pacientes vigentes con episodio ACTIVE', () => {
    // De los 4 pacientes de A, solo uno está vigente y con episodio abierto:
    // quedan fuera el de alta, el que no tiene episodios y el borrado.
    expect(body.activePatients).toBe(1);
  });

  it('excluye las notas rápidas del total de sesiones', () => {
    // 5 filas en sessions, pero una es NOTE.
    expect(body.totalSessions).toBe(4);
  });

  it('cuenta las sesiones del mes calendario actual', () => {
    // SESSION + DISCHARGE de este mes; la NOTE del mismo mes no cuenta.
    expect(body.sessionsThisMonth).toBe(2);
  });

  it('cuenta solo los pagos pendientes', () => {
    expect(body.pendingPayments).toBe(1);
  });

  it('agrupa los motivos de consulta y descarta los vacíos', () => {
    expect(body.pathologies).toEqual([
      { name: 'Lumbalgia', count: 2 },
      { name: 'Cervicalgia', count: 1 },
    ]);
  });

  it('devuelve los últimos 6 meses en orden cronológico, con ceros', () => {
    expect(body.sessionsByMonth).toHaveLength(6);
    expect(body.sessionsByMonth.map((m) => m.month)).toEqual([
      monthKey(5),
      monthKey(4),
      monthKey(3),
      monthKey(2),
      monthKey(1),
      monthKey(0),
    ]);
    // Las sesiones de A caen en el mes actual (2) y hace 3 meses (1); la de
    // hace 10 meses queda fuera de la ventana.
    expect(body.sessionsByMonth.map((m) => m.count)).toEqual([0, 0, 1, 0, 0, 2]);
  });

  it('no mezcla datos de otra clínica en ninguna métrica', async () => {
    // Si el scope de tenant fallara, cada uno de estos números subiría en 1
    // y aparecería la patología de la clínica B.
    expect(body.pathologies.map((p) => p.name)).not.toContain('Escoliosis de otra clínica');

    const resB = await request(app)
      .get('/api/dashboard/stats')
      .set('Authorization', `Bearer ${signTestToken(await clinicB.createUser())}`);

    expect(resB.status).toBe(200);
    expect(resB.body.data.activePatients).toBe(1);
    expect(resB.body.data.totalSessions).toBe(1);
    expect(resB.body.data.pathologies).toEqual([
      { name: 'Escoliosis de otra clínica', count: 1 },
    ]);
  });
});
