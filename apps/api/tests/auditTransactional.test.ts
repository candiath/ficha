import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import {
  appointmentRepo,
  consentRepo,
  episodeRepo,
  evaluationRepo,
  packageRepo,
  patientRepo,
  paymentRepo,
  sessionRepo,
} from '../src/repositories';
import type { AuditEntry } from '../src/repositories/auditLogRepository';
import type { TenantContext } from '../src/repositories/types';
import { AuditEntryError } from '../src/repositories/prisma/recordAudit';
import { ZodError } from 'zod';
import { createSessionFixture, deleteAuditRows, createTestContext, createTestClinic, patientAudit, type TestClinic, splitName } from './helpers';
import { fixture } from './fixtures';

// #188: an audited write and its audit row commit together or not at all.
// Each test forces the audit insert to fail — an entry pointing at a patient
// that does not exist violates audit_logs' foreign key — and checks that the
// write it was recording rolled back with it.

describe('audit rows are written in the same transaction as their action', () => {
  let clinic: TestClinic;
  let user: User;
  let ctx: TenantContext;

  // An audit entry that cannot be inserted.
  const broken = (): AuditEntry => ({
    action: 'PATIENT_DELETED',
    patientId: randomUUID(),
    entityId: randomUUID(),
    params: {},
  });

  // A valid entry, for the setup writes that precede the one under test.
  const validFor =
    (patientId: string) =>
    (result: { id: string }): AuditEntry => ({
      action: 'CONSENT_SIGNED',
      patientId,
      entityId: result.id,
      params: {},
    });

  const newPatient = (fullName: string) =>
    patientRepo.create(ctx, splitName(fullName), patientAudit('CREATED'));

  // A session treating an episode of its own, as every session does (#238).
  const newSession = async (patientId: string) => {
    const episode = await fixture.clinicalEpisode.create({
      data: { tenantId: clinic.tenantId, patientId },
      select: { id: true },
    });
    return createSessionFixture({
      tenantId: clinic.tenantId,
      patientId,
      userId: user.id,
      sessionDate: new Date(),
      blocks: [{ episodeId: episode.id }],
    });
  };

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
    ctx = await createTestContext(clinic.tenantId, user);
  });

  afterAll(async () => {
    const tenantId = clinic.tenantId;
    await deleteAuditRows([tenantId]);
    await prisma.appointment.deleteMany({ where: { tenantId } });
    await prisma.payment.deleteMany({ where: { tenantId } });
    await prisma.sessionPackage.deleteMany({ where: { tenantId } });
    // A session's blocks (#238) restrict its deletion: they go first.
    await prisma.sessionEpisode.deleteMany({ where: { tenantId } });
    await prisma.session.deleteMany({ where: { tenantId } });
    await prisma.initialEvaluation.deleteMany({ where: { tenantId } });
    await prisma.clinicalEpisode.deleteMany({ where: { tenantId } });
    await prisma.informedConsent.deleteMany({ where: { tenantId } });
    await prisma.patient.deleteMany({ where: { tenantId } });
    await clinic.cleanup();
  });

  it('a patient is not created when its audit row fails', async () => {
    const before = await prisma.patient.count({ where: { tenantId: clinic.tenantId } });

    await expect(patientRepo.create(ctx, { firstName: 'Sin', lastName: 'Auditoría' }, broken)).rejects.toThrow();

    expect(await prisma.patient.count({ where: { tenantId: clinic.tenantId } })).toBe(before);
  });

  // The catalog refuses an entry before the insert (SPEC-audit-structured-entries.md
  // §4): a server bug, so not a ZodError, which the error handler would answer
  // as a 400 with the parameter's details. It still rolls the write back.
  it('an entry the catalog refuses rolls the write back, as a server error', async () => {
    const before = await prisma.patient.count({ where: { tenantId: clinic.tenantId } });
    const deprecated = (p: { id: string }) =>
      ({ action: 'CREATED', patientId: p.id, entityId: p.id, params: {} }) as unknown as AuditEntry;
    const freeText = (p: { id: string }) =>
      ({ action: 'PATIENT_UPDATED', patientId: p.id, entityId: p.id, params: { changedFields: ['Dolor 42%'] } }) as unknown as AuditEntry;

    for (const entry of [deprecated, freeText]) {
      const error = await patientRepo.create(ctx, { firstName: 'Rechazada', lastName: 'Test' }, entry).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AuditEntryError);
      expect(error).not.toBeInstanceOf(ZodError);
      expect(String(error)).not.toContain('42%');
    }
    expect(await prisma.patient.count({ where: { tenantId: clinic.tenantId } })).toBe(before);
  });

  it('a patient update is rolled back when its audit row fails', async () => {
    const patient = await patientRepo.create(ctx, { firstName: 'Original', lastName: 'Test' }, patientAudit('CREATED'));

    await expect(
      patientRepo.update(ctx, patient.id, { firstName: 'Cambiado', lastName: 'Test' }, broken),
    ).rejects.toThrow();

    const row = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(row).toMatchObject({ firstName: 'Original', lastName: 'Test' });
  });

  it('a clinical session, its blocks and its payment are not created when the audit row fails', async () => {
    const patient = await patientRepo.create(ctx, { firstName: 'Con', lastName: 'Sesión' }, patientAudit('CREATED'));
    const episode = await fixture.clinicalEpisode.create({
      data: { tenantId: clinic.tenantId, patientId: patient.id },
      select: { id: true },
    });

    await expect(
      sessionRepo.create(
        ctx,
        patient.id,
        {
          sessionType: 'SESSION',
          sessionDate: new Date(),
          episodes: [{ episodeId: episode.id, painScaleBefore: 5 }],
          payment: { baseAmountCents: 1000, discountCents: 0 },
        },
        broken,
      ),
    ).rejects.toThrow();

    expect(await prisma.session.count({ where: { patientId: patient.id } })).toBe(0);
    expect(await prisma.sessionEpisode.count({ where: { patientId: patient.id } })).toBe(0);
    expect(await prisma.payment.count({ where: { patientId: patient.id } })).toBe(0);
  });

  it('a payment is not created when its audit row fails', async () => {
    const patient = await patientRepo.create(ctx, { firstName: 'Con', lastName: 'Cobro' }, patientAudit('CREATED'));
    const session = await createSessionFixture({
      tenantId: clinic.tenantId,
      patientId: patient.id,
      userId: user.id,
      sessionDate: new Date(),
    });

    await expect(
      paymentRepo.create(ctx, { sessionId: session.id, baseAmountCents: 1000, discountCents: 0 }, broken),
    ).rejects.toThrow();

    expect(await prisma.payment.count({ where: { sessionId: session.id } })).toBe(0);
  });

  it('a patient is not soft-deleted when its audit row fails', async () => {
    const patient = await newPatient('Sin Borrar');

    await expect(patientRepo.softDelete(ctx, patient.id, broken())).rejects.toThrow();

    const row = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(row.deletedAt).toBeNull();
  });

  it('a consent is not signed when its audit row fails', async () => {
    const patient = await newPatient('Sin Firma');

    await expect(consentRepo.sign(ctx, patient.id, undefined, broken)).rejects.toThrow();

    expect(await prisma.informedConsent.count({ where: { patientId: patient.id } })).toBe(0);
  });

  it('a consent revocation is rolled back when its audit row fails', async () => {
    const patient = await newPatient('Firma Vigente');
    await consentRepo.sign(ctx, patient.id, undefined, validFor(patient.id));

    await expect(consentRepo.revoke(ctx, patient.id, broken)).rejects.toThrow();

    const row = await prisma.informedConsent.findFirstOrThrow({ where: { patientId: patient.id } });
    expect(row).toMatchObject({ revokedAt: null });
  });

  it('an episode is not opened when its audit row fails', async () => {
    const patient = await newPatient('Sin Episodio');

    await expect(episodeRepo.create(ctx, patient.id, { mainComplaint: 'Lumbalgia' }, broken)).rejects.toThrow();

    expect(await prisma.clinicalEpisode.count({ where: { patientId: patient.id } })).toBe(0);
  });

  it('an episode update is rolled back when its audit row fails', async () => {
    const patient = await newPatient('Episodio Intacto');
    // Opened through the repository, as the app opens: the opening and the
    // closing below read the same clock. The failure must be the audit row's
    // foreign key (P2003), not a closing that never reached it.
    const episode = await episodeRepo.create(ctx, patient.id, { mainComplaint: 'Lumbalgia' }, validFor(patient.id));

    await expect(
      episodeRepo.update(ctx, patient.id, episode.id, { status: 'ABANDONED', closedAt: new Date() }, broken),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      episodeRepo.update(ctx, patient.id, episode.id, { mainComplaint: 'Cervicalgia', reason: 'DATA_ENTRY_ERROR' }, broken),
    ).rejects.toThrow();

    const row = await prisma.clinicalEpisode.findUniqueOrThrow({ where: { id: episode.id } });
    expect(row).toMatchObject({ status: 'ACTIVE', closedAt: null, mainComplaint: 'Lumbalgia' });
  });

  it('an initial evaluation is not saved when its audit row fails', async () => {
    const patient = await newPatient('Sin Evaluación');
    const episode = await fixture.clinicalEpisode.create({
      data: { tenantId: clinic.tenantId, patientId: patient.id },
    });

    await expect(
      evaluationRepo.upsert(ctx, patient.id, episode.id, { notes: 'test' }, broken),
    ).rejects.toThrow();

    expect(await prisma.initialEvaluation.count({ where: { episodeId: episode.id } })).toBe(0);
  });

  it('a clinical session update is rolled back when its audit row fails', async () => {
    const patient = await newPatient('Sesión Intacta');
    const session = await newSession(patient.id);

    await expect(
      sessionRepo.update(ctx, patient.id, session.id, { observations: 'cambiada' }, broken),
    ).rejects.toThrow();

    const row = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.observations).toBeNull();
  });

  it('a clinical session is not deleted when its audit row fails', async () => {
    const patient = await newPatient('Sesión Vigente');
    const session = await newSession(patient.id);

    await expect(sessionRepo.softDelete(ctx, patient.id, session.id, broken())).rejects.toThrow();

    const row = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.deletedAt).toBeNull();
  });

  it('a payment update is rolled back when its audit row fails', async () => {
    const patient = await newPatient('Cobro Intacto');
    const session = await newSession(patient.id);
    const created = await paymentRepo.create(
      ctx,
      { sessionId: session.id, baseAmountCents: 1000, discountCents: 0 },
      validFor(patient.id),
    );
    if (!created.ok) throw new Error('setup: payment not created');

    await expect(
      paymentRepo.update(ctx, created.payment.id, { discountCents: 500 }, broken),
    ).rejects.toThrow();

    const row = await prisma.payment.findUniqueOrThrow({ where: { id: created.payment.id } });
    expect(Number(row.discountCents)).toBe(0);
  });

  const slot = (daysAhead: number) => {
    const startsAt = new Date(Date.now() + daysAhead * 86_400_000);
    return { startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000) };
  };

  // Written directly, so a test only exercises the write it is about.
  const newAppointment = (patientId: string, seriesId: string | null = null, daysAhead = 1) =>
    prisma.appointment.create({
      data: { tenantId: clinic.tenantId, patientId, userId: user.id, seriesId, ...slot(daysAhead) },
    });

  it('a series of appointments is not created when an audit row fails', async () => {
    const patient = await newPatient('Sin Turnos');

    await expect(
      appointmentRepo.create(ctx, { patientId: patient.id, slots: [slot(1), slot(8)] }, broken),
    ).rejects.toThrow();

    expect(await prisma.appointment.count({ where: { patientId: patient.id } })).toBe(0);
  });

  it('an appointment update is rolled back when its audit row fails', async () => {
    const patient = await newPatient('Turno Intacto');
    const appointment = await newAppointment(patient.id);

    await expect(
      appointmentRepo.update(ctx, appointment.id, { status: 'CANCELLED' }, () => [broken()]),
    ).rejects.toThrow();
    await expect(
      appointmentRepo.update(ctx, appointment.id, { notes: 'Otra nota' }, () => [broken()]),
    ).rejects.toThrow();

    const row = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(row).toMatchObject({ status: 'SCHEDULED', cancelledAt: null, notes: null });
  });

  it('cancelling a series is rolled back when an audit row fails', async () => {
    const patient = await newPatient('Serie Intacta');
    const seriesId = randomUUID();
    await newAppointment(patient.id, seriesId, 1);
    await newAppointment(patient.id, seriesId, 8);

    await expect(appointmentRepo.cancelSeriesFrom(ctx, seriesId, new Date(), broken)).rejects.toThrow();

    expect(await prisma.appointment.count({ where: { seriesId, status: 'SCHEDULED' } })).toBe(2);
  });

  it('a package is not created when its audit row fails', async () => {
    const patient = await newPatient('Sin Paquete');

    await expect(
      packageRepo.create(
        ctx,
        { patientId: patient.id, name: 'Paquete', totalSessions: 4, pricePerSessionCents: 100 },
        broken,
      ),
    ).rejects.toThrow();

    expect(await prisma.sessionPackage.count({ where: { patientId: patient.id } })).toBe(0);
  });

  it('a package is not deleted when its audit row fails', async () => {
    const patient = await newPatient('Paquete Intacto');
    const pkg = await prisma.sessionPackage.create({
      data: {
        tenantId: clinic.tenantId,
        patientId: patient.id,
        name: 'Paquete',
        totalSessions: 4,
        pricePerSessionCents: 100,
      },
    });

    await expect(packageRepo.deleteIfUnused(ctx, pkg.id, broken)).rejects.toThrow();

    expect(await prisma.sessionPackage.count({ where: { id: pkg.id } })).toBe(1);
  });

  it('a successful write leaves exactly one audit row, attributed to the actor', async () => {
    const patient = await patientRepo.create(ctx, { firstName: 'Auditado', lastName: 'Test' }, patientAudit('CREATED'));

    const rows = await prisma.auditLog.findMany({ where: { patientId: patient.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'PATIENT_CREATED', entity: 'PATIENT', userId: user.id });
  });
});
