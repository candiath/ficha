import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { EmailSchema, PasswordSchema } from '../lib/validation';

// Gestión de usuarios de la clínica. Se monta detrás de authenticate +
// requireRole('ADMIN'): un THERAPIST nunca llega a estos handlers.
const router = Router();

// Lo que un ADMIN ve de los usuarios de su clínica. passwordHash y tenantId
// nunca salen de la API (mismo criterio que publicUserSelect en auth).
const tenantUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
} as const;

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
  const users = await prisma.user.findMany({
    where: { tenantId: req.context.tenantId },
    orderBy: { createdAt: 'asc' },
    select: tenantUserSelect,
  });

  res.json({ data: users });
});

// POST /api/users — crear usuario para la clínica.
router.post('/', async (req, res) => {
  const { email, name, password, role } = CreateUserSchema.parse(req.body);

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const user = await prisma.user.create({
      data: { email, name, passwordHash, role, tenantId: req.context.tenantId },
      select: tenantUserSelect,
    });
    res.status(201).json({ data: user });
  } catch (err) {
    // P2002 = violación del unique de email. El errorHandler global lo
    // convertiría en un 500 opaco; acá sabemos qué significa.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      res.status(409).json({ error: 'Ya existe un usuario con ese email' });
      return;
    }
    throw err;
  }
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

  // Scoped por tenant: un ADMIN no puede tocar usuarios de otra clínica.
  const existing = await prisma.user.findFirst({
    where: { id: req.params.id, tenantId: req.context.tenantId },
    select: { id: true },
  });

  if (!existing) {
    res.status(404).json({ error: 'Usuario no encontrado' });
    return;
  }

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { isActive },
    select: tenantUserSelect,
  });

  res.json({ data: user });
});

export default router;
