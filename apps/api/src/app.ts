import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { authenticate } from './middlewares/auth';
import { errorHandler } from './middlewares/errorHandler';
import { requireRole } from './middlewares/requireRole';
import { getJwtSecret } from './lib/jwt';
import { pingDatabase } from './lib/prisma';
import alertsRouter from './routes/alerts';
import authRouter from './routes/auth';
import auditLogRouter from './routes/auditLog';
import bodyRegionsRouter from './routes/bodyRegions';
import consentRouter from './routes/consent';
import dashboardRouter from './routes/dashboard';
import episodesRouter from './routes/episodes';
import evaluationRouter from './routes/evaluations';
import globalSessionsRouter from './routes/globalSessions';
import muscularChainsRouter from './routes/muscularChains';
import packagesRouter from './routes/packages';
import paymentsRouter from './routes/payments';
import patientsRouter from './routes/patients';
import sessionsRouter from './routes/sessions';
import sessionTechniquesRouter from './routes/sessionTechniques';
import techniquesRouter from './routes/techniques';
import functionalScalesRouter from './routes/functionalScales';
import usersRouter from './routes/users';

// Arma la app de Express completa (middlewares, rutas, error handler) sin
// levantar el puerto. index.ts la importa para hacer listen; los tests la
// importan para dispararle requests con supertest sin abrir sockets.
const app = express();

// Validar la configuración al armar la app: mejor explotar acá que descubrir
// en el primer login que JWT_SECRET no estaba definido.
getJwtSecret();

// Detrás de un proxy (Render), la IP real del cliente viene en
// X-Forwarded-For; sin esto el rate limiter vería la IP del proxy
// y limitaría a todos los usuarios juntos.
app.set('trust proxy', 1);

// Headers de seguridad estándar (y oculta X-Powered-By: no hace falta
// anunciar qué framework corre detrás).
app.use(helmet());

// CORS: los orígenes reales del frontend vienen de CORS_ORIGIN (exactos,
// separados por coma). Nada de wildcards tipo *.netlify.app: eso dejaría
// entrar a cualquier sitio ajeno hosteado ahí.
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const envOrigins = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Mismo criterio que getJwtSecret: mejor explotar al arrancar que descubrir
// en producción que el frontend quedó bloqueado (o cualquier origen, adentro).
if (IS_PRODUCTION && envOrigins.length === 0) {
  throw new Error(
    'CORS_ORIGIN debe estar definido en producción: orígenes exactos ' +
      'separados por coma, p. ej. https://ficha.netlify.app',
  );
}

// En desarrollo se suman localhost y las IPs de red local (probar desde
// el celular en la misma wifi); en producción solo vale CORS_ORIGIN.
const DEV_ORIGIN_PATTERN =
  /^http:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?$/;

const ALLOWED_ORIGIN: (string | RegExp)[] = IS_PRODUCTION
  ? envOrigins
  : [DEV_ORIGIN_PATTERN, ...envOrigins];

app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());

// Marca del build: string fijo que se bumpea a mano. Sirve para saber qué
// commit está sirviendo realmente un entorno desplegado, que no siempre es
// el último de la branch: si un deploy falla, Render sigue sirviendo el
// build anterior sin que nada en la app lo delate.
const BUILD_MARKER = 'canary-2026-08-15';

app.get('/health', async (_req, res) => {
  try {
    await pingDatabase();
    res.json({ status: 'ok', buildMarker: BUILD_MARKER });
  } catch {
    res.status(503).json({ status: 'error', buildMarker: BUILD_MARKER, error: 'Base de datos no disponible' });
  }
});

// Rutas públicas: login (y el propio /health más arriba).
app.use('/api/auth', authRouter);

// Todo lo que se monta debajo de esta línea requiere un token válido.
// authenticate adjunta req.context = { tenantId, userId, role }, que las rutas
// le pasan a los repositorios: ellos scopean cada query al tenant.
app.use('/api', authenticate);

app.use('/api/patients', patientsRouter);
app.use('/api/patients/:patientId/episodes', episodesRouter);
app.use('/api/patients/:patientId/episodes/:episodeId/evaluation', evaluationRouter);
app.use('/api/patients/:patientId/sessions', sessionsRouter);
app.use('/api/patients/:patientId/sessions/:sessionId/techniques', sessionTechniquesRouter);
app.use('/api/patients/:patientId/audit-log', auditLogRouter);
app.use('/api/patients/:patientId/consent', consentRouter);
app.use('/api/patients/:patientId/scales', functionalScalesRouter);
app.use('/api/sessions', globalSessionsRouter);
app.use('/api/techniques', techniquesRouter);
app.use('/api/body-regions', bodyRegionsRouter);
app.use('/api/muscular-chains', muscularChainsRouter);
app.use('/api/packages', packagesRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/dashboard', dashboardRouter);
// Gestión de usuarios: única zona ADMIN-only de la API por ahora.
app.use('/api/users', requireRole('ADMIN'), usersRouter);

// El error handler siempre va al final, después de todas las rutas.
app.use(errorHandler);

export default app;
