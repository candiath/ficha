import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { authenticate } from './middlewares/auth';
import { errorHandler } from './middlewares/errorHandler';
import { requireRole } from './middlewares/requireRole';
import { getJwtSecret } from './lib/jwt';
import { prisma } from './lib/prisma';
import alertsRouter from './routes/alerts';
import authRouter from './routes/auth';
import auditLogRouter from './routes/auditLog';
import bodyRegionsRouter from './routes/bodyRegions';
import consentRouter from './routes/consent';
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

const app = express();
const PORT = process.env.PORT ?? 3001;

// Validar la configuración al arrancar: mejor explotar acá que descubrir
// en el primer login que JWT_SECRET no estaba definido.
getJwtSecret();

// Detrás de un proxy (Render), la IP real del cliente viene en
// X-Forwarded-For; sin esto el rate limiter vería la IP del proxy
// y limitaría a todos los usuarios juntos.
app.set('trust proxy', 1);

// Headers de seguridad estándar (y oculta X-Powered-By: no hace falta
// anunciar qué framework corre detrás).
app.use(helmet());

// Permite localhost, IPs locales y el despliegue en Netlify
const ALLOWED_ORIGIN = [
  /^http:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?$/,
  /^https:\/\/(.+\.)?netlify\.app$/,
];
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());

app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'error', error: 'Base de datos no disponible' });
  }
});

// Rutas públicas: login (y el propio /health más arriba).
app.use('/api/auth', authRouter);

// Todo lo que se monta debajo de esta línea requiere un token válido.
// El middleware adjunta req.context = { tenantId, userId }.
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
// Gestión de usuarios: única zona ADMIN-only de la API por ahora.
app.use('/api/users', requireRole('ADMIN'), usersRouter);

// El error handler siempre va al final, después de todas las rutas.
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`[api] corriendo en http://localhost:${PORT}`);
});
