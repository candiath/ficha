import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import {
  APIFutureDateTolerance,
  APIPastDateTolerance,
  DAY_MS,
  isSessionDateTooFarInFuture,
  isSessionDateTooFarInPast,
} from '../src/lib/sessionDate';
import { createTestClinic, signTestToken, sleep, type TestClinic } from './helpers';

// A4: la política de fecha de sesión vivía sólo en el frontend, donde el tope a
// futuro es una advertencia BLANDA (deja enviar). Un request directo la saltea.
// Estos tests fijan el invariante en la API: error duro por fecha ilegible/vacía
// y tope duro a futuro. Ver .notes/sesiones-fecha-timezone-y-validacion.md.
describe('validación de fecha de sesión en la API', () => {
  let clinic: TestClinic;
  let user: User;
  let token: string;
  let patient: { id: string };

  const url = () => `/api/patients/${patient.id}/sessions`;

  function postWithDate(sessionDate: unknown) {
    return request(app)
      .post(url())
      .set('Authorization', `Bearer ${token}`)
      .send({ sessionDate });
  }

  beforeAll(async () => {
    clinic = await createTestClinic();
    user = await clinic.createUser();
    token = signTestToken(user);
    patient = await prisma.patient.create({
      data: { tenantId: clinic.tenantId, fullName: 'Paciente Fecha' },
      select: { id: true },
    });
  });

  afterAll(async () => {
    await sleep(300);
    await prisma.auditLog.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.session.deleteMany({ where: { tenantId: clinic.tenantId } });
    await prisma.patient.deleteMany({ where: { tenantId: clinic.tenantId } });
    await clinic.cleanup();
  });

  // --- Error duro: fecha ilegible / vacía (equivale al superRefine del form) ---

  it('rechaza una fecha vacía', async () => {
    const res = await postWithDate('');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Datos inválidos');
    expect(res.body.details.sessionDate).toBeDefined();
  });

  it('rechaza un string ilegible', async () => {
    const res = await postWithDate('mañana a la tarde');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Datos inválidos');
  });

  it('rechaza una fecha sin hora (solo YYYY-MM-DD)', async () => {
    const res = await postWithDate('2026-07-19');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Datos inválidos');
  });

  // --- Tope duro a futuro: lo que el frontend NO bloquea ---

  it('acepta la fecha actual', async () => {
    const res = await postWithDate(new Date().toISOString());
    expect(res.status).toBe(201);
  });

  it('rechaza una fecha absurdamente en el futuro', async () => {
    const farFuture = new Date(Date.now() + 400 * DAY_MS).toISOString();
    const res = await postWithDate(farFuture);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Datos inválidos');
    expect(res.body.details.sessionDate).toBeDefined();
  });
});

// Los predicados son la última línea de defensa: reciben un Date ya construido,
// se testean sin DB y deben aguantar cualquier basura que un curl logre colar
// hasta acá. `now` se inyecta para que los bordes sean deterministas.
describe('isSessionDateTooFarInFuture', () => {
  const now = Date.UTC(2026, 6, 19, 12, 0, 0);
  const at = (offset: number) => new Date(now + offset);

  it('la fecha de referencia no está en el futuro', () => {
    expect(isSessionDateTooFarInFuture(at(0), now)).toBe(false);
  });

  it('un adelanto dentro del tope no se rechaza', () => {
    expect(isSessionDateTooFarInFuture(at(APIFutureDateTolerance - 1), now)).toBe(false);
  });

  it('exactamente en el tope se permite (comparación estricta >)', () => {
    expect(isSessionDateTooFarInFuture(at(APIFutureDateTolerance), now)).toBe(false);
  });

  it('un milisegundo más allá del tope se rechaza', () => {
    expect(isSessionDateTooFarInFuture(at(APIFutureDateTolerance + 1), now)).toBe(true);
  });

  it('una fecha absurdamente futura se rechaza', () => {
    expect(isSessionDateTooFarInFuture(at(400 * DAY_MS), now)).toBe(true);
  });

  it('el Date válido más grande (año 275760) se rechaza', () => {
    expect(isSessionDateTooFarInFuture(new Date(8.64e15), now)).toBe(true);
  });

  it('una fecha pasada nunca dispara el tope de futuro', () => {
    expect(isSessionDateTooFarInFuture(at(-400 * DAY_MS), now)).toBe(false);
  });

  it('una fecha pre-1970 (timestamp negativo) no es futuro', () => {
    expect(isSessionDateTooFarInFuture(new Date('1900-01-01T00:00:00.000Z'), now)).toBe(false);
  });

  // Sabotaje: un string ilegible produce Invalid Date → getTime() === NaN, y
  // `NaN > x` es false. Sin el guard se colaría como válido; debe rechazarse.
  it('un Invalid Date se rechaza en vez de colarse', () => {
    expect(isSessionDateTooFarInFuture(new Date('no-soy-fecha'), now)).toBe(true);
    expect(isSessionDateTooFarInFuture(new Date(NaN), now)).toBe(true);
  });
});

describe('isSessionDateTooFarInPast', () => {
  const now = Date.UTC(2026, 6, 19, 12, 0, 0);
  const at = (offset: number) => new Date(now + offset);

  it('la fecha de referencia no está en el pasado', () => {
    expect(isSessionDateTooFarInPast(at(0), now)).toBe(false);
  });

  it('un atraso dentro del tope no se rechaza', () => {
    expect(isSessionDateTooFarInPast(at(-(APIPastDateTolerance - 1)), now)).toBe(false);
  });

  it('exactamente en el tope se permite (comparación estricta >)', () => {
    expect(isSessionDateTooFarInPast(at(-APIPastDateTolerance), now)).toBe(false);
  });

  it('un milisegundo más allá del tope se rechaza', () => {
    expect(isSessionDateTooFarInPast(at(-(APIPastDateTolerance + 1)), now)).toBe(true);
  });

  it('una fecha absurdamente pasada se rechaza', () => {
    expect(isSessionDateTooFarInPast(at(-400 * DAY_MS), now)).toBe(true);
  });

  it('una fecha pre-1970 (timestamp negativo) se rechaza', () => {
    expect(isSessionDateTooFarInPast(new Date('1900-01-01T00:00:00.000Z'), now)).toBe(true);
  });

  // Regresión que arreglamos: una fecha MUY futura no debe reportarse como
  // "demasiado lejos en el pasado". Medir en una sola dirección lo garantiza.
  it('una fecha futura nunca dispara el tope de pasado', () => {
    expect(isSessionDateTooFarInPast(at(400 * DAY_MS), now)).toBe(false);
  });

  it('un Invalid Date se rechaza en vez de colarse', () => {
    expect(isSessionDateTooFarInPast(new Date('no-soy-fecha'), now)).toBe(true);
    expect(isSessionDateTooFarInPast(new Date(NaN), now)).toBe(true);
  });
});
