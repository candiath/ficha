import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { DAY_MS } from '../src/lib/clinicalDate';
import { createEncounterFixture, deleteAuditRows, createTestClinic, createTestToken, sleep, type TestClinic } from './helpers';
import { fixture } from './fixtures';

// GET /api/encounters es la vista de "todas las sesiones" de la clínica: sin un
// paciente en la URL, con el nombre de cada uno y el motivo de cada episodio.
// No tenía ni un test. Lo que importa acá es qué filas entran (solo las del
// tenant, solo las vigentes) y qué trae cada una.
describe('GET /api/encounters: el listado global de la clínica', () => {
  let clinic: TestClinic;
  let clinicB: TestClinic;
  let user: User;
  let token: string;
  let patient: { id: string };
  let episode: { id: string };
  let patientId: string;
  let episodeId: string;
  let encounterConEpisodio: string;
  let encounterSinEpisodio: string;
  let encounterBorrada: string;
  let encounterDeB: string;

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    clinic = await createTestClinic();
    clinicB = await createTestClinic();
    user = await clinic.createUser();
    token = await createTestToken(user);

    patient = await fixture.patient.create({
      data: { tenantId: clinic.tenantId, firstName: 'Paciente', lastName: 'Global' },
      select: { id: true },
    });
    episode = await fixture.clinicalEpisode.create({
      data: { tenantId: clinic.tenantId, patientId: patient.id, mainComplaint: 'Dorsalgia' },
      select: { id: true },
    });

    const crear = async (patientId: string, body: Record<string, unknown> = {}) => {
      const res = await auth(request(app).post(`/api/patients/${patientId}/encounters`)).send({
        encounterDate: new Date().toISOString(),
        ...body,
      });
      expect(res.status).toBe(201);
      return res.body.data.id as string;
    };

    patientId = patient.id;
    episodeId = episode.id;
    encounterConEpisodio = await crear(patient.id, {
      episodes: [{ episodeId: episode.id }],
      encounterDate: new Date(Date.now() - 2 * DAY_MS).toISOString(),
    });
    // Only a note may treat no episode (#238).
    encounterSinEpisodio = await crear(patient.id, {
      encounterType: 'NOTE',
      encounterDate: new Date(Date.now() - 1 * DAY_MS).toISOString(),
    });
    encounterBorrada = await crear(patient.id, { episodes: [{ episodeId: episode.id }] });
    expect(
      (
        await auth(request(app).post(`/api/patients/${patient.id}/encounters/${encounterBorrada}/annul`)).send({
          reason: 'DATA_ENTRY_ERROR',
        })
      ).status,
    ).toBe(204);

    // La sesión de la otra clínica se inserta directo: su usuario no hace
    // falta para nada más.
    const userB = await clinicB.createUser();
    const patientB = await fixture.patient.create({
      data: { tenantId: clinicB.tenantId, firstName: 'Paciente de', lastName: 'B' },
      select: { id: true },
    });
    encounterDeB = (
      await createEncounterFixture({
        tenantId: clinicB.tenantId,
        patientId: patientB.id,
        userId: userB.id,
        encounterDate: new Date(),
      })
    ).id;
  });

  afterAll(async () => {
    await sleep(300);
    const tenantIds = [clinic.tenantId, clinicB.tenantId];
    await deleteAuditRows(tenantIds);
    await prisma.payment.deleteMany({ where: { tenantId: { in: tenantIds } } });
    // An encounter's blocks (#238) restrict its deletion: they go first.
    await prisma.encounterBlock.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.encounter.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.clinicalEpisode.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.patient.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await clinic.cleanup();
    await clinicB.cleanup();
  });

  it('lista las sesiones vigentes de la clínica y ninguna de otra', async () => {
    const res = await auth(request(app).get('/api/encounters'));

    expect(res.status).toBe(200);
    const ids = res.body.data.map((s: { id: string }) => s.id);
    expect(ids).toContain(encounterConEpisodio);
    expect(ids).toContain(encounterSinEpisodio);
    expect(ids).not.toContain(encounterBorrada);
    expect(ids).not.toContain(encounterDeB);
  });

  // An index, not the record (#186, SPEC-list-minimization.md §1): who and
  // when, nothing clinical. The clinical fields and the episodes' complaints
  // are read from the patient's own routes.
  it('each encounter carries only who and when', async () => {
    const edited = await auth(request(app).patch(`/api/patients/${patientId}/encounters/${encounterConEpisodio}`)).send({
      reason: 'DATA_ENTRY_ERROR',
      observations: 'MKobs',
      episodes: [{ episodeId, patientExercises: 'MKresp', painScaleBefore: 7 }],
    });
    expect(edited.status).toBe(200);

    const res = await auth(request(app).get('/api/encounters'));
    const item = res.body.data.find((s: { id: string }) => s.id === encounterConEpisodio);

    expect(Object.keys(item).sort()).toEqual(['createdAt', 'id', 'patient', 'encounterDate', 'encounterType', 'updatedAt']);
    expect(item.patient).toEqual({ id: patient.id, fullName: 'Paciente Global' });
    expect(res.text).not.toMatch(/MKobs|MKresp|Dorsalgia/);
  });

  it('viene ordenado de la más reciente a la más vieja', async () => {
    const res = await auth(request(app).get('/api/encounters'));

    const fechas = res.body.data.map((s: { encounterDate: string }) => s.encounterDate);
    expect(fechas).toEqual([...fechas].sort((a, b) => b.localeCompare(a)));
    const ids = res.body.data.map((s: { id: string }) => s.id);
    expect(ids.indexOf(encounterSinEpisodio)).toBeLessThan(ids.indexOf(encounterConEpisodio));
  });

  // Issue #72, cerrado by design: borrar un paciente lo oculta, no reescribe
  // el pasado. Sus sesiones siguen en el historial, con su nombre.
  it('sigue nombrando al paciente aunque se lo haya borrado', async () => {
    const borrado = await fixture.patient.create({
      data: { tenantId: clinic.tenantId, firstName: 'Paciente Que Se', lastName: 'Borra' },
      select: { id: true },
    });
    const sesion = await auth(request(app).post(`/api/patients/${borrado.id}/encounters`)).send({
      encounterType: 'NOTE',
      encounterDate: new Date().toISOString(),
    });
    expect(sesion.status).toBe(201);
    expect((await auth(request(app).delete(`/api/patients/${borrado.id}`))).status).toBe(204);

    const res = await auth(request(app).get('/api/encounters'));
    const fila = res.body.data.find((s: { id: string }) => s.id === sesion.body.data.id);

    expect(fila).toBeDefined();
    expect(fila.patient).toEqual({ id: borrado.id, fullName: 'Paciente Que Se Borra' });
  });

  it('sin token responde 401', async () => {
    const res = await request(app).get('/api/encounters');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'No autenticado' });
  });
});
