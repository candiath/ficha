import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { signAccessToken } from '../lib/jwt';
import { authenticate } from '../middlewares/auth';

const router = Router();

// El login es el endpoint que reciben los ataques de fuerza bruta:
// 10 intentos por IP cada 15 minutos es de sobra para un humano
// y frena un diccionario automatizado.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Probá de nuevo en unos minutos.' },
});

const LoginSchema = z.object({
  email: z
    .string()
    .email()
    .transform((e) => e.trim().toLowerCase()),
  password: z.string().min(1),
});

// Lo que se expone del usuario en las respuestas. passwordHash y tenantId
// nunca salen de la API.
const publicUserSelect = { id: true, email: true, name: true, role: true } as const;

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = LoginSchema.parse(req.body);

  const user = await prisma.user.findUnique({
    where: { email },
    select: { ...publicUserSelect, tenantId: true, passwordHash: true, isActive: true },
  });

  // Mensaje idéntico para email inexistente, usuario desactivado o
  // contraseña incorrecta: distinguirlos permitiría enumerar qué emails
  // tienen cuenta.
  const valid = user && user.isActive && (await bcrypt.compare(password, user.passwordHash));
  if (!valid) {
    res.status(401).json({ error: 'Email o contraseña incorrectos' });
    return;
  }

  // Fire-and-forget: registrar el acceso no debe demorar ni frustrar el login.
  prisma.user
    .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    .catch((err) => console.error('[auth] lastLoginAt', err));

  const token = signAccessToken({ sub: user.id, tenantId: user.tenantId });

  res.json({
    data: {
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    },
  });
});

// GET /api/auth/me — usuario autenticado actual.
// El frontend lo usa al arrancar para validar el token guardado.
router.get('/me', authenticate, async (req, res) => {
  const { userId } = req.context;
  if (!userId) {
    res.status(401).json({ error: 'Sesión expirada o inválida' });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: publicUserSelect,
  });

  if (!user) {
    res.status(401).json({ error: 'Sesión expirada o inválida' });
    return;
  }

  res.json({ data: user });
});

export default router;
