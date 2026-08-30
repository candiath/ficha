import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { techniqueRepo } from '../src/repositories';
import type { TenantContext } from '../src/repositories/types';
import { createTestClinic, signTestToken, type TestClinic } from './helpers';

// techniqueRepo es el único lugar donde viven el predicado "utilizable =
// global o del tenant" y la política "solo las propias son editables".
// Technique NO está en TENANT_SCOPED_MODELS (tenantId nullable), así que
// ningún guard filtra por tenant fuera de este repo: si el filtro se cae,
// estos tests son la red.
describe('techniqueRepo: política global-o-del-tenant', () => {
  let clinicA: TestClinic;
  let clinicB: TestClinic;
  let ctxA: TenantContext;
  let ctxB: TenantContext;
  let tokenA: string;
  let globalId: string;

  beforeAll(async () => {
    clinicA = await createTestClinic();
    clinicB = await createTestClinic();
    const userA = await clinicA.createUser();
    const userB = await clinicB.createUser();
    tokenA = signTestToken(userA);
    ctxA = { tenantId: clinicA.tenantId, userId: userA.id, role: userA.role };
    ctxB = { tenantId: clinicB.tenantId, userId: userB.id, role: userB.role };

    // Técnica global de prueba, con las mismas marcas que usa el seed
    // (isGlobal: true + tenantId: null).
    const global = await prisma.technique.create({
      data: {
        name: `Global de prueba ${clinicA.tenantId.slice(0, 8)}`,
        isGlobal: true,
        tenantId: null,
      },
      select: { id: true },
    });
    globalId = global.id;
  });

  afterAll(async () => {
    await prisma.technique.deleteMany({
      where: {
        OR: [{ tenantId: { in: [clinicA.tenantId, clinicB.tenantId] } }, { id: globalId }],
      },
    });
    await clinicA.cleanup();
    await clinicB.cleanup();
  });

  it('allUsableByTenant acepta propias y globales, rechaza ajenas e inexistentes', async () => {
    const own = await techniqueRepo.create(ctxA, { name: 'Propia de A' });
    const foreign = await techniqueRepo.create(ctxB, { name: 'Propia de B' });

    await expect(techniqueRepo.allUsableByTenant(ctxA, [])).resolves.toBe(true);
    await expect(techniqueRepo.allUsableByTenant(ctxA, [own.id])).resolves.toBe(true);
    await expect(techniqueRepo.allUsableByTenant(ctxA, [globalId])).resolves.toBe(true);
    await expect(techniqueRepo.allUsableByTenant(ctxA, [own.id, globalId])).resolves.toBe(true);
    // Ids repetidos no deben descontar (dedupe interno antes del count).
    await expect(techniqueRepo.allUsableByTenant(ctxA, [own.id, own.id])).resolves.toBe(true);
    // Una sola ajena o inexistente invalida el lote entero.
    await expect(techniqueRepo.allUsableByTenant(ctxA, [foreign.id])).resolves.toBe(false);
    await expect(techniqueRepo.allUsableByTenant(ctxA, [own.id, foreign.id])).resolves.toBe(false);
    await expect(techniqueRepo.allUsableByTenant(ctxA, [randomUUID()])).resolves.toBe(false);
  });

  it('update no toca técnicas ajenas ni globales', async () => {
    const own = await techniqueRepo.create(ctxA, { name: 'Editable de A' });

    // Ajena: null Y la fila queda intacta — el filtro viaja en el write
    // mismo (updateMany), no en un chequeo previo.
    await expect(techniqueRepo.update(ctxB, own.id, { name: 'Pisada' })).resolves.toBeNull();
    const intact = await prisma.technique.findUnique({
      where: { id: own.id },
      select: { name: true },
    });
    expect(intact?.name).toBe('Editable de A');

    // Global: no editable.
    await expect(techniqueRepo.update(ctxA, globalId, { name: 'Pisada' })).resolves.toBeNull();

    // Propia: sí, y el DTO refleja el cambio.
    const updated = await techniqueRepo.update(ctxA, own.id, { name: 'Renombrada' });
    expect(updated?.name).toBe('Renombrada');
  });

  it('delete solo borra propias', async () => {
    const own = await techniqueRepo.create(ctxA, { name: 'Borrable de A' });

    await expect(techniqueRepo.delete(ctxB, own.id)).resolves.toBe(false);
    await expect(techniqueRepo.delete(ctxA, globalId)).resolves.toBe(false);
    await expect(techniqueRepo.delete(ctxA, own.id)).resolves.toBe(true);
    await expect(prisma.technique.findUnique({ where: { id: own.id } })).resolves.toBeNull();
  });

  // Capa HTTP: el tenant no lo arma el test, lo deriva authenticate del JWT.
  it('PATCH /api/techniques/:id de una técnica ajena responde 404', async () => {
    const foreign = await techniqueRepo.create(ctxB, { name: 'Ajena por HTTP' });

    const res = await request(app)
      .patch(`/api/techniques/${foreign.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'Intento de pisada' });

    expect(res.status).toBe(404);
  });
});
