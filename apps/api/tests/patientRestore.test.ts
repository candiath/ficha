import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { addClinicDays, instantToClinicTime } from '../src/lib/clinicTime';
import { createTestClinic, createTestToken, deleteAuditRows, sleep, type TestClinic } from './helpers';
import { fixture } from './fixtures';

const AR = 'America/Argentina/Buenos_Aires';
const day = (offset: number) => addClinicDays(instantToClinicTime(new Date(), AR).date, offset);

// Deleting a patient hides her record and her pending work; restoring her
// brings both back as they were (CLAUDE.md, "Borrado de pacientes").
describe('deleting and restoring a patient', () => {
  let clinic: TestClinic;
  let other: TestClinic;
  let user: User;
  let token: string;

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const newPatient = (lastName: string, tenantId = clinic.tenantId) =>
    fixture.patient.create({ data: { tenantId, firstName: 'Paciente', lastName }, select: { id: true } });
  const agenda = () => auth(request(app).get(`/api/appointments?from=${day(0)}&to=${day(30)}`));

  beforeAll(async () => {
    clinic = await createTestClinic();
    other = await createTestClinic();
    user = await clinic.createUser();
    token = await createTestToken(user);
  });

  afterAll(async () => {
    await sleep(300);
    for (const c of [clinic, other]) {
      await prisma.appointment.deleteMany({ where: { tenantId: c.tenantId } });
      await deleteAuditRows([c.tenantId]);
      await prisma.patient.deleteMany({ where: { tenantId: c.tenantId } });
      await c.cleanup();
    }
  });

  it("hides a deleted patient's appointments and brings them back on restore", async () => {
    const patient = await newPatient('Agendada');
    const created = await auth(request(app).post('/api/appointments')).send({
      patientId: patient.id,
      date: day(3),
      time: '10:00',
      durationMinutes: 60,
    });
    expect(created.status).toBe(201);
    const appointmentId: string = created.body.data[0].id;
    const ids = async () => ((await agenda()).body.data as { id: string }[]).map((a) => a.id);
    expect(await ids()).toContain(appointmentId);

    expect((await auth(request(app).delete(`/api/patients/${patient.id}`))).status).toBe(204);
    expect(await ids()).not.toContain(appointmentId);
    expect((await auth(request(app).get(`/api/appointments/${appointmentId}`))).status).toBe(404);
    expect((await auth(request(app).patch(`/api/appointments/${appointmentId}`)).send({ notes: 'x' })).status).toBe(404);
    // Hidden, not cancelled.
    await expect(
      prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId }, select: { status: true } }),
    ).resolves.toEqual({ status: 'SCHEDULED' });

    expect((await auth(request(app).post(`/api/patients/${patient.id}/restore`))).status).toBe(204);
    expect(await ids()).toContain(appointmentId);
    expect((await auth(request(app).get(`/api/patients/${patient.id}`))).status).toBe(200);
  });

  it('restores with its audit row and a version, once', async () => {
    const patient = await newPatient('Restaurada');
    await auth(request(app).delete(`/api/patients/${patient.id}`)).expect(204);

    const deleted = await auth(request(app).get('/api/patients/deleted'));
    expect(deleted.status).toBe(200);
    expect(deleted.body.data).toContainEqual({
      id: patient.id,
      fullName: 'Paciente Restaurada',
      deletedAt: expect.any(String),
    });

    await auth(request(app).post(`/api/patients/${patient.id}/restore`)).expect(204);
    // A second restore, and restoring a patient who is not deleted: 404.
    expect((await auth(request(app).post(`/api/patients/${patient.id}/restore`))).status).toBe(404);

    const rows = await prisma.auditLog.findMany({
      where: { entityId: patient.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { action: true, userId: true },
    });
    expect(rows.map((r) => r.action)).toEqual(['PATIENT_CREATED', 'PATIENT_DELETED', 'PATIENT_RESTORED']);
    expect(rows[2].userId).toBe(user.id);
    const versions = await prisma.patientRevision.findMany({
      where: { patientId: patient.id },
      orderBy: { version: 'asc' },
      select: { version: true },
    });
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);

    const after = await auth(request(app).get('/api/patients/deleted'));
    expect((after.body.data as { id: string }[]).map((p) => p.id)).not.toContain(patient.id);
  });

  it("neither lists nor restores another clinic's deleted patient", async () => {
    const foreign = await newPatient('Ajena', other.tenantId);
    await prisma.patient.update({ where: { id: foreign.id }, data: { deletedAt: new Date() } });

    const list = await auth(request(app).get('/api/patients/deleted'));
    expect((list.body.data as { id: string }[]).map((p) => p.id)).not.toContain(foreign.id);
    const res = await auth(request(app).post(`/api/patients/${foreign.id}/restore`));
    expect(res.status).toBe(404);
    await expect(
      prisma.patient.findUniqueOrThrow({ where: { id: foreign.id }, select: { deletedAt: true } }),
    ).resolves.not.toEqual({ deletedAt: null });
  });
});
