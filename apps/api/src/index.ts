import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { errorHandler } from './middlewares/errorHandler';
import { prisma } from './lib/prisma';
import alertsRouter from './routes/alerts';
import auditLogRouter from './routes/auditLog';
import bodyRegionsRouter from './routes/bodyRegions';
import consentRouter from './routes/consent';
import evaluationRouter from './routes/evaluations';
import globalSessionsRouter from './routes/globalSessions';
import muscularChainsRouter from './routes/muscularChains';
import packagesRouter from './routes/packages';
import paymentsRouter from './routes/payments';
import patientsRouter from './routes/patients';
import sessionsRouter from './routes/sessions';
import sessionTechniquesRouter from './routes/sessionTechniques';
import techniquesRouter from './routes/techniques';
import treatmentCyclesRouter from './routes/treatmentCycles';
import functionalScalesRouter from './routes/functionalScales';

const app = express();
const PORT = process.env.PORT ?? 3001;

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

app.use('/api/patients', patientsRouter);
app.use('/api/patients/:patientId/evaluation', evaluationRouter);
app.use('/api/patients/:patientId/sessions', sessionsRouter);
app.use('/api/patients/:patientId/sessions/:sessionId/techniques', sessionTechniquesRouter);
app.use('/api/patients/:patientId/audit-log', auditLogRouter);
app.use('/api/patients/:patientId/consent', consentRouter);
app.use('/api/patients/:patientId/cycles', treatmentCyclesRouter);
app.use('/api/patients/:patientId/scales', functionalScalesRouter);
app.use('/api/sessions', globalSessionsRouter);
app.use('/api/techniques', techniquesRouter);
app.use('/api/body-regions', bodyRegionsRouter);
app.use('/api/muscular-chains', muscularChainsRouter);
app.use('/api/packages', packagesRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/alerts', alertsRouter);

// El error handler siempre va al final, después de todas las rutas.
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`[api] corriendo en http://localhost:${PORT}`);
});
