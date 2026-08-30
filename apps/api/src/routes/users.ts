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

const CreateUserSchema = z.object({
  email: EmailSchema,
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  password: PasswordSchema,
  role: z.enum(['ADMIN', 'THERAPIST']).default('THERAPIST'),
});

const UpdateUserSchema = z.object({
  isActive: z.boolean(),
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

// PATCH /api/users/:id — activar o desactivar un usuario. Desactivar revoca
// el acceso al instante: authenticate chequea isActive en cada request.
router.patch('/:id', async (req, res) => {
  const { isActive } = UpdateUserSchema.parse(req.body);

  // Desactivarse a uno mismo dejaría a la clínica sin un ADMIN capaz
  // de revertirlo.
  if (req.params.id === req.context.userId && !isActive) {
    res.status(400).json({ error: 'No podés desactivar tu propia cuenta' });
    return;
  }

  // null = usuario inexistente o de otra clínica: mismo 404, sin revelar cuál.
  const user = await userRepo.setActive(req.context, req.params.id, isActive);
  if (!user) {
    res.status(404).json({ error: 'Usuario no encontrado' });
    return;
  }

  res.json({ data: user });
});

export default router;
