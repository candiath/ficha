import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { createTestClinic, signTestToken, type TestClinic } from './helpers';

// La pantalla de Clínica mostraba datos inventados porque Tenant solo tenía
// nombre y slug. Ahora guarda contacto, CUIT, zona horaria y horario de
// atención — y dos de esos (timezone y el horario) son prerrequisito de la
// agenda, así que la validación importa más de lo que parece: una zona horaria
// basura haría que los turnos aparezcan el día equivocado.
describe('configuración de la clínica', () => {
  let clinic: TestClinic;
  let adminToken: string;
  let therapistToken: string;

  const GET = () => request(app).get('/api/tenant').set('Authorization', `Bearer ${adminToken}`);
  const patch = (token: string) =>
    request(app).patch('/api/tenant').set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    clinic = await createTestClinic();
    adminToken = signTestToken(await clinic.createUser({ role: 'ADMIN' }));
    therapistToken = signTestToken(await clinic.createUser({ role: 'THERAPIST' }));
  });

  afterAll(async () => {
    await clinic.cleanup();
  });

  it('devuelve la configuración con los valores por defecto', async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: clinic.name,
      slug: clinic.slug,
      timezone: 'America/Argentina/Buenos_Aires',
      workdayStart: '08:00',
      workdayEnd: '20:00',
      workdays: [1, 2, 3, 4, 5],
    });
    // Los datos de contacto arrancan vacíos, no inventados.
    expect(res.body.data.address).toBeNull();
    expect(res.body.data.cuit).toBeNull();
  });

  it('no expone el id del tenant', async () => {
    const res = await GET();
    expect(res.body.data.id).toBeUndefined();
  });

  it('un THERAPIST puede leerla pero no editarla', async () => {
    const leida = await request(app)
      .get('/api/tenant')
      .set('Authorization', `Bearer ${therapistToken}`);
    expect(leida.status).toBe(200);

    const editada = await patch(therapistToken).send({ name: 'No debería entrar' });
    expect(editada.status).toBe(403);
  });

  it('un ADMIN actualiza los datos de contacto', async () => {
    const res = await patch(adminToken).send({
      address: 'Av. Siempreviva 742',
      phone: '+54 11 5555-5555',
      specialty: 'Reeducación Postural Global',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.address).toBe('Av. Siempreviva 742');
    expect(res.body.data.specialty).toBe('Reeducación Postural Global');
  });

  it('normaliza el CUIT al formato con guiones, se tipee como se tipee', async () => {
    const sinGuiones = await patch(adminToken).send({ cuit: '30123456789' });
    expect(sinGuiones.body.data.cuit).toBe('30-12345678-9');

    const conGuiones = await patch(adminToken).send({ cuit: '27-98765432-1' });
    expect(conGuiones.body.data.cuit).toBe('27-98765432-1');
  });

  it('rechaza un CUIT que no tenga 11 dígitos', async () => {
    const res = await patch(adminToken).send({ cuit: '3012345' });
    expect(res.status).toBe(400);
  });

  it('un string vacío se guarda como null, no como cadena vacía', async () => {
    const res = await patch(adminToken).send({ email: '', phone: '' });
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBeNull();
    expect(res.body.data.phone).toBeNull();
  });

  it('rechaza una zona horaria que el runtime no conoce', async () => {
    const res = await patch(adminToken).send({ timezone: 'America/Narnia' });
    expect(res.status).toBe(400);
  });

  it('acepta una zona horaria IANA válida', async () => {
    const res = await patch(adminToken).send({ timezone: 'America/Argentina/Cordoba' });
    expect(res.status).toBe(200);
    expect(res.body.data.timezone).toBe('America/Argentina/Cordoba');
  });

  it('rechaza un cierre anterior a la apertura cuando vienen los dos', async () => {
    const res = await patch(adminToken).send({ workdayStart: '18:00', workdayEnd: '09:00' });
    expect(res.status).toBe(400);
  });

  // El schema no puede validar esto solo: el PATCH es parcial y el otro
  // extremo está en la base.
  it('rechaza mover solo la apertura más allá del cierre guardado', async () => {
    await patch(adminToken).send({ workdayStart: '08:00', workdayEnd: '20:00' });

    const res = await patch(adminToken).send({ workdayStart: '22:00' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cierre/i);

    const actual = await GET();
    expect(actual.body.data.workdayStart).toBe('08:00');
  });

  it('rechaza una hora con formato inválido', async () => {
    expect((await patch(adminToken).send({ workdayStart: '25:00' })).status).toBe(400);
    expect((await patch(adminToken).send({ workdayStart: '8am' })).status).toBe(400);
  });

  it('ordena los días de atención y rechaza los repetidos', async () => {
    const ordenados = await patch(adminToken).send({ workdays: [6, 1, 3] });
    expect(ordenados.status).toBe(200);
    expect(ordenados.body.data.workdays).toEqual([1, 3, 6]);

    expect((await patch(adminToken).send({ workdays: [1, 1, 2] })).status).toBe(400);
    expect((await patch(adminToken).send({ workdays: [] })).status).toBe(400);
    expect((await patch(adminToken).send({ workdays: [7] })).status).toBe(400);
  });

  it('el slug no se puede cambiar desde el PATCH', async () => {
    await patch(adminToken).send({ slug: 'slug-nuevo' });

    const res = await GET();
    expect(res.body.data.slug).toBe(clinic.slug);
  });

  it('cada clínica ve la suya', async () => {
    const otra = await createTestClinic();
    try {
      const token = signTestToken(await otra.createUser({ role: 'ADMIN' }));
      const res = await request(app)
        .get('/api/tenant')
        .set('Authorization', `Bearer ${token}`);

      expect(res.body.data.name).toBe(otra.name);
      // El PATCH de arriba no tocó a esta clínica.
      expect(res.body.data.address).toBeNull();
    } finally {
      await otra.cleanup();
    }
  });

  it('la migración deja los defaults en las clínicas que ya existían', async () => {
    // Creada por fuera de la API, como las filas viejas: las columnas nuevas
    // tienen que venir con su default y no con null.
    const fila = await prisma.tenant.findUniqueOrThrow({
      where: { id: clinic.tenantId },
      select: { timezone: true, workdays: true },
    });
    expect(fila.timezone).toBeTruthy();
    expect(fila.workdays.length).toBeGreaterThan(0);
  });
});
