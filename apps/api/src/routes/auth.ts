import { Request, Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authRepo } from '../repositories';
import { signAccessToken } from '../lib/jwt';
import { EmailSchema, PasswordSchema } from '../lib/validation';
import { authenticate } from '../middlewares/auth';

const router = Router();

// Hash señuelo, calculado una vez al arrancar: contra esto se compara cuando
// el email no existe. Ver el porqué en el handler del login.
//
// Cost 10, el mismo que usan las contraseñas reales (bcrypt.compare toma el
// costo del hash guardado): si fuera más barato, la diferencia de tiempo
// volvería a delatar el caso.
const HASH_SENUELO = bcrypt.hashSync('contraseña-que-no-existe', 10);

// Los dos frenos del login comparten mensaje y umbral: un solo número que
// recordar, y desde afuera no se distingue cuál de los dos respondió.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_THROTTLED = { error: 'Demasiados intentos. Probá de nuevo en unos minutos.' };

// El login es el endpoint que reciben los ataques de fuerza bruta:
// 10 intentos por IP cada 15 minutos es de sobra para un humano
// y frena un diccionario automatizado.
//
// El store es en memoria, así que el presupuesto se reinicia con cada
// arranque — y Render free duerme el servicio tras ~15 minutos sin tráfico.
// No es un agujero MIENTRAS la ventana no supere ese tiempo de inactividad:
// para provocar un reinicio hay que esperar más de lo que dura la ventana,
// y para entonces el presupuesto ya se renovó solo. Alargar la ventana sin
// mover el store a la base sí abriría la brecha.
const loginLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  limit: LOGIN_MAX_ATTEMPTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: LOGIN_THROTTLED,
});

// Freno por cuenta, además del freno por IP de arriba. El limiter cuenta
// por IP, y un atacante que rota IPs no lo encuentra nunca: contra una
// cuenta puntual podía probar contraseñas sin techo. Esto pone el techo del
// lado del email: diez fallos seguidos en quince minutos y la cuenta no
// acepta más intentos —ni con la contraseña correcta— hasta que el más
// viejo salga de la ventana.
//
// Se cuenta sobre login_events y no en memoria por dos razones. Sobrevive
// a los reinicios, que es justo lo que el limiter no hace. Y ya registra
// los intentos contra emails que no existen, así que un email desconocido
// se frena igual que uno real: el 429 no sirve para enumerar cuentas.
//
// Un login exitoso corta la racha: la persona que se equivocó tres veces y
// después entró no arrastra esos fallos. Y los intentos que el freno
// rechaza no se registran: si contaran, bastaría un request cada quince
// minutos para mantener la cuenta cerrada indefinidamente.
//
// La contracara, inherente a todo bloqueo por cuenta: quien conozca el
// email de una persona puede dejarla afuera del login a fuerza de fallos.
// Se acepta porque el daño es visible y temporal, mientras que el que
// evita —una contraseña adivinada en silencio— no lo es.
async function isAccountThrottled(email: string): Promise<boolean> {
  const since = new Date(Date.now() - LOGIN_WINDOW_MS);
  const attempts = await authRepo.recentLoginAttempts(email, since, LOGIN_MAX_ATTEMPTS);
  return attempts.length >= LOGIN_MAX_ATTEMPTS && attempts.every((a) => !a.success);
}

const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1),
});

// Cambiar la contraseña pide la actual, así que también es blanco de
// fuerza bruta (alguien con un token robado probando adivinarla).
const changePasswordLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  limit: LOGIN_MAX_ATTEMPTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: LOGIN_THROTTLED,
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

// Telemetría de seguridad: registra cada intento de login (exitoso o no)
// con IP y user-agent. Nunca rechaza: un fallo al registrar se loguea y no
// frustra el login. req.ip es la IP real gracias a trust proxy.
// user es null cuando el email no corresponde a ninguna cuenta.
//
// Devuelve la promesa porque el registro de un FALLO se espera: es lo que
// cuenta el freno por cuenta, y responder antes de que aterrice dejaría una
// ventana en la que el siguiente intento no lo ve. El del éxito no sostiene
// nada y sigue siendo fire-and-forget.
function recordLoginEvent(
  req: Request,
  email: string,
  user: { id: string; tenantId: string } | null,
  success: boolean,
): Promise<void> {
  return authRepo
    .recordLoginEvent({
      email,
      tenantId: user?.tenantId ?? null,
      userId: user?.id ?? null,
      success,
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    })
    .catch((err) => console.error('[auth] loginEvent', err));
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
    await recordLoginEvent(req, email, user ?? null, false);
    res.status(401).json({ error: 'Email o contraseña incorrectos' });
    return;
  }

  void recordLoginEvent(req, email, user, true);

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
