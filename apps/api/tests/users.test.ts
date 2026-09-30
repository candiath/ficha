import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, signTestToken, type TestClinic } from './helpers';

const USERS = '/api/users';

// Dos clínicas: la B existe para verificar que un ADMIN de la A no puede
// ver ni tocar usuarios ajenos (multi-tenancy es la invariante central).
describe('requireRole + /api/users', () => {
  let clinicA: TestClinic;
  let clinicB: TestClinic;
  let admin: User;
  let therapist: User;
  let outsider: User;
  let adminToken: string;
  let therapistToken: string;

  beforeAll(async () => {
    clinicA = await createTestClinic();
    clinicB = await createTestClinic();
    admin = await clinicA.createUser({ role: 'ADMIN' });
    therapist = await clinicA.createUser();
    outsider = await clinicB.createUser();
    adminToken = signTestToken(admin);
    therapistToken = signTestToken(therapist);
  });

  afterAll(async () => {
    await clinicA.cleanup();
    await clinicB.cleanup();
  });

  it('un THERAPIST recibe 403 en los tres endpoints', async () => {
    // 403 y no 401: está bien autenticado, lo que le falta es permiso.
    const responses = [
      await request(app).get(USERS).set('Authorization', `Bearer ${therapistToken}`),
      await request(app)
        .post(USERS)
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({ email: clinicA.email('intruso'), name: 'Intruso', password: 'clave-larga-123' }),
      await request(app)
        .patch(`${USERS}/${admin.id}`)
        .set('Authorization', `Bearer ${therapistToken}`)
        .send({ isActive: false }),
    ];

    for (const res of responses) {
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'No tenés permisos para esta acción' });
    }
  });

  it('un ADMIN lista solo los usuarios de su clínica, sin campos sensibles', async () => {
    const res = await request(app).get(USERS).set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((u: { id: string }) => u.id);
    expect(ids).toContain(admin.id);
    expect(ids).toContain(therapist.id);
    expect(ids).not.toContain(outsider.id);
    expect(Object.keys(res.body.data[0]).sort()).toEqual([
      'email',
      'id',
      'isActive',
      'lastLoginAt',
      'name',
      'role',
    ]);
  });

  it('crea un usuario en la clínica del ADMIN con rol THERAPIST por defecto', async () => {
    const email = clinicA.email('nueva-fisio');
    const res = await request(app)
      .post(USERS)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email, name: 'Nueva Fisio', password: 'clave-larga-123' });

    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe('THERAPIST');
    expect(res.body.data.isActive).toBe(true);

    // El tenant sale del contexto del ADMIN, no del body: nadie puede crear
    // usuarios en otra clínica por más que lo intente.
    const created = await prisma.user.findUnique({ where: { email } });
    expect(created?.tenantId).toBe(clinicA.tenantId);
  });

  it('un email ya registrado responde 409', async () => {
    const res = await request(app)
      .post(USERS)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: therapist.email, name: 'Duplicada', password: 'clave-larga-123' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Ya existe un usuario con ese email' });
  });

  it('una contraseña que no cumple la política responde 400', async () => {
    const res = await request(app)
      .post(USERS)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: clinicA.email('rechazada'), name: 'Rechazada', password: 'corta' });

    expect(res.status).toBe(400);
  });

  it('un ADMIN no puede desactivar su propia cuenta', async () => {
    // Dejaría a la clínica sin nadie capaz de revertirlo.
    const res = await request(app)
      .patch(`${USERS}/${admin.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'No podés desactivar tu propia cuenta' });
  });

  it('un usuario de otra clínica responde 404, como si no existiera', async () => {
    const res = await request(app)
      .patch(`${USERS}/${outsider.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false });

    expect(res.status).toBe(404);

    const untouched = await prisma.user.findUnique({ where: { id: outsider.id } });
    expect(untouched?.isActive).toBe(true);
  });

  it('desactivar a un usuario revoca su acceso en el request siguiente', async () => {
    const deactivate = await request(app)
      .patch(`${USERS}/${therapist.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false });

    expect(deactivate.status).toBe(200);
    expect(deactivate.body.data.isActive).toBe(false);

    // Sin esperar a que el token expire: authenticate chequea isActive
    // en cada request.
    const revoked = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${therapistToken}`);
    expect(revoked.status).toBe(401);

    // Reactivarlo le devuelve el acceso con el mismo token.
    const reactivate = await request(app)
      .patch(`${USERS}/${therapist.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: true });

    expect(reactivate.status).toBe(200);

    const restored = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${therapistToken}`);
    expect(restored.status).toBe(200);
  });

  it('un PATCH sin isActive ni role responde 400', async () => {
    const res = await request(app)
      .patch(`${USERS}/${therapist.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('un rol que no existe responde 400', async () => {
    const res = await request(app)
      .patch(`${USERS}/${therapist.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'SYSADMIN' });

    expect(res.status).toBe(400);
  });
});

// El rol se cambia sobre la cuenta existente, no borrando y recreando: la
// auditoría apunta al userId. Y la clínica nunca se queda sin una ADMIN
// activa — la regla vive en la query que escribe (whereConservaAdmin).
describe('PATCH /api/users/:id — cambio de rol', () => {
  let clinic: TestClinic;
  let admin: User;
  let adminToken: string;

  const patch = (token: string, id: string, body: object) =>
    request(app).patch(`${USERS}/${id}`).set('Authorization', `Bearer ${token}`).send(body);

  const listUsers = (token: string) =>
    request(app).get(USERS).set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    clinic = await createTestClinic();
    admin = await clinic.createUser({ role: 'ADMIN' });
    adminToken = signTestToken(admin);
  });

  afterAll(async () => {
    await clinic.cleanup();
  });

  it('ascender a ADMIN aplica en el request siguiente, con el mismo token', async () => {
    const colega = await clinic.createUser();
    const colegaToken = signTestToken(colega);

    // Antes: THERAPIST, sin acceso a la gestión de usuarios.
    expect((await listUsers(colegaToken)).status).toBe(403);

    const res = await patch(adminToken, colega.id, { role: 'ADMIN' });
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('ADMIN');

    // authenticate lee el rol de la DB, no del token: no hay que reloguearse.
    expect((await listUsers(colegaToken)).status).toBe(200);

    // Ida y vuelta: al bajarla, pierde el acceso con el mismo token. Deja a
    // `admin` como única ADMIN activa para los tests que siguen.
    expect((await patch(adminToken, colega.id, { role: 'THERAPIST' })).status).toBe(200);
    expect((await listUsers(colegaToken)).status).toBe(403);
  });

  it('degradar a una ADMIN cuando queda otra activa aplica al instante', async () => {
    const segunda = await clinic.createUser({ role: 'ADMIN' });
    const segundaToken = signTestToken(segunda);
    expect((await listUsers(segundaToken)).status).toBe(200);

    const res = await patch(adminToken, segunda.id, { role: 'THERAPIST' });
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('THERAPIST');

    expect((await listUsers(segundaToken)).status).toBe(403);
  });

  it('una ADMIN puede degradarse a sí misma si queda otra', async () => {
    const otraClinica = await createTestClinic();
    try {
      const a = await otraClinica.createUser({ role: 'ADMIN' });
      await otraClinica.createUser({ role: 'ADMIN' });

      const res = await patch(signTestToken(a), a.id, { role: 'THERAPIST' });
      expect(res.status).toBe(200);
      expect(res.body.data.role).toBe('THERAPIST');
    } finally {
      await otraClinica.cleanup();
    }
  });

  it('la última ADMIN activa no puede degradarse: 409 y sigue siendo ADMIN', async () => {
    // A esta altura `admin` es la única ADMIN activa de la clínica.
    const res = await patch(adminToken, admin.id, { role: 'THERAPIST' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/administradora/);

    const sigue = await prisma.user.findUnique({ where: { id: admin.id } });
    expect(sigue?.role).toBe('ADMIN');
    // Y su sesión sigue siendo de ADMIN.
    expect((await listUsers(adminToken)).status).toBe(200);
  });

  it('una ADMIN desactivada no cuenta como "otra"', async () => {
    await clinic.createUser({ role: 'ADMIN', isActive: false });

    const res = await patch(adminToken, admin.id, { role: 'THERAPIST' });
    expect(res.status).toBe(409);
  });

  it('degradar a una ADMIN inactiva se permite: no cambia cuántas activas quedan', async () => {
    const inactiva = await clinic.createUser({ role: 'ADMIN', isActive: false });

    const res = await patch(adminToken, inactiva.id, { role: 'THERAPIST' });
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('THERAPIST');
  });

  it('desactivar a la otra ADMIN se permite, pero después ya nadie puede degradarse', async () => {
    const otraClinica = await createTestClinic();
    try {
      const a = await otraClinica.createUser({ role: 'ADMIN' });
      const b = await otraClinica.createUser({ role: 'ADMIN' });
      const tokenA = signTestToken(a);

      // Con B activa, A puede desactivarla: A sigue ahí.
      expect((await patch(tokenA, b.id, { isActive: false })).status).toBe(200);

      // Ahora A es la última: ni degradarse ella ni degradar a B (que ya no
      // suma) la deja sin salida — solo lo primero se frena.
      expect((await patch(tokenA, a.id, { role: 'THERAPIST' })).status).toBe(409);

      // Reactivar a B vuelve a habilitar la degradación de A.
      expect((await patch(tokenA, b.id, { isActive: true })).status).toBe(200);
      expect((await patch(tokenA, a.id, { role: 'THERAPIST' })).status).toBe(200);
    } finally {
      await otraClinica.cleanup();
    }
  });

  it('rol y estado en el mismo PATCH: desactivar y degradar a la vez', async () => {
    const colega = await clinic.createUser({ role: 'ADMIN' });

    const res = await patch(adminToken, colega.id, { role: 'THERAPIST', isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ role: 'THERAPIST', isActive: false });
  });
});
