# Infraestructura

El resumen operativo (las reglas) está en `CLAUDE.md`. Esto es el porqué detrás de cada una y la historia de cómo se llegó acá.

Los recursos se nombran por su nombre, no por su ID: los IDs de Render y Neon no se versionan en este repo, que es público. Para llegar a un recurso, se busca por nombre con los MCPs (`list_services` en Render, `list_projects` / `list_branches` en Neon) o en el dashboard.

Nada se hostea junto: cada capa vive en un proveedor distinto y ninguno conoce a los otros. La rama de git es el único pegamento — los tres se disparan solos al detectar un push.

- **GitHub** (`candiath/ficha`, repo **público**) — código, CI y rulesets de protección de ramas.
- **Render** — la API de Express. Un servicio por entorno, plan free (cold start ~50s).
- **Netlify** — la web de Vite, build estático. Un solo sitio (`fichita`) con dos contextos de deploy.
- **Neon** — Postgres. Un solo proyecto (`ficha`) con una branch por entorno.

## Los tres entornos

| | Producción | Testing | Desarrollo |
| --- | --- | --- | --- |
| Rama | `main` | `dev` | working tree local |
| Quién lo consume | los usuarios | solo Nath | solo Nath |
| API (servicio de Render) | `Ficha` → ficha-i3t6.onrender.com | `ficha-staging` → ficha-staging.onrender.com | `localhost:3001` |
| Web | fichita.netlify.app | `dev--fichita.netlify.app` (branch deploy) | `localhost:5173` |
| DB (branch de Neon) | `production` | `staging` | `development` |

Los tres están aislados de verdad, no solo por URL: **cada uno tiene su propia branch de Neon y sus propios `JWT_SECRET` y `PLATFORM_JWT_SECRET`**, así que un token de testing no vale en producción y una migración local no toca datos reales. Los dos secretos de un mismo entorno tienen que ser distintos entre sí: la API no arranca si son iguales (ver *Operador de plataforma* en `CLAUDE.md`). Los dos desplegados corren con `NODE_ENV=production`, que gatea el guard del seed y vuelve obligatorio `CORS_ORIGIN`; en local `NODE_ENV` no es production, por eso ahí el seed sí corre.

Hay un cuarto consumidor de la DB que no es un entorno: **CI**, con su propia branch de Neon (`ci`) y su propia `CI_DATABASE_URL` (secret de GitHub).

Esa branch se creó desde `production` y después se le borró el esquema, así que **arrancó** vacía — a propósito: los logs del CI de este repo son públicos, y una base de CI con datos de producción los expondría en cuanto un test fallara imprimiendo una fila.

*Correction (2026-10-05):* this paragraph used to say that `migrate deploy` rebuilds the branch from the first migration on every run. It does not: the branch persists, and `migrate deploy` only applies the migrations it has not seen yet (checked in Neon: the 32 migrations were applied one by one since 2026-09-03). So CI verifies that each new migration applies on top of the previous state, not that the whole chain applies on an empty database. And it is no longer empty of rows either: interrupted runs leave orphaned test clinics behind (8 on 2026-10-05). They are fictitious test data, so the public logs expose nothing real.

**Release PRs to `main` rebuild it from scratch** (`prisma migrate reset --force --skip-seed` before the tests): the whole migration chain is proven to apply on an empty database — what a brand new environment does — right before production, and the leftover test rows are cleared. Feature PRs skip it to keep CI short; a manual run can force it (Actions → Tests → Run workflow → "reset_ci_db"). Because `migrate reset` destroys everything, the step first refuses to run if the database holds any account that is not `@test.ficha.local`: every other environment has one (checked 2026-10-05: production 2, staging 3, development 2; ci 0), so a `CI_DATABASE_URL` pointed elsewhere by mistake fails the run instead of wiping that database. The guard needs no configuration; its one blind spot is a database with no accounts at all, which has nothing to lose.

Las branches de Neon son copy-on-write: se crean en segundos con los datos del padre y solo ocupan las páginas que divergen. Rehacer `development` desde `production` para tener datos frescos es barato.

## El ciclo de vida de un cambio

```
local (development) ──PR──> dev ──auto-deploy──> testing
                             │
                             └──PR "release: ..."──> main ──auto-deploy──> producción
```

Los PRs de feature van contra `dev`, nunca contra `main`. La promoción a producción es un PR `dev` → `main` con merge commit (no squash: reescribir ahí duplicaría el historial que ya vive en `dev`).

**El ruleset tiene `strict_required_status_checks_policy` en `false` a propósito** — no es un olvido. Con `strict` en `true` ("require branches to be up to date"), cada release deja un merge commit que vive solo en `main`, así que `dev` queda permanentemente "desactualizada" y GitHub exige un *Update branch*; ese botón hace un push directo a `dev`, que el mismo ruleset rechaza por no tener checks corridos todavía. Deadlock en cada release. Y no se pierde nada: como todo llega a `main` a través de `dev`, `dev` nunca puede estar atrasada en código. La contracara es que si alguna vez se hace un hotfix directo sobre `main`, hay que bajarlo a `dev` a mano — GitHub ya no avisa.

Como el árbol que testea el PR de release es idéntico al merge commit que aterriza en `main` (nadie más mueve `main`), el CI **no corre de nuevo al mergear a `main`**. Si en el futuro `main` empezara a recibir cambios por otro canal, esa suposición deja de valer y habría que volver a sumarla.

**Since 2026-10-05 it does not run on push to `dev` either**, for the same reason: the PR already tested the merge of its branch into `dev`, and running again on the merge took half of the CI time (each run is ~15–20 min: the GitHub runners are far from Neon's São Paulo region and the API tests run serially). The one case it covered — two PRs that pass separately but break together — is caught by the release PR to `main` before production. The full suite also runs locally before every push.

**And it only runs what a PR can affect.** A `changes` job classifies the changed files: a docs-only PR (`docs/`, `tasks/`, `.claude/`, `.notes/`, `*.md`) runs no tests; a web-only PR (`apps/web/`) skips the API integration tests. Release PRs to `main` and manual runs always run everything. The `test` and `test-web` jobs still run and report success when they have nothing to do — they are required checks, and a job skipped as a whole never reports, which would block the merge.

El repo borra la rama de un PR al mergearlo (`delete_branch_on_merge`, desde el 30/09/2026), lo que hace que GitHub reapunte solo los PRs apilados encima. `dev` y `main` se salvan porque el ruleset *Wait for tests to pass* incluye la regla `deletion`: si se la saca, mergear el PR de release borraría `dev`.

El entorno de testing solo sirve si se usa: el valor está en la ventana entre mergear a `dev` y promover a `main`. Promover en el mismo minuto convierte a testing en una segunda producción rota en silencio.

## Política de migraciones

Cada entorno migra su propia base, y el schema viaja por el mismo canal que el código:

1. **Local**: `npm run db:migrate` (`prisma migrate dev`) genera el archivo de migración contra la branch `development`. El archivo se commitea junto al cambio de código que lo necesita.
2. **Testing y producción**: `npm run migrate:prod` (`prisma migrate deploy`) corre en el Build Command de cada servicio de Render, con el `DATABASE_URL` de ese servicio. Es idempotente: aplica solo lo pendiente.

Las migraciones van por **conexión directa**, no por el pooler: el datasource declara `directUrl = env("DIRECT_DATABASE_URL")`, que es el mismo host de Neon sin `-pooler`. `prisma migrate` toma un advisory lock de sesión y PgBouncer en modo transacción no garantiza la misma conexión física entre statements (falla con `P1002`). Cada entorno necesita las dos variables; la app solo usa la pooled.

Si una migración falla, el build falla y Render **mantiene vivo el deploy anterior** — el entorno sigue sirviendo la versión vieja en vez de arrancar con un schema a medias. Prisma envuelve cada migración en una transacción, así que no quedan aplicadas por la mitad.

**Migraciones destructivas en dos pasos.** Un `DROP COLUMN` que llega junto al código que deja de usar la columna rompe producción en el intervalo entre que la migración corre y el proceso nuevo toma el tráfico. Se hace en dos releases: primero se agrega lo nuevo y se deja de leer lo viejo; el `DROP` va en un release posterior, cuando ya nada lo referencia.

**A column type change on a table the app reads breaks the pooler for a while** (found in #186, 2026-10-10). Neon's pooler shares prepared statements across clients, and once a column's type changes (even `timestamp(3)` → `timestamp(6)`), every cached statement that reads it fails with `cached plan must not change result type` until the pooler's server connections recycle. With the old code still serving, or the new one starting, that means failed requests right after the deploy. Avoid type changes on hot tables; if one is unavoidable, it is its own release, and the compute is restarted right after the migration (Neon console, or the MCP's `restart_postgres_endpoint`).

**A migration that fails on Render leaves the database blocked.** `_prisma_migrations` keeps the failed row, and every later deploy fails with `P3009` until someone runs `npx prisma migrate resolve --rolled-back <migration>` against that database's direct URL. First confirm that nothing of the migration remains: Prisma sends a migration as one script, which Postgres runs as one implicit transaction, so a failed one normally leaves nothing; a migration with its own `COMMIT` or a non-transactional statement (`CREATE INDEX CONCURRENTLY`) can leave half of it, which has to be undone or finished by hand first. For `production`, that happens where its credential lives, never from a laptop's `.env`.

Nunca correr `db:migrate` ni `db:seed` con `DATABASE_URL` apuntando a `production`. **El `.env` local no guarda la URL de producción**, ni siquiera comentada: tenerla a mano invita a copiarla, y una credencial de producción pegada donde no corresponde obliga a rotarla en las cuatro branches. Si hace falta inspeccionar producción con `db:studio`, se saca de la consola de Neon en el momento y se descarta.

## Backups

El point-in-time recovery de Neon en el plan free cubre **6 horas** hacia atrás (`history_retention_seconds: 21600`). Alcanza para deshacer un error que se nota enseguida; no alcanza para nada que se descubra al día siguiente, ni sirve si se pierde la cuenta.

Por eso hay un **repositorio de backups aparte, privado**, con un `pg_dump` de producción versionado por git. El dump se escribe siempre en los mismos dos archivos —`dump/schema.sql` y `dump/data.sql`— y cada corrida que encuentra diferencias deja un commit: el historial de git *es* el versionado, y `git log dump/data.sql` es la línea de tiempo de la base. Una corrida sin cambios no commitea nada, y la detección es `git diff --cached --quiet`, sin preguntarle nada a la base.

Corre diario a las 06:00 UTC, a mano, y desde este repo al abrir el PR de release (`.github/workflows/backup-antes-del-release.yml`) — al **abrir** y no al mergear, porque para cuando el merge ocurre Render ya arrancó el build y `migrate deploy` puede estar corriendo.

**La credencial de producción vive solo en el repo privado.** Éste es público: aunque las secrets no se filtran a los PRs de forks, cualquiera con permiso de escritura podría sacarlas modificando un workflow. Acá solo está `BACKUP_DISPATCH_TOKEN`, que puede disparar aquel workflow y nada más.

Ese disparo va por el endpoint de **`workflow_dispatch`** (`/actions/workflows/{id}/dispatches`), no por el de `repository_dispatch` (`/dispatches`), y la diferencia es de permisos: en un PAT fine-grained el segundo exige **Contents: write** sobre el repo privado, y Contents incluye lectura — o sea que el token del repo público podría bajarse los dumps con las historias clínicas. El primero se conforma con **Actions: write**, que permite pedir un backup pero no leerlo.

Se respalda **solo producción**: `staging` y `development` se rehacen desde ella en segundos, porque las branches de Neon son copy-on-write.

## Audit tables

Since #186 (`docs/specs/SPEC-audit-hardening.md`) the database itself keeps `audit_logs` and `platform_audit_logs` honest: triggers reject every `UPDATE` and `TRUNCATE`, stamp `created_at` on insert, and check that a row's session belongs to its author; foreign keys `RESTRICT` and keep a row inside its clinic. Deleting an audit row, or inserting one with a past date, needs **maintenance**: two things at once.

- **The flag**: the table `ficha_ops.audit_maintenance_allowed` exists. **Only `development` and `ci` have it.** It lives outside `public`, so `prisma migrate reset` keeps it (checked on 2026-10-10).
- **The switch**: `SELECT set_config('ficha.audit_maintenance', pg_current_xact_id()::text, true)`, inside the same transaction as the delete. A switch with any other value, or set at session level, does nothing.

Only the test helpers (`tests/helpers.ts`), the seed and `npm run purge:test-audit -w apps/api` turn it on; `tests/auditSwitchScan.test.ts` keeps it that way.

### Setting up a branch

A branch created from `development` or `ci` inherits the flag. A branch created or reset from `production` (or `staging`) does not have it, and test cleanup fails until the flag exists. To add it to a test branch:

```sql
CREATE SCHEMA IF NOT EXISTS ficha_ops;
CREATE TABLE IF NOT EXISTS ficha_ops.audit_maintenance_allowed ();
```

**Never on `staging` or `production`.** There, the Render build refuses to deploy, and the API logs `[audit] no-audit-maintenance.sql: FAILED` at startup.

### The checks

| | `prisma/audit-guards.sql` | `prisma/no-audit-maintenance.sql` |
| --- | --- | --- |
| What fails it | a trigger or audit function differs from what the migrations deployed, a trigger is disabled, a rule, row-level security, an unlogged table, a missing or non-restricting foreign key | the flag exists |
| CI (`test.yml`, on `ci`) | after `migrate deploy` | — (`ci` has the flag) |
| Render build (`migrate:prod`) | after `migrate deploy` | before `migrate deploy` |
| API startup (`src/index.ts`) | always, only logs | in production, only logs |

When a Render build fails on a check, the previous deploy keeps serving. Find out what changed the database before anything else: a check failing means a guarantee is gone. When the change is intended, it arrives as a new migration and new expected values in `audit-guards.sql`, in the same PR. That migration also needs an entry in the `ALLOWED` list of `tests/auditMigrationScan.test.ts`, which fails on DDL that alters the audit tables, their functions or their enums.

**Line endings.** Migration SQL is checked out with LF (`.gitattributes`), so a migration applied from a Windows laptop creates the same function bodies as one applied by CI or Render, and the function hashes match.

### Orphans

Interrupted test runs leave test clinics behind, and their audit rows now block deleting them. `npm run purge:test-audit -w apps/api` deletes the audit rows of test clinics older than an hour (and of test operators); it refuses to run without the flag.

### The pre-launch wipe

Production's data is fictitious until delivery. The wipe before delivery drops the schema, which no trigger sees, and rebuilds it:

```sql
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
```

followed by `prisma migrate deploy`. Run it where the production credential lives (the backups repository), never from a laptop. Never use `migrate reset` with the seed on a deployed database.

### Restoring a backup

The dumps in the backups repository load with the triggers already in place: `schema.sql` creates them before `data.sql` inserts. Loaded naively:
- the session check rejects audit rows whose session was pruned, or not loaded yet (`audit_logs` sorts before `auth_sessions`);
- the stamp trigger would rewrite every `created_at` to the moment of the restore.

So the triggers of the two audit tables are off **for the load only**, in one transaction that stops at the first error:

```bash
psql "$URL" -v ON_ERROR_STOP=1 -f dump/schema.sql
psql "$URL" -1 -v ON_ERROR_STOP=1 \
  -c 'ALTER TABLE public.audit_logs DISABLE TRIGGER USER' \
  -c 'ALTER TABLE public.platform_audit_logs DISABLE TRIGGER USER' \
  -f dump/data.sql \
  -c 'ALTER TABLE public.audit_logs ENABLE TRIGGER USER' \
  -c 'ALTER TABLE public.platform_audit_logs ENABLE TRIGGER USER'
psql "$URL" -v ON_ERROR_STOP=1 -f apps/api/prisma/audit-guards.sql
```

Then compare the row counts per table with the dump. If anything fails, nothing is loaded and the triggers stay on. A forgotten re-enable is caught by `audit-guards.sql`. Rehearsed on 2026-10-10 ([run](https://github.com/candiath/ficha/actions/runs/38083672334), Postgres 16 in a runner, seed data): dumped with the backups repository's flags and restored this way, the database reproduced all 102 rows, every audit time and session, and passed the guards. The same load without the procedure stopped at the first demo audit row (`audit row names a session that is not its author's`), and the guards caught a forgotten re-enable.

## Cómo se llegó acá (2026-08-29)

El split a tres entornos se hizo el 29/08/2026 y está **completo**: `main` como default branch, rulesets (`test` + `test-web` en `main` y `dev`, PR obligatorio en `main`), las tres branches de Neon, los dos servicios de Render apuntando a su rama y corriendo `migrate:prod` en el build, Netlify con production branch en `main` más branch deploy de `dev`, y `VITE_API_URL` por contexto.

Dos cosas que se rompieron en el camino y conviene no repetir:

- **No habilitar PR previews sobre el servicio de producción de Render.** Los previews clonan las env vars del padre, así que cada uno arrancaba con el `DATABASE_URL` y el `JWT_SECRET` de producción: migraba contra la base real y firmaba tokens válidos en producción. Si se quieren previews, van sobre `ficha-staging`.
- **Verificar la config de Netlify leyendo el bundle, no el dashboard.** Vite inlinea `VITE_API_URL` en build time, así que `curl` sobre el JS publicado dice a qué API pega cada contexto de verdad. Cambiar la variable no tiene efecto hasta rebuildear.
