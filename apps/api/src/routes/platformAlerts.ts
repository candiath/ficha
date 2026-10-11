import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { sysadminAlerts } from '../lib/sysadminAlerts';
import { sysadminAlertRepo } from '../repositories';

// The operator's Alertas card (#186, docs/specs/SPEC-sysadmin-alerts.md §6),
// mounted behind authenticateOperator. Nothing here names the bot token or
// the chat id: the configuration is a status and the names of the variables
// that are missing or malformed.

// Telegram asks for about one message per second per chat, and answers 429
// with a wait when a bot goes over; a real alert raised during that wait is
// delayed, or lost. 50 a minute is the limit Nath chose (Decision 3).
export const TEST_ALERTS_PER_MINUTE = 50;

export function createPlatformAlertsRouter({ testLimitPerMinute = TEST_ALERTS_PER_MINUTE } = {}) {
  const router = Router();

  // One counter for every operator: Telegram limits per chat, and they all
  // share the one chat. In memory, like the login limiters.
  const testLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: testLimitPerMinute,
    keyGenerator: () => 'sysadmin-chat',
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas alertas de prueba. Probá de nuevo en un minuto.' },
  });

  // GET /api/platform/alerts — the card and the banner.
  router.get('/', async (_req, res) => {
    const overview = await sysadminAlertRepo.overview();
    res.json({ data: { ...sysadminAlerts.status(), ...overview } });
  });

  // GET /api/platform/alerts/bot — the bot's name, from getMe (cached).
  router.get('/bot', async (_req, res) => {
    res.json({ data: await sysadminAlerts.bot() });
  });

  // POST /api/platform/alerts/test — sends a test alert and waits for
  // Telegram. Its answer is the result, whatever it is: a rejection is not an
  // HTTP error. Recorded in platform_audit_logs (TEST_ALERT_SENT).
  router.post('/test', testLimiter, async (req, res) => {
    res.status(201).json({ data: await sysadminAlerts.sendTest(req.operator) });
  });

  return router;
}

export default createPlatformAlertsRouter();
