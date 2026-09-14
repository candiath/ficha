import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { EmailSchema, PasswordSchema } from '../lib/validation';
import { userRepo } from '../repositories';

// Gestión de usuarios de la clínica. Se monta detrás de authenticate +
// requireRole('ADMIN'): un THERAPIST nunca llega a estos handlers.
// Las queries viven en userRepo; acá queda el HTTP: validar el body,
// hashear la contraseña y mapear null a 409/404.
const router = Router();

// Los mismos valores en el alta y en el cambio de rol: un rol que se puede
// asignar al crear se puede asignar después.
const RoleSchema = z.enum(['ADMIN', 'THERAPIST']);

const CreateUserSchema = z.object({
  email: EmailSchema,
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  password: PasswordSchema,
  role: RoleSchema.default('THERAPIST'),
});

// Los dos campos administrativos de un usuario. Un PATCH sin ninguno no pide
// nada: 400 en vez de un 200 que no cambió nada.
const UpdateUserSchema = z
  .object({
    isActive: z.boolean().optional(),
    role: RoleSchema.optional(),
  })
  .refine((d) => d.isActive !== undefined || d.role !== undefined, {
    error: 'Indicá qué cambiar: isActive o role',
    // Con path: el errorHandler responde fieldErrors y descarta los errores
    // de raíz; sin esto el 400 llegaría con `details: {}` y sin explicación.
    path: ['role'],
  });

// GET /api/users — usuarios de la clínica, activos e inactivos.
router.get('/', async (req, res) => {
  const users = await userRepo.list(req.context);
  res.json({ data: users });
});

// POST /api/users — crear usuario para la clínica.
router.post('/', async (req, res) => {
  const { email, name, password, role } = CreateUserSchema.parse(req.body);

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await userRepo.create(req.context, { email, name, passwordHash, role });

  // null = ya existe un usuario con ese email (unique global).
  if (!user) {
    res.status(409).json({ error: 'Ya existe un usuario con ese email' });
    return;
  }

  res.status(201).json({ data: user });
});

// PATCH /api/users/:id — cambiar el rol o activar/desactivar un usuario.
// Las dos cosas aplican al instante: authenticate lee isActive y role de la
// DB en cada request, no del token. Cambiar el rol en vez de borrar y recrear
// la cuenta conserva la auditoría, que apunta al userId.
router.patch('/:id', async (req, res) => {
  const input = UpdateUserSchema.parse(req.body);

  // Desactivarse a uno mismo es cerrarse la puerta desde adentro. Degradarse
  // sí se permite: el repositorio lo frena solo si no queda otra ADMIN.
  if (req.params.id === req.context.userId && input.isActive === false) {
    res.status(400).json({ error: 'No podés desactivar tu propia cuenta' });
    return;
  }

  const result = await userRepo.update(req.context, req.params.id, input);

  if (!result.ok) {
    // not_found = inexistente o de otra clínica: mismo 404, sin revelar cuál.
    if (result.reason === 'not_found') {
      res.status(404).json({ error: 'Usuario no encontrado' });
      return;
    }
    // last_admin: el cambio dejaría a la clínica sin nadie que pueda
    // administrarla — ni revertir esto mismo.
    res.status(409).json({
      error: 'La clínica tiene que conservar al menos una persona administradora activa',
    });
    return;
  }

  res.json({ data: result.user });
});

export default router;
