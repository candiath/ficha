import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { errorHandler } from '../src/middlewares/errorHandler';
import { authenticateOperator } from '../src/middlewares/platformAuth';
import { createPlatformAlertsRouter } from '../src/routes/platformAlerts';
import {
  createTestClinic,
  createTestOperator,
  createTestToken,
  type TestClinic,
  type TestOperator,
} from './helpers';

// The operator's Alertas card (#186, docs/specs/SPEC-sysadmin-alerts.md §6).
// Telegram is a stubbed global fetch; the variables are stubbed per test.

const ALERTS = '/api/platform/alerts';
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const SECRET = TOKEN.split(':')[1];
const CHAT = '987654321';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function configure(token = TOKEN) {
  vi.stubEnv('TELEGRAM_BOT_TOKEN', token);
  vi.stubEnv('TELEGRAM_CHAT_ID', CHAT);
}

function telegram(respond: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    calls.push(url);
    return Promise.resolve(respond(url));
  });
  return calls;
}

function expectNoSecrets(text: string) {
  expect(text).not.toContain(TOKEN);
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain(CHAT);
}

describe('platform alerts', () => {
  let op: TestOperator;
  let clinic: TestClinic;
  const asOperator = (r: request.Test, token = op.token) => r.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    op = await createTestOperator();
    clinic = await createTestClinic();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await op.cleanup();
    await clinic.cleanup();
  });

  // tests/setup.ts empties the variables; Prisma, loaded with the app, reads
  // .env again and must not bring a real token back.
  it('runs with no Telegram configuration, even after Prisma loads .env', () => {
    expect(process.env.TELEGRAM_BOT_TOKEN).toBe('');
    expect(process.env.TELEGRAM_CHAT_ID).toBe('');
    expect(process.env.RENDER_SERVICE_NAME).toBe('');
  });

  it('is for the operator only', async () => {
    const user = await clinic.createUser({ role: 'ADMIN' });

    expect((await request(app).get(ALERTS)).status).toBe(401);
    expect((await asOperator(request(app).get(ALERTS), await createTestToken(user))).status).toBe(401);
    expect((await request(app).post(`${ALERTS}/test`)).status).toBe(401);
  });

  describe('GET /alerts', () => {
    it('says what is missing when Telegram is not configured', async () => {
      const res = await asOperator(request(app).get(ALERTS));

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        environment: 'local',
        configuration: 'not_configured',
        variables: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'],
      });
      expect(Array.isArray(res.body.data.alerts)).toBe(true);
      expect(res.body.data).toHaveProperty('lastDelivery');
      expect(res.body.data).toHaveProperty('lastTest');
      expect(res.body.data).toHaveProperty('undeliveredAlert');
    });

    it('never names the token or the chat', async () => {
      configure();

      const res = await asOperator(request(app).get(ALERTS));

      expect(res.body.data).toMatchObject({ configuration: 'configured', variables: [] });
      expectNoSecrets(res.text);
    });
  });

  describe('GET /alerts/bot', () => {
    it("returns the bot's username", async () => {
      configure();
      telegram(() => json({ ok: true, result: { id: 1, is_bot: true, username: 'ficha_local_bot' } }));

      const res = await asOperator(request(app).get(`${ALERTS}/bot`));

      expect(res.body.data).toEqual({ status: 'ok', username: 'ficha_local_bot' });
    });

    it("reports Telegram's rejection", async () => {
      // Another token: the service remembers the bot of the one above.
      configure('555555555:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
      telegram(() => json({ ok: false, error_code: 401, description: 'Unauthorized' }, 401));

      const res = await asOperator(request(app).get(`${ALERTS}/bot`));

      expect(res.body.data).toEqual({ status: 'error', errorCode: 401, detail: 'Unauthorized' });
      expect(res.text).not.toContain('BBBBBBBBBB');
    });

    it('asks nothing when not configured', async () => {
      const calls = telegram(() => json({ ok: true }));

      const res = await asOperator(request(app).get(`${ALERTS}/bot`));

      expect(res.body.data).toEqual({ status: 'not_configured' });
      expect(calls).toEqual([]);
    });
  });

  describe('POST /alerts/test', () => {
    it('sends a test alert, records it and the operator action, and returns the answer', async () => {
      configure();
      const calls = telegram(() => json({ ok: true, result: { message_id: 1 } }));

      const res = await asOperator(request(app).post(`${ALERTS}/test`));

      expect(res.status).toBe(201);
      expect(res.body.data).toEqual({ alertId: expect.any(String), outcome: 'SENT', errorCode: null, detail: null });
      expect(calls).toEqual([`https://api.telegram.org/bot${TOKEN}/sendMessage`]);
      const alert = await prisma.sysadminAlert.findUniqueOrThrow({
        where: { id: res.body.data.alertId as string },
        include: { deliveries: true },
      });
      expect(alert).toMatchObject({ kind: 'TEST', operatorId: op.operator.id, deliveries: [{ outcome: 'SENT' }] });
      const actions = await prisma.platformAuditLog.findMany({
        where: { operatorId: op.operator.id, action: 'TEST_ALERT_SENT' },
      });
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.every((a) => a.tenantId === null && a.targetUserId === null)).toBe(true);
    });

    it('answers 201 when Telegram rejects the message: the rejection is the result', async () => {
      configure();
      telegram(() => json({ ok: false, error_code: 400, description: 'Bad Request: chat not found' }, 400));

      const res = await asOperator(request(app).post(`${ALERTS}/test`));

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ outcome: 'REJECTED', errorCode: 400, detail: 'Bad Request: chat not found' });
    });

    it('records the attempt when Telegram is not configured', async () => {
      const res = await asOperator(request(app).post(`${ALERTS}/test`));

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ outcome: 'NOT_CONFIGURED', errorCode: null });
    });

    // undici's errors can carry the URL, and the URL carries the token.
    it('never lets the token out, when fetch fails with it in the error', async () => {
      configure();
      const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
      vi.stubGlobal('fetch', () =>
        Promise.reject(new TypeError(`fetch failed: ${url}`, { cause: new Error(`connect ECONNREFUSED ${url}`) })),
      );
      const logged: string[] = [];
      const capture = (...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      };
      vi.spyOn(console, 'log').mockImplementation(capture);
      vi.spyOn(console, 'error').mockImplementation(capture);

      const res = await asOperator(request(app).post(`${ALERTS}/test`));

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ outcome: 'UNREACHABLE', detail: 'TypeError' });
      expectNoSecrets(res.text);
      expectNoSecrets(logged.join('\n'));
      const deliveries = await prisma.sysadminAlertDelivery.findMany({
        where: { alertId: res.body.data.alertId as string },
      });
      expectNoSecrets(JSON.stringify(deliveries));
    });
  });

  // The real router, with a small limit: one counter for every operator,
  // since Telegram limits per chat and they all share the one chat.
  describe('the test limit', () => {
    let other: TestOperator;

    beforeAll(async () => {
      other = await createTestOperator();
    });

    afterAll(() => other.cleanup());

    it('is shared by every operator', async () => {
      const limited = express()
        .use(express.json())
        .use(ALERTS, authenticateOperator, createPlatformAlertsRouter({ testLimitPerMinute: 2 }))
        .use(errorHandler);

      expect((await asOperator(request(limited).post(`${ALERTS}/test`))).status).toBe(201);
      expect((await asOperator(request(limited).post(`${ALERTS}/test`), other.token)).status).toBe(201);
      const third = await asOperator(request(limited).post(`${ALERTS}/test`), other.token);

      expect(third.status).toBe(429);
      expect(third.body).toEqual({ error: 'Demasiadas alertas de prueba. Probá de nuevo en un minuto.' });
    });
  });
});
