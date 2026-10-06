import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { platformRepo } from '../repositories';
import { SLUG_PATTERN, slugify } from '@ficha/shared';
import { EmailSchema, OptionalTextSchema, PasswordSchema, requiredText } from '../lib/validation';
import { disabledPasswordHash } from '../lib/passwordReset';
import { idParam } from '../middlewares/idParam';

// Rutas del operador de plataforma (issue #153). Se montan detrás de
// authenticateOperator y FUERA de authenticate: acá no hay TenantContext, y
// el tenantId de cada operación viene en la URL, elegido por el operador.
// Tocan clínicas y lo administrativo de sus usuarios; nada clínico entra ni
// sale por acá, y platformRepository es quien lo garantiza.
const router = Router();
router.param('tenantId', idParam('Clínica no encontrada'));
router.param('userId', idParam('Usuario no encontrado'));

const CreateTenantSchema = z.object({
  name: requiredText(2, 'El nombre debe tener al menos 2 caracteres'),
  // Opcional: por defecto sale del nombre, y "" cuenta como no venir. Si viene
  // a mano tiene que tener la misma forma, porque es lo que va a aparecer en
  // URLs.
  slug: OptionalTextSchema.refine((v) => v == null || SLUG_PATTERN.test(v), {
    error: 'El slug solo admite minúsculas, números y guiones simples',
  }),
});

const SetTenantActiveSchema = z.object({
  active: z.boolean(),
});

// El rol no se elige: el operador crea ADMIN, y punto. Los THERAPIST los
// crea la clínica desde su propia pantalla.
const CreateAdminSchema = z.object({
  email: EmailSchema,
  name: requiredText(2, 'El nombre debe tener al menos 2 caracteres'),
  password: PasswordSchema,
});

const UpdateUserSchema = z
  .object({
    isActive: z.boolean().optional(),
    role: z.enum(['ADMIN', 'THERAPIST']).optional(),
  })
  .refine((d) => d.isActive !== undefined || d.role !== undefined, {
    error: 'Indicá qué cambiar: isActive o role',
    path: ['role'],
  });

// GET /api/platform/tenants
router.get('/tenants', async (_req, res) => {
  res.json({ data: await platformRepo.listTenants() });
});

// POST /api/platform/tenants
router.post('/tenants', async (req, res) => {
  const body = CreateTenantSchema.parse(req.body);
  const slug = body.slug ?? slugify(body.name);

  if (!slug) {
    res.status(400).json({ error: 'No se pudo derivar un slug del nombre; indicá uno' });
    return;
  }

  const tenant = await platformRepo.createTenant(req.operator, { name: body.name, slug });
  if (!tenant) {
    res.status(409).json({ error: `Ya existe una clínica con el slug "${slug}"` });
    return;
  }

  res.status(201).json({ data: tenant });
});

// PATCH /api/platform/tenants/:tenantId — desactivar o reactivar la clínica
// entera. Desactivar revoca a todos sus usuarios en el request siguiente.
router.patch('/tenants/:tenantId', async (req, res) => {
  const { active } = SetTenantActiveSchema.parse(req.body);

  const tenant = await platformRepo.setTenantActive(req.operator, req.params.tenantId, active);
  if (!tenant) {
    res.status(404).json({ error: 'Clínica no encontrada' });
    return;
  }

  res.json({ data: tenant });
});

// GET /api/platform/tenants/:tenantId/users
router.get('/tenants/:tenantId/users', async (req, res) => {
  const users = await platformRepo.listTenantUsers(req.params.tenantId);
  if (!users) {
    res.status(404).json({ error: 'Clínica no encontrada' });
    return;
  }
  res.json({ data: users });
});

// POST /api/platform/tenants/:tenantId/users — el primer ADMIN de la clínica
// (o uno más). Es lo que antes hacía el script create-admin, ya borrado.
router.post('/tenants/:tenantId/users', async (req, res) => {
  const { email, name, password } = CreateAdminSchema.parse(req.body);

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await platformRepo.createAdmin(req.operator, req.params.tenantId, {
    email,
    name,
    passwordHash,
  });

  if (!result.ok) {
    if (result.reason === 'tenant_not_found') {
      res.status(404).json({ error: 'Clínica no encontrada' });
      return;
    }
    res.status(409).json({ error: 'Ya existe un usuario con ese email' });
    return;
  }

  res.status(201).json({ data: result.user });
});

// PATCH /api/platform/tenants/:tenantId/users/:userId — delegar ADMIN a un
// usuario existente (o degradarlo, activarlo, desactivarlo). Misma regla que
// la clínica se aplica a sí misma: no queda sin una ADMIN activa.
router.patch('/tenants/:tenantId/users/:userId', async (req, res) => {
  const input = UpdateUserSchema.parse(req.body);

  const result = await platformRepo.updateTenantUser(
    req.operator,
    req.params.tenantId,
    req.params.userId,
    input,
  );

  if (!result.ok) {
    if (result.reason === 'not_found') {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }
    res.status(409).json({
      error: 'La clínica tiene que conservar al menos una persona administradora activa',
    });
    return;
  }

  res.json({ data: result.user });
});

// POST /api/platform/tenants/:tenantId/users/:userId/disconnect-devices —
// closes every session of the user without deactivating her, audited. 204
// with no body, like the clinic's own route: no device count.
router.post('/tenants/:tenantId/users/:userId/disconnect-devices', async (req, res) => {
  const done = await platformRepo.disconnectUserDevices(
    req.operator,
    req.params.tenantId,
    req.params.userId,
  );

  // Nonexistent clinic, or a user who is not in it: same 404.
  if (!done) {
    res.status(404).json({ error: 'Usuario no encontrado' });
    return;
  }

  res.status(204).send();
});

// POST /api/platform/tenants/:tenantId/users/:userId/password-reset — the
// operator's counterpart of POST /api/users/:id/password-reset, audited. The
// raw token leaves the API only in this response.
router.post('/tenants/:tenantId/users/:userId/password-reset', async (req, res) => {
  const result = await platformRepo.createUserPasswordReset(
    req.operator,
    req.params.tenantId,
    req.params.userId,
    {
      disabledPasswordHash: await disabledPasswordHash(),
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    },
  );

  if (!result.ok) {
    if (result.reason === 'not_found') {
      res.status(404).json({ error: 'Usuario no encontrado' });
    } else {
      res.status(409).json({ error: 'El usuario está desactivado' });
    }
    return;
  }

  res.set('Cache-Control', 'no-store');
  res.status(201).json({ data: { token: result.token, expiresAt: result.expiresAt } });
});

// GET /api/platform/tenants/:tenantId/audit-log
router.get('/tenants/:tenantId/audit-log', async (req, res) => {
  const entries = await platformRepo.listAuditLog(req.params.tenantId);
  if (!entries) {
    res.status(404).json({ error: 'Clínica no encontrada' });
    return;
  }
  res.json({ data: entries });
});

// Una ruta de plataforma que no existe es 404 acá mismo. Sin esto caería en
// el `app.use('/api', authenticate)` de abajo y respondería "sesión
// inválida" por traer un token de operador, que confunde.
router.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

export default router;
