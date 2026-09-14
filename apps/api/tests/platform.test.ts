import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import {
  createTestClinic,
  createTestOperator,
  signTestToken,
  TEST_PASSWORD,
  waitFor,
  type TestClinic,
  type TestOperator,
} from './helpers';

const PLATFORM = '/api/platform';

// El operador de plataforma (#153): crea clínicas, les delega su ADMIN, y
// las puede apagar. Y NO ve nada clínico: las respuestas se comparan campo
// por campo contra la vista administrativa.
describe('operador de plataforma', { timeout: 30_000 }, () => {
  let op: TestOperator;
  let clinic: TestClinic;
  // Clínicas creadas por el operador durante la suite, para limpiarlas.
  const createdTenantIds: string[] = [];
  // Cada login sale de una IP distinta: el freno por IP no interviene y el
  // presupuesto de 10 por IP no se agota entre tests.
  let nextIp = 1;

  const asOperator = (r: request.Test) => r.set('Authorization', `Bearer ${op.token}`);

  function operatorLogin(email: string, password: string) {
    return request(app)
      .post(`${PLATFORM}/auth/login`)
      .set('X-Forwarded-For', `10.1.0.${nextIp++}`)
      .send({ email, password });
  }

  beforeAll(async () => {
    op = await createTestOperator();
    clinic = await createTestClinic();
  });

  afterAll(async () => {
    for (const id of createdTenantIds) {
      await prisma.platformAuditLog.deleteMany({ where: { tenantId: id } });
      await prisma.loginEvent.deleteMany({ where: { tenantId: id } });
      await prisma.user.deleteMany({ where: { tenantId: id } });
      await prisma.tenant.delete({ where: { id } });
    }
    await clinic.cleanup();
    await op.cleanup();
  });

  describe('login', () => {
    it('devuelve un token que abre /me y no expone el hash', async () => {
      const res = await operatorLogin(op.operator.email, TEST_PASSWORD);

      expect(res.status).toBe(200);
      expect(Object.keys(res.body.data.operator).sort()).toEqual(['email', 'id', 'name']);

      const me = await request(app)
        .get(`${PLATFORM}/auth/me`)
        .set('Authorization', `Bearer ${res.body.data.token}`);
      expect(me.status).toBe(200);
      expect(me.body.data.id).toBe(op.operator.id);

      // El acceso queda registrado con el operador como actor.
      const event = await waitFor(() =>
        prisma.loginEvent.findFirst({ where: { operatorId: op.operator.id, success: true } }),
      );
      expect(event.tenantId).toBeNull();
      expect(event.userId).toBeNull();
    });

    it('contraseña incorrecta, email inexistente y operador inactivo: el mismo 401', async () => {
      const inactivo = await createTestOperator({ isActive: false });
      try {
        const casos = [
          await operatorLogin(op.operator.email, 'no-es-esta'),
          await operatorLogin('nadie@test.ficha.local', TEST_PASSWORD),
          await operatorLogin(inactivo.operator.email, TEST_PASSWORD),
        ];
        for (const res of casos) {
          expect(res.status).toBe(401);
          expect(res.body).toEqual({ error: 'Email o contraseña incorrectos' });
        }
      } finally {
        await inactivo.cleanup();
      }
    });

    it('diez fallos seguidos frenan la cuenta aunque la contraseña sea la correcta', async () => {
      const blanco = await createTestOperator();
      try {
        for (let i = 0; i < 10; i++) {
          expect((await operatorLogin(blanco.operator.email, 'mal')).status).toBe(401);
        }
        const res = await operatorLogin(blanco.operator.email, TEST_PASSWORD);
        expect(res.status).toBe(429);
      } finally {
        await blanco.cleanup();
      }
    });

    it('un operador desactivado pierde el acceso con el token que ya tenía', async () => {
      const efimero = await createTestOperator();
      try {
        expect(
          (await request(app).get(`${PLATFORM}/auth/me`).set('Authorization', `Bearer ${efimero.token}`)).status,
        ).toBe(200);

        await prisma.platformOperator.update({
          where: { id: efimero.operator.id },
          data: { isActive: false },
        });

        expect(
          (await request(app).get(`${PLATFORM}/auth/me`).set('Authorization', `Bearer ${efimero.token}`)).status,
        ).toBe(401);
      } finally {
        await efimero.cleanup();
      }
    });
  });

  describe('clínicas', () => {
    it('crear una clínica la deja en la lista, sin ADMIN, con auditoría', async () => {
      const res = await asOperator(request(app).post(`${PLATFORM}/tenants`)).send({
        name: `Clínica Nueva ${op.operator.id.slice(0, 8)}`,
      });

      expect(res.status).toBe(201);
      createdTenantIds.push(res.body.data.id);
      expect(res.body.data.slug).toBe(`clinica-nueva-${op.operator.id.slice(0, 8)}`);
      expect(res.body.data.activeAdmins).toBe(0);
      expect(res.body.data.deactivatedAt).toBeNull();

      const list = await asOperator(request(app).get(`${PLATFORM}/tenants`));
      expect(list.status).toBe(200);
      const fila = list.body.data.find((t: { id: string }) => t.id === res.body.data.id);
      expect(fila).toBeDefined();
      // Exactamente los campos administrativos: nada de contacto ni horarios,
      // que son de la clínica, y por supuesto nada clínico.
      expect(Object.keys(fila).sort()).toEqual([
        'activeAdmins',
        'createdAt',
        'deactivatedAt',
        'id',
        'name',
        'slug',
      ]);

      const audit = await asOperator(request(app).get(`${PLATFORM}/tenants/${res.body.data.id}/audit-log`));
      expect(audit.body.data).toHaveLength(1);
      expect(audit.body.data[0]).toMatchObject({
        operatorId: op.operator.id,
        action: 'TENANT_CREATED',
      });
    });

    it('un slug repetido responde 409', async () => {
      const res = await asOperator(request(app).post(`${PLATFORM}/tenants`)).send({
        name: 'Otro nombre',
        slug: clinic.slug,
      });

      expect(res.status).toBe(409);
    });

    it('un slug con mayúsculas o espacios responde 400', async () => {
      const res = await asOperator(request(app).post(`${PLATFORM}/tenants`)).send({
        name: 'Clínica',
        slug: 'Con Espacios',
      });

      expect(res.status).toBe(400);
    });

    it('desactivar la clínica revoca a todos sus usuarios al instante; reactivar los restaura', async () => {
      const admin = await clinic.createUser({ role: 'ADMIN' });
      const adminToken = signTestToken(admin);
      expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);

      const off = await asOperator(request(app).patch(`${PLATFORM}/tenants/${clinic.tenantId}`)).send({
        active: false,
      });
      expect(off.status).toBe(200);
      expect(off.body.data.deactivatedAt).not.toBeNull();

      // Con el token que ya tenía: 401 en el request siguiente.
      expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`)).status).toBe(401);

      // Y el login tampoco entra, con el mismo mensaje que cualquier otro fallo.
      const login = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', `10.1.0.${nextIp++}`)
        .send({ email: admin.email, password: TEST_PASSWORD });
      expect(login.status).toBe(401);
      expect(login.body).toEqual({ error: 'Email o contraseña incorrectos' });

      // Desactivar de nuevo es idempotente: ni mueve la marca ni audita.
      const again = await asOperator(request(app).patch(`${PLATFORM}/tenants/${clinic.tenantId}`)).send({
        active: false,
      });
      expect(again.body.data.deactivatedAt).toBe(off.body.data.deactivatedAt);

      const on = await asOperator(request(app).patch(`${PLATFORM}/tenants/${clinic.tenantId}`)).send({
        active: true,
      });
      expect(on.status).toBe(200);
      expect(on.body.data.deactivatedAt).toBeNull();
      expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);

      const audit = await asOperator(request(app).get(`${PLATFORM}/tenants/${clinic.tenantId}/audit-log`));
      const acciones = audit.body.data.map((a: { action: string }) => a.action);
      expect(acciones.filter((a: string) => a === 'TENANT_DEACTIVATED')).toHaveLength(1);
      expect(acciones.filter((a: string) => a === 'TENANT_REACTIVATED')).toHaveLength(1);
    });

    it('una clínica inexistente responde 404', async () => {
      const res = await asOperator(request(app).patch(`${PLATFORM}/tenants/no-existe`)).send({ active: false });
      expect(res.status).toBe(404);
      expect((await asOperator(request(app).get(`${PLATFORM}/tenants/no-existe/users`))).status).toBe(404);
    });
  });

  describe('usuarios de una clínica', () => {
    let tenantId: string;

    beforeAll(async () => {
      const res = await asOperator(request(app).post(`${PLATFORM}/tenants`)).send({
        name: `Clínica Delegada ${op.operator.id.slice(0, 8)}`,
      });
      tenantId = res.body.data.id;
      createdTenantIds.push(tenantId);
    });

    it('crear el primer ADMIN: esa persona entra por el login de la clínica y administra', async () => {
      const email = clinic.email('primera-admin');
      const res = await asOperator(request(app).post(`${PLATFORM}/tenants/${tenantId}/users`)).send({
        email,
        name: 'Primera Admin',
        password: 'clave-larga-123',
      });

      expect(res.status).toBe(201);
      expect(res.body.data.role).toBe('ADMIN');
      expect(Object.keys(res.body.data).sort()).toEqual([
        'email',
        'id',
        'isActive',
        'lastLoginAt',
        'name',
        'role',
      ]);

      // Y es un ADMIN de verdad, de ESA clínica: se loguea por el camino
      // normal y ve /api/users con solo ella adentro.
      const login = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', `10.1.0.${nextIp++}`)
        .send({ email, password: 'clave-larga-123' });
      expect(login.status).toBe(200);
      expect(login.body.data.user.role).toBe('ADMIN');

      const users = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${login.body.data.token}`);
      expect(users.status).toBe(200);
      expect(users.body.data.map((u: { email: string }) => u.email)).toEqual([email]);

      const tenant = (await asOperator(request(app).get(`${PLATFORM}/tenants`))).body.data.find(
        (t: { id: string }) => t.id === tenantId,
      );
      expect(tenant.activeAdmins).toBe(1);
    });

    it('un email ya usado en cualquier clínica responde 409', async () => {
      const ajeno = await clinic.createUser();
      const res = await asOperator(request(app).post(`${PLATFORM}/tenants/${tenantId}/users`)).send({
        email: ajeno.email,
        name: 'Repetida',
        password: 'clave-larga-123',
      });

      expect(res.status).toBe(409);
    });

    it('delegar ADMIN a un usuario existente aplica en su request siguiente', async () => {
      const fisio = await prisma.user.create({
        data: {
          tenantId,
          email: clinic.email('fisio-delegada'),
          passwordHash: 'x',
          role: 'THERAPIST',
        },
      });
      const fisioToken = signTestToken(fisio);
      expect((await request(app).get('/api/users').set('Authorization', `Bearer ${fisioToken}`)).status).toBe(403);

      const res = await asOperator(
        request(app).patch(`${PLATFORM}/tenants/${tenantId}/users/${fisio.id}`),
      ).send({ role: 'ADMIN' });

      expect(res.status).toBe(200);
      expect(res.body.data.role).toBe('ADMIN');
      expect((await request(app).get('/api/users').set('Authorization', `Bearer ${fisioToken}`)).status).toBe(200);

      const audit = await asOperator(request(app).get(`${PLATFORM}/tenants/${tenantId}/audit-log`));
      expect(audit.body.data[0]).toMatchObject({
        action: 'USER_ROLE_CHANGED',
        targetUserId: fisio.id,
        operatorId: op.operator.id,
      });
    });

    it('la misma regla que la clínica: no se puede degradar a la última ADMIN activa', async () => {
      // Dejar una sola ADMIN activa: degradar a la delegada del test anterior.
      const users: User[] = await prisma.user.findMany({ where: { tenantId, role: 'ADMIN' } });
      expect(users).toHaveLength(2);
      const [primera, delegada] = users;

      expect(
        (
          await asOperator(request(app).patch(`${PLATFORM}/tenants/${tenantId}/users/${delegada.id}`)).send({
            role: 'THERAPIST',
          })
        ).status,
      ).toBe(200);

      const res = await asOperator(
        request(app).patch(`${PLATFORM}/tenants/${tenantId}/users/${primera.id}`),
      ).send({ role: 'THERAPIST' });

      expect(res.status).toBe(409);
      const sigue = await prisma.user.findUnique({ where: { id: primera.id } });
      expect(sigue?.role).toBe('ADMIN');
    });

    it('un usuario de otra clínica responde 404 aunque el id exista', async () => {
      const ajeno = await clinic.createUser();
      const res = await asOperator(
        request(app).patch(`${PLATFORM}/tenants/${tenantId}/users/${ajeno.id}`),
      ).send({ role: 'ADMIN' });

      expect(res.status).toBe(404);
      const intacto = await prisma.user.findUnique({ where: { id: ajeno.id } });
      expect(intacto?.role).toBe('THERAPIST');
    });

    it('la lista de usuarios expone solo lo administrativo', async () => {
      const res = await asOperator(request(app).get(`${PLATFORM}/tenants/${tenantId}/users`));

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      for (const u of res.body.data) {
        expect(Object.keys(u).sort()).toEqual(['email', 'id', 'isActive', 'lastLoginAt', 'name', 'role']);
      }
    });
  });
});
