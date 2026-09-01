import { postureFamiliesSchema } from '@ficha/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, signTestToken, sleep, type TestClinic } from './helpers';

// La grilla de familias de posturas y las listas de dolor en familia son
// columnas JSONB: Postgres no valida nada de su contenido. Hasta que existió
// @ficha/shared, la ruta tampoco — `z.unknown()` y un `record(string, string)`
// dejaban entrar cualquier cosa, y el significado de cada celda vivía sólo en el
// componente de React que la dibujaba.
//
// Estos tests fijan el invariante en la API: lo que se puede guardar es
// exactamente lo que declara POSTURE_TABLES. Sin ellos, la validación estricta
// es una promesa que nadie verifica.
describe('validación de las familias de la evaluación inicial', () => {
  let clinic: TestClinic;
  let user: User;
  let token: string;
  let patient: { id: string };
  let episode: { id: string };

  const url = () => `/api/patients/${patient.id}/episodes/${episode.id}/evaluation`;

  function put(body: unknown) {
    return request(app).put(url()).set('Authorization', `Bearer ${token}`).send(body);
  }

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
    token = signTestToken(user);
    patient = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName: 'Paciente Familias' },
      select: { id: true },
    });
    episode = await prisma.clinicalEpisode.create({
      data: { tenantId: clinic.tenantId, patientId: patient.id, mainComplaint: 'Cervicalgia' },
      select: { id: true },
    });
  });

  afterAll(async () => {
    await sleep(300);
    await prisma.auditLog.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.initialEvaluation.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.clinicalEpisode.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await clinic.cleanup();
  });

  // --- Lo que sí se puede guardar ---

  it('guarda una grilla con los cuatro tipos de celda y la devuelve igual', async () => {
    const grilla = {
      tabla1: { '2': { P: 'X' }, R: { A: 'x' } },
      tabla2: { '1': { F6: 'x', Reeq: '000', R: true, Pistas: 'revisar cadena posterior' } },
    };

    const res = await put({ postureFamilies: grilla });
    expect(res.status).toBe(200);
    expect(res.body.data.postureFamilies).toEqual(grilla);

    // Ida y vuelta completa: lo que devuelve la API vuelve a validar.
    expect(postureFamiliesSchema.safeParse(res.body.data.postureFamilies).success).toBe(true);
  });

  it('acepta una grilla vacía y las listas de dolor en familia', async () => {
    const res = await put({
      postureFamilies: {},
      familyPainAppearance: ['1', '3'],
      familyPainDisappearance: [],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.familyPainAppearance).toEqual(['1', '3']);
  });

  // --- Lo que no ---

  // Cada caso es una forma distinta de que la definición sea la autoridad: el
  // nombre de la columna, el de la fila, el de la tabla, el tipo del valor, y
  // que una columna válida lo sea sólo en su propia tabla.
  const invalidos: [string, unknown][] = [
    ['una columna que no existe', { tabla2: { '1': { NOPE: 'x' } } }],
    ['una fila fuera de la tabla', { tabla1: { '9': { A: 'x' } } }],
    ['una tabla que no existe', { t1: { '1': { A: 'x' } } }],
    ['una marca fuera de x/X', { tabla1: { '1': { A: 'on' } } }],
    ['el flag como string', { tabla2: { '1': { R: 'on' } } }],
    ['una opción fuera de la lista', { tabla2: { '1': { Reeq: 'ZZ' } } }],
    ['texto vacío en vez de celda ausente', { tabla2: { '1': { Pistas: '' } } }],
    ['una columna de la otra tabla', { tabla1: { '1': { F6: 'x' } } }],
  ];

  it.each(invalidos)('rechaza %s', async (_caso, postureFamilies) => {
    const res = await put({ postureFamilies });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Datos inválidos');
  });

  it('rechaza una familia de dolor que no está en la lista', async () => {
    const res = await put({ familyPainAppearance: ['5'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Datos inválidos');
  });
});
