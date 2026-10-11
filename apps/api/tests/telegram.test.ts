import { describe, expect, it } from 'vitest';
import {
  getTelegramBot,
  readTelegramConfig,
  redact,
  sendTelegramMessage,
  type TelegramConfig,
} from '../src/lib/telegram';

// The Telegram client (#186, docs/specs/SPEC-sysadmin-alerts.md §3): the only
// code that knows the bot token. No database and no network: every test
// passes its own fetch.

// Shaped like a real token, but made up.
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const SECRET = TOKEN.split(':')[1];
const CHAT = '987654321';
const CONFIG: TelegramConfig = { status: 'configured', token: TOKEN, chatId: CHAT };
const OPTS = { timeoutMs: 1000 };

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    const call = { url, init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// Nothing that leaves the client may carry the token, its secret half, or
// the chat id.
function expectNoSecrets(value: unknown) {
  const text = JSON.stringify(value);
  expect(text).not.toContain(TOKEN);
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain(CHAT);
}

describe('readTelegramConfig', () => {
  it('is not configured without the variables, or with empty ones', () => {
    expect(readTelegramConfig({})).toEqual({
      status: 'not_configured',
      variables: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'],
    });
    expect(readTelegramConfig({ TELEGRAM_BOT_TOKEN: ' ', TELEGRAM_CHAT_ID: '' })).toEqual({
      status: 'not_configured',
      variables: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'],
    });
  });

  it('is not configured with only one of them', () => {
    expect(readTelegramConfig({ TELEGRAM_BOT_TOKEN: TOKEN })).toEqual({
      status: 'not_configured',
      variables: ['TELEGRAM_CHAT_ID'],
    });
  });

  it('is configured with a token and a numeric chat id', () => {
    expect(readTelegramConfig({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT })).toEqual(CONFIG);
    expect(readTelegramConfig({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '-1001234567890' }).status).toBe(
      'configured',
    );
  });

  // A token that could add a path segment, a query or a fragment to the URL
  // never reaches it.
  it.each([
    `${TOKEN}/../getUpdates`,
    `${TOKEN}?x=1`,
    `${TOKEN}#x`,
    'not-a-token',
    '123:short',
  ])('rejects the malformed token %s', (token) => {
    const config = readTelegramConfig({ TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: CHAT });
    expect(config).toEqual({ status: 'invalid', variables: ['TELEGRAM_BOT_TOKEN'] });
    expectNoSecrets(config);
  });

  // @channelname only reaches public channels, which anyone can read.
  it.each(['@ficha_alerts', '1234', 'abc', '12 34'])('rejects the chat id %s', (chatId) => {
    expect(readTelegramConfig({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: chatId })).toEqual({
      status: 'invalid',
      variables: ['TELEGRAM_CHAT_ID'],
    });
  });

  it('names a missing variable along with a malformed one', () => {
    expect(readTelegramConfig({ TELEGRAM_BOT_TOKEN: 'bad' })).toEqual({
      status: 'invalid',
      variables: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'],
    });
  });
});

describe('sendTelegramMessage', () => {
  it('posts plain text to the bot API, without markup or link previews', async () => {
    const { fetch, calls } = fakeFetch(() => json({ ok: true, result: { message_id: 1 } }));

    const result = await sendTelegramMessage(CONFIG, '[local] Hola', { ...OPTS, fetch });

    expect(result).toEqual({ outcome: 'SENT' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.redirect).toBe('error');
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      chat_id: CHAT,
      text: '[local] Hola',
      link_preview_options: { is_disabled: true },
    });
  });

  it('sends nothing when not configured', async () => {
    const { fetch, calls } = fakeFetch(() => json({ ok: true }));

    const result = await sendTelegramMessage(
      { status: 'not_configured', variables: ['TELEGRAM_CHAT_ID'] },
      'x',
      { ...OPTS, fetch },
    );

    expect(result).toEqual({ outcome: 'NOT_CONFIGURED', detail: 'TELEGRAM_CHAT_ID' });
    expect(calls).toHaveLength(0);
  });

  it("reports a rejection with Telegram's code and description", async () => {
    const { fetch } = fakeFetch(() => json({ ok: false, error_code: 401, description: 'Unauthorized' }, 401));

    expect(await sendTelegramMessage(CONFIG, 'x', { ...OPTS, fetch })).toEqual({
      outcome: 'REJECTED',
      errorCode: 401,
      detail: 'Unauthorized',
      retryAfterSeconds: null,
    });
  });

  it('keeps the wait Telegram asks for on a 429', async () => {
    const { fetch } = fakeFetch(() =>
      json(
        { ok: false, error_code: 429, description: 'Too Many Requests: retry after 7', parameters: { retry_after: 7 } },
        429,
      ),
    );

    expect(await sendTelegramMessage(CONFIG, 'x', { ...OPTS, fetch })).toMatchObject({
      outcome: 'REJECTED',
      errorCode: 429,
      retryAfterSeconds: 7,
    });
  });

  it.each([0, -1, 1.5, 'soon', 100000])('ignores an unusable retry_after (%s)', async (retryAfter) => {
    const { fetch } = fakeFetch(() =>
      json({ ok: false, error_code: 429, parameters: { retry_after: retryAfter } }, 429),
    );

    expect(await sendTelegramMessage(CONFIG, 'x', { ...OPTS, fetch })).toMatchObject({
      outcome: 'REJECTED',
      errorCode: 429,
      detail: null,
      retryAfterSeconds: null,
    });
  });

  it.each([
    ['a body that is not JSON', () => new Response('<html>Bad Gateway</html>', { status: 502 }), 'HTTP 502'],
    ['JSON that is not Telegram\'s', () => json({ hello: 'world' }), 'HTTP 200'],
    ['a rejection without an integer code', () => json({ ok: false, error_code: '401' }, 401), 'HTTP 401'],
  ])('is unreachable on %s', async (_case, respond, detail) => {
    const { fetch } = fakeFetch(respond);

    expect(await sendTelegramMessage(CONFIG, 'x', { ...OPTS, fetch })).toEqual({ outcome: 'UNREACHABLE', detail });
  });

  it('is unreachable on a timeout', async () => {
    const { fetch } = fakeFetch(() => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });

    expect(await sendTelegramMessage(CONFIG, 'x', { ...OPTS, fetch })).toEqual({
      outcome: 'UNREACHABLE',
      detail: 'TimeoutError',
    });
  });

  // undici's errors can carry the URL, and the URL carries the token.
  it('never lets a network error carry the token out', async () => {
    const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
    const { fetch } = fakeFetch(() => {
      const cause = Object.assign(new Error(`connect ECONNREFUSED ${url}`), { code: 'ECONNREFUSED' });
      const error = new TypeError(`fetch failed: ${url}`, { cause });
      error.stack = `TypeError: fetch failed: ${url}\n    at ${url}`;
      throw error;
    });

    const result = await sendTelegramMessage(CONFIG, 'x', { ...OPTS, fetch });

    expect(result).toEqual({ outcome: 'UNREACHABLE', detail: 'TypeError ECONNREFUSED' });
    expectNoSecrets(result);
  });

  it('keeps an odd error code out of the detail', async () => {
    const { fetch } = fakeFetch(() => {
      throw new TypeError('fetch failed', { cause: { code: `E ${TOKEN}` } });
    });

    const result = await sendTelegramMessage(CONFIG, 'x', { ...OPTS, fetch });

    expect(result).toEqual({ outcome: 'UNREACHABLE', detail: 'TypeError' });
  });

  it("never lets Telegram's description carry a secret out", async () => {
    const description =
      `Bad Request: ${TOKEN} | ${SECRET} | ${TOKEN.replace(':', '%3A')} | ` +
      `${TOKEN.slice(0, 15)}\u0007${TOKEN.slice(15)} | chat ${CHAT} | bot${TOKEN}/x`;
    const { fetch } = fakeFetch(() => json({ ok: false, error_code: 400, description }, 400));

    const result = await sendTelegramMessage(CONFIG, 'x', { ...OPTS, fetch });

    expect(result.outcome).toBe('REJECTED');
    expectNoSecrets(result);
  });

  it('never throws, whatever fetch does', async () => {
    const fetch = (() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the point: not an Error
      throw 'not even an Error';
    }) as unknown as typeof globalThis.fetch;

    expect(await sendTelegramMessage(CONFIG, 'x', { ...OPTS, fetch })).toEqual({
      outcome: 'UNREACHABLE',
      detail: 'Error',
    });
  });
});

describe('redact', () => {
  it('keeps Telegram\'s own words intact', () => {
    expect(redact("Forbidden: bots can't send messages to bots", CONFIG)).toBe(
      "Forbidden: bots can't send messages to bots",
    );
  });

  it('replaces anything shaped like a token, from any configuration', () => {
    const other = '555555555:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    expect(redact(`leaked ${other} here`, CONFIG)).not.toContain('BBBBBBBBBB');
    expect(redact(`leaked ${other} here`, { status: 'not_configured', variables: [] })).not.toContain(
      'BBBBBBBBBB',
    );
  });

  it('cuts the result to 200 printable characters', () => {
    const out = redact(`${'x'.repeat(300)}\u0000\n`, CONFIG);
    expect(out).toHaveLength(200);
    expect(out).toMatch(/^[\x20-\x7e]+$/);
  });
});

describe('getTelegramBot', () => {
  it("returns the bot's username", async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({ ok: true, result: { id: 123456789, is_bot: true, first_name: 'Ficha', username: 'ficha_alerts_bot' } }),
    );

    expect(await getTelegramBot(CONFIG, { ...OPTS, fetch })).toEqual({ status: 'ok', username: 'ficha_alerts_bot' });
    expect(calls[0].url).toBe(`https://api.telegram.org/bot${TOKEN}/getMe`);
  });

  it("reports Telegram's rejection", async () => {
    const { fetch } = fakeFetch(() => json({ ok: false, error_code: 401, description: 'Unauthorized' }, 401));

    expect(await getTelegramBot(CONFIG, { ...OPTS, fetch })).toEqual({
      status: 'error',
      errorCode: 401,
      detail: 'Unauthorized',
    });
  });

  it('reports an unreachable Telegram without the token', async () => {
    const { fetch } = fakeFetch(() => {
      throw new TypeError(`fetch failed https://api.telegram.org/bot${TOKEN}/getMe`);
    });

    const result = await getTelegramBot(CONFIG, { ...OPTS, fetch });

    expect(result).toEqual({ status: 'error', errorCode: null, detail: 'TypeError' });
  });

  it('is not configured without the variables', async () => {
    const { fetch, calls } = fakeFetch(() => json({ ok: true }));

    expect(
      await getTelegramBot({ status: 'not_configured', variables: ['TELEGRAM_BOT_TOKEN'] }, { ...OPTS, fetch }),
    ).toEqual({ status: 'not_configured' });
    expect(calls).toHaveLength(0);
  });
});

// tests/setup.ts: the local .env may hold a real token.
describe('the test environment', () => {
  it('carries no Telegram configuration', () => {
    expect(readTelegramConfig(process.env).status).toBe('not_configured');
  });

  it('blocks the real Bot API, without repeating the URL', async () => {
    const error: unknown = await fetch(`https://api.telegram.org/bot${TOKEN}/getMe`).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/never call the real Telegram API/);
    expect((error as Error).message).not.toContain(TOKEN);
  });
});
