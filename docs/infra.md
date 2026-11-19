# Infraestructura

El resumen operativo (las reglas) está en `CLAUDE.md`. Esto es el porqué detrás de cada una y la historia de cómo se llegó acá.

Los recursos se nombran por su nombre, no por su ID: los IDs de Render y Neon no se versionan en este repo, que es público. Para llegar a un recurso, se busca por nombre con los MCPs (`list_services` en Render, `list_projects` / `list_branches` en Neon) o en el dashboard; Lightsail, en la consola de AWS.

Nada se hostea junto: cada capa vive en un proveedor distinto y ninguno conoce a los otros. La rama de git es el único pegamento — cada capa se dispara sola al detectar un push.

- **GitHub** (`candiath/ficha`, repo **público**) — código, CI y rulesets de protección de ramas. It also builds the API's Docker image on every push to `main` and `dev` (`image.yml`) and publishes it to GHCR.
- **AWS Lightsail** — the production API since 2026-11-14, and only it (*Production on AWS* below): the image runs as a container behind Caddy, which serves `api.cliniplus.com.ar`. The instance pulls new images itself (`ops/`).
- **Render** — staging (`ficha-staging`, `staging-api.cliniplus.com.ar`), plan free (cold start ~50s). `Ficha`, production's old service, stays as a backup with no traffic.
- **Netlify** — la web de Vite, build estático. Un solo sitio (`fichita`) con dos contextos de deploy.
- **Neon** — Postgres 18. `production` is in the project `rapid-band-cliniplus-ohio` (us-east-2), next to the Lightsail instance; `staging`, `development` and `ci` are still in `ficha-pg18` (sa-east-1). The Ohio project also has `staging` and `ci` branches, and `ficha-pg18` still has its old `production`: neither is the environment of the same name (*Production on AWS*).

## Los tres entornos

| | Producción | Testing | Desarrollo |
| --- | --- | --- | --- |
| Rama | `main` | `dev` | working tree local |
| Quién lo consume | los usuarios | solo Nath | solo Nath |
| API | api.cliniplus.com.ar (Lightsail) | staging-api.cliniplus.com.ar (Render, `ficha-staging`) | `localhost:3001` |
| Web | fichita.netlify.app | `dev--fichita.netlify.app` (branch deploy) | `localhost:5173` |
| DB (branch de Neon) | `production` (Ohio project) | `staging` | `development` |

Los tres están aislados de verdad, no solo por URL: **cada uno tiene su propia branch de Neon**, así que un token de testing no vale en producción (every session, the clinic's and the operator's, is a row in that environment's database: there is no signing secret since operator-sessions) y una migración local no toca datos reales. Los dos desplegados corren con `NODE_ENV=production`, que gatea el guard del seed y vuelve obligatorio `CORS_ORIGIN`; en local `NODE_ENV` no es production, por eso ahí el seed sí corre.

Hay un cuarto consumidor de la DB que no es un entorno: **CI**, con su propia branch de Neon (`ci`) y su propia `CI_DATABASE_URL` (secret de GitHub). Since 2026-10-29 only release PRs to `main` and manual runs use it; PRs to `dev` run on a throwaway Postgres in Docker on the runner (see *PRs to `dev` no longer use `ci`* below).

Esa branch se creó desde `production` y después se le borró el esquema, así que **arrancó** vacía — a propósito: los logs del CI de este repo son públicos, y una base de CI con datos de producción los expondría en cuanto un test fallara imprimiendo una fila. Since the move to Postgres 18 (2026-11-01) it is a branch of the new project, created while its root was still empty and migrated from zero.

*Correction (2026-10-05):* this paragraph used to say that `migrate deploy` rebuilds the branch from the first migration on every run. It does not: the branch persists, and `migrate deploy` only applies the migrations it has not seen yet (checked in Neon: the 32 migrations were applied one by one since 2026-09-03). So CI verifies that each new migration applies on top of the previous state, not that the whole chain applies on an empty database. And it is no longer empty of rows either: interrupted runs leave orphaned test clinics behind (8 on 2026-10-05). They are fictitious test data, so the public logs expose nothing real.

**Release PRs to `main` rebuild it from scratch** (`prisma migrate reset --force --skip-seed` before the tests): the whole migration chain is proven to apply on an empty database — what a brand new environment does — right before production, and the leftover test rows are cleared. A manual run can force it (Actions → Tests → Run workflow → "reset_ci_db"). Because `migrate reset` destroys everything, the step first refuses to run if the database holds any account that is not `@test.ficha.local`: every other environment has one (checked 2026-10-05: production 2, staging 3, development 2; ci 0), so a `CI_DATABASE_URL` pointed elsewhere by mistake fails the run instead of wiping that database. The guard needs no configuration; its one blind spot is a database with no accounts at all, which has nothing to lose.

**A PR behind `dev` fails fast when `ci` is ahead of it** (since 2026-10-15). Until 2026-10-29 every PR shared the `ci` branch (now only release PRs and manual runs do), and the ruleset does not require branches to be up to date (see *El ciclo de vida de un cambio*), so a PR can find migrations that another PR applied and its own branch does not have. Its code then runs against a newer schema: on 2026-10-14 a PR still reading `encounters.pre_encounter_state`, which another PR had dropped, failed ~70 tests with `P2022` after the whole 25-minute suite. Right after `migrate deploy`, the step *Check the database has no migrations this branch lacks* compares the finished, not rolled back rows of `_prisma_migrations` with the folders in `prisma/migrations` and fails in seconds, naming the extra migrations. **The fix is to merge `dev` into the branch and push.** It fails even when the extra migrations are additive and the tests would have passed: the check cannot tell, and the merge is cheap. `prisma migrate status` is not used because Prisma 5.22 reports such a database as "up to date" with exit code 0 (it lists migrations missing locally only when the two histories diverge; checked on 2026-10-15 against a scratch Postgres). Release PRs and manual runs with "reset_ci_db" rebuild the database first, so it holds exactly their migrations and the check passes.

**PRs to `dev` no longer use `ci`** (since 2026-10-29). They run `npm test` on the runner, against the same throwaway Postgres in Docker as locally (*Local test database*). The check above could only tell a PR it was blocked, not unblock it: on 2026-10-24 an open PR applied `20261024180000_scale_band_from_score` to `ci`, and two other PRs failed the check until 2026-10-28, because merging `dev` cannot bring a migration that is not in `dev` yet. With a database per run, nothing another PR did can reach a run, every PR proves its whole migration chain applies from empty, and the suite runs next to its database instead of across the network (~2.5 min locally on 2026-10-14, against 25–35 min per run on `ci`). What is given up: the pooler's and latency's failures (*Local test database*) now first show on the release PR to `main`, still before production. Manual runs stay on Neon: they exist to recheck the suite after rotating `CI_DATABASE_URL`.

Las branches de Neon son copy-on-write: se crean en segundos con los datos del padre y solo ocupan las páginas que divergen.

**`production` is handled as holding real clinical data**: it holds them from the relaunch (#238), and until then the clinic's trial. So no long-lived branch is created from it any more: `staging`, `development` and `ci` keep only test data. A branch copied from `production` is still the way to rehearse a risky migration, but it lives only for the rehearsal and is deleted afterwards. Its connection string never goes into a laptop's `.env` or a CI secret of this repository.

## El ciclo de vida de un cambio

```
local (development) ──PR──> dev ──auto-deploy──> testing
                             │
                             └──PR "release: ..."──> main ──auto-deploy──> producción
```

Los PRs de feature van contra `dev`, nunca contra `main`. La promoción a producción es un PR `dev` → `main` con merge commit (no squash: reescribir ahí duplicaría el historial que ya vive en `dev`).

**El ruleset tiene `strict_required_status_checks_policy` en `false` a propósito** — no es un olvido. Con `strict` en `true` ("require branches to be up to date"), cada release deja un merge commit que vive solo en `main`, así que `dev` queda permanentemente "desactualizada" y GitHub exige un *Update branch*; ese botón hace un push directo a `dev`, que el mismo ruleset rechaza por no tener checks corridos todavía. Deadlock en cada release. Y no se pierde nada: como todo llega a `main` a través de `dev`, `dev` nunca puede estar atrasada en código. La contracara es que si alguna vez se hace un hotfix directo sobre `main`, hay que bajarlo a `dev` a mano — GitHub ya no avisa.

Como el árbol que testea el PR de release es idéntico al merge commit que aterriza en `main` (nadie más mueve `main`), el CI **no corre de nuevo al mergear a `main`**. Si en el futuro `main` empezara a recibir cambios por otro canal, esa suposición deja de valer y habría que volver a sumarla.

**It runs on push to `dev`** (again since 2026-10-29, on Docker). A PR tests its merge into `dev` as `dev` was when the PR ran, and the ruleset does not require branches to be up to date, so two PRs can pass separately and break together. The push run tests the tree that actually landed, right after the merge. From 2026-10-05 to 2026-10-29 it did not run there: each run took ~15–20 min on Neon (the GitHub runners are far from its São Paulo region and the API tests run serially), half of the CI time, and that case was left to the release PR. On Docker a run takes ~2 min. A push run is always a full run, and nothing waits for it: a red one means fixing `dev` before the next release.

**And it only runs what a PR can affect.** A `changes` job classifies the changed files: a docs-only PR (`docs/`, `tasks/`, `.claude/`, `.notes/`, `*.md`) runs no tests; a web-only PR (`apps/web/`) skips the API integration tests. Release PRs to `main` and manual runs always run everything. The `test` and `test-web` jobs still run and report success when they have nothing to do — they are required checks, and a job skipped as a whole never reports, which would block the merge.

**Dependabot's PRs are closed, and the bump goes through `dev`** (decided 2026-10-29). The repo has no `dependabot.yml`: what Dependabot opens are security updates, which always target the default branch, `main` (`target-branch` only applies to version updates). Their CI takes the release path and fails within a minute: workflows triggered by Dependabot get no Actions secrets, so `CI_DATABASE_URL` is empty. That red check is kept on purpose. `main`'s ruleset does not look at who opened a PR, and a green bump merged there would skip `dev` and staging and leave `main` with a commit `dev` lacks. The bump is redone in a PR to `dev` (as in `chore/dependabot-security-bumps`) and the Dependabot PR is closed.

El repo borra la rama de un PR al mergearlo (`delete_branch_on_merge`, desde el 30/09/2026), lo que hace que GitHub reapunte solo los PRs apilados encima. `dev` y `main` se salvan porque el ruleset *Wait for tests to pass* incluye la regla `deletion`: si se la saca, mergear el PR de release borraría `dev`.

El entorno de testing solo sirve si se usa: el valor está en la ventana entre mergear a `dev` y promover a `main`. Promover en el mismo minuto convierte a testing en una segunda producción rota en silencio.

## Build version: web and API in step

The web (Netlify) and the API (Lightsail, Render for staging) deploy separately from the same commit, so for a while after each push they can disagree: a tab opened before a release keeps running the old web, and the new web can reach the API before the API's deploy finishes, or after it fails (the previous version keeps serving). An old web reading a new API can show data wrong (for example annulled encounters as current), so the web checks on every response and asks the user to reload (`apps/web/src/lib/buildVersion.ts`; the rule is in `CLAUDE.md`).

**The version is the commit time** (`git log -1 --format=%ct`, Unix seconds) of the commit a build was made from, so nobody bumps it and the larger one is the newer build. `scripts/build-version.mjs` resolves it, first match wins:

1. `FICHA_BUILD_VERSION`, for a build without a git repository: the API's Docker image (`.git` is not in its build context), whose workflow (`image.yml`) passes the commit time as the `BUILD_VERSION` build arg.
2. `git log -1 --format=%ct`, which works on a shallow clone: Netlify's build (and Render's) clones the repository.
3. Nothing: the build carries no version (the build log says so) and the web does no check. It fails open on purpose.

- **API**: `npm run build -w apps/api` writes `dist/build-version.json`; the API sends it as `X-Build-Version` on every response and as `buildVersion` in `/health`, so a deploy can be checked with `curl -s <api>/health`. `FICHA_BUILD_VERSION` at runtime overrides the file.
- **Web**: `vite build` inlines it as `import.meta.env.VITE_BUILD_VERSION`. The dev server inlines nothing.

**It relies on both sides deploying every commit.** Neither `image.yml` nor Netlify has a build filter or ignore rule today: if one is added (say, Netlify skipping API-only commits), the side that skipped a commit looks older forever and its users get the notice for nothing. The same goes for a **rollback**: rolling back one side alone makes the other look newer until the rollback is undone, so roll back both, or neither.

**Netlify must not cache `index.html`**, or a reload brings the old web back. Its default for HTML is `cache-control: public,max-age=0,must-revalidate` (checked on 2026-11-09), and the CDN is cleared on every deploy; the assets are content-hashed. If a reload ever does bring back the same old web, the notice notices (it remembers in `sessionStorage` which API version it reloaded for) and says "Estamos actualizando Ficha" instead of asking again.

## Política de migraciones

Cada entorno migra su propia base, y el schema viaja por el mismo canal que el código:

1. **Local**: `npm run db:migrate` (`prisma migrate dev`) genera el archivo de migración contra la branch `development`. El archivo se commitea junto al cambio de código que lo necesita.
2. **Testing y producción**: `npm run migrate:prod` (`prisma migrate deploy`, with the audit checks around it) runs in every deploy, with that environment's `DATABASE_URL`: on Lightsail `ops/deploy.sh` runs it in a one-off container of the new image before starting it; on Render, the Build Command. Es idempotente: aplica solo lo pendiente.

Las migraciones van por **conexión directa**, no por el pooler: el datasource declara `directUrl = env("DIRECT_DATABASE_URL")`, que es el mismo host de Neon sin `-pooler`. `prisma migrate` toma un advisory lock de sesión y PgBouncer en modo transacción no garantiza la misma conexión física entre statements (falla con `P1002`). Cada entorno necesita las dos variables; la app solo usa la pooled.

Si una migración falla, el deploy se corta y **sigue vivo el anterior** (`deploy.sh` sends a Telegram message; Render keeps its previous build) — el entorno sigue sirviendo la versión vieja en vez de arrancar con un schema a medias. Prisma envuelve cada migración en una transacción, así que no quedan aplicadas por la mitad.

**Migraciones destructivas en dos pasos.** Un `DROP COLUMN` que llega junto al código que deja de usar la columna rompe producción en el intervalo entre que la migración corre y el proceso nuevo toma el tráfico. Se hace en dos releases: primero se agrega lo nuevo y se deja de leer lo viejo; el `DROP` va en un release posterior, cuando ya nada lo referencia.

**A column type change on a table the app reads breaks the pooler for a while** (found in #186, 2026-10-10). Neon's pooler shares prepared statements across clients, and once a column's type changes (even `timestamp(3)` → `timestamp(6)`), every cached statement that reads it fails with `cached plan must not change result type` until the pooler's server connections recycle. With the old code still serving, or the new one starting, that means failed requests right after the deploy. Avoid type changes on hot tables; if one is unavoidable, it is its own release, and the compute is restarted right after the migration (Neon console, or the MCP's `restart_postgres_endpoint`). **`20261116120000_timestamptz` is one, on every table**: every timestamp column becomes `timestamptz(3)`. It goes to `main` in a release of its own, at a quiet moment, since it locks every table it rewrites. Restart each environment's compute right after the migration runs there: `staging`, `production`, and `development` and `ci` when they get it.

**A failed migration leaves the database blocked.** `_prisma_migrations` keeps the failed row, and every later deploy fails with `P3009` until someone runs `npx prisma migrate resolve --rolled-back <migration>` against that database's direct URL. First confirm that nothing of the migration remains: Prisma sends a migration as one script, which Postgres runs as one implicit transaction, so a failed one normally leaves nothing; a migration with its own `COMMIT` or a non-transactional statement (`CREATE INDEX CONCURRENTLY`) can leave half of it, which has to be undone or finished by hand first. For `production`, that happens where its credential lives, never from a laptop's `.env`.

Nunca correr `db:migrate` ni `db:seed` con `DATABASE_URL` apuntando a `production`. **El `.env` local no guarda la URL de producción**, ni siquiera comentada: tenerla a mano invita a copiarla, y una credencial de producción pegada donde no corresponde obliga a rotarla en las cuatro branches. Si hace falta inspeccionar producción con `db:studio`, se saca de la consola de Neon en el momento y se descarta.

## Backups

Neon's point-in-time recovery covers **6 hours** back on the free plan (`history_retention_seconds: 21600`). That undoes a mistake noticed right away; it does nothing for one found the next day, or if the account is lost.

So production is also dumped every day by a **separate, private backups repository**, where the production credential lives (its README has the details and the setup). Since 2026-11 the dumps are no longer committed there: git never forgets, so a patient who asked to be deleted stayed in every old dump, in plain text.

- `backup.yml` pipes `pg_dump -Fc` to [`age`](https://age-encryption.org), encrypting to one public key, and uploads the ciphertext to a **Backblaze B2 bucket**. The plaintext never touches a disk. The private key is kept offline by Nath, not in any repository.
- Every object is uploaded **locked in COMPLIANCE mode** until it expires: dailies 30 days, a monthly copy (the run of the 1st) 12 months. Nobody can delete it or shorten the lock before then, not even the account owner. The bucket's lifecycle rules delete it afterwards.
- The upload key can write and set locks, nothing else: it cannot read, list or delete. A stolen one cannot destroy a backup. B2 was picked over Cloudflare R2 for this: R2's tokens that write also read and list.
- Next to each dump goes an encrypted file with every table's row count at dump time. `restore-test.yml`, on the 3rd of each month, checks that the newest daily is at most 48 hours old. If the private key is in that repository as `AGE_IDENTITY`, it also restores the dump into a throwaway Postgres 18, compares every count, and runs `audit-guards.sql`. Without the key, the restore is a manual drill every quarter (*Restoring a backup*).
- A failure of either workflow sends a fixed Telegram message through the sysadmin bot.

It runs daily at 06:00 UTC, by hand, and from this repo when a release PR is **opened** (`.github/workflows/backup-antes-del-release.yml`), not merged: by the time of the merge, Render has started the build and `migrate deploy` may be running.

**The production credential lives only in the private repository.** This one is public: secrets do not reach PRs from forks, but anyone with write access could extract them by changing a workflow. All this repo has is `BACKUP_DISPATCH_TOKEN`, which can trigger that workflow and nothing else.

The trigger goes through the **`workflow_dispatch`** endpoint (`/actions/workflows/{id}/dispatches`), not `repository_dispatch` (`/dispatches`), because of permissions. In a fine-grained PAT, the second needs **Contents: write** on the private repo. That is enough to push a workflow that prints its secrets, and before the bucket it also meant reading the dumps. The first needs only **Actions: write**, which can ask for a backup but not read one. The contract is the workflow file `backup.yml`, `ref=main` and the input `motivo`.

**A deletion outlives the backups that hold it**: a patient deleted in production stays in the dailies for about a month and in the monthlies for about a year. The lock is what stops anyone from removing them earlier, on purpose. A restore therefore brings back every patient deleted since that dump, and those deletions have to be applied again.

Only **production** is backed up: `staging` and `development` hold only test data, so nothing there needs a backup.

The backups repository's history (the plain-SQL dumps of before the bucket) was restarted on 2026-10-12, right after the first wipe (#223). It is restarted again after the relaunch's wipe (#238), dropping the dumps of the clinic's trial. From then on, that repository holds no data.

## Audit tables

Since #186 (`docs/specs/SPEC-audit-hardening.md`) the database itself keeps `audit_logs` and `platform_audit_logs` honest, and since sysadmin-alerts `sysadmin_alerts` and `sysadmin_alert_deliveries` too: triggers reject every `UPDATE` and `TRUNCATE`, stamp `created_at` (and, on the first two, `transaction_id`) on insert, and check that a row's encounter belongs to its author; foreign keys `RESTRICT` and keep a row inside its clinic. Deleting an audit row, or inserting one with a past date, needs **maintenance**: two things at once. Under maintenance an insert also keeps the `transaction_id` it sends; without one, it gets the inserting transaction's, as every row of a manual recovery would outside maintenance.

- **The flag**: the table `ficha_ops.audit_maintenance_allowed` exists. **Only `development` and `ci` have it.** It lives outside `public`, so `prisma migrate reset` keeps it (checked on 2026-10-10).
- **The switch**: `SELECT set_config('ficha.audit_maintenance', pg_current_xact_id()::text, true)`, inside the same transaction as the delete. A switch with any other value, or set at session level, does nothing.

Only the test helpers (`tests/helpers.ts`), the seed and `npm run purge:test-audit -w apps/api` turn it on; `tests/auditSwitchScan.test.ts` keeps it that way.

### Setting up a branch

A branch created from `development` or `ci` inherits the flag. A branch created or reset from `production` (or `staging`) does not have it, and test cleanup fails until the flag exists. To add it to a test branch:

```sql
CREATE SCHEMA IF NOT EXISTS ficha_ops;
CREATE TABLE IF NOT EXISTS ficha_ops.audit_maintenance_allowed ();
```

**Never on `staging` or `production`.** There, every deploy refuses to go on, and the API logs `[audit] no-audit-maintenance.sql: FAILED` at startup.

### The checks

| | `prisma/audit-guards.sql` | `prisma/no-audit-maintenance.sql` |
| --- | --- | --- |
| What fails it | a trigger or audit function differs from what the migrations deployed, a trigger is disabled, a rule, row-level security, an unlogged table, a missing or non-restricting foreign key | the flag exists |
| CI (`test.yml`, on `ci`) | after `migrate deploy` | — (`ci` has the flag) |
| Every deploy (`migrate:prod`) | after `migrate deploy` | before and after `migrate deploy` |
| API startup (`src/index.ts`) | always, only logs | in production, only logs |

**The flag check failing after `migrate deploy` means a migration created the flag** (`tests/noMaintenanceFlagMigration.test.ts` should have refused it). The migration has already run, and the build stops before the new code serves, but the flag stays in that database: drop it by hand now (`DROP SCHEMA ficha_ops CASCADE`), then fix the migration. Failing before `migrate deploy`, someone created it by hand.

When a deploy fails on a check, the previous version keeps serving. Find out what changed the database before anything else: a check failing means a guarantee is gone. When the change is intended, it arrives as a new migration and new expected values in `audit-guards.sql`, in the same PR. That migration also needs an entry in the `ALLOWED` list of `tests/auditMigrationScan.test.ts`, which fails on DDL that alters the audit tables, their functions or their enums.

**Line endings.** Migration SQL is checked out with LF (`.gitattributes`), so a migration applied from a Windows laptop creates the same function bodies as one applied by CI or a deploy, and the function hashes match.

### Orphans

Interrupted test runs leave test clinics behind, and their audit rows now block deleting them. `npm run purge:test-audit -w apps/api` deletes the audit rows of test clinics older than an hour, with their clinical revisions (and those of test operators); it refuses to run without the flag.

### The pre-launch wipe

Run on 2026-10-12 (#223), when production's data was fictitious, and run once more before the relaunch (#238): the launch was postponed to correct the data model, and what production holds since the first wipe is the clinic's trial. The wipe drops the schema, which no trigger sees, and rebuilds it:

```sql
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
```

followed by `npm run db:migrate:prod -w apps/api` (the maintenance-flag check, `prisma migrate deploy`, the flag check again and `audit-guards.sql`, as in every deploy). The clinical revisions tables go with the schema, so the wipe needs no step of its own for them. It is `wipe.yml` in the backups repository, where the production credential lives, never a laptop:

- it takes a `target` (`rehearsal`, a Neon branch copied from `production`, or `production`) and a confirmation that must read `wipe <target>`;
- for `production` it first runs the backup and stops if the backup fails;
- the rehearsal refuses a URL whose endpoint is production's;
- at the end it checks every migration is applied and every table is empty, and cuts the role's open connections. Restart the API afterwards: new connections, and the startup audit checks run again. On Lightsail, `deploy.sh` does nothing while the image is unchanged, so restart the container: `docker compose restart api-prod` in `/opt/ficha`.

It was rehearsed on a branch copied from `production` (same tables, triggers, constraints and functions afterwards), then run on production, followed by the redeploy, the operator (`create:operator`) and the clinic. The second wipe follows the same steps (checklist in #238). **After the relaunch, with real data, it is never run on production again**, and its `production` target is removed (#233). Never use `migrate reset` with the seed on a deployed database.

### Restoring a backup

**Never restore over production.** Bring a copy up next to it, take what is needed, and put it back by hand; for a total disaster, the same steps target a new, empty Postgres 18 or newer.

The dumps in the bucket are custom-format (`pg_dump -Fc`) and encrypted with `age`. Run these in Git Bash, not PowerShell 5.1, whose pipes re-encode binary data. You need `age`, Docker, the B2 CLI and the private key:

```bash
# 1. Download a dump and its counts (B2 CLI with the account's key, or the web UI).
b2 ls b2://<bucket>/daily/
b2 file download b2://<bucket>/daily/ficha-<time>.dump.age ./ficha.dump.age
b2 file download b2://<bucket>/daily/ficha-<time>.counts.age ./ficha.counts.age

# 2. An empty Postgres 18.
docker run -d --name ficha-restore -e POSTGRES_PASSWORD=x -p 55432:5432 postgres:18
until docker exec ficha-restore pg_isready -U postgres -q; do sleep 1; done; sleep 3

# 3. Decrypt and restore in one pipe: the plaintext never lands on disk.
age --decrypt --identity /path/to/ficha-backup.key ficha.dump.age \
  | docker exec -i ficha-restore pg_restore -U postgres -d postgres \
      --no-owner --no-privileges --exit-on-error --single-transaction

# 4. Check: the audit guards, and the counts against the restored tables.
docker exec -i ficha-restore psql -U postgres -v ON_ERROR_STOP=1 -q < apps/api/prisma/audit-guards.sql
age --decrypt --identity /path/to/ficha-backup.key ficha.counts.age

# 5. Take what is needed, then throw it all away.
docker rm -f ficha-restore; rm ficha.dump.age ficha.counts.age
```

**No trigger is switched off.** In a custom-format restore, `pg_restore` creates the tables, loads their rows, and only then creates indexes, constraints and triggers (the post-data section). So the audit triggers do not exist while the rows load. No `created_at` or `transaction_id` is restamped, no session check rejects an audit row whose session was pruned, and the foreign keys are checked when they are created. The single transaction means a failure loads nothing. Tested on 2026-11-15 in Docker, with Ficha's migrations and an audit row whose session had been deleted. The row came back with its `created_at` and session, every table matched its dump-time count, and the guards passed. `restore-test.yml` repeats the check every month when it holds the key.

#### Plain-SQL dumps (before the bucket)

The dumps committed to the backups repository until 2026-11 (`dump/schema.sql`, `dump/data.sql`) load with the triggers already in place: `schema.sql` creates them before `data.sql` inserts. Loaded naively:
- the session check rejects audit rows whose session was pruned, or not loaded yet (`audit_logs` sorts before `auth_sessions`);
- the stamp triggers would rewrite every `created_at` to the moment of the restore, and give every row the restore's one `transaction_id`.

So the triggers of the four audit tables (since sysadmin-alerts, the two alert tables too) are off **for the load only**, in one transaction that stops at the first error:

```bash
psql "$URL" -v ON_ERROR_STOP=1 -f dump/schema.sql
psql "$URL" -1 -v ON_ERROR_STOP=1 \
  -c 'ALTER TABLE public.audit_logs DISABLE TRIGGER USER' \
  -c 'ALTER TABLE public.platform_audit_logs DISABLE TRIGGER USER' \
  -c 'ALTER TABLE public.sysadmin_alerts DISABLE TRIGGER USER' \
  -c 'ALTER TABLE public.sysadmin_alert_deliveries DISABLE TRIGGER USER' \
  -f dump/data.sql \
  -c 'ALTER TABLE public.audit_logs ENABLE TRIGGER USER' \
  -c 'ALTER TABLE public.platform_audit_logs ENABLE TRIGGER USER' \
  -c 'ALTER TABLE public.sysadmin_alerts ENABLE TRIGGER USER' \
  -c 'ALTER TABLE public.sysadmin_alert_deliveries ENABLE TRIGGER USER'
psql "$URL" -v ON_ERROR_STOP=1 -f apps/api/prisma/audit-guards.sql
```

The six clinical revisions tables (`encounter_revisions`, `patient_revisions`, `episode_revisions`, `evaluation_revisions`, `consent_revisions`, `patient_antecedent_revisions`) stay out of that list on purpose: their triggers fire on `UPDATE`, `DELETE` and `TRUNCATE`, not on the `INSERT`s of a load, and they have no `created_at` to stamp. Their rows load after the aggregates and audit rows they name, as `encounter_blocks` does after `encounters`.

Then compare the row counts per table with the dump: better, per table, the count and an md5 of its rows as text, ordered, on the source and on the restored database. If anything fails, nothing is loaded and the triggers stay on. A forgotten re-enable is caught by `audit-guards.sql`. Rehearsed on 2026-10-10 ([run](https://github.com/candiath/ficha/actions/runs/38083672334), Postgres 16 in a runner, seed data): dumped with the backups repository's flags and restored this way, the database reproduced all 102 rows, every audit time and encounter, and passed the guards. The same load without the procedure stopped at the first demo audit row (`audit row names an encounter that is not its author's`), and the guards caught a forgotten re-enable. Rehearsed again on 2026-11-01 for the move to 18, on real branches: `staging` and `development` were dumped from the 16 project by `pg_dump` 18 and restored into the 18 one with exactly these commands, and every table matched by count and row hash.

**A dump from before `20261116120000_timestamptz`** has plain `timestamp` columns, whose values carry no zone, and the old stamp function. Restore it whole, its `schema.sql` with its own `data.sql`, compare it with the source, and only then run `prisma migrate deploy`, which converts every timestamp as UTC (and changes how each one prints, so the row hashes no longer match); `audit-guards.sql` passes after it, not before. Never load such a `data.sql` into a newer schema: each value would be read in the loading session's `TimeZone`. From that release on, `data.sql` writes every timestamp with its offset, and the loading session's zone no longer matters.

**`pg_dump` must be at least the server's major version**, and its output loads only into a server at least as new: `pg_dump` 16 refuses an 18 server, and an 18 dump sets `transaction_timeout`, which 16 rejects. On a machine without the client tools, run them from the server's image: `docker run --rm -i -e PGURL postgres:18 sh -c 'pg_dump "$PGURL" …'`, so the URL is expanded inside the container and never appears on a command line.

## Sysadmin alerts (Telegram)

The API tells the platform operator by Telegram when something needs her (`docs/specs/SPEC-sysadmin-alerts.md`). Today it alerts when an audit check fails at startup. Each environment has **its own bot**, so staging never writes into production's chat.

### Setting up an environment

1. In Telegram, talk to **@BotFather**: `/newbot`, a name (`Ficha staging alerts`) and a username ending in `bot`. It answers with the token.
2. Open a chat with the new bot and send it any message (a bot cannot write first). Use **a private chat with the bot, or a private group with only the operator**: never a public channel, whose messages anyone can read. The API rejects `@channel` ids for that reason.
3. Find the chat id: open `https://api.telegram.org/bot<token>/getUpdates` in your own browser and read `result[].message.chat.id` (a number; negative for a group). Do it on your machine, not through any tool that logs URLs: the URL carries the token.
4. Add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` to that environment's secrets: for production its env file on Lightsail (`/opt/ficha/prod.env`), then `docker compose up -d --force-recreate api-prod` in `/opt/ficha`; for staging, `ficha-staging`'s environment on Render (saving redeploys).
5. In `/platform`, the *Alertas* card says "Configurado · bot @…". Press **Enviar alerta de prueba**: the message arrives, and the card shows the result.

The label at the start of every message is `RENDER_SERVICE_NAME` (`[Ficha]`, `[ficha-staging]`): Render sets it itself, and on Lightsail each env file sets it (`ops/README.md`); `[local]` when it is missing.

### Rules

- **The local `.env` never holds a staging or production token**, just as it never holds the production database URL. Use a third bot of your own, or leave the variables unset (the card says "No configurado"). Agents read `.env` files, and `ts-node-dev` re-runs the startup check, and its alerts, on every save.
- **Never set `NODE_DEBUG=undici` or `NODE_DEBUG=fetch`** on a deployed service: Node then prints request URLs, token included, to the logs.
- **Messages never carry links.** A message from the bot with a link was not sent by the app.
- **Rotating a token** (it leaked, or someone left): `/revoke` in @BotFather, then the new token where the environment keeps it (step 4 above). A leaked token lets someone read the chat and send fake alerts in the bot's name.
- **The test button** is limited to 50 a minute, shared by every operator: Telegram limits per chat, and a bot over its limit gets a `429` and a wait, during which a real alert is delayed or lost.

### When an alert does not arrive

The card lists the last 20 real alerts with the outcome of their last attempt; the API logs one line per attempt (`[alerts] AUDIT_GUARDS_FAILED <id>: REJECTED 401 Unauthorized`). A banner across `/platform` stays until a later real alert is delivered.

| Outcome | Meaning |
| --- | --- |
| `REJECTED 401` | The token is wrong or revoked. |
| `REJECTED 400` "chat not found" / `403` | Wrong chat id, or nobody wrote to the bot first, or the bot was blocked or removed. |
| `REJECTED 429` | Too many messages; retried after Telegram's wait if it is under a minute. |
| `UNREACHABLE` | No usable answer (timeout, network); retried twice. |
| `NOT_CONFIGURED` | A variable is missing or malformed; nothing was sent. |

## Local test database

`npm test` runs the API suite against a throwaway Postgres in Docker, not a Neon branch: every round-trip to Neon crosses the network, and the suite makes thousands. On 2026-10-14 the full suite (789 tests) took about 2.5 minutes. Arguments go to vitest: `npm test -- tests/login.test.ts`; `npm run test:watch` is the same in watch mode. `npm run test:neon` is plain vitest against `DATABASE_URL`: what CI runs, and locally a run against `development` when one is needed. A bare `npx vitest` does the same, so it skips the container.

- **What it is**: the `test-db` service of `docker-compose.yml`: Postgres 18 with C.UTF-8 collation and GMT (like the Neon branches), on `127.0.0.1:5433`, with durability off. Its data lives on tmpfs: `docker compose down` (or restarting Docker) leaves it empty, which is also how orphans from interrupted runs are cleared.
- **The tmpfs is mounted at `/var/lib/postgresql`**, not at `.../data`: from 18 the image keeps its data in `/var/lib/postgresql/18/docker`, and its entrypoint exits with an error when `/var/lib/postgresql/data` is a mount holding no data (checked on 2026-11-01). Each worktree shares the compose project `ficha` and its port, so two worktrees on different images replace each other's container on every run; to try another image without touching it, use another project and port (`docker compose -p <name> -f docker-compose.yml -f <override with ports: !override>`) and point `DATABASE_URL` and `DIRECT_DATABASE_URL` at it.
- **The maintenance flag** is created by `docker/test-db/init.sql` when the container starts empty, as on `development` and `ci`.
- **What the script does** (`apps/api/scripts/test-docker.ts`): starts the container if it is not running, runs `prisma migrate deploy` and `audit-guards.sql`, then vitest. The URL is a constant in the script, not a variable: it is set in the environment, where it wins over `apps/api/.env`, so `.env` is never edited and nothing else can point the script at another database.
- **What it does not catch**: it has no pooler, and its latency is near zero. Failures that come from Neon's PgBouncer (`P1002` on a migration, `cache lookup failed for type` after a reset) or from latency (an interactive transaction past its timeout, `P2028`) only show on Neon. That is why release PRs to `main` and manual runs stay on the `ci` branch (`npm run test:neon`). PRs to `dev` run on this container in CI too (since 2026-10-29), so such a failure first shows on the release PR, still before production.
- The dev server, the seed and `db:migrate` keep using `development`: the container is only for tests. Without Docker running, `npm test` stops and says so.

## Postgres 18

The move from 16 started on 2026-11-01 (rollout step 0 of `docs/specs/PLAN-clinical-revisions.md`). A Neon project has one major version, so the move is a new project, `ficha-pg18`, and each branch moves by dump and restore (*Restoring a backup*). It is renamed `ficha` once the old project is deleted.

- `staging` and `development` were restored from dumps of the old branches; `ci` was created empty and migrated. `production` moves last, in a window agreed with the clinic, with the `Ficha` service suspended from the dump to the switch. Before that, the backups repository's `backup.yml` moves to `postgresql-client-18` and checks its dump on `postgres:18`.
- **A new branch starts with its parent's role password.** Every branch of a new project starts with the root's, so a laptop's `development` URL or the `CI_DATABASE_URL` secret would open `production` by swapping the endpoint. Reset `neondb_owner`'s password on each branch, in the console, right after creating it; the MCP's reset returns the password, so it is not used.
- **What changed for the app**: a delete refused by an `ON DELETE RESTRICT` key raises `23001` (`restrict_violation`) instead of `23503`, and Prisma 5.22 does not map it to `P2003`. Nothing in `src` depends on that code; the tests use `expectRestrictedDelete` (`tests/helpers.ts`), which accepts both until `production` is on 18. The audit functions print the same on 18, so `audit-guards.sql` did not change.
- Neon's free plan picks the maintenance window itself: Sunday 05:00–06:00 UTC on the new project.

## Production on AWS (2026-11-14)

The production API moved from Render to an **AWS Lightsail** instance, and its database to a new Neon project in **Ohio** (`rapid-band-cliniplus-ohio`, us-east-2), next to it. The domain is `cliniplus.com.ar`; the production web reads from `api.cliniplus.com.ar` (checked in the published bundle on 2026-11-18).

- **How a change reaches it**: `ops/README.md`. In short: a push to `main` publishes `ghcr.io/candiath/ficha-api:main`; every 5 minutes the instance runs `ops/deploy.sh prod`, which pulls a new image, runs `migrate:prod` with it, starts it and waits for its health check. A failure leaves the previous version serving and sends a Telegram message. Rolling back is pinning `PROD_TAG` to an older `sha-<commit>`.
- **Render's `Ficha` stays as a backup** (decided 2026-11-18), with no traffic: the web no longer calls it. Before switching back to it, check which database its `DATABASE_URL` names: it must be the Ohio `production`.
- **Staging went back to Render** (decided 2026-11-18). For a few days it ran on the same instance (`staging.3-147-5-12.sslip.io`); it left so that a staging failure (memory, disk, a bad image) cannot reach production's host, and production's secrets are the only ones there. It is `ficha-staging` again, at `staging-api.cliniplus.com.ar`. What is given up: staging no longer exercises `deploy.sh`, so production's deploy path is first run by each release. `image.yml` still builds the `dev` image, which at least proves the Dockerfile builds before a release.
- **The Ohio project's `staging` and `ci` branches** were created from its `production`, so they started with its role password (*Postgres 18*). Reset it on each before any URL of theirs is used anywhere.
- The CSP in `netlify.toml` still lists the `onrender.com` and `sslip.io` origins next to the two `cliniplus.com.ar` ones; they leave once the dev context reads from `staging-api.cliniplus.com.ar` (#320 generates the CSP from `VITE_API_URL`).

## Cómo se llegó acá (2026-08-29)

El split a tres entornos se hizo el 29/08/2026 y está **completo**: `main` como default branch, rulesets (`test` + `test-web` en `main` y `dev`, PR obligatorio en `main`), las tres branches de Neon, los dos servicios de Render apuntando a su rama y corriendo `migrate:prod` en el build, Netlify con production branch en `main` más branch deploy de `dev`, y `VITE_API_URL` por contexto.

Dos cosas que se rompieron en el camino y conviene no repetir:

- **No habilitar PR previews sobre el servicio de producción de Render.** Los previews clonan las env vars del padre, así que cada uno arrancaba con el `DATABASE_URL` y el `JWT_SECRET` de producción: migraba contra la base real y firmaba tokens válidos en producción. Si se quieren previews, van sobre `ficha-staging`.
- **Verificar la config de Netlify leyendo el bundle, no el dashboard.** Vite inlinea `VITE_API_URL` en build time, así que `curl` sobre el JS publicado dice a qué API pega cada contexto de verdad. Cambiar la variable no tiene efecto hasta rebuildear.
