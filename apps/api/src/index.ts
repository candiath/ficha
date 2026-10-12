import 'dotenv/config';
import app from './app';
import { checkAuditGuardsAtStartup } from './lib/auditGuards';
import { authSessionRetentionJob, startRetention } from './lib/retention';
import { sysadminAlerts } from './lib/sysadminAlerts';

// Punto de entrada del server: solo carga el entorno y escucha. Toda la
// app (middlewares, rutas, validación de config) vive en app.ts para que
// los tests puedan importarla sin abrir un puerto.
const PORT = process.env.PORT ?? 3001;

app.listen(PORT, () => {
  console.log(`[api] corriendo en http://localhost:${PORT}`);
  // Which alerts can go out, by name only (SPEC-sysadmin-alerts.md §7).
  const { configuration, variables } = sysadminAlerts.status();
  console.log(
    `[alerts] Telegram: ${configuration.replace('_', ' ')}${variables.length ? ` (${variables.join(', ')})` : ''}`,
  );
  // Here and not in app.ts, so tests don't run it. Never awaited: the server
  // serves whatever the check says.
  void checkAuditGuardsAtStartup().catch((error: unknown) => {
    console.error('[audit] startup check crashed:', error);
  });
  // Retention purges (#178): a minute after start, then daily, off every
  // request; the timers never keep the process alive.
  startRetention([authSessionRetentionJob]);
});
