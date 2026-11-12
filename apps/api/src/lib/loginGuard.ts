import type { Request } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { authRepo } from '../repositories';
import type { LoginAttemptOutcome, LoginRealm } from '../repositories/authRepository';

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
// Se cuenta sobre login_events y no en memoria: sobrevive a los reinicios,
// que es justo lo que el limiter no hace, y registra los intentos contra
// emails que no existen, así que un email desconocido se frena igual que
// uno real y el 429 no sirve para enumerar cuentas.
//
// **Per realm** (area 2 review, M1): the clinic's login, the operator's, and
// the current password asked by each "change password" count apart. A
// success at one door used to clear the streak at another, so a clinic user
// created with the operator's email reset the operator's brake at will.
//
// **Reserved before bcrypt** (L2): the attempt is recorded as a failure,
// under a lock per realm and email, before its password is compared, and
// settled afterwards. Concurrent attempts see each other, so a burst from
// many addresses is counted instead of passing the brake together.
//
// Un login exitoso corta la racha: la persona que se equivocó tres veces y
// después entró no arrastra esos fallos. Y los intentos que el freno rechaza
// no se registran: si contaran, bastaría un request cada quince minutos para
// mantener la cuenta cerrada indefinidamente.
//
// La contracara, inherente a todo bloqueo por cuenta: quien conozca el email
// de una persona puede dejarla afuera del login a fuerza de fallos. Se
// acepta porque el daño es visible y temporal, mientras que el que evita
// —una contraseña adivinada en silencio— no lo es. Con el operador pesa más
// (es la vía de recuperación de una clínica sin ADMIN) y se acepta igual: su
// email no es público y la ventana es corta. Si alguna vez hiciera falta, la
// salida es una lista de IPs de confianza exentas del freno para
// /api/platform/auth, no aflojar el freno.

/**
 * The id of the reserved attempt, or null if the brake holds. `key` is what
 * the brake counts by: the email for a login; for the current password of a
 * "change password", the credential making the guesses (see the routes), so
 * a stolen credential cannot arm the brake against the account's owner.
 */
export function reserveAttempt(req: Request, realm: LoginRealm, key: string): Promise<string | null> {
  return authRepo.reserveLoginAttempt(
    { realm, email: key, ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null },
    { since: new Date(Date.now() - LOGIN_WINDOW_MS), max: LOGIN_MAX_ATTEMPTS },
  );
}

/**
 * Records what the comparison found. A failure is already recorded as one;
 * this adds whose account it was, and turns a success into one. Never
 * rejects: a failure to record is logged and does not undo the login.
 */
export function settleAttempt(
  id: string,
  outcome: Partial<LoginAttemptOutcome> & { success: boolean },
): Promise<void> {
  return authRepo
    .settleLoginAttempt(id, { tenantId: null, userId: null, operatorId: null, ...outcome })
    .catch((err: unknown) => console.error('[auth] loginEvent', err instanceof Error ? err.name : 'error'));
}
