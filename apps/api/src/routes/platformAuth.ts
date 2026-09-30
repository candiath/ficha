import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { platformRepo } from '../repositories';
import { signOperatorToken } from '../lib/platformJwt';
import {
  createLoginLimiter,
  HASH_SENUELO,
  isAccountThrottled,
  LOGIN_THROTTLED,
  recordLoginEvent,
} from '../lib/loginGuard';
import { EmailSchema, PasswordSchema } from '../lib/validation';
import { authenticateOperator } from '../middlewares/platformAuth';

// Login del operador de plataforma. Es el espejo de routes/auth.ts con los
// mismos frenos y las mismas propiedades (mensaje único, bcrypt siempre,
// intentos registrados), leyendo de platform_operators y firmando con el
// secreto de plataforma. Los intentos van a login_events con operatorId:
// el freno por cuenta cuenta por email, así que cubre al operador sin más.
const router = Router();

const loginLimiter = createLoginLimiter();
const changePasswordLimiter = createLoginLimiter();

const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1),
});

const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: PasswordSchema,
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'La contraseña nueva debe ser distinta de la actual',
    path: ['newPassword'],
  });

// POST /api/platform/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = LoginSchema.parse(req.body);

  if (await isAccountThrottled(email)) {
    res.status(429).json(LOGIN_THROTTLED);
    return;
  }

  const operator = await platformRepo.findOperatorByEmailForLogin(email);

  // Igual que en el login de la clínica: bcrypt corre siempre, en su propia
  // línea, para que el tiempo no delate si el email tiene cuenta (#71).
  const passwordOk = await bcrypt.compare(password, operator?.passwordHash ?? HASH_SENUELO);

  if (!operator || !operator.isActive || !passwordOk) {
    await recordLoginEvent(req, {
      email,
      tenantId: null,
      userId: null,
      operatorId: operator?.id ?? null,
      success: false,
    });
    res.status(401).json({ error: 'Email o contraseña incorrectos' });
    return;
  }

  void recordLoginEvent(req, {
    email,
    tenantId: null,
    userId: null,
    operatorId: operator.id,
    success: true,
  });
  platformRepo
    .touchOperatorLastLogin(operator.id)
    .catch((err) => console.error('[platform-auth] lastLoginAt', err));

  const token = signOperatorToken(operator.id);

  res.json({
    data: {
      token,
      operator: { id: operator.id, email: operator.email, name: operator.name },
    },
  });
});

// POST /api/platform/auth/change-password
router.post('/change-password', changePasswordLimiter, authenticateOperator, async (req, res) => {
  const { currentPassword, newPassword } = ChangePasswordSchema.parse(req.body);

  const operator = await platformRepo.getOperatorCredentials(req.operator.operatorId);
  if (!operator) {
    res.status(401).json({ error: 'Sesión expirada o inválida' });
    return;
  }

  const valid = await bcrypt.compare(currentPassword, operator.passwordHash);
  if (!valid) {
    res.status(400).json({ error: 'La contraseña actual es incorrecta' });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await platformRepo.updateOperatorPassword(operator.id, passwordHash);

  res.json({ data: { token: signOperatorToken(operator.id) } });
});

// GET /api/platform/auth/me
router.get('/me', authenticateOperator, async (req, res) => {
  const operator = await platformRepo.getOperatorProfile(req.operator.operatorId);
  if (!operator) {
    res.status(401).json({ error: 'Sesión expirada o inválida' });
    return;
  }
  res.json({ data: operator });
});

export default router;
