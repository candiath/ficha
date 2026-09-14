import type { Request } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { authRepo } from '../repositories';
import type { LoginEventInput } from '../repositories/authRepository';

// Las defensas del login, compartidas entre el de la clínica (/api/auth) y
// el del operador de plataforma (/api/platform/auth). Viven juntas para que
// los dos logins tengan exactamente los mismos frenos y el mismo mensaje:
// una cuenta de operador es la más poderosa del sistema, y sería absurdo
// que estuviera peor defendida que la de una fisioterapeuta.

// Hash señuelo, calculado una vez al arrancar: contra esto se compara cuando
// el email no existe, para que bcrypt corra siempre y el TIEMPO de respuesta
// no distinga un email con cuenta de uno sin (issue #71).
//
// Cost 10, el mismo que usan las contraseñas reales (bcrypt.compare toma el
// costo del hash guardado): si fuera más barato, la diferencia de tiempo
// volvería a delatar el caso.
export const HASH_SENUELO = bcrypt.hashSync('contraseña-que-no-existe', 10);

// Los frenos comparten mensaje y umbral: un solo número que recordar, y
// desde afuera no se distingue cuál de los dos respondió.
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_ATTEMPTS = 10;
export const LOGIN_THROTTLED = { error: 'Demasiados intentos. Probá de nuevo en unos minutos.' };

// Freno por IP: 10 intentos cada 15 minutos es de sobra para un humano y
// frena un diccionario automatizado.
//
// El store es en memoria, así que el presupuesto se reinicia con cada
// arranque — y Render free duerme el servicio tras ~15 minutos sin tráfico.
// No es un agujero MIENTRAS la ventana no supere ese tiempo de inactividad:
// para provocar un reinicio hay que esperar más de lo que dura la ventana,
// y para entonces el presupuesto ya se renovó solo. Alargar la ventana sin
// mover el store a la base sí abriría la brecha.
//
// Una instancia por endpoint: cada limiter lleva su propio contador, así que
// agotar el del login no bloquea el cambio de contraseña ni al revés.
export function createLoginLimiter() {
  return rateLimit({
    windowMs: LOGIN_WINDOW_MS,
    limit: LOGIN_MAX_ATTEMPTS,
    standardHeaders: true,
    legacyHeaders: false,
    message: LOGIN_THROTTLED,
  });
}

// Freno por cuenta, además del freno por IP. El limiter cuenta por IP, y un
// atacante que rota IPs no lo encuentra nunca: contra una cuenta puntual
// podía probar contraseñas sin techo. Esto pone el techo del lado del email:
// diez fallos seguidos en quince minutos y la cuenta no acepta más intentos
// —ni con la contraseña correcta— hasta que el más viejo salga de la ventana.
//
// Se cuenta sobre login_events y no en memoria por dos razones. Sobrevive a
// los reinicios, que es justo lo que el limiter no hace. Y ya registra los
// intentos contra emails que no existen, así que un email desconocido se
// frena igual que uno real: el 429 no sirve para enumerar cuentas. Por lo
// mismo cubre al operador de plataforma sin código aparte: su login registra
// en la misma tabla y cuenta por el mismo email.
//
// Un login exitoso corta la racha: la persona que se equivocó tres veces y
// después entró no arrastra esos fallos. Y los intentos que el freno rechaza
// no se registran: si contaran, bastaría un request cada quince minutos para
// mantener la cuenta cerrada indefinidamente.
//
// La contracara, inherente a todo bloqueo por cuenta: quien conozca el email
// de una persona puede dejarla afuera del login a fuerza de fallos. Se
// acepta porque el daño es visible y temporal, mientras que el que evita
// —una contraseña adivinada en silencio— no lo es.
export async function isAccountThrottled(email: string): Promise<boolean> {
  const since = new Date(Date.now() - LOGIN_WINDOW_MS);
  const attempts = await authRepo.recentLoginAttempts(email, since, LOGIN_MAX_ATTEMPTS);
  return attempts.length >= LOGIN_MAX_ATTEMPTS && attempts.every((a) => !a.success);
}

// Telemetría de seguridad: registra un intento de login (exitoso o no) con
// IP y user-agent. Nunca rechaza: un fallo al registrar se loguea y no
// frustra el login. req.ip es la IP real gracias a trust proxy.
//
// Devuelve la promesa porque el registro de un FALLO se espera: es lo que
// cuenta el freno por cuenta, y responder antes de que aterrice dejaría una
// ventana en la que el siguiente intento no lo ve. El del éxito no sostiene
// nada y puede ser fire-and-forget.
export function recordLoginEvent(
  req: Request,
  input: Omit<LoginEventInput, 'ip' | 'userAgent'>,
): Promise<void> {
  return authRepo
    .recordLoginEvent({
      ...input,
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    })
    .catch((err) => console.error('[auth] loginEvent', err));
}
