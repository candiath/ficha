import type { SysadminAlertKind } from '@prisma/client';
import { sysadminAlertRepo } from '../repositories';
import type {
  RealAlertKind,
  SysadminAlertDeliveryInput,
  SysadminAlertRepository,
} from '../repositories/sysadminAlertRepository';
import type { OperatorContext } from '../repositories/types';
import {
  getTelegramBot,
  readTelegramConfig,
  sendTelegramMessage,
  type TelegramBotResult,
  type TelegramConfig,
  type TelegramResult,
} from './telegram';

// Sysadmin alerts (#186, docs/specs/SPEC-sysadmin-alerts.md §4): what the
// platform operator is told by Telegram. Each alert and each delivery attempt
// leaves a row; a failure to send or to record never reaches whatever raised
// the alert.
//
// No rate limiting yet: the map's "one message per kind every 15 minutes" is
// deferred to a later module.

export const SEND_TIMEOUT_MS = 10_000;
export const BOT_TIMEOUT_MS = 5_000;
// Real alerts only; the operator's test is sent once.
export const MAX_ATTEMPTS = 3;
const RETRY_WAITS_MS = [5_000, 30_000];
// A 429 that asks for a longer wait is given up on, and recorded.
export const MAX_RETRY_AFTER_SECONDS = 60;
// A failed getMe is not asked again for this long, so refreshing the card
// does not call Telegram each time. A success holds for the life of the
// process: the token cannot change without a restart.
const BOT_FAILURE_CACHE_MS = 60_000;

// Spanish: the operator reads them. Fixed text only, never a value: Telegram
// is a third party, and a message is built from this, the environment's label
// and the alert's id, nothing else. The check's own failure text stays in the
// service's logs.
const MESSAGES: Record<SysadminAlertKind, string> = {
  AUDIT_GUARDS_FAILED:
    'Falló el chequeo de las tablas de auditoría al arrancar la API (audit-guards.sql). ' +
    'Alguna garantía de la base cambió después del deploy. El detalle está en los logs del servicio.',
  AUDIT_MAINTENANCE_FLAG_PRESENT:
    'La base tiene la marca de mantenimiento de auditoría (no-audit-maintenance.sql). ' +
    'En este entorno las filas de auditoría se pueden borrar. El detalle está en los logs del servicio.',
  TEST: 'Alerta de prueba enviada desde /platform. Si la ves, las alertas de este entorno llegan.',
};

export interface SysadminAlertsDeps {
  repo: SysadminAlertRepository;
  // Read on every call, and fetch looked up on every call: tests set them per
  // test (vi.stubEnv, vi.stubGlobal).
  env: () => NodeJS.ProcessEnv;
  fetch: () => typeof fetch;
  sleep: (ms: number) => Promise<void>;
  log: Pick<Console, 'log' | 'error'>;
  now?: () => Date;
}

export interface AlertsConfigStatus {
  // The label every message starts with.
  environment: string;
  configuration: TelegramConfig['status'];
  // The names of the missing or malformed variables, never their values.
  variables: string[];
}

export interface TestAlertResult extends SysadminAlertDeliveryInput {
  alertId: string;
}

export interface SysadminAlerts {
  // Records the alert and delivers it, with retries. Never rejects: a caller
  // on a request path writes `void sysadminAlerts.raise(kind)`.
  raise(kind: RealAlertKind): Promise<void>;
  // The operator's test: records the alert with its platform audit row (a
  // failure there is the caller's), sends once, records the attempt, and
  // returns Telegram's answer.
  sendTest(op: OperatorContext): Promise<TestAlertResult>;
  status(): AlertsConfigStatus;
  bot(): Promise<TelegramBotResult>;
}

// RENDER_SERVICE_NAME is set by Render (Ficha, ficha-staging); outside it,
// "local".
export function environmentLabel(env: NodeJS.ProcessEnv): string {
  const name = (env.RENDER_SERVICE_NAME ?? '').replace(/[^A-Za-z0-9 ._-]/g, '').trim().slice(0, 40);
  return name || 'local';
}

export function alertMessage(kind: SysadminAlertKind, alertId: string | null, label: string): string {
  const reference = alertId ? `Alerta ${alertId}` : 'Alerta sin registrar: la base no aceptó la fila.';
  return `[${label}] ${MESSAGES[kind]}\n${reference}`;
}

function toDelivery(result: TelegramResult): SysadminAlertDeliveryInput {
  if (result.outcome === 'SENT') return { outcome: 'SENT', errorCode: null, detail: null };
  if (result.outcome === 'REJECTED') {
    return { outcome: 'REJECTED', errorCode: result.errorCode, detail: result.detail };
  }
  return { outcome: result.outcome, errorCode: null, detail: result.detail };
}

// The wait before the next attempt, or null to stop. Only what may change on
// its own is retried: no answer, Telegram's own trouble, or its rate limit.
// A 400, 401 or 403 is the configuration's, and would fail again.
function retryWait(result: TelegramResult, attempt: number): number | null {
  if (attempt >= MAX_ATTEMPTS) return null;
  const backoff = RETRY_WAITS_MS[attempt - 1];
  if (result.outcome === 'UNREACHABLE') return backoff;
  if (result.outcome !== 'REJECTED') return null;
  if (result.errorCode === 429) {
    if (result.retryAfterSeconds === null) return backoff;
    return result.retryAfterSeconds <= MAX_RETRY_AFTER_SECONDS ? result.retryAfterSeconds * 1000 : null;
  }
  return result.errorCode >= 500 ? backoff : null;
}

function describeDelivery(delivery: SysadminAlertDeliveryInput): string {
  return [delivery.outcome, delivery.errorCode, delivery.detail].filter((part) => part !== null).join(' ');
}

// An error's name and Prisma code, never its message.
function errorName(error: unknown): string {
  const name = error instanceof Error ? error.name : 'unknown error';
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^P\d{4}$/.test(code) ? `${name} ${code}` : name;
}

export function createSysadminAlerts(deps: SysadminAlertsDeps): SysadminAlerts {
  let botCache: { token: string; result: TelegramBotResult; until: number } | null = null;
  const now = () => (deps.now ? deps.now() : new Date()).getTime();

  function log(level: 'log' | 'error', line: string): void {
    try {
      deps.log[level](line);
    } catch {
      // A logger that fails must not turn an alert into a rejection.
    }
  }

  async function send(kind: SysadminAlertKind, alertId: string | null, config: TelegramConfig) {
    const text = alertMessage(kind, alertId, environmentLabel(deps.env()));
    const result = await sendTelegramMessage(config, text, { fetch: deps.fetch(), timeoutMs: SEND_TIMEOUT_MS });
    const delivery = toDelivery(result);
    // Already redacted: the detail went through lib/telegram.ts.
    log(delivery.outcome === 'SENT' ? 'log' : 'error',
      `[alerts] ${kind} ${alertId ?? 'unrecorded'}: ${describeDelivery(delivery)}`);
    if (alertId) {
      try {
        await deps.repo.recordDelivery(alertId, delivery);
      } catch (error) {
        log('error', `[alerts] ${kind} ${alertId}: could not record the attempt (${errorName(error)})`);
      }
    }
    return { result, delivery };
  }

  return {
    async raise(kind) {
      try {
        let alertId: string | null = null;
        try {
          alertId = (await deps.repo.createAlert(kind)).id;
        } catch (error) {
          // The database may be what is wrong: the message still goes out.
          log('error', `[alerts] ${kind}: could not record the alert (${errorName(error)}); sending it anyway`);
        }
        const config = readTelegramConfig(deps.env());
        for (let attempt = 1; ; attempt++) {
          const { result } = await send(kind, alertId, config);
          const wait = retryWait(result, attempt);
          if (wait === null) break;
          await deps.sleep(wait);
        }
      } catch (error) {
        log('error', `[alerts] ${kind}: raising failed (${errorName(error)})`);
      }
    },

    async sendTest(op) {
      const { id } = await deps.repo.createTestAlert(op);
      const { delivery } = await send('TEST', id, readTelegramConfig(deps.env()));
      return { alertId: id, ...delivery };
    },

    status() {
      const env = deps.env();
      const config = readTelegramConfig(env);
      return {
        environment: environmentLabel(env),
        configuration: config.status,
        variables: config.status === 'configured' ? [] : config.variables,
      };
    },

    async bot() {
      const config = readTelegramConfig(deps.env());
      if (config.status !== 'configured') return { status: 'not_configured' };
      if (botCache && botCache.token === config.token && botCache.until > now()) return botCache.result;
      const result = await getTelegramBot(config, { fetch: deps.fetch(), timeoutMs: BOT_TIMEOUT_MS });
      botCache = {
        token: config.token,
        result,
        until: result.status === 'ok' ? Number.POSITIVE_INFINITY : now() + BOT_FAILURE_CACHE_MS,
      };
      return result;
    },
  };
}

export const sysadminAlerts = createSysadminAlerts({
  repo: sysadminAlertRepo,
  env: () => process.env,
  fetch: () => globalThis.fetch,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log: console,
});
