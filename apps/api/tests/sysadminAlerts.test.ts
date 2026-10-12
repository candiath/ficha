import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { createSysadminAlerts, type SysadminAlertsDeps } from '../src/lib/sysadminAlerts';
import { sysadminAlertRepo } from '../src/repositories';
import type { SysadminAlertRepository } from '../src/repositories/sysadminAlertRepository';
import { createTestOperator, deleteSysadminAlerts, type TestOperator } from './helpers';

// The alerts service (#186, docs/specs/SPEC-sysadmin-alerts.md §4): records
// each alert and each attempt, retries what is worth retrying, and never
// rejects. Telegram is always a fake fetch; the database is the real one,
// and the assertions are on this file's own alerts.

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const CHAT = '987654321';
const ENV = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT, RENDER_SERVICE_NAME: 'ficha-staging' };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const SENT = () => json({ ok: true, result: { message_id: 1 } });

const alertIds: string[] = [];

// The real repository, remembering what it created so the file can clean up.
const trackedRepo: SysadminAlertRepository = {
  ...sysadminAlertRepo,
  async createAlert(kind) {
    const alert = await sysadminAlertRepo.createAlert(kind);
    alertIds.push(alert.id);
    return alert;
  },
};

function setup(responses: (() => Response)[], overrides: Partial<SysadminAlertsDeps> = {}) {
  const texts: string[] = [];
  const sleeps: number[] = [];
  const lines: string[] = [];
  let call = 0;
  const fetch = ((_url: RequestInfo | URL, init?: RequestInit) => {
    // getMe has no body; sendMessage carries the text.
    if (init?.body) texts.push((JSON.parse(init.body as string) as { text: string }).text);
    const respond = responses[Math.min(call++, responses.length - 1)];
    return Promise.resolve(respond());
  }) as typeof globalThis.fetch;
  const alerts = createSysadminAlerts({
    repo: trackedRepo,
    env: () => ENV,
    fetch: () => fetch,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    log: { log: (line: string) => lines.push(line), error: (line: string) => lines.push(line) },
    ...overrides,
  });
  return { alerts, texts, sleeps, lines, calls: () => call };
}

const deliveriesOf = (alertId: string) =>
  prisma.sysadminAlertDelivery.findMany({
    where: { alertId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { outcome: true, errorCode: true, detail: true },
  });

afterAll(async () => {
  if (alertIds.length > 0) await deleteSysadminAlerts(alertIds);
});

describe('raise', () => {
  it('records the alert, sends its fixed message and records the delivery', async () => {
    const { alerts, texts, sleeps } = setup([SENT]);

    await alerts.raise('AUDIT_GUARDS_FAILED');

    const id = alertIds.at(-1)!;
    expect(await prisma.sysadminAlert.findUniqueOrThrow({ where: { id } })).toMatchObject({
      kind: 'AUDIT_GUARDS_FAILED',
      operatorId: null,
    });
    expect(await deliveriesOf(id)).toEqual([{ outcome: 'SENT', errorCode: null, detail: null }]);
    expect(texts).toEqual([
      '[ficha-staging] Falló el chequeo de las tablas de auditoría al arrancar la API (audit-guards.sql). ' +
        'Alguna garantía de la base cambió después del deploy. El detalle está en los logs del servicio.\n' +
        `Alerta ${id}`,
    ]);
    expect(sleeps).toEqual([]);
  });

  it("retries a 429 after Telegram's wait", async () => {
    const { alerts, sleeps } = setup([
      () => json({ ok: false, error_code: 429, description: 'Too Many Requests: retry after 7', parameters: { retry_after: 7 } }, 429),
      SENT,
    ]);

    await alerts.raise('AUDIT_MAINTENANCE_FLAG_PRESENT');

    expect(await deliveriesOf(alertIds.at(-1)!)).toEqual([
      { outcome: 'REJECTED', errorCode: 429, detail: 'Too Many Requests: retry after 7' },
      { outcome: 'SENT', errorCode: null, detail: null },
    ]);
    expect(sleeps).toEqual([7000]);
  });

  it('gives up on a 429 that asks for more than a minute', async () => {
    const { alerts, sleeps } = setup([
      () => json({ ok: false, error_code: 429, parameters: { retry_after: 90 } }, 429),
    ]);

    await alerts.raise('AUDIT_GUARDS_FAILED');

    expect(await deliveriesOf(alertIds.at(-1)!)).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('tries three times when Telegram cannot be reached, then stops', async () => {
    const { alerts, sleeps } = setup([() => new Response('<html>Bad Gateway</html>', { status: 502 })]);

    await alerts.raise('AUDIT_GUARDS_FAILED');

    expect(await deliveriesOf(alertIds.at(-1)!)).toEqual([
      { outcome: 'UNREACHABLE', errorCode: null, detail: 'HTTP 502' },
      { outcome: 'UNREACHABLE', errorCode: null, detail: 'HTTP 502' },
      { outcome: 'UNREACHABLE', errorCode: null, detail: 'HTTP 502' },
    ]);
    expect(sleeps).toEqual([5000, 30000]);
  });

  it('does not retry a rejection that will not change, like a bad token', async () => {
    const { alerts, sleeps } = setup([() => json({ ok: false, error_code: 401, description: 'Unauthorized' }, 401)]);

    await alerts.raise('AUDIT_GUARDS_FAILED');

    expect(await deliveriesOf(alertIds.at(-1)!)).toEqual([
      { outcome: 'REJECTED', errorCode: 401, detail: 'Unauthorized' },
    ]);
    expect(sleeps).toEqual([]);
  });

  it('records the alert without sending when Telegram is not configured', async () => {
    const { alerts, calls } = setup([SENT], { env: () => ({}) });

    await alerts.raise('AUDIT_GUARDS_FAILED');

    expect(await deliveriesOf(alertIds.at(-1)!)).toEqual([
      { outcome: 'NOT_CONFIGURED', errorCode: null, detail: 'TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID' },
    ]);
    expect(calls()).toBe(0);
  });

  // The database may be what is wrong: the message still goes out.
  it('never rejects, and still sends, when nothing else works', async () => {
    const broken: SysadminAlertRepository = {
      ...sysadminAlertRepo,
      createAlert: () => Promise.reject(new Error(`database down, token ${TOKEN}`)),
      recordDelivery: () => Promise.reject(new Error('database down')),
    };
    const texts: string[] = [];
    const lines: string[] = [];
    const alerts = createSysadminAlerts({
      repo: broken,
      env: () => ENV,
      fetch: () =>
        ((_url: RequestInfo | URL, init?: RequestInit) => {
          texts.push((JSON.parse(init?.body as string) as { text: string }).text);
          return Promise.reject(new TypeError(`fetch failed https://api.telegram.org/bot${TOKEN}/sendMessage`));
        }),
      sleep: async () => {},
      log: { log: (line: string) => lines.push(line), error: (line: string) => lines.push(line) },
    });

    await expect(alerts.raise('AUDIT_GUARDS_FAILED')).resolves.toBeUndefined();

    expect(texts).toHaveLength(3);
    expect(texts[0]).toMatch(/Alerta sin registrar/);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain(TOKEN);
    expect(lines.join('\n')).not.toContain(TOKEN.split(':')[1]);
  });

  it('never rejects, even when logging fails', async () => {
    const { alerts } = setup([SENT], {
      log: {
        log: () => {
          throw new Error('stdout closed');
        },
        error: () => {
          throw new Error('stdout closed');
        },
      },
    });

    await expect(alerts.raise('AUDIT_GUARDS_FAILED')).resolves.toBeUndefined();
  });
});

describe('sendTest', () => {
  let operator: TestOperator;

  beforeAll(async () => {
    operator = await createTestOperator();
  });

  afterAll(() => operator.cleanup());

  it("sends once, records the attempt and returns Telegram's answer", async () => {
    const { alerts, texts, sleeps } = setup([
      () => json({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }, 403),
    ]);

    const result = await alerts.sendTest({ operatorId: operator.operator.id });

    expect(result).toEqual({
      alertId: expect.any(String),
      outcome: 'REJECTED',
      errorCode: 403,
      detail: 'Forbidden: bot was blocked by the user',
    });
    expect(await deliveriesOf(result.alertId)).toEqual([
      { outcome: 'REJECTED', errorCode: 403, detail: 'Forbidden: bot was blocked by the user' },
    ]);
    expect(texts).toEqual([
      '[ficha-staging] Alerta de prueba enviada desde /platform. Si la ves, las alertas de este entorno llegan.\n' +
        `Alerta ${result.alertId}`,
    ]);
    expect(sleeps).toEqual([]);
  });
});

describe('status', () => {
  it('names the environment and the configuration, never the values', () => {
    const { alerts } = setup([SENT]);
    expect(alerts.status()).toEqual({ environment: 'ficha-staging', configuration: 'configured', variables: [] });
  });

  it("is 'local' outside Render, and keeps the label to safe characters", () => {
    expect(setup([SENT], { env: () => ({}) }).alerts.status()).toEqual({
      environment: 'local',
      configuration: 'not_configured',
      variables: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'],
    });
    const odd = setup([SENT], { env: () => ({ ...ENV, RENDER_SERVICE_NAME: 'Ficha <b>prod</b>\n' }) });
    expect(odd.alerts.status().environment).toBe('Ficha bprodb');
  });
});

describe('bot', () => {
  const getMe = () => json({ ok: true, result: { id: 1, is_bot: true, username: 'ficha_staging_bot' } });

  it('asks Telegram once, then remembers the answer', async () => {
    const { alerts, calls } = setup([getMe]);

    expect(await alerts.bot()).toEqual({ status: 'ok', username: 'ficha_staging_bot' });
    expect(await alerts.bot()).toEqual({ status: 'ok', username: 'ficha_staging_bot' });
    expect(calls()).toBe(1);
  });

  it('remembers a failure for a minute', async () => {
    let now = new Date('2026-10-11T12:00:00Z');
    const { alerts, calls } = setup(
      [() => json({ ok: false, error_code: 401, description: 'Unauthorized' }, 401), getMe],
      { now: () => now },
    );

    expect(await alerts.bot()).toEqual({ status: 'error', errorCode: 401, detail: 'Unauthorized' });
    expect((await alerts.bot()).status).toBe('error');
    expect(calls()).toBe(1);

    now = new Date(now.getTime() + 61_000);
    expect(await alerts.bot()).toEqual({ status: 'ok', username: 'ficha_staging_bot' });
    expect(calls()).toBe(2);
  });

  it('asks nothing when Telegram is not configured', async () => {
    const { alerts, calls } = setup([getMe], { env: () => ({}) });

    expect(await alerts.bot()).toEqual({ status: 'not_configured' });
    expect(calls()).toBe(0);
  });
});
