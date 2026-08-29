import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { patientRepo } from '../src/repositories';
import type { TenantContext } from '../src/repositories/types';
import { createTestClinic, signTestToken, sleep, type TestClinic } from './helpers';

// patientRepo es el único lugar donde vive la política de borrado lógico:
// TODO método opera sobre pacientes vigentes (deletedAt: null). Antes de estos
// tests, borrar ese filtro del repo dejaba la suite entera en verde.
//
// Dos capas a propósito:
//   1. El repo directo, con un TenantContext armado a mano: fija la política.
//   2. Las rutas por HTTP: ahí el tenantId NO lo pone el test, lo deriva
//      authenticate del JWT contra la DB y lo deja en req.context, que es lo
//      que las rutas le pasan al repo. Es el tramo que la capa 1 no cubre.

let clinicA: TestClinic;
let clinicB: TestClinic;
let userA: User;
let tokenA: string;
let ctxA: TenantContext;
let ctxB: TenantContext;

beforeAll(async () => {
  clinicA = await createTestClinic();
  clinicB = await createTestClinic();
  userA = await clinicA.createUser({ role: 'ADMIN' });
  const userB = await clinicB.createUser({ role: 'ADMIN' });
  tokenA = signTestToken(userA);
  ctxA = { tenantId: clinicA.tenantId, userId: userA.id, role: 'ADMIN' };
  ctxB = { tenantId: clinicB.tenantId, userId: userB.id, role: 'ADMIN' };
});

afterAll(async () => {
  // Las escrituras de auditoría de las rutas son fire-and-forget: darles un
  // instante a aterrizar antes de borrar, o quedan filas que bloquean el
  // delete del paciente por la FK.
  await sleep(300);
  const tenantIds = [clinicA.tenantId, clinicB.tenantId];
  await prisma.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
  // Los hijos no deberían existir (el test de sub-rutas verifica justamente
  // que no se creen), pero si ese test falla las FKs bloquearían el borrado
  // del paciente y el fallo se disfrazaría de error de limpieza.
  await prisma.session.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.sessionPackage.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.clinicalEpisode.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.patient.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await clinicA.cleanup();
  await clinicB.cleanup();
});

// Cada test crea su propio paciente: así el orden de ejecución no importa y un
// test que borra no le saca el piso al siguiente.
function crearPaciente(fullName: string, ctx: TenantContext = ctxA) {
  return patientRepo.create(ctx, { fullName });
}

// Lee la fila cruda con el cliente base (sin scope de tenant ni filtro de
// vigencia): es la única forma de asertar sobre deletedAt, que el DTO no expone.
function filaCruda(id: string) {
  return prisma.patient.findUnique({
    where: { id },
    select: { fullName: true, deletedAt: true, tenantId: true },
  });
}

describe('patientRepo: política de vigencia (repo directo)', () => {
  it('create devuelve el DTO con fechas ISO y sin campos internos', async () => {
    const patient = await patientRepo.create(ctxA, {
      fullName: 'Paciente Nuevo',
      birthDate: new Date('1990-05-10'),
    });

    expect(patient.fullName).toBe('Paciente Nuevo');
    expect(typeof patient.createdAt).toBe('string');
    expect(patient.birthDate).toMatch(/^1990-05-10T/);
    // El select del repo es el contrato con el front: tenantId es interno y
    // deletedAt siempre sería null acá, así que ninguno debe viajar.
    expect(patient).not.toHaveProperty('tenantId');
    expect(patient).not.toHaveProperty('deletedAt');
    // El tenantId lo inyecta el guard a partir del contexto, no el input.
    await expect(filaCruda(patient.id)).resolves.toMatchObject({
      tenantId: clinicA.tenantId,
      deletedAt: null,
    });
  });

  it('list no incluye pacientes borrados', async () => {
    const vigente = await crearPaciente('Vigente en la lista');
    const borrado = await crearPaciente('Borrado en la lista');
    await patientRepo.softDelete(ctxA, borrado.id);

    const ids = (await patientRepo.list(ctxA)).map((p) => p.id);

    expect(ids).toContain(vigente.id);
    expect(ids).not.toContain(borrado.id);
  });

  it('getById devuelve null para un paciente borrado', async () => {
    const patient = await crearPaciente('Borrado para getById');
    await patientRepo.softDelete(ctxA, patient.id);

    await expect(patientRepo.getById(ctxA, patient.id)).resolves.toBeNull();
  });

  it('getById devuelve null para un paciente de otro tenant', async () => {
    const deB = await crearPaciente('Paciente de B', ctxB);

    await expect(patientRepo.getById(ctxA, deB.id)).resolves.toBeNull();
  });

  // exists es el guard que las sub-rutas (sesiones, episodios, paquetes) usan
  // como chequeo de padre: sus tres respuestas son las tres razones de un 404.
  it('exists distingue vigente propio, borrado y ajeno', async () => {
    const vigente = await crearPaciente('Vigente para exists');
    const borrado = await crearPaciente('Borrado para exists');
    await patientRepo.softDelete(ctxA, borrado.id);
    const ajeno = await crearPaciente('Ajeno para exists', ctxB);

    await expect(patientRepo.exists(ctxA, vigente.id)).resolves.toBe(true);
    await expect(patientRepo.exists(ctxA, borrado.id)).resolves.toBe(false);
    await expect(patientRepo.exists(ctxA, ajeno.id)).resolves.toBe(false);
  });

  it('update de un paciente vigente devuelve el DTO ya actualizado', async () => {
    const patient = await crearPaciente('Nombre Viejo');

    const updated = await patientRepo.update(ctxA, patient.id, { phone: '11-2222' });

    expect(updated).toMatchObject({ id: patient.id, phone: '11-2222' });
    // updatedAt lo mueve Prisma con @updatedAt: el DTO debe traer el valor de
    // después de escribir, no el que se leyó antes.
    expect(updated!.updatedAt >= patient.updatedAt).toBe(true);
  });

  // El where con deletedAt viaja en la MISMA query que escribe (updateMany, no
  // update): sin eso habría una ventana entre chequear y actualizar, y un
  // paciente borrado en el medio se podría editar igual.
  it('update de un paciente borrado devuelve null y no lo resucita', async () => {
    const patient = await crearPaciente('Borrado Intacto');
    await patientRepo.softDelete(ctxA, patient.id);

    await expect(
      patientRepo.update(ctxA, patient.id, { fullName: 'Editado post mortem' }),
    ).resolves.toBeNull();

    const fila = await filaCruda(patient.id);
    expect(fila?.fullName).toBe('Borrado Intacto');
    expect(fila?.deletedAt).not.toBeNull();
  });

  it('update de un paciente de otro tenant devuelve null', async () => {
    const deB = await crearPaciente('Intocable de B', ctxB);

    await expect(
      patientRepo.update(ctxA, deB.id, { fullName: 'hackeado' }),
    ).resolves.toBeNull();
    await expect(filaCruda(deB.id)).resolves.toMatchObject({ fullName: 'Intocable de B' });
  });

  it('softDelete marca deletedAt sin borrar la fila', async () => {
    const patient = await crearPaciente('A Borrar');

    await expect(patientRepo.softDelete(ctxA, patient.id)).resolves.toBe(true);

    const fila = await filaCruda(patient.id);
    expect(fila).not.toBeNull();
    expect(fila?.deletedAt).toBeInstanceOf(Date);
  });

  // El deletedAt: null del where hace el borrado idempotente hacia afuera: la
  // segunda vez no hay fila vigente que tocar, así que no se re-marca la fecha
  // (que falsearía cuándo se borró) y la ruta puede devolver 404.
  it('softDelete dos veces devuelve false y conserva la fecha original', async () => {
    const patient = await crearPaciente('Borrado Dos Veces');
    await patientRepo.softDelete(ctxA, patient.id);
    const primeraFecha = (await filaCruda(patient.id))?.deletedAt;

    await expect(patientRepo.softDelete(ctxA, patient.id)).resolves.toBe(false);

    await expect(filaCruda(patient.id)).resolves.toMatchObject({ deletedAt: primeraFecha });
  });

  it('softDelete de un paciente de otro tenant devuelve false', async () => {
    const deB = await crearPaciente('No Borrable desde A', ctxB);

    await expect(patientRepo.softDelete(ctxA, deB.id)).resolves.toBe(false);
    await expect(filaCruda(deB.id)).resolves.toMatchObject({ deletedAt: null });
  });
});

// Acá el TenantContext no lo arma el test: lo deriva authenticate del JWT
// leyendo el tenantId de la DB (no del token) y lo deja en req.context, que es
// lo que las rutas le pasan a patientRepo. Estos tests cubren ese cableado.
describe('patientRepo vía HTTP: el tenant sale del request', () => {
  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${tokenA}`);

  it('GET /api/patients no lista pacientes borrados ni de otro tenant', async () => {
    const vigente = await crearPaciente('Vigente HTTP');
    const borrado = await crearPaciente('Borrado HTTP');
    await patientRepo.softDelete(ctxA, borrado.id);
    const ajeno = await crearPaciente('Ajeno HTTP', ctxB);

    const res = await auth(request(app).get('/api/patients'));

    expect(res.status).toBe(200);
    const ids = res.body.data.map((p: { id: string }) => p.id);
    expect(ids).toContain(vigente.id);
    expect(ids).not.toContain(borrado.id);
    expect(ids).not.toContain(ajeno.id);
  });

  // Mismo 404 en los tres casos (no existe / es de otro tenant / está borrado):
  // distinguirlos le confirmaría a un atacante que el id existe en otra clínica.
  it('GET /api/patients/:id da 404 igual para el borrado y para el ajeno', async () => {
    const borrado = await crearPaciente('Borrado 404');
    await patientRepo.softDelete(ctxA, borrado.id);
    const ajeno = await crearPaciente('Ajeno 404', ctxB);

    for (const id of [borrado.id, ajeno.id]) {
      const res = await auth(request(app).get(`/api/patients/${id}`));
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Paciente no encontrado' });
    }
  });

  it('PATCH /api/patients/:id de otro tenant da 404 y deja la fila intacta', async () => {
    const ajeno = await crearPaciente('Ajeno PATCH', ctxB);

    const res = await auth(request(app).patch(`/api/patients/${ajeno.id}`)).send({
      fullName: 'hackeado',
    });

    expect(res.status).toBe(404);
    await expect(filaCruda(ajeno.id)).resolves.toMatchObject({ fullName: 'Ajeno PATCH' });
  });

  it('DELETE /api/patients/:id borra lógico y el segundo intento da 404', async () => {
    const patient = await crearPaciente('DELETE HTTP');

    const primero = await auth(request(app).delete(`/api/patients/${patient.id}`));
    expect(primero.status).toBe(204);

    const segundo = await auth(request(app).delete(`/api/patients/${patient.id}`));
    expect(segundo.status).toBe(404);
    expect(segundo.body).toEqual({ error: 'Paciente no encontrado' });

    // Borrado lógico: la fila sigue ahí para no romper historia clínica ni FKs.
    await expect(filaCruda(patient.id)).resolves.not.toBeNull();
  });

  // El efecto dominó del borrado lógico, y la razón de que exists() exista:
  // las sub-rutas no repiten el filtro de vigencia, delegan en patientRepo.
  it('un paciente borrado deja de ser padre válido para sus sub-rutas', async () => {
    const patient = await crearPaciente('Padre Borrado');
    await patientRepo.softDelete(ctxA, patient.id);
    const base = `/api/patients/${patient.id}`;

    // Se prueban lecturas y escrituras: que un GET no devuelva nada es
    // cosmético al lado de que un POST cuelgue una fila de un paciente que ya
    // no existe — esa fila queda huérfana, sin pantalla que la muestre.
    const subRutas: Array<[string, request.Test]> = [
      ['GET sesiones', request(app).get(`${base}/sessions`)],
      ['GET episodios', request(app).get(`${base}/episodes`)],
      [
        'POST sesión',
        request(app).post(`${base}/sessions`).send({ sessionDate: new Date().toISOString() }),
      ],
      [
        'POST episodio',
        request(app).post(`${base}/episodes`).send({ mainComplaint: 'Motivo huérfano' }),
      ],
      // Acá el patientId viaja en el BODY, no en la URL: es la otra puerta al
      // mismo guard, y la que un chequeo hecho a mano en cada ruta olvidaría.
      [
        'POST paquete',
        request(app).post('/api/packages').send({
          patientId: patient.id,
          name: 'Paquete huérfano',
          totalSessions: 10,
          pricePerSession: 100,
        }),
      ],
    ];

    for (const [ruta, pedido] of subRutas) {
      const res = await auth(pedido);
      // El segundo argumento de expect nombra la ruta en el mensaje de error:
      // sin eso, un fallo en el loop no dice cuál de las cinco se rompió.
      expect(res.status, ruta).toBe(404);
      expect(res.body, ruta).toEqual({ error: 'Paciente no encontrado' });
    }

    // Contracara de los 404: ninguna escritura rechazada dejó una fila colgada.
    const [sesiones, episodios, paquetes] = await Promise.all([
      prisma.session.count({ where: { patientId: patient.id } }),
      prisma.clinicalEpisode.count({ where: { patientId: patient.id } }),
      prisma.sessionPackage.count({ where: { patientId: patient.id } }),
    ]);
    expect({ sesiones, episodios, paquetes }).toEqual({
      sesiones: 0,
      episodios: 0,
      paquetes: 0,
    });
  });
});
