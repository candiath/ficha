# Spec: sysadmin-alerts

Module of the [audit capability map](audit-map.md) (issue #186). **Status: approved 2026-10-11.** An adversarial security review ran before implementation; its findings are folded in below and marked *(review)*. Decisions Nath took before the spec was written are marked *(decided)*, and the answers to its open questions are under *Decisions*.

## Objective

Tell the sysadmin (the platform operator) when something needs her, by Telegram, without the app ever depending on Telegram and without ever handing Telegram personal data.

After this module:

- **The API can raise an alert** of a fixed kind.
  - It is recorded in an append-only audit table and sent to a Telegram chat off the request path.
  - Every delivery attempt is recorded with its outcome.
  - A failure to send or to record never fails whatever raised the alert.
- **The first producer is real.** The audit check at startup (`src/lib/auditGuards.ts`) raises an alert when a check *fails*, as `SPEC-audit-hardening.md` anticipated.
- **The operator sees the channel's health** in an *Alertas* card in `/platform`:
  - the configuration and the bot's name;
  - the last delivery and its result;
  - the last 20 alerts with their delivery state;
  - a button that sends a test alert and shows Telegram's answer.

  A banner across `/platform` says when the last real alert did not arrive.
- **The bot token never leaves its environment variable**: it is never in a log, a row, a response or an error message.

Later modules (`record-access-log`, `security-events`) add their own alert kinds on top of this one.

### Decided before this spec *(decided)*

1. **One bot per environment.**
   - Each Render service (`ficha-staging`, `Ficha`) has its own `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. Nath sets them in the Render dashboard; they never go through a chat.
   - Without them, the app works the same and shows "no configurado".
   - Every message starts with the environment: `[<RENDER_SERVICE_NAME>]`, or `[local]` outside Render.
2. **An audit table of its own:**
   - one row per alert and one per delivery attempt;
   - the same append-only and timestamp triggers as `audit_logs`;
   - checked in `audit-guards.sql` and in the migration scan;
   - separate from `audit_logs` and `platform_audit_logs`;
   - classified for the tenant guard;
   - cleaned in tests only through `tests/helpers.ts`.
3. **No personal data** in messages or rows: no names, emails, clinical data or values. Telegram is a third party.
4. **Sending never fails the request that triggers it.** A failed send is recorded.
5. **The token is never exposed.** The Telegram API URL contains it (`/bot<token>/…`), and `fetch` errors can carry the URL. So every error is sanitized before it is logged, stored or returned.
6. **The *Alertas* card.** It shows:
   - the configuration: token and chat loaded, and the bot's name from `getMe`;
   - the last delivery;
   - the last 20 alerts;
   - a test button. It awaits Telegram and shows the result. It has its own limit, and each test is recorded in `platform_audit_logs` with a new `PlatformAction`.

   A global banner appears when the last real delivery failed.
7. **Rate limiting deferred.** The map's "at most one message per kind every 15 minutes" is not in this module, and the map's row says so. A Telegram `429` is recorded as a failed attempt.
8. **First producer**: the startup audit check, on a failed check.

## Tech Stack, Commands

- **Stack:** Express 5, Prisma 5.22 and Postgres on Neon; React 19 and TanStack Query on the web.
- **HTTP:** Node's global `fetch` (Node ≥ 18) with `AbortSignal.timeout`.
- **No new dependencies.** No Telegram SDK: the Bot API is two JSON endpoints.

```
npm test                   # API integration tests (vitest + supertest, against Neon)
npm test -w apps/web       # web tests (vitest + jsdom)
npm run check              # lint + typecheck, the pre-commit hook
```

**Migration.** `migrate dev` hangs without a TTY, so:

1. Generate with `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script`.
2. Add the hand-written SQL below.
3. Apply with `npx prisma migrate deploy`.

It is developed on a throwaway Neon branch created from `development`, and rehearsed on a throwaway copy of `production` before the PR. Both branches are deleted at the end.

## Design

### 1. Data model

Two tables: the alert, and its delivery attempts.

- **One meaning.** They record what the sysadmin was told and whether it reached her, with the same reader and the same retention. In the map's "one table per meaning" they count as one entry.
- **Why two tables, not one with a discriminator.**
  - Each kind of row gets its own `NOT NULL` columns.
  - An attempt's foreign key can only point at an alert, never at another attempt.

  See Decision 1.

```prisma
// What the sysadmin is told (#186, docs/specs/SPEC-sysadmin-alerts.md). An
// audit table: append-only, created_at stamped by the database, checked by
// prisma/audit-guards.sql. A kind names a fixed message; rows carry no text,
// no personal data and no values.
enum SysadminAlertKind {
  AUDIT_GUARDS_FAILED            // audit-guards.sql failed at startup
  AUDIT_MAINTENANCE_FLAG_PRESENT // no-audit-maintenance.sql failed at startup
  TEST                           // sent by the operator from /platform
}

enum SysadminAlertOutcome {
  SENT           // Telegram accepted it
  REJECTED       // Telegram answered ok: false; error_code says why (401, 403, 429…)
  UNREACHABLE    // no usable answer: network error, timeout, a body that is not Telegram's
  NOT_CONFIGURED // token or chat missing or malformed: nothing was sent
}

model SysadminAlert {
  id         String            @id @default(uuid(7)) @db.Uuid
  kind       SysadminAlertKind
  // Who sent a test alert. Null for every other kind (a CHECK enforces it).
  operatorId String?           @map("operator_id") @db.Uuid
  // Stamped by the database on insert (audit_rows_stamp_created_at), in UTC.
  createdAt  DateTime          @default(now()) @map("created_at")

  operator   PlatformOperator? @relation(fields: [operatorId], references: [id], onDelete: Restrict, onUpdate: Restrict)
  deliveries SysadminAlertDelivery[]

  @@index([createdAt])
  @@map("sysadmin_alerts")
}

model SysadminAlertDelivery {
  id        String               @id @default(uuid(7)) @db.Uuid
  alertId   String               @map("alert_id") @db.Uuid
  outcome   SysadminAlertOutcome
  // Telegram's error_code, only when it rejected the message.
  errorCode Int?                 @map("error_code")
  // Why it was not sent: Telegram's description, the network error's code, or
  // the missing variable's name. Redacted (§3) and cut to 200 characters.
  detail    String?              @db.VarChar(200)
  createdAt DateTime             @default(now()) @map("created_at")

  alert SysadminAlert @relation(fields: [alertId], references: [id], onDelete: Restrict, onUpdate: Restrict)

  @@index([alertId, createdAt])
  @@index([createdAt])
  @@map("sysadmin_alert_deliveries")
}
```

The migration starts with a lock, before Prisma's part *(review)*. It takes every table it alters or references, in the same order as `20261010191055_audit_rows_enforced`. A request of the code still serving then waits for the migration, and cannot deadlock with it:

```sql
LOCK TABLE public.tenants, public.platform_operators, public.users,
  public.platform_audit_logs IN ACCESS EXCLUSIVE MODE;
```

After Prisma's part, it adds by hand:

```sql
-- The same three triggers as platform_audit_logs, on both tables, calling the
-- existing functions (no new function, so no new hash): UPDATE and TRUNCATE
-- always rejected, DELETE only under maintenance, created_at stamped.
CREATE TRIGGER sysadmin_alerts_stamp_created_at BEFORE INSERT ON public.sysadmin_alerts
  FOR EACH ROW EXECUTE FUNCTION public.audit_rows_stamp_created_at();
CREATE TRIGGER sysadmin_alerts_append_only BEFORE UPDATE OR DELETE ON public.sysadmin_alerts
  FOR EACH ROW EXECUTE FUNCTION public.audit_rows_are_append_only();
CREATE TRIGGER sysadmin_alerts_no_truncate BEFORE TRUNCATE ON public.sysadmin_alerts
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_rows_are_append_only();
-- (the same three on sysadmin_alert_deliveries)

-- A test alert names its operator; nothing else does.
ALTER TABLE public.sysadmin_alerts ADD CONSTRAINT sysadmin_alerts_operator_only_on_tests
  CHECK ((kind = 'TEST') = (operator_id IS NOT NULL));
-- Telegram's error code goes with a rejection, and only with one.
ALTER TABLE public.sysadmin_alert_deliveries ADD CONSTRAINT sysadmin_alert_deliveries_error_code_on_rejected
  CHECK ((outcome = 'REJECTED') = (error_code IS NOT NULL));
```

Both enum types are created in this same migration, so these `CHECK`s can name their values. The restriction applies only to a value *added* with `ALTER TYPE … ADD VALUE`: it cannot be used in the transaction that adds it.

**Tenant guard.** Neither table has a `tenantId`: an alert is about the platform, not a clinic, like `tenants` itself.

- `tests/tenantScopeCoverage.test.ts` only accepts models that have a `tenantId`; any other entry is a "phantom". So the two tables go in neither list.
- A comment next to `TENANT_MODELS_FUERA_DEL_GUARD` records the decision. It also says where a later producer that adds a `tenant_id` must classify them: outside the guard, since they are written without a `ctx` and the operator reads them across clinics.
- The coverage test enforces that classification as soon as the column appears.

See Decision 2.

### 2. The test alert in `platform_audit_logs`

The operator's test is an operator action, so it goes where every operator action goes *(decided)*:

- a new `PlatformAction` value, `TEST_ALERT_SENT`;
- the description `Envió una alerta de prueba`.

It concerns no clinic, and `platform_audit_logs.tenant_id` is `NOT NULL` today. This module makes it nullable, for that action only:

```sql
ALTER TABLE "platform_audit_logs" ALTER COLUMN "tenant_id" DROP NOT NULL;
-- Only an action on the platform itself has no clinic; every other action
-- still names one (review: a buggy write with a null clinic would vanish from
-- the clinic's audit list). Compared as text: the value is added in this same
-- migration, and a value added by ADD VALUE cannot be used before it commits.
ALTER TABLE public.platform_audit_logs ADD CONSTRAINT platform_audit_logs_tenant_only_off_platform
  CHECK ((tenant_id IS NULL) = (action::text = 'TEST_ALERT_SENT'));
-- With tenant_id null, the composite key (tenant_id, target_user_id) is not
-- checked (MATCH SIMPLE). A row with a target always names its clinic.
ALTER TABLE public.platform_audit_logs ADD CONSTRAINT platform_audit_logs_target_needs_tenant
  CHECK (tenant_id IS NOT NULL OR target_user_id IS NULL);
```

- **Types.** `PlatformAuditLogDTO.tenantId` and the shared `PlatformAuditEntry.tenantId` become `string | null`. `listAuditLog(tenantId)` filters by clinic, so its rows never have a null one.
- **Tenant guard.** The `PlatformAuditLog` entry in `TENANT_MODELS_FUERA_DEL_GUARD` gains the reason: an action on the platform names no clinic.
- **Cleanup.** `deleteAuditRows(tenantIds)` deletes by clinic, so it does not see these rows. `deleteOperatorAuditRows(operatorId)` deletes by operator, so it does. That is how `createTestOperator().cleanup()` already removes them.
- **A later platform action without a clinic** changes the first `CHECK`. That is a migration on the `ALLOWED` list, reviewed on purpose.
- **Old code during the deploy window** never reads a row without a clinic: `listAuditLog` filters by clinic. It never writes one either *(review: checked)*.

### 3. Telegram client (`src/lib/telegram.ts`)

The only code that knows the token, the URL and Telegram's response format. **It never throws**: every outcome comes back as a value, including a programming error inside it.

```ts
export type TelegramConfig =
  | { status: 'configured'; token: string; chatId: string }
  | { status: 'not_configured' | 'invalid'; variables: string[] }; // names only, never values

export function readTelegramConfig(env: NodeJS.ProcessEnv): TelegramConfig;

export type TelegramResult =
  | { outcome: 'SENT' }
  | { outcome: 'REJECTED'; errorCode: number; detail: string | null; retryAfterSeconds: number | null }
  | { outcome: 'UNREACHABLE'; detail: string }
  | { outcome: 'NOT_CONFIGURED'; detail: string };

export function sendTelegramMessage(config, text, opts: { fetch; timeoutMs }): Promise<TelegramResult>;
export function getTelegramBot(config, opts: { fetch; timeoutMs }):
  Promise<{ status: 'ok'; username: string } | { status: 'error'; errorCode: number | null; detail: string | null }>;
```

- **Configuration.**
  - `TELEGRAM_BOT_TOKEN` must match `^\d{1,20}:[A-Za-z0-9_-]{30,64}$`.
  - `TELEGRAM_CHAT_ID` must be numeric: `^-?\d{5,20}$` *(review)*. The `@channelname` form only reaches public channels, whose messages anyone can read, including whoever caused the alert.
  - Both missing or empty: `not_configured`.
  - Either one malformed: `invalid`, and no request is ever made.
  - The format check is what keeps a token from adding a path segment, a query or a fragment to the URL (`/`, `?`, `#`, `..`).
  - A malformed value never crashes the API. Alerts are secondary, and a typo in a variable must not take the service down.
- **Request.**
  - `POST https://api.telegram.org/bot<token>/sendMessage`.
  - JSON body: `{ chat_id, text, link_preview_options: { is_disabled: true } }`.
  - No `parse_mode`: the message is plain text, so nothing in it is read as markup.
  - `redirect: 'error'` and `AbortSignal.timeout(timeoutMs)`.
  - The host is a constant.
  - `fetch` is looked up when the call is made, not when the client is created *(review)*, so a test's `vi.stubGlobal` reaches it.
- **Response.** Telegram's JSON is untrusted *(review)*.
  - `ok: true` gives `SENT`.
  - `ok: false` with an integer `error_code` gives `REJECTED`, with that code and the `description` if it is a string. For a `429`, `parameters.retry_after` is kept only if it is an integer from 1 to 3600.
  - Anything else gives `UNREACHABLE`: a network error, a timeout, a body that is not JSON, JSON that is not Telegram's shape, or an `ok: false` without an integer code.
- **Redaction.** Every `detail` goes through `redact()` before it leaves this file *(review: order and patterns)*:
  1. Keep only printable ASCII. This runs first, so a control character cannot split a token past the patterns and then disappear.
  2. Replace the configured token, and its secret half on its own, with `<token>`.
  3. Replace anything shaped like a token with `<token>`, so a token from another configuration cannot leak either: `\d{6,}(:|%3A)[A-Za-z0-9_-]{20,}` (case-insensitive) and `:[A-Za-z0-9_-]{30,}`.
  4. Replace `bot\d+:[^/\s]*` with `bot<token>`.
  5. Replace the configured chat id with `<chat>`. This runs last, so it cannot break a token's digits before the shapes match.
  6. Cut the result to 200 characters.
- **Errors.**
  - A network error's `detail` is never its message. It is built only from the error's `name` and its `cause.code` when there is one (`TimeoutError`, `ECONNRESET`, `ENOTFOUND`, `UND_ERR_CONNECT_TIMEOUT`…), then redacted anyway.
  - The error object itself is dropped: never logged, returned, stored or rethrown. So it cannot reach `errorHandler`, whose log would print it.

### 4. Alerts service (`src/lib/sysadminAlerts.ts`)

```ts
export function createSysadminAlerts(deps: {
  repo: SysadminAlertRepository;
  env: () => NodeJS.ProcessEnv;      // read on every call
  fetch: () => typeof fetch;         // looked up on every call
  sleep: (ms: number) => Promise<void>;
  log: Pick<Console, 'log' | 'error'>;
}): {
  // Records the alert and delivers it with retries. Never rejects: a caller on
  // a request path writes `void sysadminAlerts.raise(kind)`.
  raise(kind: Exclude<SysadminAlertKind, 'TEST'>): Promise<void>;
  // The test button: records the alert and its platform audit row, sends once,
  // records the attempt, and returns Telegram's answer.
  sendTest(op: OperatorContext): Promise<TestAlertResult>;
  status(): AlertsConfigStatus;      // configuration, without values
  bot(): Promise<BotStatus>;         // getMe, cached
};

export const sysadminAlerts = createSysadminAlerts({ /* the real ones */ });
```

**Raising a real alert:**

1. **Insert the alert row.** If the insert fails (the database is down), log it and still send, with "sin registrar" in place of the id. The message matters more than its row, and the database being down may be exactly what is wrong. Attempts of an unrecorded alert are only logged.
2. **Send, up to 3 attempts**, with a 10-second timeout each.
   - Retry only after `UNREACHABLE`, or after `REJECTED` with `429` or `5xx`.
   - For a `429`, wait Telegram's `retry_after`; if it is over 60 s, stop.
   - Otherwise wait 5 s, then 30 s.
   - `NOT_CONFIGURED` makes no request and is recorded once.
3. **Record each attempt** as a delivery row, and log one already-redacted line per attempt, e.g. `[alerts] AUDIT_GUARDS_FAILED <id>: REJECTED 401 Unauthorized`.

Everything runs inside one `try/catch` that also catches failures of the logger, so `raise` resolves in every case.

**Sending a test:**

1. **Record.** One transaction writes the `TEST` alert row (with `operator_id`) and the `platform_audit_logs` row (`TEST_ALERT_SENT`, `tenant_id` null). If it fails, the route fails like any write (500), and nothing was sent.
2. **Send** after the commit, so no transaction stays open across a network call. One attempt, no retries, 10-second timeout, recorded as a delivery row.
3. **Return** `{ alertId, outcome, errorCode, detail }`. If recording the attempt fails, the result is still returned and the failure logged.

**Messages.** Spanish, because the operator reads them. Plain text, built only from a fixed template per kind, the environment label and the alert id:

```
[Ficha] Falló el chequeo de las tablas de auditoría al arrancar la API (audit-guards.sql).
Alguna garantía de la base cambió después del deploy. El detalle está en los logs del servicio.
Alerta 0192e4a1-…
```

| Kind | Message (after the label) |
|---|---|
| `AUDIT_GUARDS_FAILED` | Falló el chequeo de las tablas de auditoría al arrancar la API (audit-guards.sql). Alguna garantía de la base cambió después del deploy. El detalle está en los logs del servicio. |
| `AUDIT_MAINTENANCE_FLAG_PRESENT` | La base tiene la marca de mantenimiento de auditoría (no-audit-maintenance.sql). En este entorno las filas de auditoría se pueden borrar. El detalle está en los logs del servicio. |
| `TEST` | Alerta de prueba enviada desde /platform. Si la ves, las alertas de este entorno llegan. |

- **The label** is `RENDER_SERVICE_NAME`, which Render sets (`Ficha`, `ficha-staging`), or `local` when it is unset. It is kept to `[A-Za-z0-9 ._-]` and 40 characters.
- **No links, ever.** A message from the bot that carries a link was not sent by the app. `docs/infra.md` says so.
- **The check's own failure text does not go to Telegram.** It names triggers and tables, which is not personal data, but it is free text read from the catalog. The message points to the logs, where it already is.

**`getMe`** (`bot()`) is called by `GET /api/platform/alerts/bot`, with a 5-second timeout.

- A success is cached for the life of the process: the token cannot change without a restart.
- A failure is cached for 60 s *(review)*, so refreshing the card does not call Telegram each time.
- It returns the bot's `username` only.

### 5. Repository (`sysadminAlertRepository.ts`)

```ts
export interface SysadminAlertRepository {
  createAlert(kind: Exclude<SysadminAlertKind, 'TEST'>): Promise<{ id: string }>;
  // The TEST alert and its platform_audit_logs row, in one transaction.
  createTestAlert(op: OperatorContext): Promise<{ id: string }>;
  recordDelivery(alertId: string, delivery: DeliveryInput): Promise<void>;
  overview(): Promise<SysadminAlertsOverviewData>;
}
```

- **No `ctx`**, like `auditGuardRepository` and `platformRepository`: there is no clinic. It touches only the two alert tables, plus `platform_audit_logs` for the test.
- **`overview()`** returns:
  - **the last 20 real alerts** (every kind but `TEST`), newest first (`createdAt desc, id desc`), each with its latest delivery and its number of deliveries. Tests are kept out of this list *(review)*, so a burst of tests cannot push a real alert out of view;
  - **the last test**, with its latest delivery;
  - **the latest delivery overall**, with its alert's kind: the card's "último envío";
  - **the banner**, decided by a pure function, `undeliveredAlert(latestRealAlert, lastSentAt, now)`, unit-tested on its own *(review)*:
    - It looks only at the most recent real alert, and shows it while that alert has no `SENT` delivery, and either its latest delivery is not `SENT` or it is more than 3 minutes old. The second case covers an alert whose process died before any attempt was recorded *(review)*.
    - Only a later real alert that is delivered clears it. A test never does *(review)*, and it does not expire (Decision 4).

### 6. Routes (`src/routes/platformAlerts.ts`)

Mounted at `/api/platform/alerts`, behind `authenticateOperator`. They go before `/api/platform`, whose router ends in a catch-all 404. Errors are in Spanish.

| Route | Response |
|---|---|
| `GET /api/platform/alerts` | `{ environment, configuration: 'configured' \| 'not_configured' \| 'invalid', variables: string[], lastDelivery, lastTest, undeliveredAlert, alerts }` |
| `GET /api/platform/alerts/bot` | `{ status: 'ok', username }`, `{ status: 'not_configured' }` or `{ status: 'error', errorCode, detail }` |
| `POST /api/platform/alerts/test` | `201 { alertId, outcome, errorCode, detail }`. Telegram's answer is the result, whatever it is: a rejection is not an HTTP error. |

- **The test's limit.** Its own `express-rate-limit` instance, in memory like the login limiters.
  - It is keyed **globally**, not per operator *(review)*: Telegram limits per chat, and every operator shares the one chat.
  - The router is built by `createPlatformAlertsRouter({ testLimitPerMinute })`. `app.ts` passes the module's constant; tests pass a small number to the same code.
  - Over the limit: `429 { error: 'Demasiadas alertas de prueba. Probá de nuevo en un minuto.' }`.
  - **50 per minute** (Decision 3).
- **No response names the token or the chat id.** The configuration is `configured`, plus the names of the missing or malformed variables and the bot's username.
- **Audit coverage.** `POST /api/platform/alerts/test` enters `auditCoverageManifest.ts` as `audited`, in `platform_audit_logs`.

### 7. Startup producer (`src/lib/auditGuards.ts`)

`checkAuditGuardsAtStartup(log, raise = sysadminAlerts.raise)`:

- **What raises.** A `failed` result of `audit-guards.sql` raises `AUDIT_GUARDS_FAILED`; of `no-audit-maintenance.sql`, `AUDIT_MAINTENANCE_FLAG_PRESENT`. An `unreachable` result raises nothing: a Neon cold start would page the operator for nothing.
- **It awaits `raise` inside its own `try/catch`** *(review)* and logs a fixed string if it ever rejects. So no alert path can become an unhandled rejection, a crash and a restart loop.
- **"Unreachable" is narrowed** *(review)*. `prismaAuditGuardRepository` today calls every error without the guards' prefix "unreachable". That includes `relation "audit_logs" does not exist`, the worst failure there is. From now on:
  - only connection errors are `unreachable`: `PrismaClientInitializationError`, and `P1001`, `P1002`, `P1008` and `P1017`;
  - anything else is `failed`, with its message.
- **`audit-guards.sql` resolves each table with `to_regclass()`**, and reports a missing one as a problem instead of erroring.
- **Repeats.** Render free restarts the API after every idle period. A guarantee that stays broken therefore alerts several times a day until it is fixed. That is the intended noise until the map's rate limiting exists.

`index.ts` also logs the configuration at startup: `[alerts] Telegram: configured`, `not configured`, or `invalid (TELEGRAM_CHAT_ID)`.

### 8. Audit checks and scans

- **`prisma/audit-guards.sql`** covers the two new tables like the others:
  - exactly three triggers each (`_stamp_created_at` 7, `_append_only` 27, `_no_truncate` 34), all enabled;
  - no rule, no row-level security, permanent, no child tables;
  - every foreign key restricts. They are named: `sysadmin_alerts_operator_id_fkey` (`operator_id` → `platform_operators.id`) and `sysadmin_alert_deliveries_alert_id_fkey` (`alert_id` → `sysadmin_alerts.id`).
  - **New:** each `CHECK` by name, its exact `pg_get_constraintdef` text, and `convalidated`. These are the two on the alert tables and the two on `platform_audit_logs`. A Postgres upgrade that changes that text fails the guard, and is then a reviewed PR.
  - **New** *(review)*: `NOT NULL` on `kind`, `outcome` and `alert_id`, since a `CHECK` with a null operand passes.
  - Each new table literal appears exactly once, like the existing ones. So `auditHardening.test.ts` keeps swapping only the two tables it swaps.
- **`tests/auditMigrationScan.test.ts`**:
  - `AUDIT_NAMES` gains `sysadmin_alerts`, `sysadmin_alert_deliveries`, `SysadminAlertKind` and `SysadminAlertOutcome`, so later migrations are scanned for them too.
  - `ALLOWED` entries change from a reason to `{ reason, violations }`: the exact list of violations a migration is allowed. Today an allowed migration is exempt as a whole, so a statement added to it later would pass unseen.
  - This module's migration goes on `ALLOWED`. Reason: it creates triggers that call the audit functions, and drops `NOT NULL` from `platform_audit_logs.tenant_id`. The list includes any foreign key Prisma's diff drops and re-adds.
- **`tests/auditSwitchScan.test.ts`** is unchanged: cleanup goes through the helpers, which are already on its list.

### 9. Tests never reach Telegram

- **`tests/setup.ts`:**
  - deletes `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` and `RENDER_SERVICE_NAME` from the environment;
  - replaces the global `fetch` with one that throws on `api.telegram.org`, with a message that does not repeat the URL *(review)*.

  Tests that need Telegram inject a fake `fetch` (unit tests) or stub it per test (`vi.stubGlobal`, `vi.stubEnv`).
- **Database tests assert only on their own alert ids** *(review)*. `ci` is shared by concurrent PR runs, and interrupted runs leave alerts behind. So no test asserts on "the latest" of a table.
- **Cleanup** in `tests/helpers.ts`, inside the existing maintenance transaction:
  - `deleteSysadminAlerts(alertIds)` deletes the deliveries, then the alerts. It fails closed on an empty list.
  - `deleteOperatorAuditRows(operatorId)` also deletes that operator's test alerts and their deliveries, before its platform rows. `createTestOperator().cleanup()` already calls it, and the operator could not be deleted otherwise (`RESTRICT`).
- **`scripts/purge-test-audit.ts`** also deletes every alert older than an hour, with its deliveries *(review)*. It already runs only where the maintenance flag exists (`development`, `ci`), and those hold no real alerts.

### 10. Web

- **The *Alertas* card** (`components/platform/AlertsCard.tsx`) goes at the end of the clinics page (`/platform/tenants`, the operator's home), with `id="alertas"`. It shows:
  - the environment label;
  - the configuration: "Configurado · bot @nombre", "No configurado: falta TELEGRAM_CHAT_ID en el servicio", "Configuración inválida: TELEGRAM_BOT_TOKEN", or "No se pudo verificar el bot (Telegram respondió 401)";
  - the last delivery: date, kind and result ("Enviada", "Rechazada por Telegram (429)", "No se pudo contactar a Telegram", "No configurado");
  - the **"Enviar alerta de prueba"** button. It is disabled when the configuration is missing or invalid, says "Enviando…" while it waits, then shows the result inline (and the last test's) and refreshes the card;
  - the last 20 real alerts: kind, date, delivery state, and the number of attempts when there was more than one.
- **The banner** (`components/platform/UndeliveredAlertBanner.tsx`) sits in `PlatformLayout`, above every page:
  - "La última alerta no llegó por Telegram (fecha, tipo). Revisá la tarjeta Alertas."
  - It links to `/platform/tenants#alertas`, and reads `GET /api/platform/alerts`, the same query as the card.
- **Shared types** in `packages/shared`: `SysadminAlertKind`, `SysadminAlertOutcome`, `SysadminAlertsOverview`, `SysadminAlertBot` and `TestAlertResult`. Also `PlatformAuditEntry.tenantId: string | null`.

### 11. Docs

- **`audit-map.md`:** the `sysadmin-alerts` row says rate limiting is deferred *(decided)* and links this spec.
- **`CLAUDE.md`:**
  - the alert tables among the database-enforced audit tables;
  - `sysadminAlertRepository` among the repositories without a `ctx`;
  - the test alert in the operator's list;
  - the Telegram variables.
- **`docs/infra.md`:**
  - **Setup per environment:** one bot per environment from BotFather; a private chat with the bot, or a private group with only the operator (never a public channel); the numeric chat id; the two variables per Render service.
  - **The local `.env`** *(review)*: never a staging or production token, just as it never holds the production database URL. Use a third bot of its own, or leave the variables unset. Agents read `.env` files, and `ts-node-dev` re-runs the startup check on every save.
  - **Never `NODE_DEBUG=undici` or `fetch`** on a deployed service *(review)*: it prints request URLs, token included.
  - **Rotation** *(review)*: BotFather `/revoke`, the new token in Render, and a redeploy. A leaked token lets someone read the chat and send fake "alerts". Messages never carry links.
  - **Restore:** the procedure disables and re-enables the triggers of the four audit tables, not two.
  - **A failed migration on Render** leaves `P3009` until `migrate resolve --rolled-back`. The gap is already noted in `SPEC-audit-hardening.md`.
- **`apps/api/.env.example`:** the two variables, commented.

## Code Style

As in the rest of `apps/api`:

- ports and Prisma implementations under `repositories/`;
- Zod and HTTP semantics in the route;
- English for identifiers and comments, Spanish for what the operator reads.

```ts
// A delivery attempt's detail, safe to log, store and return: the token and
// chat id never survive it, nor anything shaped like a token. Non-printable
// characters go first, so none can split a token past the patterns.
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
  if (config.status === 'configured') out = out.split(config.chatId).join('<chat>');
  return out.slice(0, 200);
}
```

## Testing Strategy

Vitest and supertest against Neon for the API; vitest and jsdom for the web. Telegram is always a fake `fetch`.

- **`tests/telegram.test.ts`** (no database):
  - **Configuration:** missing, empty, a token with `/`, `?` or `#`, an `@channel` chat, a short chat id, and valid values.
  - **The request:** `https://api.telegram.org/bot<token>/sendMessage`, with the body above and no `parse_mode`.
  - **Responses:**
    - `ok: true` gives `SENT`;
    - `ok: false` with 401 gives `REJECTED` 401 with its description;
    - a 429 gives `REJECTED` 429 with `retryAfterSeconds`; a non-integer or out-of-range `retry_after` gives `null`;
    - `ok: false` without an integer code, a body that is not JSON, a 502 with HTML, a timeout, or `TypeError('fetch failed')` gives `UNREACHABLE`.
  - **Leaks:**
    - `fetch` throws an error whose message, `cause` and `stack` carry the full URL with the token;
    - Telegram's description contains the token, the token's secret half alone, the token URL-encoded, the token split by a control character, and the chat id;
    - in every case, no result contains any of them, nor anything shaped like another token;
    - Telegram's own words ("bots can't…") come through intact.
  - **`getTelegramBot`:** the username; a 401; unreachable.
- **`tests/sysadminAlerts.test.ts`** (database):
  - **Delivery:**
    - `raise` records the alert and one `SENT` delivery. The message carries the label, the kind's text and the id, and nothing else.
    - A `429` with `retry_after`, then success: two deliveries, and the wait was honored (fake `sleep`).
    - Three `UNREACHABLE`: three deliveries, then it stops.
    - A `401`: one delivery, no retry.
    - Not configured: one `NOT_CONFIGURED` delivery, and `fetch` is never called.
    - A repository that throws and a `fetch` that throws: `raise` resolves, the message is still sent (with "sin registrar"), and the logs carry no token.
  - **Append-only:** on both tables, `update`, `delete` and `deleteMany` are rejected; `created_at` is the database's time; the helpers can delete.
  - **`CHECK`s:** each of these is rejected:
    - a `TEST` alert without an operator, and an `AUDIT_GUARDS_FAILED` alert with one;
    - a `REJECTED` delivery without a code, and a `SENT` delivery with one;
    - a platform audit row with a target and no clinic, a `TEST_ALERT_SENT` row with a clinic, and a `TENANT_CREATED` row without one.
  - **`RESTRICT`:** deleting an operator who sent a test alert fails.
  - **`overview()`, on the test's own ids:** its real alert appears with its latest delivery and its count; its test is the last test and is not in the list.
- **`undeliveredAlert()`** (pure function, no database):
  - a failed real alert shows;
  - a later real alert that is delivered clears it;
  - a later `SENT` test does not;
  - an alert with no delivery shows after 3 minutes, not before;
  - a failed test never shows.
- **`tests/platformAlerts.test.ts`** (routes):
  - **Auth:** without an operator token, `401`; with a clinic token, `401`.
  - **`GET /alerts`:** the shape; not configured; neither the token nor the chat id anywhere in the body.
  - **`GET /alerts/bot`:** the username; not configured; Telegram's 401.
  - **`POST /alerts/test`:**
    - `201` with the outcome;
    - the alert row exists (`TEST`, the operator), and so does the `platform_audit_logs` row (`TEST_ALERT_SENT`, no clinic, no target);
    - a rejection is still a `201`, with `REJECTED`;
    - a `fetch` that throws an error carrying the token: no token in the response, the rows or the captured logs.
  - **The limit:** the real router built with `testLimitPerMinute: 2`. Two pass, the third is a `429`, and the counter is shared by two operators.
- **`tests/auditGuards.test.ts`:**
  - a failed check raises its kind;
  - `unreachable` and `passed` raise nothing;
  - a rejecting `raise` leaves no unhandled rejection;
  - a missing table counts as `failed`.
- **Existing tests:**
  - `audit-guards.sql` passes on the deployed tables, and the TEMP-copy tests still pass;
  - `auditGuardRepository.test.ts` follows the narrowed `unreachable`;
  - the migration scan, with the stricter `ALLOWED`;
  - `auditCoverage.test.ts`, with the new route;
  - `tenantScopeCoverage.test.ts`, unchanged.
- **Web:**
  - `AlertsCard`: configured with its bot; not configured, with the button disabled; the test's result shown; the list.
  - `UndeliveredAlertBanner`: shown with the alert's date and kind; hidden when there is nothing to show.

## Boundaries

- **Always:**
  - every alert and every attempt leaves a row, unless the database refuses it, and then a log line;
  - messages come only from the fixed templates, the label and the alert id;
  - every `detail` goes through `redact` before it is logged, stored or returned;
  - tests use a fake `fetch`.
- **Ask first:**
  - a new alert kind whose message needs a value (a count, an id other than the alert's);
  - retries, timeouts or the test limit beyond the numbers above;
  - showing Telegram's `description` anywhere outside the card;
  - a new platform action without a clinic.
- **Never:**
  - the token or the chat id in a log, row, response, error or message;
  - `parse_mode`, a link, or any text in a message that did not come from a template;
  - personal data, names, emails or clinical values in a message or a row;
  - an alert failure surfacing as a failed request. The one exception is the test route's own recording (step 1 of the test).
  - a real Telegram request from a test;
  - a staging or production token in a local `.env`.

## Success Criteria

- [ ] With both variables set, a failed `audit-guards.sql` at startup reaches the chat as `[<service>] …`, and leaves one alert row and one delivery row.
- [ ] Without the variables, the API starts and serves the same; the alert is recorded as `NOT_CONFIGURED`; the card says "No configurado" and the button is disabled.
- [ ] The test button returns Telegram's answer within 10 s, and records the alert, the attempt and a `TEST_ALERT_SENT` platform audit row, within its limit.
- [ ] The banner shows when the last real alert did not arrive, as §5 defines.
- [ ] No test, log, row or response contains the token, even when `fetch` throws an error that carries the URL.
- [ ] Both alert tables reject `UPDATE`, `TRUNCATE`, and `DELETE` outside maintenance. `audit-guards.sql` pins their triggers, keys, `NOT NULL`s and checks. The migration is on `ALLOWED` with its exact violations.
- [ ] `npm test`, `npm test -w apps/web` and `npm run check` pass locally, and the CI `test` and `test-web` jobs pass.
- [ ] The migration was rehearsed on a copy of `production`, and the throwaway branches are deleted.

## Decisions (2026-10-11)

The open questions, as Nath answered them:

1. **Two tables**, `sysadmin_alerts` and `sysadmin_alert_deliveries`. With one, half the columns would be null on every row, and an attempt's foreign key could point at another attempt.
2. **The tenant guard.** Neither table has a `tenantId`, and the coverage test rejects classifying a model without one. A comment in `tenantScope.ts` says where they go when a producer adds a `tenant_id`; the test demands it at that point.
3. **The test's limit: 50 per minute**, keyed globally: Telegram limits per chat, and every operator shares the one chat. It was 100. Telegram asks for about one message per second per chat and answers `429` with a wait, during which a real alert is delayed, or lost if the wait is over 60 s.
4. **The banner is literal, with no expiry**: it stays until a later real alert is delivered. A test does not clear it.
5. **`platform_audit_logs.tenant_id` becomes nullable**, which recording the test there requires. Two `CHECK`s keep it narrow: only `TEST_ALERT_SENT` has no clinic, and a row with a target always has one.
