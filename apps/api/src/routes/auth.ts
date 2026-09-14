import { Request, Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { authRepo } from '../repositories';
import { signAccessToken } from '../lib/jwt';
import {
  createLoginLimiter,
  HASH_SENUELO,
  isAccountThrottled,
  LOGIN_THROTTLED,
  recordLoginEvent,
} from '../lib/loginGuard';
import { EmailSchema, PasswordSchema } from '../lib/validation';
import { authenticate } from '../middlewares/auth';

const router = Router();

// Los frenos (por IP y por cuenta), el hash señuelo y la telemetría de
// intentos viven en lib/loginGuard: los comparte el login del operador de
// plataforma, que tiene que estar defendido exactamente igual.
const loginLimiter = createLoginLimiter();

const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1),
});

// Cambiar la contraseña pide la actual, así que también es blanco de
// fuerza bruta (alguien con un token robado probando adivinarla).
const changePasswordLimiter = createLoginLimiter();

const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: PasswordSchema,
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'La contraseña nueva debe ser distinta de la actual',
    path: ['newPassword'],
  });

// user es null cuando el email no corresponde a ninguna cuenta: el evento
// queda sin tenant ni usuario, pero con el email (lo que cuenta el freno).
function recordAttempt(
  req: Request,
  email: string,
  user: { id: string; tenantId: string } | null,
  success: boolean,
): Promise<void> {
  return recordLoginEvent(req, {
    email,
    tenantId: user?.tenantId ?? null,
    userId: user?.id ?? null,
    success,
  });
}

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = LoginSchema.parse(req.body);

  // Antes de buscar el usuario y de bcrypt: un intento frenado no cuesta
  // trabajo ni deja rastro (ver isAccountThrottled).
  if (await isAccountThrottled(email)) {
    res.status(429).json(LOGIN_THROTTLED);
    return;
  }

  const user = await authRepo.findByEmailForLogin(email);

  // Mensaje idéntico para email inexistente, usuario desactivado o
  // contraseña incorrecta: distinguirlos permitiría enumerar qué emails
  // tienen cuenta.
  //
  // Pero el mensaje no alcanzaba: el TIEMPO los distinguía. Antes esto era
  // una sola expresión encadenada, y la evaluación perezosa hacía que bcrypt
  // no llegara a correr cuando el email no existía: 67 ms contra 0. Un
  // atacante prueba una lista de emails con cualquier contraseña y separa los
  // que tienen cuenta — exactamente lo que el mensaje uniforme intentaba
  // impedir (issue #71).
  //
  // Ahora bcrypt corre siempre: sin usuario, contra un hash señuelo. Que
  // `passwordOk` se calcule en su propia línea, ANTES de decidir, es lo que
  // sostiene la propiedad — plegarlo de vuelta dentro del if reintroduce el
  // cortocircuito y con él el canal.
  const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? HASH_SENUELO);

  if (!user || !user.isActive || !passwordOk) {
    await recordAttempt(req, email, user ?? null, false);
    res.status(401).json({ error: 'Email o contraseña incorrectos' });
    return;
  }

  void recordAttempt(req, email, user, true);

  // Fire-and-forget: registrar el acceso no debe demorar ni frustrar el login.
  authRepo
    .touchLastLogin(user.id)
    .catch((err) => console.error('[auth] lastLoginAt', err));

  const token = signAccessToken({ sub: user.id, tenantId: user.tenantId });

  res.json({
    data: {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenant: user.tenant,
      },
    },
  });
});

// POST /api/auth/change-password — requiere la contraseña actual además
// del token: un token robado solo no alcanza para bloquear al dueño real
// de la cuenta cambiándole la contraseña.
router.post('/change-password', changePasswordLimiter, authenticate, async (req, res) => {
  const { currentPassword, newPassword } = ChangePasswordSchema.parse(req.body);

  const user = await authRepo.getCredentials(req.context.userId);

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

  // updatePassword estampa passwordChangedAt, que invalida los tokens
  // emitidos antes del cambio.
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await authRepo.updatePassword(user.id, passwordHash);

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

  const user = await authRepo.getPublicProfile(userId);

  if (!user) {
    res.status(401).json({ error: 'Sesión expirada o inválida' });
    return;
  }

  res.json({ data: user });
});

export default router;
