import 'dotenv/config';

// Corre antes de que cada archivo de tests importe la app. NODE_ENV=test
// apaga el log de queries de Prisma y deja el CORS en modo desarrollo
// (la obligación de CORS_ORIGIN es solo de producción).
process.env.NODE_ENV = 'test';

// El secreto del operador de plataforma. En los tests no protege nada real
// —firma tokens que solo viven en este proceso—, así que si el entorno no
// trae uno se usa un valor fijo, con el mismo criterio que el cost 4 de
// bcrypt en helpers.ts. Solo acá: la app sigue exigiéndolo por env.
process.env.PLATFORM_JWT_SECRET ??= 'secreto-de-plataforma-solo-para-tests-0123456789';

// Tests never reach Telegram (#186, SPEC-sysadmin-alerts.md §9). The local
// .env may hold a real bot's token: the variables go, and any request to the
// Bot API fails before it leaves this process. A test that needs Telegram
// passes its own fetch, or stubs this one (vi.stubGlobal). The message does
// not repeat the URL, which would carry the token.
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_CHAT_ID;
delete process.env.RENDER_SERVICE_NAME;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
  if (URL.canParse(url) && new URL(url).hostname === 'api.telegram.org') {
    throw new Error('Tests never call the real Telegram API: pass a fake fetch.');
  }
  return realFetch(input, init);
});
