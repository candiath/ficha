import { Request, Router } from 'express';
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

// Cambiar la contraseña pide la actual, así que también es blanco de
// fuerza bruta (alguien con un token robado probando adivinarla).
const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Probá de nuevo en unos minutos.' },
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  // TODO: currentPassword y newPassword podrían ser iguales, pero mas importante
  // es que debería definirse una única vez el schema de Password
  newPassword: z.string().min(8, 'La contraseña nueva debe tener al menos 8 caracteres'),
});

// Lo que se expone del usuario en las respuestas. passwordHash y tenantId
// nunca salen de la API.
const publicUserSelect = { id: true, email: true, name: true, role: true } as const;

// Telemetría de seguridad: registra cada intento de login (exitoso o no)
// con IP y user-agent. Fire-and-forget: un fallo al registrar no debe
// demorar ni frustrar el login. req.ip es la IP real gracias a trust proxy.
// user es null cuando el email no corresponde a ninguna cuenta.
function recordLoginEvent(
  req: Request,
  email: string,
  user: { id: string; tenantId: string } | null,
  success: boolean,
) {
  prisma.loginEvent
    .create({
      data: {
        email,
        tenantId: user?.tenantId ?? null,
        userId: user?.id ?? null,
        success,
        ip: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      },
    })
    .catch((err) => console.error('[auth] loginEvent', err));
}

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
    recordLoginEvent(req, email, user ?? null, false);
    res.status(401).json({ error: 'Email o contraseña incorrectos' });
    return;
  }

  recordLoginEvent(req, email, user, true);

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

// POST /api/auth/change-password — requiere la contraseña actual además
// del token: un token robado solo no alcanza para bloquear al dueño real
// de la cuenta cambiándole la contraseña.
router.post('/change-password', changePasswordLimiter, authenticate, async (req, res) => {
  const { currentPassword, newPassword } = ChangePasswordSchema.parse(req.body);

  const user = await prisma.user.findUnique({
    where: { id: req.context.userId },
    select: { id: true, tenantId: true, passwordHash: true },
  });

  if (!user) {
    res.status(401).json({ error: 'Sesión expirada o inválida' });
    return;
  }

  // 400 y no 401: ante un 401 fuera del login el cliente web borra el token
  // y cierra la sesión, y un typo en la contraseña actual no amerita eso.
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    res.status(400).json({ error: 'La contraseña actual es incorrecta' });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, passwordChangedAt: new Date() },
  });

  // passwordChangedAt invalida los tokens emitidos antes del cambio; este
  // token nuevo evita que la sesión que hizo el cambio quede afuera.
  const token = signAccessToken({ sub: user.id, tenantId: user.tenantId });

  res.json({ data: { token } });
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
