# Ficha

Monorepo de npm workspaces: `apps/api` (Express 5 + Prisma + Postgres), `apps/web` (Vite + React 19 + Tailwind v4 + Base UI), `packages/shared` (tipos y schemas Zod compartidos; se buildea antes que las apps).

## Comandos

- `npm run dev` — shared + api + web en paralelo (api en :3001, web en :5173)
- `npm run dev:api` / `npm run dev:web` — cada app por separado
- `npm test` — the API's integration tests (vitest + supertest) against a throwaway Postgres in Docker, which must be running ([`docs/infra.md`](docs/infra.md#local-test-database)). Arguments go to vitest: `npm test -- login authSessions`. A bare `npx vitest` skips the container and hits `apps/api/.env`'s database (Neon)
- `npm run test:neon` — the same suite against `DATABASE_URL` (Neon): what CI runs
- `npm test -w apps/web` — tests del frontend (vitest + jsdom + testing-library)
- `npm run build` — shared → api → web
- `npm run db:migrate` / `db:seed` / `db:studio` — Prisma (workspace apps/api)

## Infraestructura

El porqué de cada regla de esta sección y la historia del split a tres entornos están en [`docs/infra.md`](docs/infra.md). Los recursos se nombran por nombre: los IDs de Render y Neon no se versionan (el repo es público). Para llegar a uno, buscarlo con los MCPs (`list_services` en Render, `list_projects` / `list_branches` en Neon); Netlify no tiene MCP, se mira en el dashboard.

- **GitHub** (`candiath/ficha`, **público**) — código, CI, rulesets.
- **Render** — la API. Un servicio por entorno, plan free (cold start ~50s).
- **Netlify** — la web. Un sitio (`fichita`) con dos contextos de deploy.
- **Neon** — Postgres. Proyecto `ficha`, una branch por entorno.

**Production holds no real clinical data yet, and is handled as if it did.** The launch of 2026-10-12 (the first wipe, #223) was postponed to correct the data model: what production holds since then is the clinic's trial, and it is wiped again before the relaunch (#238). Real clinical data starts at the relaunch. `staging`, `development` and `ci` hold only test data, and no branch is ever created from `production` except a temporary rehearsal branch, deleted when the rehearsal ends (see `docs/infra.md`).

| | Producción | Testing | Desarrollo |
| --- | --- | --- | --- |
| Rama | `main` | `dev` | working tree local |
| API (servicio de Render) | `Ficha` → ficha-i3t6.onrender.com | `ficha-staging` → ficha-staging.onrender.com | `localhost:3001` |
| Web | fichita.netlify.app | `dev--fichita.netlify.app` | `localhost:5173` |
| DB (branch de Neon) | `production` | `staging` | `development` |

CI usa una cuarta branch, `ci`, que arrancó **vacía a propósito** (los logs del CI son públicos). It persists between runs: `migrate deploy` applies only new migrations, and interrupted runs leave fictitious test rows behind (see `docs/infra.md`). Release PRs to `main` rebuild it from scratch with `migrate reset`, guarded against any database with non-test accounts.

Cada entorno tiene su propia branch y su propio `PLATFORM_JWT_SECRET` (the platform operator's; clinic users have no secret: their sessions are server-side rows in `auth_sessions`, see below). Los desplegados corren con `NODE_ENV=production`, que bloquea el seed y exige `CORS_ORIGIN`.

### Reglas

- PRs de feature contra `dev`. Release: PR `dev` → `main` con **merge commit**, no squash. Dejar pasar tiempo entre mergear a `dev` y promover: ese intervalo es todo el valor de testing.
- **No activar `strict` ("require branches to be up to date") en el ruleset**: produce un deadlock en cada release. Un hotfix directo sobre `main` hay que bajarlo a `dev` a mano.
- El CI no corre en push a `main` porque el PR de release ya testeó el mismo árbol. Si `main` empieza a recibir cambios por otro canal, hay que volver a sumarlo. **Nor on push to `dev`** (same reason: the PR tested the merge); and on PRs it skips what the change cannot affect — docs-only PRs run no tests, web-only PRs skip the API tests (`changes` job in `test.yml`). The full API suite runs locally before every push.
- Los PRs borran su rama al mergearse (`delete_branch_on_merge`). `dev` y `main` sobreviven solo porque el ruleset tiene la regla `deletion`: no sacarla.
- **Migraciones**: se generan en local con `npm run db:migrate` y se commitean con el código. Render corre `npm run migrate:prod` en el build de cada servicio; si falla, sigue sirviendo el deploy anterior. Van por `DIRECT_DATABASE_URL` (sin pooler; con pooler fallan con `P1002`).
- **Migraciones destructivas en dos releases**: primero se deja de leer la columna; el `DROP` va en un release posterior.
- Nunca correr `db:migrate` ni `db:seed` contra `production`. **El `.env` local no guarda la URL de producción**, ni comentada.
- No habilitar PR previews sobre el servicio de Render de producción: clonan sus env vars. Si se quieren previews, van sobre `ficha-staging`.
- Para saber a qué API pega cada contexto de Netlify, mirar el bundle publicado (`VITE_API_URL` se inlinea al buildear), no el dashboard.

### Backups

El PITR de Neon cubre 6 horas. Además hay un `pg_dump` diario de producción en un repo privado aparte, disparado también al **abrir** el PR de release (`.github/workflows/backup-antes-del-release.yml`). La credencial de producción vive solo allá. Its history was started over after the wipe of 2026-10-12 and is started over again after the relaunch's wipe (#238); from then on the dumps hold real clinical data. Acá solo está `BACKUP_DISPATCH_TOKEN`, un PAT fine-grained con **Actions: write** (y no Contents, que daría lectura de los dumps) que usa el endpoint `workflow_dispatch`.

## Base de datos

Postgres en **Neon**, vía `DATABASE_URL` en `apps/api/.env` (branch `development`, ver *Infraestructura*). The dev server and `prisma migrate dev` run directly against Neon; the only local database is the tests' throwaway Postgres in Docker (`npm test`).

### Acceso a datos: patrón repositorio

**La base de datos se toca solo desde `apps/api/src/repositories`.** Una regla `no-restricted-imports` en `eslint.config.mjs` lo hace cumplir: importar `lib/prisma` o `lib/tenantScope` desde una ruta o middleware es error de lint (y el CI corre `npm run check`). `tests/`, `prisma/seed.ts` y `scripts/` quedan exentos.

Cada entidad tiene un **port** (`<entidad>Repository.ts`: interface + DTOs) y una **implementación** (`prisma/prisma<Entidad>Repository.ts`), exportada con alias desde el barrel `repositories/index.ts`. Convenciones:

- Primer argumento `ctx: TenantContext` (lo arma `authenticate` y viaja en `req.context`); adentro, `forTenant(ctx)` devuelve el cliente scopeado que inyecta el `tenantId` solo.
- **No encontrado devuelve `null`/`false`, nunca throw** — la ruta lo mapea a 404. Con más de dos salidas, unión de literales (`'deleted' | 'not_found' | 'in_use'`) o resultado discriminado (`{ ok: false, reason }`).
- **Las escrituras condicionadas llevan la condición en el `where` del write** (`updateMany`/`deleteMany` + count, o `update` con campos no únicos en el where y `P2025` → `null`): existencia, pertenencia y vigencia se deciden en la misma query que escribe, sin ventana entre chequeo y escritura.
- Los DTOs no exponen `tenantId`; fechas como ISO string.
- **Money is integer cents everywhere**: `BIGINT` columns named `*_cents`, `*Cents` fields in the API and the web, validated with `CentsSchema` ($1.234,56 is `123456`). Pesos exist only on screen, through `apps/web/src/lib/money.ts` (`parsePesos` reads what was typed from the string, `formatCents` shows it). Never a float of pesos: it rounds differently in two places.
- **Foreign keys carry the clinic, and the patient when there is one**: a row points at a patient with `(tenant_id, patient_id)`, at a user with `(tenant_id, user_id)`, and at a patient's episode, session or package with `(tenant_id, patient_id, id)`, always `Restrict`. A repository bug can then not join two clinics or two patients: the database refuses it. A new model follows the pattern; `20261024120000_model_integrity` has the reasons and the `CHECK`s that go with it.
- Zod y la semántica HTTP se quedan en la ruta; la política de datos (borrado lógico, "global o del tenant", "no borrar un paquete usado") vive en el repositorio.
- **Audited writes record their audit row in the same transaction** (#188): the repository method takes an `audit` argument (an `AuditBuilder<T>`, built from the write's result, or an `AuditEntry` for deletes) and writes it with `recordAudit(tx, ctx, entry)` using the write's own transaction client. If either fails, both roll back. `auditLogRepository` is read-only — there is no standalone `create`, so a route cannot record an action separately (and lose the row when that second write fails). The route still writes the wording of the entry. `tests/auditTransactional.test.ts` forces the audit insert to fail and checks the action rolled back.
- **The database enforces the audit tables** (#186, [`docs/specs/audit-map.md`](docs/specs/audit-map.md), [`SPEC-audit-hardening.md`](docs/specs/SPEC-audit-hardening.md); operations in [`docs/infra.md`](docs/infra.md#audit-tables)):
  - **Append-only**: triggers on `audit_logs`, `platform_audit_logs`, `sysadmin_alerts` and `sysadmin_alert_deliveries` reject every `UPDATE` and `TRUNCATE`, and every `DELETE` outside maintenance. `created_at` is stamped by the database on insert (UTC, `clock_timestamp()`), whatever the caller sends. Readers order by `createdAt`, then `id`.
  - **Maintenance** (deleting, or inserting with a past date) needs the flag table `ficha_ops.audit_maintenance_allowed`, **which only `development` and `ci` have**, and the switch `set_config('ficha.audit_maintenance', pg_current_xact_id()::text, true)` in the same transaction. Only `tests/helpers.ts`, `tests/auditHardening.test.ts`, the seed and `npm run purge:test-audit` use it (`tests/auditSwitchScan.test.ts`).
  - **Foreign keys `RESTRICT`**, and patient, author and target are composite `(tenant_id, …)`: an audit row cannot point at another clinic's row, and nobody it names can be deleted. `platform_audit_logs.operator_id` is required; its `tenant_id` is null only for an action on the platform itself (`TEST_ALERT_SENT`), and a row with a target always names its clinic (two `CHECK`s).
  - `TenantContext` carries `authSessionId`, set by `authenticate` (there is no `req.authSessionId`); `recordAudit` stores it in `audit_logs.auth_session_id`, and a trigger rejects a session that is not the author's. It never goes into a clinic-facing DTO.
  - **Checks**: `prisma/audit-guards.sql` (tables, triggers, functions by hash, rules, row-level security, foreign keys, `CHECK`s, `NOT NULL`s) and `prisma/no-audit-maintenance.sql` run in CI, in the Render build (`migrate:prod`) and at API startup (where a failed check alerts the sysadmin, see *Sysadmin alerts*). Changing a trigger or audit function is a new migration plus new expected values there; a migration with DDL on the audit tables also needs an entry in `tests/auditMigrationScan.test.ts`, with the exact violations it is allowed.
  - **Audit rows are codes, never sentences or values** ([`SPEC-audit-structured-entries.md`](docs/specs/SPEC-audit-structured-entries.md)): an `action` per business fact (`CONSENT_REVOKED`, `DISCHARGE_RECORDED`), the object it touched, `actor_type` (`USER` / `OPERATOR` / `SYSTEM`) and `params` holding only codes (`{ "scaleType": "NDI" }`, `{ "changedFields": ["phone"] }`). Every action is declared, with its parameters and its Spanish wording, in the catalog `packages/shared/src/auditActions.ts`: `recordAudit` / `recordPlatformAudit` refuse anything it does not allow (a `500`, rolling the action back), the database refuses numbers, ids, emails and free text in `params` (`audit_params_are_codes`), and the screens build the sentence from it. An update records the names of the fields it changed and, if none changed, nothing. **Codes are permanent**: an action, a parameter or a parameter value, once written, is never renamed, reused or removed; a replaced action is marked `deprecated` and keeps its wording. Who was affected is read from the row's target when displayed (`PlatformAuditLogDTO.targetUser`). The `description` column of the format before the catalog was dropped before go-live.
  - **Tests touch audit rows only through `tests/helpers.ts`**: `deleteAuditRows`, `deleteOperatorAuditRows` (also the operator's test alerts), `deleteSysadminAlerts`, `insertAuditRowsAt` (backdating). Delete a test's audit rows before its users, patients or operators. Repository tests get a session-backed context from `createTestContext`.
  - The seed refuses to run on a database with accounts outside `@ficha.dev` / `@test.ficha.local` (`prisma/seedGuard.ts`).

Tres excepciones documentadas:

- **`authRepository` no recibe `ctx`**: sus lecturas son las que lo construyen (login y `authenticate`), así que corren antes de que exista un tenant. **Sessions live here too** (`docs/specs/SPEC-server-sessions.md`): login creates an `auth_sessions` row and returns an opaque token (only its SHA-256 is stored); `authenticate` accepts it only if one query finds the session unrevoked and unexpired *and* the user and clinic active. Every write that cuts access (logout, password change, deactivating a user or a clinic) also revokes the sessions involved, in the same transaction — the join is the safety net, the revocation is what keeps a reactivation from bringing old sessions back. `auth_sessions` has no `tenantId` (the owner is the user), so it needs no guard classification.

  **Lifetime** (`lib/authSessionPolicy.ts`, `docs/specs/SPEC-my-sessions.md`): every session has an idle *and* an absolute timeout and dies at the first — idle kills an abandoned session, absolute caps a stolen one that is kept alive by use. Normal: 1 h idle / 12 h absolute. Trusted device (opt-in checkbox at login): 7 days / 30 days, at most 3 per user (a 4th demotes the oldest to normal). `last_used_at` is written at most every 5 minutes. A session that **ended** (revoked, expired or idle past the longest idle timeout) more than **180 days** ago is deleted by the retention runner (`lib/retention.ts`, `lib/retentionPolicy.ts`, #178): a minute after the API starts and daily after that, never on a request. 180 days is the floor, since audit rows name a session by id and must still resolve to its device. These are code constants on purpose — security policy is changed in a reviewed PR, not per deployment. Users see and close their own sessions in *Mi cuenta → Dispositivos conectados* (`/api/auth/devices`); nobody else can list them. An ADMIN (`POST /api/users/:id/disconnect-devices`, *Clínica → Usuarios*) and the platform operator can **disconnect every device** of a user without deactivating her (`docs/specs/SPEC-admin-revocation.md`): `204` with no count, so they never learn how many devices she had. The operator's is audited; the ADMIN's is not yet (#186).

  **Password reset links** (`docs/specs/SPEC-password-reset.md`): there is no "forgot my password" by email; an ADMIN (`POST /api/users/:id/password-reset`, not on herself) or the operator generates a single-use link for an active user of the clinic, valid 24 h, and passes it on by hand. **Generating it is what cuts access**, in one transaction (`repositories/prisma/passwordResetLinks.ts`, shared by both): her earlier unused links are retired, her password hash is replaced with a bcrypt hash of random bytes (so login timing does not reveal the reset) and every session she had is revoked. The token is opaque (`lib/opaqueToken.ts`, the same generator as sessions; only its SHA-256 is stored in `password_reset_tokens`) and travels **only in request bodies and the URL fragment** (`/restablecer-contrasena#<token>`, which the page clears from the address bar): never in a path or query string a server would log. The public routes (`POST /api/auth/password-reset/check` and `/password-reset`) are rate limited per IP and answer every invalid link — unknown, used, retired, expired, deactivated user or clinic — with the same `400`; the conditioned write decides single use, so two concurrent uses yield one `204`. Both user lists show the expiry of a usable link (`passwordResetExpiresAt`, the "Restablecimiento pendiente" badge), never the token. The operator's generation is audited (`PASSWORD_RESET_LINK_CREATED`); the ADMIN's and the use of a link are not yet (#186), but each row keeps the evidence #186 will read: `created_by_user_id` / `created_by_operator_id`, `created_ip` / `created_user_agent`, `used_ip` / `used_user_agent` — so an ADMIN who resets a therapist's password and uses the link herself leaves a trace.

  **Naming: "session" alone is the clinical one** (`Session`, `sessions`, `SessionDTO`, `/api/sessions`): it is the therapists' own word. A login session is always **`AuthSession`** in code (`AuthSessionDTO`, `authSessionId`, `lib/authSession*.ts`), lives under `/api/auth/devices`, and is a **"dispositivo"** in the UI ("Dispositivos conectados"); only the standard phrases "Iniciar sesión" / "Cerrar sesión" keep the word.
- **`tenantRepository` filtra a mano por `id: ctx.tenantId`**: `Tenant` no está —ni debe estar— en `TENANT_SCOPED_MODELS`, porque el guard filtra inyectando una columna `tenantId` y en esa tabla el tenant *es* el `id`. Ponerla en la lista haría que buscara `tenants.tenant_id`, que no existe.
- **`platformRepository` recibe el `tenantId` como argumento explícito** en cada operación, en vez de un `ctx`: es la capa del operador de plataforma (abajo), la única que elige el tenant a mano. Usa el `prisma` base y solo toca `tenants`, lo administrativo de `users` y `platform_audit_logs`.

Two more take no `ctx` because they are about the platform, not a clinic: `auditGuardRepository` (runs the audit checks) and `sysadminAlertRepository` (the alert tables, plus the `platform_audit_logs` row of a test alert). The alert tables have no `tenantId`, so they need no guard classification (see the comment in `tenantScope.ts`).

Hubo otra —`techniqueRepository`— pero los catálogos de técnicas se eliminaron del modelo el 01/09/2026 y con ellos el repositorio.

**Todo modelo con columna `tenantId` tiene que estar en `TENANT_SCOPED_MODELS` o en `TENANT_MODELS_FUERA_DEL_GUARD`** (hoy `LoginEvent` y `PlatformAuditLog`, con el motivo al lado). Olvidarse de clasificar un modelo nuevo es el único bug del guard que no falla visiblemente —devuelve filas de todas las clínicas sin un solo error—, así que `tests/tenantScopeCoverage.test.ts` compara el schema contra las dos listas y rompe el CI si aparece uno sin clasificar.

### Operador de plataforma

Quien crea clínicas y les nombra su primera ADMIN (issue #153). **No es un tercer valor de `UserRole`**: es la tabla `platform_operators`, con su propio login (`/api/platform/auth/*`), su propio secreto (`PLATFORM_JWT_SECRET`, obligatorio) y sus propias rutas (`/api/platform/*`), montadas en `app.ts` **antes** de `authenticate` y por lo tanto fuera de él y de `forTenant`. The operator is still on a JWT (it moves to sessions in the `operator-sessions` module); the two kinds of token cannot overlap: an operator JWT matches no clinic session, and a clinic session token is not a JWT. `tests/platformIsolation.test.ts` prueba las dos direcciones con tokens fabricados.

Lo que puede: listar y crear clínicas, desactivarlas (`tenants.deactivated_at`: todos sus usuarios reciben 401 en el request siguiente, porque `findForAuth` lo exige null), crear el ADMIN de una clínica y cambiar rol o estado de sus usuarios —con la misma regla de "la clínica conserva una ADMIN activa" que aplica `userRepository` (`whereConservaAdmin`)—, disconnect a user's devices (`USER_DEVICES_DISCONNECTED`), generate a password reset link for her (`PASSWORD_RESET_LINK_CREATED`), and send a test alert (`TEST_ALERT_SENT`, the only action with no clinic). Lo que no puede: nada clínico. Cada acción deja una fila en `platform_audit_logs` **en la misma transacción**.

El bootstrap es `npm run create:operator -w apps/api` con `OPERATOR_EMAIL` y `OPERATOR_PASSWORD`: se corre **una vez por entorno**, y a partir de ahí todo pasa por la UI de `/platform`. Reemplazó a `create-admin.ts`, que se borró en #79. En local el seed crea `operador@ficha.dev` / `password123`.

### Sysadmin alerts

The operator is told by Telegram when something needs her (#186, [`docs/specs/SPEC-sysadmin-alerts.md`](docs/specs/SPEC-sysadmin-alerts.md); setup in [`docs/infra.md`](docs/infra.md#sysadmin-alerts-telegram)). One bot per environment: each Render service has its own `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (numeric). Without them the app works the same and the card says "No configurado".

- **`sysadminAlerts.raise(kind)`** (`lib/sysadminAlerts.ts`) records the alert in `sysadmin_alerts`, sends a fixed Spanish message off the request path, and records every attempt in `sysadmin_alert_deliveries`, retrying a timeout, a 5xx or a 429 within a minute (3 attempts). It never rejects: a caller on a request path writes `void sysadminAlerts.raise(kind)`. A kind names a fixed message: **no values, names or clinical data**, in the message or the rows. Rate limiting per kind is deferred.
- **The token never leaves the variable.** Only `lib/telegram.ts` knows it; it never throws, reduces a network error to its name and code (undici's messages carry the URL, which carries the token), and redacts every detail.
- **The first producer** is the startup audit check: a *failed* check alerts; one that could not run does not.
- **`/platform`**: the *Alertas* card (configuration by variable name, bot from `getMe`, last delivery, last 20 real alerts, a test button limited to 50 a minute for every operator together) and a banner while the most recent real alert has not arrived.
- **Tests never reach Telegram**: `tests/setup.ts` drops the variables and blocks `api.telegram.org`; tests pass a fake `fetch`.

### Borrado de pacientes

Es **lógico** (`deletedAt`): el paciente desaparece de `GET /api/patients`, su ficha da 404 y no puede recibir datos clínicos nuevos (las rutas que crean episodios, sesiones, escalas, alertas y paquetes pasan por `patientRepo.exists()`). Pero **el historial ya registrado lo sigue nombrando**: los joins `patient: { select: { fullName } }` de Cobros, Sesiones y Paquetes no filtran `deletedAt` a propósito — un cobro sin nombre sería un registro inútil. Borrar un paciente lo oculta; no reescribe el pasado. (Issue #72, cerrado *by design*.)

La línea que separa las dos mitades es **historial vs. trabajo pendiente**. Por eso las **alertas sí filtran** pacientes borrados, en la lista y en el contador de no leídas: una alerta no registra lo que pasó, pide una acción — y sobre un paciente eliminado esa acción es imposible. El filtro va en la lectura (`clinicalAlertRepository`) y no borra filas: el borrado es reversible y las alertas deben poder volver con el paciente.

### JSON fields: their shape lives in `packages/shared`

Postgres validates nothing inside a `Json?` column, so **the shape of a JSON field is declared in `packages/shared` and the route validates it with that schema**, strict (`strictObject`) so an unknown key is a `400`. Otherwise the meaning of the data lives only in the React component that draws it, and nobody else can read it without reimplementing it.

The initial evaluation's posture-family grid was the model case until the RPG fields left the evaluation (#238); its history is in `git log -- packages/shared/src/postureFamilies.ts`. One field is still outside the pattern: `retractionMap` uses `z.unknown()`, pending the client's answer on the body map.

The modules of `packages/shared` with **runtime values** (the rest is `import type`): `slug.ts`, with `slugify` and `SLUG_PATTERN`, so the API derives a clinic's slug with exactly the function the web previews it with; `auditActions.ts`, the catalog of audit actions the API validates every audit row with and the web builds each row's sentence from; and `partialDate.ts`, a date as the patient remembers it (a day, a month or a year, maybe approximate), which the API validates and the web builds from "hace dos meses" and shows (#238). That is why `apps/web/vite.config.ts` and `vitest.config.ts` alias `@ficha/shared` to the source (the package compiles to CommonJS, which a browser cannot load), and why the CI's `test` job builds `packages/shared` before the API tests; Render already does it through `build:api`. A new one goes on this list: a runtime value in a package almost everyone imports as types is easy to lose sight of.

## Convenciones

- Branches `feat/*` desde `dev`; PRs de feature contra `dev`, nunca contra `main`. El default branch del repo es `main`, así que `gh pr create` necesita `-B dev` explícito. Commits pequeños y atómicos, con prefijo convencional (`fix(web): ...`, `test(web): ...`).
- **Language (since 2026-10-04): everything new is written in English** — identifiers, comments, test names, commit messages, PR and issue text, and documentation (including specs and new sections of this file).
  - **Exception: what users read stays in Spanish** — UI text and API error messages (`{"error":"No autenticado"}`).
  - Existing Spanish code and docs are not translated in bulk; translate a piece when it is touched for another reason.
- La API envuelve respuestas en `{ data: ... }`; todo `/api/*` salvo `/api/auth/*` y `/health` exige `Authorization: Bearer <token>` (401 → `{"error":"No autenticado"}`).
- CI (`.github/workflows/test.yml`): jobs paralelos para API (con migraciones) y web.

### Every write route is classified for audit

Every `POST`, `PUT`, `PATCH` and `DELETE` route is in `apps/api/tests/auditCoverageManifest.ts`, as `audited` (with its audit table), `exempt` (with a reason) or `debt` (with the module that closes it). A new write route either writes its audit row in the same transaction (see *Acceso a datos*) or is added as `exempt` with a reason, reviewed in the PR. Never add a new route as `debt`. `tests/auditCoverage.test.ts` breaks the CI when a route is missing from the manifest or an entry outlives its route. Spec: [`docs/specs/SPEC-audit-coverage.md`](docs/specs/SPEC-audit-coverage.md).

### Global lists carry no clinical text

A response that spans patients carries no clinical text (#186, [`docs/specs/SPEC-list-minimization.md`](docs/specs/SPEC-list-minimization.md)): no column of `Session`, `ClinicalEpisode`, `InitialEvaluation`, `FunctionalScale`, `InformedConsent`, `SessionEpisode` or `PatientEvent`, nor text derived from one (an episode's complaint in an alert). Clinical detail is read from routes under `/api/patients/:patientId/…`, the record, which `record-access-log` will log.

- Every `GET` outside the record is classified in `apps/api/tests/listScopeManifest.ts`: *probed* (called against a clinic whose clinical columns hold markers; its keys are pinned) or *exempt* with a reason. `tests/listMinimization.test.ts` fails on an unclassified `GET`, a marker in a probed response, or a key added to one.
- A list selects only the columns it returns.
- An edit form renders only from the full record, never from a list item: under "un solo vacío", a partial object saves its missing fields as erased.

### Un solo vacío, y lo decide la API

Hay una sola forma de decir "este campo no tiene dato" y es `null`. Como un formulario web no tiene `null` sino `""`, la API acepta las dos y normaliza; el front manda lo que el control tiene en la mano y no traduce nada.

| Lo que llega | Qué pasa |
| --- | --- |
| el campo no viene | no se toca |
| `""` o `"   "` | `null` |
| `null` | `null` |

Los schemas están en `apps/api/src/lib/validation.ts` (`OptionalTextSchema`, `OptionalDateSchema`, `OptionalDateTimeSchema`, `OptionalIdSchema`, `optionalEnum`, `optionalText({ max })`) y las rutas los usan en vez de repetir la regla. El texto obligatorio va con `requiredText(min, mensaje)`, que **trimea antes de medir**: sin eso, un nombre de tres espacios pasa `min(2)` y queda una ficha con un paciente sin nombre.

Esto vale también para las columnas JSON de la evaluación inicial: `jsonFields()` omite la clave del campo que no vino, en vez de completarla con `JsonNull`. Lo contrario —lo que hacía hasta #161— convertía cada PUT parcial en un borrado silencioso de la grilla de posturas.

### Ids: UUIDv7 en columnas `uuid`, validados antes de consultar

Toda PK es `@default(uuid(7)) @db.Uuid` y toda columna que guarda un id lleva `@db.Uuid` (#174). Contra una columna `uuid`, un id con otra forma no devuelve "no encontrado": Prisma tira `P2023`. Por eso el formato se valida antes de llegar al repositorio:

- **En la URL → 404** con el mensaje de la entidad: cada `:param` se registra con `router.param(nombre, idParam('X no encontrado'))` en el archivo que lo declara; los del path de montaje (`:patientId`, `:episodeId`) con `app.param` en `app.ts`. `tests/idParamCoverage.test.ts` rompe el CI si una ruta nueva usa un param sin registrar.
- **En el body o el query → 400**: `IdSchema` / `OptionalIdSchema`.
- Red de seguridad: el `errorHandler` responde `P2023` como 404 y lo loguea — si aparece en los logs, hay un camino sin validar.

Una columna nueva que guarde un id lleva `@db.Uuid`, aunque no tenga relación declarada (como `AuditLog.entityId` o `Appointment.seriesId`). Y una migración que cambie el tipo de una columna con datos se revisa a mano: para `text → uuid` Prisma genera `DROP COLUMN` + `ADD COLUMN`, que borra los valores (ver `20261002154935_ids_uuid_nativos`).

**Un id identifica, no autoriza**: un UUID (v4 o v7) no es un secreto. Un acceso sin login nunca lleva el id de una fila en la URL, sino un token aleatorio propio.

Para levantar y verificar la app end-to-end (puertos, seed, gotchas de Windows): skill `verify` en `.claude/skills/verify/SKILL.md`.
