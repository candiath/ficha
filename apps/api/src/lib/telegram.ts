// The Telegram Bot API, for sysadmin alerts (#186,
// docs/specs/SPEC-sysadmin-alerts.md §3). The only code that knows the bot
// token, the URL (which carries it: /bot<token>/...) and Telegram's response
// format.
//
// It never throws: every outcome, a programming error included, comes back as
// a value. And nothing it returns carries the token or the chat id: a
// network error is reduced to its name and code, and every detail goes
// through redact(). The error objects themselves are dropped, so they cannot
// reach a log (errorHandler's, for one) with the URL in them.

const API = 'https://api.telegram.org';

// The format check is what keeps a token from adding a path segment, a query
// or a fragment to the URL. Numeric chat ids only: the @channelname form only
// reaches public channels, which anyone can read.
const TOKEN_PATTERN = /^\d{1,20}:[A-Za-z0-9_-]{30,64}$/;
const CHAT_ID_PATTERN = /^-?\d{5,20}$/;
const DETAIL_MAX = 200;
const RETRY_AFTER_MAX_SECONDS = 3600;

export type TelegramConfig =
  | { status: 'configured'; token: string; chatId: string }
  // The variables' names, never their values.
  | { status: 'not_configured' | 'invalid'; variables: string[] };

export type TelegramResult =
  | { outcome: 'SENT' }
  | { outcome: 'REJECTED'; errorCode: number; detail: string | null; retryAfterSeconds: number | null }
  | { outcome: 'UNREACHABLE'; detail: string }
  | { outcome: 'NOT_CONFIGURED'; detail: string };

export type TelegramBotResult =
  | { status: 'ok'; username: string }
  | { status: 'not_configured' }
  | { status: 'error'; errorCode: number | null; detail: string | null };

export interface TelegramOptions {
  fetch: typeof fetch;
  timeoutMs: number;
}

// A malformed value never throws: alerts are secondary, and a typo in a
// variable must not take the service down.
export function readTelegramConfig(env: NodeJS.ProcessEnv): TelegramConfig {
  const token = env.TELEGRAM_BOT_TOKEN?.trim() ?? '';
  const chatId = env.TELEGRAM_CHAT_ID?.trim() ?? '';
  const missing: string[] = [];
  const invalid: string[] = [];

  if (!token) missing.push('TELEGRAM_BOT_TOKEN');
  else if (!TOKEN_PATTERN.test(token)) invalid.push('TELEGRAM_BOT_TOKEN');
  if (!chatId) missing.push('TELEGRAM_CHAT_ID');
  else if (!CHAT_ID_PATTERN.test(chatId)) invalid.push('TELEGRAM_CHAT_ID');

  if (invalid.length > 0) return { status: 'invalid', variables: [...invalid, ...missing] };
  if (missing.length > 0) return { status: 'not_configured', variables: missing };
  return { status: 'configured', token, chatId };
}

// A detail that is safe to log, store and return. Non-printable characters
// go first, so none can split a token past the patterns and vanish after.
// The chat id goes last, so it cannot break a token's digits before the
// shapes match.
export function redact(text: string, config: TelegramConfig): string {
  let out = text.replace(/[^\x20-\x7e]/g, '');
  if (config.status === 'configured') {
    const secret = config.token.slice(config.token.indexOf(':') + 1);
    out = out.split(config.token).join('<token>').split(secret).join('<token>');
  }
  out = out
    .replace(/\d{6,}(:|%3A)[A-Za-z0-9_-]{20,}/gi, '<token>')
    .replace(/:[A-Za-z0-9_-]{30,}/g, ':<token>')
    .replace(/bot\d+:[^/\s]*/g, 'bot<token>');
  if (config.status === 'configured') {
    out = out.split(config.chatId).join('<chat>');
    const digits = config.chatId.replace(/^-/, '');
    if (digits.length >= 5) out = out.split(digits).join('<chat>');
  }
  return out.slice(0, DETAIL_MAX);
}

export async function sendTelegramMessage(
  config: TelegramConfig,
  text: string,
  opts: TelegramOptions,
): Promise<TelegramResult> {
  if (config.status !== 'configured') {
    return { outcome: 'NOT_CONFIGURED', detail: config.variables.join(', ') };
  }
  try {
    const response = await opts.fetch(`${API}/bot${config.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Plain text, no parse_mode: nothing in a message is read as markup.
      body: JSON.stringify({ chat_id: config.chatId, text, link_preview_options: { is_disabled: true } }),
      redirect: 'error',
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    const body = await readJson(response);

    if (isRecord(body) && body.ok === true) return { outcome: 'SENT' };
    const rejection = readRejection(body, config);
    if (rejection) {
      const retryAfter = isRecord(body) && isRecord(body.parameters) ? body.parameters.retry_after : null;
      return {
        outcome: 'REJECTED',
        ...rejection,
        retryAfterSeconds:
          rejection.errorCode === 429 && isInteger(retryAfter, 1, RETRY_AFTER_MAX_SECONDS) ? retryAfter : null,
      };
    }
    return { outcome: 'UNREACHABLE', detail: `HTTP ${response.status}` };
  } catch (error) {
    return { outcome: 'UNREACHABLE', detail: redact(describeError(error), config) };
  }
}

export async function getTelegramBot(config: TelegramConfig, opts: TelegramOptions): Promise<TelegramBotResult> {
  if (config.status !== 'configured') return { status: 'not_configured' };
  try {
    const response = await opts.fetch(`${API}/bot${config.token}/getMe`, {
      redirect: 'error',
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    const body = await readJson(response);

    if (isRecord(body) && body.ok === true && isRecord(body.result)) {
      const { username } = body.result;
      if (typeof username === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(username)) {
        return { status: 'ok', username };
      }
    }
    const rejection = readRejection(body, config);
    if (rejection) return { status: 'error', ...rejection };
    return { status: 'error', errorCode: null, detail: `HTTP ${response.status}` };
  } catch (error) {
    return { status: 'error', errorCode: null, detail: redact(describeError(error), config) };
  }
}

// Telegram's JSON is untrusted: a rejection counts only with an integer code.
function readRejection(body: unknown, config: TelegramConfig): { errorCode: number; detail: string | null } | null {
  if (!isRecord(body) || body.ok !== false || !isInteger(body.error_code, 100, 999)) return null;
  return {
    errorCode: body.error_code,
    detail: typeof body.description === 'string' ? redact(body.description, config) : null,
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return JSON.parse(await response.text());
  } catch {
    return null;
  }
}

// Only the error's name and its cause's code (ECONNRESET, ENOTFOUND,
// UND_ERR_CONNECT_TIMEOUT…), never its message: undici's can carry the URL.
function describeError(error: unknown): string {
  const name = error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : 'Error';
  const cause: unknown = error instanceof Error ? error.cause : undefined;
  const code = isRecord(cause) ? cause.code : undefined;
  return typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code) ? `${name} ${code}` : name;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isInteger(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}
