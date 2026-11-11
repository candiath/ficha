import request from 'supertest';
import { prisma } from '../src/lib/prisma';
import { createSessionFixture, deleteAuditRows, type TestClinic } from './helpers';
import { fixture } from './fixtures';

// One patient's record and the clinic's rows around it, for the generic
// probes (livePatientCoverage, crossClinicProbe): every route with an id in
// its path gets a real id of the right kind.
export interface ProbeWorld {
  patientId: string;
  episodeId: string;
  sessionId: string;
  eventId: string;
  appointmentId: string;
  packageId: string;
  paymentId: string;
  alertId: string;
  userId: string;
  authSessionId: string;
}

export async function buildProbeWorld(clinic: TestClinic, lastName: string): Promise<ProbeWorld> {
  const tenantId = clinic.tenantId;
  const user = await clinic.createUser({ role: 'ADMIN' });
  const patient = await fixture.patient.create({
    data: { tenantId, firstName: 'Sonda', lastName },
    select: { id: true },
  });
  const owner = { tenantId, patientId: patient.id };
  const episode = await fixture.clinicalEpisode.create({ data: { ...owner, mainComplaint: 'Lumbalgia' } });
  await fixture.initialEvaluation.create({ data: { ...owner, episodeId: episode.id, notes: 'Evaluación' } });
  await fixture.informedConsent.create({ data: { ...owner, signedAt: new Date() } });
  const event = await fixture.patientEvent.create({ data: { ...owner, kind: 'SURGERY', description: 'Cesárea' } });
  const session = await createSessionFixture({ ...owner, userId: user.id, sessionDate: new Date() });
  const start = new Date(Date.now() + 3 * 86_400_000);
  const appointment = await prisma.appointment.create({
    data: { ...owner, userId: user.id, startsAt: start, endsAt: new Date(start.getTime() + 3_600_000) },
  });
  const pkg = await prisma.sessionPackage.create({
    data: { ...owner, name: 'Paquete', totalSessions: 4, pricePerSessionCents: 100n },
  });
  const payment = await prisma.payment.create({
    data: { ...owner, sessionId: session.id, baseAmountCents: 100n, finalAmountCents: 100n },
  });
  const alert = await prisma.clinicalAlert.create({ data: { ...owner, type: 'FOLLOW_UP', message: 'Seguimiento' } });
  const authSession = await prisma.authSession.create({
    data: { userId: user.id, tokenHash: Buffer.from(`${patient.id}-probe`), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return {
    patientId: patient.id,
    episodeId: episode.id,
    sessionId: session.id,
    eventId: event.id,
    appointmentId: appointment.id,
    packageId: pkg.id,
    paymentId: payment.id,
    alertId: alert.id,
    userId: user.id,
    authSessionId: authSession.id,
  };
}

// The id a `:param` takes, by its name and the route it is in. undefined: a
// route whose param no probe knows, which the probes report.
export function probeParam(world: ProbeWorld, route: string, name: string): string | undefined {
  const byName: Record<string, string> = {
    patientId: world.patientId,
    episodeId: world.episodeId,
    sessionId: world.sessionId,
    eventId: world.eventId,
    authSessionId: world.authSessionId,
    version: '1',
  };
  if (name in byName) return byName[name];
  if (name !== 'id') return undefined;
  const byMount: [string, string][] = [
    ['/api/patients/', world.patientId],
    ['/api/appointments/', world.appointmentId],
    ['/api/packages/', world.packageId],
    ['/api/payments/', world.paymentId],
    ['/api/alerts/', world.alertId],
    ['/api/users/', world.userId],
  ];
  return byMount.find(([mount]) => route.startsWith(mount))?.[1];
}

// Everything the clinic holds that a probe could write, as one string: equal
// before and after means no probe wrote anything.
export async function clinicState(tenantId: string): Promise<string> {
  const where = { tenantId };
  const rows = await Promise.all([
    prisma.patient.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.clinicalEpisode.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.initialEvaluation.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.informedConsent.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.patientEvent.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.session.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.sessionEpisode.findMany({ where, orderBy: [{ sessionId: 'asc' }, { episodeId: 'asc' }] }),
    prisma.appointment.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.sessionPackage.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.payment.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.clinicalAlert.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.user.findMany({ where, orderBy: { id: 'asc' } }),
    prisma.authSession.findMany({ where: { user: where }, orderBy: { id: 'asc' } }),
    prisma.passwordResetToken.findMany({ where: { user: where }, orderBy: { id: 'asc' } }),
    prisma.auditLog.count({ where }),
  ]);
  return JSON.stringify(rows, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
}

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

// One probe request: the route's method, an empty JSON body.
export function probeRequest(app: Parameters<typeof request>[0], method: string, url: string, token: string) {
  const agent = request(app);
  return agent[method.toLowerCase() as Method](url).set('Authorization', `Bearer ${token}`).send({});
}

export async function deleteProbeWorld(clinic: TestClinic): Promise<void> {
  const where = { tenantId: clinic.tenantId };
  await deleteAuditRows([clinic.tenantId]);
  await prisma.payment.deleteMany({ where });
  await prisma.sessionPackage.deleteMany({ where });
  await prisma.appointment.deleteMany({ where });
  await prisma.clinicalAlert.deleteMany({ where });
  await prisma.sessionEpisode.deleteMany({ where });
  await prisma.session.deleteMany({ where });
  await prisma.informedConsent.deleteMany({ where });
  await prisma.initialEvaluation.deleteMany({ where });
  await prisma.patientEvent.deleteMany({ where });
  await prisma.clinicalEpisode.deleteMany({ where });
  await prisma.patient.deleteMany({ where });
  await prisma.passwordResetToken.deleteMany({ where: { user: where } });
  await prisma.authSession.deleteMany({ where: { user: where } });
  await clinic.cleanup();
}
