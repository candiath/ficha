import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, signTestToken, sleep, waitFor, type TestClinic } from './helpers';

// La evaluación inicial es 1:1 con el episodio y se escribe con un PUT que es
// upsert. evaluationFamilies.test.ts ya fija qué se puede guardar en las
// columnas JSON; acá va lo otro: que el PUT sea reemplazo completo y no merge
// —un campo ausente se guarda como null, que es lo que hace que borrar un dato
// del formulario lo borre de verdad—, que el episodio mande sobre el 404, y
// que la auditoría distinga el alta de la corrección.
describe('CRUD de la evaluación inicial', () => {
  let clinic: TestClinic;
  let user: User;
  let token: string;
  let patient: { id: string };
  let episode: { id: string };

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const url = (episodeId = episode.id, patientId = patient.id) =>
    `/api/patients/${patientId}/episodes/${episodeId}/evaluation`;

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser({ role: 'ADMIN' });
    token = signTestToken(user);
    patient = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName: 'Paciente Evaluación' },
      select: { id: true },
    });
    episode = await nuevoEpisodio();
  });

  afterAll(async () => {
    await sleep(300);
    await prisma.initialEvaluation.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.auditLog.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.clinicalEpisode.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await clinic.cleanup();
  });

  // Cada test que escribe usa su propio episodio: la evaluación es única por
  // episodio, así que compartirlo acoplaría el alta con la actualización.
  async function nuevoEpisodio() {
    return prisma.clinicalEpisode.create({
      data: { tenantId: clinic.tenantId, patientId: patient.id, mainComplaint: 'Dorsalgia' },
      select: { id: true },
    });
  }

  function auditoria(evaluationId: string, action: 'CREATED' | 'UPDATED') {
    return waitFor(() =>
      prisma.auditLog.findFirst({
        where: {
          tenantId: clinic.tenantId,
          entity: 'EVALUATION',
          entityId: evaluationId,
          action,
        },
        select: { patientId: true, userId: true, description: true },
      }),
    );
  }

  // ── GET ───────────────────────────────────────────────────────────────────

  it('GET de un episodio sin evaluación devuelve data null, no 404', async () => {
    const sinEvaluacion = await nuevoEpisodio();

    const res = await auth(request(app).get(url(sinEvaluacion.id)));

    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  // ── PUT: alta ─────────────────────────────────────────────────────────────

  it('PUT crea la evaluación, la devuelve entera y la audita como alta', async () => {
    const propio = await nuevoEpisodio();

    const res = await auth(request(app).put(url(propio.id))).send({
      reasonForConsultation: 'Dolor dorsal de tres meses',
      medicalHistory: 'Sin cirugías',
      globalPosture: 'Anterior',
      breathingPattern: 'Costal superior',
      morphotype: 'Normolíneo',
      footEvaluation: 'Pie plano bilateral',
      physicalActivity: 'Natación 2x semana',
      painAppearanceMoment: 'A la mañana',
      painFrequency: 'Diaria',
      evaScale: 7,
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      patientId: patient.id,
      episodeId: propio.id,
      reasonForConsultation: 'Dolor dorsal de tres meses',
      medicalHistory: 'Sin cirugías',
      globalPosture: 'Anterior',
      evaScale: 7,
    });
    expect(typeof res.body.data.evaluatedAt).toBe('string');
    expect(res.body.data).not.toHaveProperty('tenantId');

    await expect(auditoria(res.body.data.id, 'CREATED')).resolves.toMatchObject({
      patientId: patient.id,
      userId: user.id,
      description: 'Evaluación inicial registrada',
    });
  });

  // ── PUT: actualización ────────────────────────────────────────────────────

  it('el segundo PUT actualiza la misma fila y la audita como corrección', async () => {
    const propio = await nuevoEpisodio();

    const alta = await auth(request(app).put(url(propio.id))).send({ evaScale: 5 });
    const correccion = await auth(request(app).put(url(propio.id))).send({ evaScale: 3 });

    expect(correccion.status).toBe(200);
    expect(correccion.body.data.id).toBe(alta.body.data.id);
    expect(correccion.body.data.evaScale).toBe(3);

    // Una evaluación por episodio, no dos.
    await expect(
      prisma.initialEvaluation.count({ where: { episodeId: propio.id } }),
    ).resolves.toBe(1);

    await expect(auditoria(alta.body.data.id, 'UPDATED')).resolves.toMatchObject({
      description: 'Evaluación inicial actualizada',
    });
  });

  it('un campo mandado en null se borra', async () => {
    const propio = await nuevoEpisodio();
    await auth(request(app).put(url(propio.id))).send({ notes: 'Primera consulta', evaScale: 8 });

    const res = await auth(request(app).put(url(propio.id))).send({
      notes: null,
      evaScale: null,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.notes).toBeNull();
    expect(res.body.data.evaScale).toBeNull();
  });

  // Este test documenta una inconsistencia, no un invariante querido: el port
  // dice "el PUT es reemplazo completo, un campo ausente se guarda como null",
  // y eso hoy vale sólo para las cuatro columnas JSON —jsonFields() las fuerza
  // a JsonNull—. Un campo escalar ausente ni siquiera llega al update, porque
  // Zod no lo pone en el objeto parseado, así que conserva el valor anterior.
  // O sea que el mismo request borra postureFamilies y preserva notes.
  //
  // No se arregla acá: cuál de las dos semánticas es la correcta es una
  // decisión de diseño (#161), y la web manda el formulario entero, así que
  // hoy no se nota. Si se unifica, este test cambia a propósito.
  it('hoy el campo ausente se comporta distinto según sea escalar o JSON', async () => {
    const propio = await nuevoEpisodio();
    await auth(request(app).put(url(propio.id))).send({
      notes: 'Primera consulta',
      postureFamilies: { tabla1: { '1': { A: 'x' } } },
    });

    const res = await auth(request(app).put(url(propio.id))).send({
      reasonForConsultation: 'Dolor dorsal',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.reasonForConsultation).toBe('Dolor dorsal');
    // El JSON ausente se borra…
    expect(res.body.data.postureFamilies).toBeNull();
    // …y el escalar ausente sobrevive.
    expect(res.body.data.notes).toBe('Primera consulta');
  });

  it('el GET devuelve lo último que se guardó', async () => {
    const propio = await nuevoEpisodio();
    await auth(request(app).put(url(propio.id))).send({ globalPosture: 'Posterior' });

    const res = await auth(request(app).get(url(propio.id)));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ episodeId: propio.id, globalPosture: 'Posterior' });
  });

  // ── Validación ────────────────────────────────────────────────────────────

  it('rechaza una EVA fuera de 0 a 10', async () => {
    const res = await auth(request(app).put(url())).send({ evaScale: 11 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Datos inválidos');
    expect(res.body.details).toHaveProperty('evaScale');
  });

  it('acepta EVA 0: no tener dolor es un dato, no un campo vacío', async () => {
    const propio = await nuevoEpisodio();
    const res = await auth(request(app).put(url(propio.id))).send({ evaScale: 0 });

    expect(res.status).toBe(200);
    expect(res.body.data.evaScale).toBe(0);
  });

  // ── El episodio manda sobre el 404 ────────────────────────────────────────

  it('un episodio inexistente responde 404 en GET y en PUT', async () => {
    const inexistente = randomUUID();

    const get = await auth(request(app).get(url(inexistente)));
    const put = await auth(request(app).put(url(inexistente))).send({ evaScale: 4 });

    expect(get.status).toBe(404);
    expect(get.body.error).toBe('Episodio no encontrado');
    expect(put.status).toBe(404);
  });

  it('un episodio de otro paciente de la misma clínica es 404: no se escribe nada', async () => {
    const otroPaciente = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName: 'Paciente Vecino' },
      select: { id: true },
    });
    const suEpisodio = await prisma.clinicalEpisode.create({
      data: { tenantId: clinic.tenantId, patientId: otroPaciente.id },
      select: { id: true },
    });

    const res = await auth(request(app).put(url(suEpisodio.id))).send({ evaScale: 9 });

    expect(res.status).toBe(404);
    await expect(
      prisma.initialEvaluation.count({ where: { episodeId: suEpisodio.id } }),
    ).resolves.toBe(0);
  });

  it('la evaluación de otra clínica no se lee ni se pisa', async () => {
    const otra = await createTestClinic();
    try {
      const ajeno = await prisma.patient.create({
        data: { tenantId: otra.tenantId, fullName: 'Paciente Ajeno' },
        select: { id: true },
      });
      const suEpisodio = await prisma.clinicalEpisode.create({
        data: { tenantId: otra.tenantId, patientId: ajeno.id },
        select: { id: true },
      });
      await prisma.initialEvaluation.create({
        data: {
          tenantId: otra.tenantId,
          patientId: ajeno.id,
          episodeId: suEpisodio.id,
          notes: 'Historia de otra clínica',
        },
      });

      // Con el patientId ajeno el 404 lo da el paciente; con el propio, el
      // episodio. Las dos combinaciones tienen que dar 404 y dejar la fila
      // de la otra clínica intacta.
      const conPacienteAjeno = await auth(request(app).get(url(suEpisodio.id, ajeno.id)));
      const conPacientePropio = await auth(request(app).put(url(suEpisodio.id))).send({
        notes: 'Pisado',
      });

      expect(conPacienteAjeno.status).toBe(404);
      expect(conPacientePropio.status).toBe(404);
      await expect(
        prisma.initialEvaluation.findFirst({
          where: { episodeId: suEpisodio.id },
          select: { notes: true },
        }),
      ).resolves.toEqual({ notes: 'Historia de otra clínica' });

      await prisma.initialEvaluation.deleteMany({ where: { tenantId: otra.tenantId } });
      await prisma.clinicalEpisode.deleteMany({ where: { tenantId: otra.tenantId } });
      await prisma.patient.deleteMany({ where: { tenantId: otra.tenantId } });
    } finally {
      await otra.cleanup();
    }
  });

  // ── Autenticación ─────────────────────────────────────────────────────────

  it('sin token no se lee ni se escribe', async () => {
    for (const res of await Promise.all([
      request(app).get(url()),
      request(app).put(url()).send({ evaScale: 5 }),
    ])) {
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('No autenticado');
    }
  });
});
