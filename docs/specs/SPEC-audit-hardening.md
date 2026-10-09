# Spec: audit-hardening

Module of the [audit capability map](audit-map.md) (issue #186). **Status: approved 2026-10-09 (v4, after three adversarial review cycles).**

## Objective

Make the two audit tables that exist today, `audit_logs` and `platform_audit_logs`, hold what the database promises, not only what the application happens to write. After this module:

- **No query can change or truncate an audit row.** Deleting one, or inserting it with a past date, is only possible on a database that carries a maintenance flag, which only `development` and `ci` have, and only inside a transaction that also turns on a switch tied to it.
- **The timestamp is the database's**: `created_at` is stamped at insert time, in UTC, with microseconds, whatever the caller sent.
- **An audit row cannot lose its author or target, nor point at another clinic's** patient, author or target: composite foreign keys with `RESTRICT`.
- **The session on an audit row is real when written**: if `auth_session_id` is present, it is an existing session of the row's author at insert time. A later release makes it mandatory whenever there is an author (see Rollout).
- **Descriptions name the action, never values**: no pain scores, scale scores, amounts, emails or names in any row written from now on. A later release adds a database check for digits, `@` and `$`.
- **A database whose guarantees changed persistently is noticed**: the Render build refuses it, and the API logs it at startup.

The later tables (`clinic_audit_logs`, `record_access_logs`) are born with the same functions, foreign key rules and session column.

**What this module does not protect against:**

- **The owner role.** The app connects as the role that owns the tables. Inside a single transaction it can disable a trigger, or create the flag, act, and undo it, and commit without leaving any trace in the catalog. The checks below see only **persistent** changes. Preventing both kinds is #206.
- **Detecting deletions made by that role.** That needs an external anchor (e.g. the daily backup recording row counts in the private repository) and is left to #206.
- **`entity_id` pointing at the wrong row.** It is polymorphic, and a per-entity check needs rules for deletions, where the row no longer exists when its audit row is written. Today the repository takes it from the write's own result inside the same transaction. It is revisited when `clinical-audit-coverage` gives every entity its own `AuditEntity` value (functional scales share `EVALUATION` today).

## Tech Stack, Commands

Express 5, Prisma 5.22, Postgres on Neon. No new dependencies. Commands: `npm test`, `npm test -w apps/web`, `npm run check`. Migrations with `prisma migrate diff --from-schema-datasource … --to-schema-datamodel … --script` (plus the hand-written SQL below), then `migrate deploy` (`migrate dev` hangs without a TTY).

Prisma introspects only `public` and does not manage triggers, functions or `CHECK` constraints, so none of them causes drift. Before writing the rest, the first implementation task runs the SQL below on a throwaway Neon branch, sent whole and not split on `;`, since `$$` bodies contain semicolons. It also confirms that `migrate diff --exit-code` stays at 0. For that throwaway branch and for the rehearsal copy of `production` you provide the connection strings by hand: the Neon MCP's `get_connection_string` is blocked in these sessions.

**Line endings.** This machine checks files out with CRLF (`core.autocrlf=true`), Prisma sends `migration.sql` to Postgres unchanged, and function bodies keep the `\r`. Function hashes would then differ between a laptop deploy and CI or Render. `.gitattributes` gains `apps/api/prisma/**/*.sql text eol=lf` (renormalizing those files), and every hash also strips `\r` before comparing.

## Design

### 1. Triggers

```sql
-- Maintenance (deleting audit rows, inserting them with a past date) needs two
-- things at once:
--  * the flag: the table ficha_ops.audit_maintenance_allowed exists. It lives
--    outside `public`, so Prisma neither sees it nor drops it on migrate reset.
--    Only the development and ci branches have it.
--  * the switch: ficha.audit_maintenance set, transaction-local, to the id of
--    the current transaction. A value that leaked (a session-level SET through
--    the pooler, another transaction's) never matches.
-- The switch is checked first, so ordinary writes never look up the flag.
-- Every name is schema-qualified and search_path ends in pg_temp: otherwise
-- pg_temp is searched first, and a TEMP table named like a real one would be
-- read instead of it.
CREATE FUNCTION public.audit_maintenance_on() RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF coalesce(current_setting('ficha.audit_maintenance', true), '')
     <> pg_current_xact_id()::text THEN
    RETURN false;
  END IF;
  RETURN to_regclass('ficha_ops.audit_maintenance_allowed') IS NOT NULL;
END
$$;

-- UPDATE and TRUNCATE: always rejected. DELETE: only under maintenance.
CREATE FUNCTION public.audit_rows_are_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' AND public.audit_maintenance_on() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit rows are append-only: % on % rejected', TG_OP, TG_TABLE_NAME;
END
$$;

-- The row's time is the database's, in UTC (the column is timestamp without
-- time zone, so now() would follow the session's TimeZone), and the insert's
-- own (clock_timestamp, not the transaction's start).
CREATE FUNCTION public.audit_rows_stamp_created_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT public.audit_maintenance_on() THEN
    NEW.created_at := clock_timestamp() AT TIME ZONE 'UTC';
  END IF;
  RETURN NEW;
END
$$;

-- A session on a row is a real session of its author when the row is written.
-- That session row always exists at that moment: authenticate has just read it.
CREATE FUNCTION public.audit_logs_check_session() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.auth_session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.auth_sessions s
    WHERE s.id = NEW.auth_session_id AND s.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'audit row names a session that is not its author''s';
  END IF;
  RETURN NEW;
END
$$;
```

The switch is turned on with `SELECT set_config('ficha.audit_maintenance', pg_current_xact_id()::text, true)`.

Seven triggers, and no others:

| Table | Trigger | When | Function |
|---|---|---|---|
| `audit_logs` | `audit_logs_stamp_created_at` | `BEFORE INSERT`, row | stamp |
| `audit_logs` | `audit_logs_check_session` | `BEFORE INSERT`, row | check session |
| `audit_logs` | `audit_logs_append_only` | `BEFORE UPDATE OR DELETE`, row | append-only |
| `audit_logs` | `audit_logs_no_truncate` | `BEFORE TRUNCATE`, statement | append-only |
| `platform_audit_logs` | the same three, minus the session check | | |

**`created_at` moves to `timestamp(6)`** on both tables, in this migration. Its precision is milliseconds today, which rounds two inserts less than a millisecond apart (or a `createMany`) to the same value. Readers order by `createdAt`, then `id`.

#### Who deletes, and how

- **Tests.** 27 test files plus `tests/helpers.ts` delete audit rows directly today. All of them move to helpers, the only test code that turns on the switch apart from `auditHardening.test.ts`:

  ```ts
  // Both tables, by clinic. Fails closed: an empty list throws instead of
  // becoming "every row".
  export async function deleteAuditRows(tenantIds: string[]): Promise<void>;
  // platform_audit_logs, by operator (createTestOperator().cleanup()).
  export async function deleteOperatorAuditRows(operatorId: string): Promise<void>;
  // For tests about ordering: rows with a given past date. Each row names its
  // author's session, so it keeps working once the session is required.
  export async function insertAuditRowsAt(rows: BackdatedAuditRow[]): Promise<void>;
  ```

  Each runs one transaction that turns the switch on and acts. When the flag table is missing, the error says how to create it.
- **Orphans** left by interrupted runs go through `scripts/purge-test-audit.ts`. Ad-hoc SQL (the Neon console or MCP) works only where the flag exists, and only with the switch set in the same transaction.
- **The seed** inserts its demo history with `createMany({ skipDuplicates: true })` (`ON CONFLICT DO NOTHING`, never the `upsert` it uses today, which would fire the update trigger), inside a transaction with the switch on, to keep the demo dates.
  - Its rows point at one expired session it creates for its demo user, and their descriptions follow §4.
  - Without the flag it stops with the same message as the helpers, instead of silently stamping "now".
  - It gains a second guard next to `NODE_ENV`: it refuses to run when the database has any user outside its own domain and the test domains.
- **The pre-launch wipe** drops the schema (`DROP SCHEMA public CASCADE`, then `migrate deploy`), which no trigger sees. It never runs `migrate reset` without `--skip-seed`. It runs where the production credential lives (the private backups repository), never from a laptop.
- **A restore from backup** loads `data.sql` with `COPY` while the triggers already exist (`schema.sql` loads first). Without care:
  - the stamp trigger rewrites every `created_at`;
  - the session check rejects every row whose session was pruned, or whose session was not loaded yet (`audit_logs` sorts before `auth_sessions`);
  - and `psql` without `ON_ERROR_STOP` reports success with an empty table.

  So the restore:
  - disables every audit trigger (`ALTER TABLE … DISABLE TRIGGER USER` on both tables);
  - loads in one transaction with `-v ON_ERROR_STOP=1`;
  - re-enables the triggers, and compares row counts per table with the dump.

  A forgotten re-enable is caught by the checks. `docs/infra.md` and the restore notes in the backups repository document it, and PR 2 rehearses one restore on a scratch branch.
- **A future migration that must rewrite audit rows** (a backfill) disables the append-only trigger inside itself. A CI test scans every migration **not on a frozen list of the migrations that exist when PR 2 merges** (a branch started earlier, with an older timestamp, is still scanned). It fails when one touches the audit tables, their functions or their enums with:
  - `ALTER COLUMN`, `DROP COLUMN`, `RENAME`, `DROP TABLE`, `DROP CONSTRAINT`, `SET UNLOGGED`, `OWNER TO`;
  - `CREATE TRIGGER`, `DISABLE TRIGGER`, `DROP TRIGGER`, `CREATE RULE`, `POLICY`, `ROW LEVEL SECURITY`;
  - `CREATE OR REPLACE FUNCTION`, `ALTER FUNCTION`, `DROP FUNCTION`;
  - `ALTER TYPE … RENAME VALUE` on `AuditAction`, `AuditEntity` or `PlatformAction`;
  - `session_replication_role`.

  Any of these passes only if the migration is on an allowlist, with its reason. Row triggers do not see DDL. This test is what keeps a type change (Prisma's `DROP COLUMN` + `ADD COLUMN`) from silently destroying audit content.
- **The switch stays out of the app.** A test scans `apps/api`, `.github` and the root `package.json`. It fails when the switch's name appears outside an exact list of files: the migration, `tests/helpers.ts`, `tests/auditHardening.test.ts`, the scan test itself, `prisma/seed.ts` and `scripts/purge-test-audit.ts`. It builds the name by concatenation so as not to find itself. It also fails, anywhere, on a session-level `SET [SESSION] ficha.audit_maintenance`, or on a `set_config` of it whose value is not `pg_current_xact_id()::text` or whose third argument is not `true`.

#### Checks

Two SQL files, each a `DO` block that raises (so `prisma db execute --file … --schema prisma/schema.prisma` exits non-zero; it reads `DIRECT_DATABASE_URL`, which every step that runs it exports), with nothing to compile.

- **`prisma/audit-guards.sql`** fails when, on either audit table:
  - the set of non-internal triggers is not exactly the seven above, compared by the hash of `pg_get_triggerdef()`. That covers timing, events, level, a `WHEN` condition and the function each one calls.
  - any of them is not enabled (`tgenabled <> 'O'`);
  - the hash of a function's `pg_get_functiondef()`, with `\r` removed, differs from the expected one. That covers its body, `SET` clauses, volatility, `SECURITY DEFINER` and language.
  - the table has a rule (`pg_rewrite`), row-level security (`relrowsecurity`), or is not permanent (`relpersistence <> 'p'`);
  - a composite foreign key is missing, by name, or lacks `RESTRICT` on delete and update;
  - `platform_audit_logs.operator_id` is nullable.
- **`prisma/no-audit-maintenance.sql`** fails when `ficha_ops.audit_maintenance_allowed` exists.

| | `audit-guards` | `no-audit-maintenance` |
|---|---|---|
| CI, after `migrate deploy` on `ci` | ✓ (the structure is tested before staging) | — (`ci` has the flag) |
| `migrate:prod` on Render (staging, production) | after `migrate deploy` | before `migrate deploy` |
| API startup (`index.ts`, not `app.ts`, so tests don't run it) | ✓ | ✓ when `NODE_ENV=production` |

- **On Render**, a failed check fails the build and the previous deploy keeps serving. Every change in this module is compatible with the code that predates it (see Rollout), so that deploy keeps working.
- **At startup** the checks run through a repository method (the lint rule keeps raw database access there) and only log. They report "could not check" (a Neon cold-start timeout, for example) separately from "check failed". Once `sysadmin-alerts` exists, a failed check alerts. Render free restarts the API after every idle period, so in practice this runs several times a day.

### 2. Foreign keys

| Relation | Today | After |
|---|---|---|
| `audit_logs` → patient | `patient_id → patients.id` | `(tenant_id, patient_id) → patients (tenant_id, id)` |
| `audit_logs` → author | `user_id → users.id`, `SET NULL` | `(tenant_id, user_id) → users (tenant_id, id)` |
| `platform_audit_logs` → target | `target_user_id → users.id`, `SET NULL` | `(tenant_id, target_user_id) → users (tenant_id, id)` |
| `platform_audit_logs` → operator | `operator_id`, nullable, `SET NULL` | `NOT NULL` |

- **`RESTRICT` everywhere.** Every foreign key on both tables gets `onDelete: Restrict` and `onUpdate: Restrict`. Without an explicit `onUpdate`, Prisma keeps `ON UPDATE CASCADE`.
- **`@@unique([tenantId, id])` on `Patient` and `User`.** It is redundant with the primary key, but Postgres can only reference a column set that has a unique constraint.
- **A null second column means "nothing to check".** On a composite key whose second column is null (no author, no target), Postgres skips the check, which is the intended meaning.
- **`operator_id` becomes `NOT NULL`.** It was nullable only so that `SET NULL` could work, and every operator action has an operator.
- **Prisma accepts all of this.** All three reviews confirmed that Prisma 5.22 validates and generates the composite relations (including the optional ones, with `tenantId` shared by several relations), `ON UPDATE RESTRICT` and `SET NOT NULL`.

Before PR 2 merges to `dev` (staging migrates from `dev`), these must return 0 on a branch copied from `production`, and then on each environment:

```sql
SELECT count(*) FROM audit_logs a JOIN patients p ON p.id = a.patient_id WHERE p.tenant_id <> a.tenant_id;
SELECT count(*) FROM audit_logs a JOIN users u ON u.id = a.user_id WHERE u.tenant_id <> a.tenant_id;
SELECT count(*) FROM platform_audit_logs a JOIN users u ON u.id = a.target_user_id WHERE u.tenant_id <> a.tenant_id;
SELECT count(*) FROM platform_audit_logs WHERE operator_id IS NULL;
```

**Left out, with reasons:**

- **`login_events`:** its success rows are written fire-and-forget, so `RESTRICT` would turn a late insert into flaky test cleanup. `security-events` makes that write transactional and changes its foreign keys then.
- **`password_reset_tokens`:** its rows change when a link is used, and `user_id` cascades with the user. The evidence in it reaches an audit row in `clinic-audit`, under these same rules.

### 3. `auth_session_id`

```prisma
model AuditLog {
  // …
  // The login this action came from: groups the actions of one session, and
  // resolves to its device and IP while the auth_sessions row exists. The
  // session's id, not its token: not a credential. No foreign key, because
  // auth_sessions rows are deleted with their user and pruned (#178), and the
  // audit row outlives them; the insert trigger checks it instead. Never in a
  // clinic-facing DTO: only the user herself may list her sessions.
  authSessionId String? @map("auth_session_id") @db.Uuid
}
```

- **`TenantContext` gains `authSessionId: string`** (non-null), and `req.authSessionId` goes away, leaving one source of truth. The comment in `types/express.d.ts` that kept it out on purpose ("repositories never need it") stops being true: `recordAudit` needs it. Logout, password change and the device routes read `req.context.authSessionId`.
- **Hand-built contexts in tests** (9 files) get it from a helper that creates a real session, as `createTestToken` already does. This depends on #205, without which `tsc` does not see the tests.
- **Writes with no clinic user**, like the alert engine's, need a system context. That belongs to `clinical-audit-coverage`, the first module to record them.
- **"Required whenever there is an author"** is `CHECK (user_id IS NULL OR auth_session_id IS NOT NULL) NOT VALID`, added one release later (see Rollout).
- **A constraint passed to #178:** prune `auth_sessions` no sooner than `login_events` (180 days), so a recent audit row still resolves to a device. Past that, the id still groups one login's actions. Copying the IP and user agent into every audit row would put personal data in rows that can never change, against decision 3 of the map.
- **`AuditLogDTO` does not expose it.** Any user who reads a patient's history could otherwise count a colleague's sessions, which `CLAUDE.md` keeps private to each user.

`platform_audit_logs` gets no session column here: the operator still signs in with a JWT. See Open Questions.

### 4. Descriptions without values

| Where | Today | After |
|---|---|---|
| `sessions.ts` (create) | `Sesión RPG registrada — Dolor 7 → 3` | `Sesión RPG registrada` |
| `functionalScales.ts` | `Escala OSWESTRY aplicada — score 42%` | `Escala OSWESTRY aplicada` |
| `payments.ts` (create) | `Cobro registrado — $15000` | `Cobro registrado` |
| `payments.ts` (update) | `Cobro actualizado — Estado: PAID`, written even when the status did not change | `Cobro actualizado` |
| `prismaPlatformRepository.ts` | `Creó la clínica "X" (x)`, `Creó a ana@… como ADMIN de "X"`, `Desactivó a ana@…`, … | `Creó la clínica`, `Creó una ADMIN`, `Desactivó a la usuaria`, `Cambió el rol a ADMIN`, … |
| `prisma/seed.ts` | patient names, EVA and NDI scores, a clinical note's text | the same rules |

- **What stays:** the session type, the scale type and a role change's new role. They say what was done, not a person's data or a measurement.
- **Names are resolved when a screen reads the row.** `PlatformAuditLogDTO` gains `targetUser: { email, name } | null` from a join, and the platform's audit list shows it. An anonymized user then shows as anonymized.
- **Older rows keep their old text.** They can no longer be updated, and the pre-launch wipe removes them. On `development`, the seed's old rows stay, because it skips existing ids.
- **What is lost, and where it belongs.** Today the creation row of a session or payment is the only immutable copy of its original pain scores or amount, since a later `PATCH` overwrites the record itself. After this module that copy is gone. Keeping earlier values belongs to versioning the clinical rows, which the map does not have yet (see Open Questions). Production data is fictitious until delivery, so nothing real is lost meanwhile.
- **Enforcement.** The rule goes in a comment on `AuditEntry`, and tests pin each changed wording. One release later, `CHECK (description !~ '[0-9@$]') NOT VALID` on both tables enforces most of it at the database: no new wording and no enum value it uses contains a digit, `@` or `$`. Names alone stay unenforceable.
- **Exact-text assertions that change:** `sessionsCrud.test.ts:639`, `disconnectDevices.test.ts:160`, `passwordReset.test.ts:226`, `platform.test.ts:347`.

## Rollout

`development` and `ci` are shared:
- CI runs `migrate deploy` on `ci` for every API PR, before it merges;
- `migrate deploy` never re-applies an edited migration;
- there are no down migrations;
- Render migrates during the build while the old code still serves.

Hence:

0. **Merge #205 first**, so the hand-built contexts in tests are typechecked.
1. **PR 1, additive migration only.** It cannot break another branch or code still serving: an added nullable column changes nothing for them, and `set_config` on a setting nothing reads does nothing.
   - the nullable `auth_session_id`, written by `recordAudit` through `TenantContext`, and the removal of `req.authSessionId`;
   - the helpers, with all test cleanup moved onto them;
   - the seed changes and the descriptions;
   - the platform DTO and list;
   - the `.gitattributes` rule;
   - `DIRECT_DATABASE_URL` exported in CI's test step, as the migrate steps already do.
2. **Before PR 2:**
   - create `ficha_ops.audit_maintenance_allowed` on `development` and `ci`. It is one-time SQL, documented in `docs/infra.md`; branches created from them inherit it, and a reset from `production` drops it;
   - merge or rebase every open branch onto `dev`;
   - develop PR 2 against a throwaway Neon branch created from `development`, never against the shared ones.
3. **PR 2, opened once its migration is final:**
   - the functions and triggers, `timestamp(6)`, the foreign keys and `operator_id NOT NULL`;
   - the two check files and every place that runs them, including the startup check;
   - the migration-DDL and switch scans, and the tests below;
   - the docs.

   Around it:
   - **Before it merges to `dev`:** the rehearsal on a copy of `production`, with the queries of §2, and one restore rehearsal.
   - **If its migration changes after CI applied it:** rebuild `ci` with the `reset_ci_db` dispatch of `test.yml`.
   - **If it is abandoned:** a down script in the PR description, to apply by hand on `ci` and `development`.
   - **Old code still serving:** it never updates or deletes audit rows, writes valid foreign keys and a null session (the session check only applies when one is present), and always sets `operator_id`. It keeps working during the deploy window and after a failed build.
4. **One release later:** the two `NOT VALID` checks (the session required with an author, and descriptions without digits, `@` or `$`). They are safe once no code that predates PR 1 can be serving anywhere, and go with the next module that writes audit rows (`clinic-audit`).

A migration that fails on Render leaves `_prisma_migrations` marked failed, so later deploys fail with `P3009` until `migrate resolve --rolled-back` runs against that database. For production that has to happen where its credential lives. It is a gap for every migration and gets its own issue.

## Testing Strategy

Vitest + supertest against Neon. New `tests/auditHardening.test.ts`, which touches the shared tables only with row-level operations on its own clinic:

- **Structure:**
  - `prisma/audit-guards.sql` passes;
  - the same file, with its table names replaced by `TEMP` copies, fails when one of their triggers is disabled, has a `WHEN` condition, or calls a different function.
- **Real tables:**
  - `update`, `delete` and `deleteMany` on the test's own rows fail;
  - `deleteAuditRows` succeeds;
  - an insert with a past `createdAt` is stored with the current UTC time;
  - two rows inserted in one `createMany` get different times.
- **On a single-connection client over the direct URL** (`connection_limit=1`), with a `TEMP` table carrying the same triggers:
  - `TRUNCATE` fails even under maintenance.
  - A switch set to any value other than the current transaction's id (including one set at session level) does not allow a delete.
  - After a transaction that set the switch commits, the same backend (same `pg_backend_pid()`) cannot delete.
  - The switch alone, without the flag, does not allow a delete: tested in a transaction that drops the flag table and rolls back. That is the only lock this test takes on a shared object, on a table nothing else writes.
  - A `TEMP` table named `auth_sessions` does not satisfy the session check.
- **`RESTRICT`:** deleting a user who authored or was targeted by an audit row, or an operator who acted, fails with `P2003`.
- **Composite keys:** through the base client, inserting an audit row whose patient, author or target belongs to another clinic fails with `P2003`.
- **Sessions:**
  - `POST /api/patients` with a real session writes that session's id;
  - a row naming another user's session, or one that does not exist, is rejected;
  - `GET …/audit-log` does not return it.
- **Descriptions:** the new wordings. A session with pain values, a scale with a score and a payment with an amount carry none of them.
- **Guards in code:** the switch scan and the migration-DDL test pass on today's files.
- **Unchanged:** `auditTransactional.test.ts` (#188) still passes; its broken entry still violates a foreign key.

Web: the platform audit list renders `targetUser`.

## Boundaries

- **Always:**
  - audit rows are written only by repositories, inside the action's transaction;
  - the switch is set only to the current transaction's id with `set_config(…, true)`, by its listed files;
  - migrations touching audit tables are developed on a throwaway branch and rehearsed on a copy of `production` before reaching `dev`.
- **Ask first:**
  - extending composite keys to non-audit tables;
  - a new way to delete or backdate audit rows;
  - adding a migration to the DDL allowlist;
  - changing an expected hash;
  - changing which values may appear in a description.
- **Never:**
  - `UPDATE` an audit row;
  - create the flag on `staging` or `production`;
  - set the switch at session level;
  - run `migrate reset` with the seed against a deployed database;
  - expose `auth_session_id` to anyone but its owner.

## Success Criteria

- [ ] No query can update or truncate `audit_logs` or `platform_audit_logs`. Deleting or backdating needs the flag (only on `development` and `ci`) and the switch, set to the current transaction's id.
- [ ] Deleting a user or operator who appears in an audit row fails, and an audit row cannot reference another clinic's patient, author or target.
- [ ] A session on an audit row is, when the row is written, a real session of its author.
- [ ] No row written after PR 1 has a description with a pain score, scale score, amount, email or name.
- [ ] When a trigger, function, rule, row-level security or table persistence differs from what was deployed, or the flag exists where it must not, a Render build fails and the API logs it at startup.
- [ ] All test cleanup of audit rows goes through the helpers. The full suite passes, locally and on CI, after each PR.
- [ ] `CLAUDE.md` and `docs/infra.md` cover:
  - the triggers, the flag and the switch, and who may use them;
  - `RESTRICT`;
  - the checks and the branch setup step;
  - the wipe and restore procedures;
  - the line-ending rule;
  - the description rule.

## Decisions (2026-10-09)

1. **Checks:** kept in full.
2. **The operator's session:** `operator-sessions` adds `platform_audit_logs.operator_session_id` (nullable uuid, no foreign key, checked on insert as §1 checks the clinic's, filled from `req.operator`).
3. **Versioning clinical records:** a module of its own in the map, `clinical-history`.
4. **The role, session type and scale type** stay in descriptions.

## Open Questions (as asked, answered above)

1. **The operator's session on platform audit rows.** You are writing `operator-sessions` yourself. I suggest that module add `platform_audit_logs.operator_session_id`: a nullable uuid with no foreign key, checked on insert as §1 checks the clinic's, and filled from `req.operator`. That is better than this module adding a column that stays null until then.
2. **Versioning clinical records.** Ley 26.529 asks for an inviolable record. Today a `PATCH` to a session or payment overwrites its values, and after this module no audit row keeps the originals (§4). I propose a new module in the map, `clinical-history`: each update or delete of a clinical row stores the previous version in an append-only table, and the audit row records which fields changed (names only, as in "X cambió el email de Z"). Should it go in the map, and how high?
3. **The new role, the session type and the scale type in descriptions.** I keep them: they are not personal or clinical data, and promoting someone to ADMIN is exactly what an audit must show. Tell me if you want them out too.
