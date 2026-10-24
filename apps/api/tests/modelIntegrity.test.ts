import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, type TestClinic } from './helpers';

// The database refuses what the API already refuses (20261024120000_model_integrity):
// rows that join two clinics or two patients, and values out of range. These
// write with the base client on purpose, as a repository bug would, past every
// check of the routes.
describe('The database keeps the model consistent', () => {
  let clinic: TestClinic;
  let otherClinic: TestClinic;
  let user: User;
  let otherClinicsUser: User;
  let patient: string;
  let otherPatient: string;
  let episode: string;
  let otherPatientsEpisode: string;
  let otherPatientsSession: string;
  let otherPatientsPackage: string;

  const DAY_MS = 24 * 60 * 60 * 1000;

  beforeAll(async () => {
    clinic = await createTestClinic();
    otherClinic = await createTestClinic();
    user = await clinic.createUser();
    otherClinicsUser = await otherClinic.createUser();
    const tenantId = clinic.tenantId;

    const createPatient = async (fullName: string) =>
      (await prisma.patient.create({ data: { tenantId, fullName }, select: { id: true } })).id;
    patient = await createPatient('Paciente');
    otherPatient = await createPatient('Otro paciente');

    const createEpisode = async (patientId: string) =>
      (await prisma.clinicalEpisode.create({ data: { tenantId, patientId }, select: { id: true } })).id;
    episode = await createEpisode(patient);
    otherPatientsEpisode = await createEpisode(otherPatient);

    otherPatientsSession = (
      await prisma.session.create({
        data: { tenantId, patientId: otherPatient, userId: user.id, sessionDate: new Date() },
        select: { id: true },
      })
    ).id;
    otherPatientsPackage = (
      await prisma.sessionPackage.create({
        data: { tenantId, patientId: otherPatient, name: 'Paquete', totalSessions: 10, pricePerSessionCents: 100 },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    const where = { tenantId: clinic.tenantId };
    await prisma.appointment.deleteMany({ where });
    await prisma.payment.deleteMany({ where });
    await prisma.sessionPackage.deleteMany({ where });
    await prisma.sessionEpisode.deleteMany({ where });
    await prisma.session.deleteMany({ where });
    await prisma.initialEvaluation.deleteMany({ where });
    await prisma.functionalScale.deleteMany({ where });
    await prisma.clinicalEpisode.deleteMany({ where });
    await prisma.patient.deleteMany({ where });
    await clinic.cleanup();
    await otherClinic.cleanup();
  });

  const session = () =>
    prisma.session.create({
      data: { tenantId: clinic.tenantId, patientId: patient, userId: user.id, sessionDate: new Date() },
      select: { id: true },
    });

  describe('a row cannot join two clinics or two patients', () => {
    it("refuses a session by another clinic's therapist", async () => {
      await expect(
        prisma.session.create({
          data: { tenantId: clinic.tenantId, patientId: patient, userId: otherClinicsUser.id, sessionDate: new Date() },
        }),
      ).rejects.toThrow(/sessions_tenant_id_user_id_fkey/);
    });

    it("refuses a payment for another patient's session", async () => {
      await expect(
        prisma.payment.create({
          data: {
            tenantId: clinic.tenantId,
            patientId: patient,
            sessionId: otherPatientsSession,
            baseAmountCents: 100,
            finalAmountCents: 100,
          },
        }),
      ).rejects.toThrow(/payments_tenant_id_patient_id_session_id_fkey/);
    });

    it("refuses a payment from another patient's package", async () => {
      const own = await session();
      await expect(
        prisma.payment.create({
          data: {
            tenantId: clinic.tenantId,
            patientId: patient,
            sessionId: own.id,
            packageId: otherPatientsPackage,
            baseAmountCents: 100,
            finalAmountCents: 100,
          },
        }),
      ).rejects.toThrow(/payments_tenant_id_patient_id_package_id_fkey/);
    });

    it("refuses an evaluation of another patient's episode", async () => {
      await expect(
        prisma.initialEvaluation.create({
          data: { tenantId: clinic.tenantId, patientId: patient, episodeId: otherPatientsEpisode },
        }),
      ).rejects.toThrow(/initial_evaluations_tenant_id_patient_id_episode_id_fkey/);
    });

    it("refuses a scale on another patient's episode", async () => {
      await expect(
        prisma.functionalScale.create({
          data: {
            tenantId: clinic.tenantId,
            patientId: patient,
            episodeId: otherPatientsEpisode,
            scaleType: 'NDI',
            responses: {},
            score: 10,
            interpretation: 'Discapacidad leve (5–14%)',
          },
        }),
      ).rejects.toThrow(/functional_scales_tenant_id_patient_id_episode_id_fkey/);
    });

    it("refuses an appointment with another patient's episode or session, or another clinic's therapist", async () => {
      const appointment = (extra: Record<string, string>) =>
        prisma.appointment.create({
          data: {
            tenantId: clinic.tenantId,
            patientId: patient,
            userId: user.id,
            startsAt: new Date(Date.now() + DAY_MS),
            endsAt: new Date(Date.now() + DAY_MS + 45 * 60_000),
            ...extra,
          },
        });

      await expect(appointment({ episodeId: otherPatientsEpisode })).rejects.toThrow(
        /appointments_tenant_id_patient_id_episode_id_fkey/,
      );
      await expect(appointment({ sessionId: otherPatientsSession })).rejects.toThrow(
        /appointments_tenant_id_patient_id_session_id_fkey/,
      );
      await expect(appointment({ userId: otherClinicsUser.id })).rejects.toThrow(
        /appointments_tenant_id_user_id_fkey/,
      );
      // An appointment of its own patient, with nothing optional, is fine.
      await expect(appointment({ episodeId: episode })).resolves.toBeDefined();
    });
  });

  describe('values stay in range', () => {
    it('refuses a pain outside 0–10', async () => {
      const own = await session();
      await expect(
        prisma.sessionEpisode.create({
          data: { tenantId: clinic.tenantId, patientId: patient, sessionId: own.id, episodeId: episode, painScaleAfter: 11 },
        }),
      ).rejects.toThrow(/session_episodes_pain_after_range/);
    });

    it('refuses a discount larger than the amount', async () => {
      const own = await session();
      await expect(
        prisma.payment.create({
          data: { tenantId: clinic.tenantId, patientId: patient, sessionId: own.id, baseAmountCents: 100, discountCents: 150, finalAmountCents: 0 },
        }),
      ).rejects.toThrow(/payments_discount_within_base/);
    });

    it('refuses a final amount that is not the base minus the discount', async () => {
      const own = await session();
      await expect(
        prisma.payment.create({
          data: { tenantId: clinic.tenantId, patientId: patient, sessionId: own.id, baseAmountCents: 10_000, discountCents: 1_000, finalAmountCents: 10_000 },
        }),
      ).rejects.toThrow(/payments_final_is_base_minus_discount/);
    });

    it('refuses an appointment that ends before it starts', async () => {
      const startsAt = new Date(Date.now() + DAY_MS);
      await expect(
        prisma.appointment.create({
          data: { tenantId: clinic.tenantId, patientId: patient, userId: user.id, startsAt, endsAt: startsAt },
        }),
      ).rejects.toThrow(/appointments_ends_after_start/);
    });

    it('refuses a cancelled appointment without its date, and a date on one that is not cancelled', async () => {
      const startsAt = new Date(Date.now() + DAY_MS);
      const endsAt = new Date(startsAt.getTime() + 45 * 60_000);
      const base = { tenantId: clinic.tenantId, patientId: patient, userId: user.id, startsAt, endsAt };

      await expect(prisma.appointment.create({ data: { ...base, status: 'CANCELLED' } })).rejects.toThrow(
        /appointments_cancelled_has_date/,
      );
      await expect(prisma.appointment.create({ data: { ...base, cancelledAt: new Date() } })).rejects.toThrow(
        /appointments_cancelled_has_date/,
      );
    });

    it('refuses a closed episode without its closing date, and an open one with it', async () => {
      const base = { tenantId: clinic.tenantId, patientId: patient };

      await expect(prisma.clinicalEpisode.create({ data: { ...base, status: 'DISCHARGED' } })).rejects.toThrow(
        /clinical_episodes_closed_has_date/,
      );
      await expect(prisma.clinicalEpisode.create({ data: { ...base, closedAt: new Date() } })).rejects.toThrow(
        /clinical_episodes_closed_has_date/,
      );
    });
  });
});
