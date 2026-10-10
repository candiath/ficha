# Ficha

Monorepo de npm workspaces: `apps/api` (Express 5 + Prisma + Postgres), `apps/web` (Vite + React 19 + Tailwind v4 + Base UI), `packages/shared` (tipos y schemas Zod compartidos; se buildea antes que las apps).

## Comandos

- `npm run dev` — shared + api + web en paralelo (api en :3001, web en :5173)
- `npm run dev:api` / `npm run dev:web` — cada app por separado
- `npm test` — tests de integración de la API (vitest + supertest, pegan a la DB)
- `npm test -w apps/web` — tests del frontend (vitest + jsdom + testing-library)
- `npm run build` — shared → api → web
- `npm run db:migrate` / `db:seed` / `db:studio` — Prisma (workspace apps/api)

## Infraestructura

El porqué de cada regla de esta sección y la historia del split a tres entornos están en [`docs/infra.md`](docs/infra.md). Los recursos se nombran por nombre: los IDs de Render y Neon no se versionan (el repo es público). Para llegar a uno, buscarlo con los MCPs (`list_services` en Render, `list_projects` / `list_branches` en Neon); Netlify no tiene MCP, se mira en el dashboard.

- **GitHub** (`candiath/ficha`, **público**) — código, CI, rulesets.
- **Render** — la API. Un servicio por entorno, plan free (cold start ~50s).
- **Netlify** — la web. Un sitio (`fichita`) con dos contextos de deploy.
- **Neon** — Postgres. Proyecto `ficha`, una branch por entorno.

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

El PITR de Neon cubre 6 horas. Además hay un `pg_dump` diario de producción en un repo privado aparte, disparado también al **abrir** el PR de release (`.github/workflows/backup-antes-del-release.yml`). La credencial de producción vive solo allá. Acá solo está `BACKUP_DISPATCH_TOKEN`, un PAT fine-grained con **Actions: write** (y no Contents, que daría lectura de los dumps) que usa el endpoint `workflow_dispatch`.

## Base de datos

Postgres en **Neon**, vía `DATABASE_URL` en `apps/api/.env` (branch `development`, ver *Infraestructura*). No hay base local ni Docker: `prisma migrate dev` corre directo contra Neon.

### Acceso a datos: patrón repositorio

**La base de datos se toca solo desde `apps/api/src/repositories`.** Una regla `no-restricted-imports` en `eslint.config.mjs` lo hace cumplir: importar `lib/prisma` o `lib/tenantScope` desde una ruta o middleware es error de lint (y el CI corre `npm run check`). `tests/`, `prisma/seed.ts` y `scripts/` quedan exentos.

Cada entidad tiene un **port** (`<entidad>Repository.ts`: interface + DTOs) y una **implementación** (`prisma/prisma<Entidad>Repository.ts`), exportada con alias desde el barrel `repositories/index.ts`. Convenciones:

- Primer argumento `ctx: TenantContext` (lo arma `authenticate` y viaja en `req.context`); adentro, `forTenant(ctx)` devuelve el cliente scopeado que inyecta el `tenantId` solo.
- **No encontrado devuelve `null`/`false`, nunca throw** — la ruta lo mapea a 404. Con más de dos salidas, unión de literales (`'deleted' | 'not_found' | 'in_use'`) o resultado discriminado (`{ ok: false, reason }`).
- **Las escrituras condicionadas llevan la condición en el `where` del write** (`updateMany`/`deleteMany` + count, o `update` con campos no únicos en el where y `P2025` → `null`): existencia, pertenencia y vigencia se deciden en la misma query que escribe, sin ventana entre chequeo y escritura.
- Los DTOs no exponen `tenantId`; fechas como ISO string y `Decimal` como `number`.
- Zod y la semántica HTTP se quedan en la ruta; la política de datos (borrado lógico, "global o del tenant", "no borrar un paquete usado") vive en el repositorio.
- **Audited writes record their audit row in the same transaction** (#188): the repository method takes an `audit` argument (an `AuditBuilder<T>`, built from the write's result, or an `AuditEntry` for deletes) and writes it with `recordAudit(tx, ctx, entry)` using the write's own transaction client. If either fails, both roll back. `auditLogRepository` is read-only — there is no standalone `create`, so a route cannot record an action separately (and lose the row when that second write fails). The route still writes the wording of the entry. `tests/auditTransactional.test.ts` forces the audit insert to fail and checks the action rolled back.
- **The database enforces the audit tables** (#186, [`docs/specs/audit-map.md`](docs/specs/audit-map.md), [`SPEC-audit-hardening.md`](docs/specs/SPEC-audit-hardening.md); operations in [`docs/infra.md`](docs/infra.md#audit-tables)):
  - **Append-only**: triggers on `audit_logs` and `platform_audit_logs` reject every `UPDATE` and `TRUNCATE`, and every `DELETE` outside maintenance. `created_at` is stamped by the database on insert (UTC, `clock_timestamp()`), whatever the caller sends. Readers order by `createdAt`, then `id`.
  - **Maintenance** (deleting, or inserting with a past date) needs the flag table `ficha_ops.audit_maintenance_allowed`, **which only `development` and `ci` have**, and the switch `set_config('ficha.audit_maintenance', pg_current_xact_id()::text, true)` in the same transaction. Only `tests/helpers.ts`, the seed and `npm run purge:test-audit` use it (`tests/auditSwitchScan.test.ts`).
  - **Foreign keys `RESTRICT`**, and patient, author and target are composite `(tenant_id, …)`: an audit row cannot point at another clinic's row, and nobody it names can be deleted. `platform_audit_logs.operator_id` is required.
  - `TenantContext` carries `authSessionId`, set by `authenticate` (there is no `req.authSessionId`); `recordAudit` stores it in `audit_logs.auth_session_id`, and a trigger rejects a session that is not the author's. It never goes into a clinic-facing DTO.
  - **Checks**: `prisma/audit-guards.sql` (triggers, functions by hash, rules, row-level security, foreign keys) and `prisma/no-audit-maintenance.sql` run in CI, in the Render build (`migrate:prod`) and at API startup (log only). Changing a trigger or audit function is a new migration plus new expected values there; a migration with DDL on the audit tables also needs an entry in `tests/auditMigrationScan.test.ts`.
  - **A description names the action, never a value**: no measurements, scores, amounts, emails or names. Who was affected is read from the row's target when displayed (`PlatformAuditLogDTO.targetUser`).
  - **Tests touch audit rows only through `tests/helpers.ts`**: `deleteAuditRows`, `deleteOperatorAuditRows`, `insertAuditRowsAt` (backdating). Delete a test's audit rows before its users, patients or operators. Repository tests get a session-backed context from `createTestContext`.
  - The seed refuses to run on a database with accounts outside `@ficha.dev` / `@test.ficha.local` (`prisma/seedGuard.ts`).

Tres excepciones documentadas:

- **`authRepository` no recibe `ctx`**: sus lecturas son las que lo construyen (login y `authenticate`), así que corren antes de que exista un tenant. **Sessions live here too** (`docs/specs/SPEC-server-sessions.md`): login creates an `auth_sessions` row and returns an opaque token (only its SHA-256 is stored); `authenticate` accepts it only if one query finds the session unrevoked and unexpired *and* the user and clinic active. Every write that cuts access (logout, password change, deactivating a user or a clinic) also revokes the sessions involved, in the same transaction — the join is the safety net, the revocation is what keeps a reactivation from bringing old sessions back. `auth_sessions` has no `tenantId` (the owner is the user), so it needs no guard classification.

  **Lifetime** (`lib/authSessionPolicy.ts`, `docs/specs/SPEC-my-sessions.md`): every session has an idle *and* an absolute timeout and dies at the first — idle kills an abandoned session, absolute caps a stolen one that is kept alive by use. Normal: 1 h idle / 12 h absolute. Trusted device (opt-in checkbox at login): 7 days / 30 days, at most 3 per user (a 4th demotes the oldest to normal). `last_used_at` is written at most every 5 minutes. These are code constants on purpose — security policy is changed in a reviewed PR, not per deployment. Users see and close their own sessions in *Mi cuenta → Dispositivos conectados* (`/api/auth/devices`); nobody else can list them. An ADMIN (`POST /api/users/:id/disconnect-devices`, *Clínica → Usuarios*) and the platform operator can **disconnect every device** of a user without deactivating her (`docs/specs/SPEC-admin-revocation.md`): `204` with no count, so they never learn how many devices she had. The operator's is audited; the ADMIN's is not yet (#186).

  **Password reset links** (`docs/specs/SPEC-password-reset.md`): there is no "forgot my password" by email; an ADMIN (`POST /api/users/:id/password-reset`, not on herself) or the operator generates a single-use link for an active user of the clinic, valid 24 h, and passes it on by hand. **Generating it is what cuts access**, in one transaction (`repositories/prisma/passwordResetLinks.ts`, shared by both): her earlier unused links are retired, her password hash is replaced with a bcrypt hash of random bytes (so login timing does not reveal the reset) and every session she had is revoked. The token is opaque (`lib/opaqueToken.ts`, the same generator as sessions; only its SHA-256 is stored in `password_reset_tokens`) and travels **only in request bodies and the URL fragment** (`/restablecer-contrasena#<token>`, which the page clears from the address bar): never in a path or query string a server would log. The public routes (`POST /api/auth/password-reset/check` and `/password-reset`) are rate limited per IP and answer every invalid link — unknown, used, retired, expired, deactivated user or clinic — with the same `400`; the conditioned write decides single use, so two concurrent uses yield one `204`. Both user lists show the expiry of a usable link (`passwordResetExpiresAt`, the "Restablecimiento pendiente" badge), never the token. The operator's generation is audited (`PASSWORD_RESET_LINK_CREATED`); the ADMIN's and the use of a link are not yet (#186), but each row keeps the evidence #186 will read: `created_by_user_id` / `created_by_operator_id`, `created_ip` / `created_user_agent`, `used_ip` / `used_user_agent` — so an ADMIN who resets a therapist's password and uses the link herself leaves a trace.

  **Naming: "session" alone is the clinical one** (`Session`, `sessions`, `SessionDTO`, `/api/sessions`): it is the therapists' own word. A login session is always **`AuthSession`** in code (`AuthSessionDTO`, `authSessionId`, `lib/authSession*.ts`), lives under `/api/auth/devices`, and is a **"dispositivo"** in the UI ("Dispositivos conectados"); only the standard phrases "Iniciar sesión" / "Cerrar sesión" keep the word.
- **`tenantRepository` filtra a mano por `id: ctx.tenantId`**: `Tenant` no está —ni debe estar— en `TENANT_SCOPED_MODELS`, porque el guard filtra inyectando una columna `tenantId` y en esa tabla el tenant *es* el `id`. Ponerla en la lista haría que buscara `tenants.tenant_id`, que no existe.
- **`platformRepository` recibe el `tenantId` como argumento explícito** en cada operación, en vez de un `ctx`: es la capa del operador de plataforma (abajo), la única que elige el tenant a mano. Usa el `prisma` base y solo toca `tenants`, lo administrativo de `users` y `platform_audit_logs`.

Hubo otra —`techniqueRepository`— pero los catálogos de técnicas se eliminaron del modelo el 01/09/2026 y con ellos el repositorio.

**Todo modelo con columna `tenantId` tiene que estar en `TENANT_SCOPED_MODELS` o en `TENANT_MODELS_FUERA_DEL_GUARD`** (hoy `LoginEvent` y `PlatformAuditLog`, con el motivo al lado). Olvidarse de clasificar un modelo nuevo es el único bug del guard que no falla visiblemente —devuelve filas de todas las clínicas sin un solo error—, así que `tests/tenantScopeCoverage.test.ts` compara el schema contra las dos listas y rompe el CI si aparece uno sin clasificar.

### Operador de plataforma

Quien crea clínicas y les nombra su primera ADMIN (issue #153). **No es un tercer valor de `UserRole`**: es la tabla `platform_operators`, con su propio login (`/api/platform/auth/*`), su propio secreto (`PLATFORM_JWT_SECRET`, obligatorio) y sus propias rutas (`/api/platform/*`), montadas en `app.ts` **antes** de `authenticate` y por lo tanto fuera de él y de `forTenant`. The operator is still on a JWT (it moves to sessions in the `operator-sessions` module); the two kinds of token cannot overlap: an operator JWT matches no clinic session, and a clinic session token is not a JWT. `tests/platformIsolation.test.ts` prueba las dos direcciones con tokens fabricados.

Lo que puede: listar y crear clínicas, desactivarlas (`tenants.deactivated_at`: todos sus usuarios reciben 401 en el request siguiente, porque `findForAuth` lo exige null), crear el ADMIN de una clínica y cambiar rol o estado de sus usuarios —con la misma regla de "la clínica conserva una ADMIN activa" que aplica `userRepository` (`whereConservaAdmin`)—, disconnect a user's devices (`USER_DEVICES_DISCONNECTED`) and generate a password reset link for her (`PASSWORD_RESET_LINK_CREATED`). Lo que no puede: nada clínico. Cada acción deja una fila en `platform_audit_logs` **en la misma transacción**.

El bootstrap es `npm run create:operator -w apps/api` con `OPERATOR_EMAIL` y `OPERATOR_PASSWORD`: se corre **una vez por entorno**, y a partir de ahí todo pasa por la UI de `/platform`. Reemplazó a `create-admin.ts`, que se borró en #79. En local el seed crea `operador@ficha.dev` / `password123`.

### Borrado de pacientes

Es **lógico** (`deletedAt`): el paciente desaparece de `GET /api/patients`, su ficha da 404 y no puede recibir datos clínicos nuevos (las rutas que crean episodios, sesiones, escalas, alertas y paquetes pasan por `patientRepo.exists()`). Pero **el historial ya registrado lo sigue nombrando**: los joins `patient: { select: { fullName } }` de Cobros, Sesiones y Paquetes no filtran `deletedAt` a propósito — un cobro sin nombre sería un registro inútil. Borrar un paciente lo oculta; no reescribe el pasado. (Issue #72, cerrado *by design*.)

La línea que separa las dos mitades es **historial vs. trabajo pendiente**. Por eso las **alertas sí filtran** pacientes borrados, en la lista y en el contador de no leídas: una alerta no registra lo que pasó, pide una acción — y sobre un paciente eliminado esa acción es imposible. El filtro va en la lectura (`clinicalAlertRepository`) y no borra filas: el borrado es reversible y las alertas deben poder volver con el paciente.

### Campos JSON: la forma vive en `packages/shared`

La evaluación inicial guarda varias columnas `Json?` (grilla de familias de posturas, dolor en familia, mapa de retracciones). Postgres no valida nada de su contenido, así que **la forma de un campo JSON se declara en `packages/shared` y la ruta la valida con ese schema** — si no, el significado del dato termina viviendo sólo en el componente de React que lo dibuja, y nadie más puede leerlo sin reimplementarlo.

`postureFamilies` es el caso modelo (`packages/shared/src/postureFamilies.ts`): `POSTURE_TABLES` describe las dos tablas columna por columna, cada una con un `kind` (`mark`, `flag`, `choice`, `text`) que dice qué guarda la celda. De ahí sale todo lo demás: la web dibuja el control según el `kind` y `postureFamiliesSchema` se deriva de la misma definición, con `strictObject` en los tres niveles (tabla → fila → columna). Agregar una columna es agregar una entrada en la lista.

Lo guardado es sparse: una celda vacía no se guarda, una fila o tabla que queda sin celdas se borra, y una grilla sin nada se guarda como `NULL`. `setPostureCell` hace esa poda; no armar el objeto a mano.

Éste es uno de los dos módulos de `packages/shared` con **valores de runtime** (el resto son `import type`); el otro es `slug.ts`, con `slugify` y `SLUG_PATTERN`, para que la API derive el slug de una clínica con exactamente la misma función con la que la web lo previsualiza. Por eso `apps/web/vite.config.ts` y `vitest.config.ts` aliasan `@ficha/shared` al código fuente —el paquete compila a CommonJS, que un browser no puede cargar— y el job `test` del CI buildea `packages/shared` antes de correr los tests de la API. Render ya lo hacía vía `build:api`. Si se agrega un tercero, esta lista se actualiza: un valor de runtime nuevo en un paquete que casi todos importan como tipos es fácil de perder de vista.

Queda un campo sin migrar a este patrón: `retractionMap` sigue con `z.unknown()`.

## Convenciones

- Branches `feat/*` desde `dev`; PRs de feature contra `dev`, nunca contra `main`. El default branch del repo es `main`, así que `gh pr create` necesita `-B dev` explícito. Commits pequeños y atómicos, con prefijo convencional (`fix(web): ...`, `test(web): ...`).
- **Language (since 2026-10-04): everything new is written in English** — identifiers, comments, test names, commit messages, PR and issue text, and documentation (including specs and new sections of this file).
  - **Exception: what users read stays in Spanish** — UI text and API error messages (`{"error":"No autenticado"}`).
  - Existing Spanish code and docs are not translated in bulk; translate a piece when it is touched for another reason.
- La API envuelve respuestas en `{ data: ... }`; todo `/api/*` salvo `/api/auth/*` y `/health` exige `Authorization: Bearer <token>` (401 → `{"error":"No autenticado"}`).
- CI (`.github/workflows/test.yml`): jobs paralelos para API (con migraciones) y web.

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
