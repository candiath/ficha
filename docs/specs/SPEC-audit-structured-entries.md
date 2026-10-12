# Spec: audit-structured-entries

Module of the [audit map](audit-map.md) (issue #186). **Status: draft, awaiting approval.**

## Objective

Audit rows stop storing a Spanish sentence. Each row records **what happened as codes**: an action that names the business fact, the entity and its id, and a small set of typed parameters. The screens build the Spanish sentence from a catalog. After this module:

- `audit_logs` and `platform_audit_logs` have no `description` column: nothing in them is free text, so no personal or clinical value can land there by accident.
- Every action is one code per business fact (`CONSENT_REVOKED`, not `CONSENT` + `UPDATED` + "revocado"). Filtering "every revocation" is `WHERE action = 'CONSENT_REVOKED'`.
- One catalog in `packages/shared` declares every action of every audit table: its parameters and its Spanish wording. The API validates every row against it before writing; the web renders with it; a future export of the clinical record (PDF) can use it too.
- Changing a wording or adding a language never touches the database.
- `clinic-audit` and every later audit table are born with this format.

Who reads it: therapists in a patient's *Actividad* timeline (`audit_logs`), the operator in `/platform` (`platform_audit_logs`).

### Why now

Production is wiped before delivery (#223), so the only rows that will ever carry the old format are fictitious ones. After delivery, rows can never change, and every code written becomes permanent. This is the last moment the format is free.

### What is wrong today

Part of the meaning lives only in the Spanish text, so dropping `description` as it stands would lose it:

| Fact | Row today | Where the difference is |
|---|---|---|
| Consent revoked | `CONSENT` + `UPDATED` | only in "revocado" |
| Session, clinical note or discharge | `SESSION` + `CREATED` | only in the text |
| Functional scale applied | `EVALUATION` + `CREATED` | only in the text, with the raw enum inside (`Escala OSWESTRY aplicada`) |
| User deactivated or reactivated | `USER_ACTIVE_CHANGED` | only in "Desactivó" / "Reactivó" (the clinic uses two actions: inconsistent) |
| Role changed | `USER_ROLE_CHANGED` | the new role only in the text |

## Decisions it builds on

From the conversation of 2026-10-11, after reviewing OWASP's Logging and Logging Vocabulary cheat sheets, FHIR R5 `AuditEvent`, and the audit logs of GitHub (`repo.create`), Stripe (`customer.updated`) and WorkOS (an `action` with a schema registered per action):

1. **One action per business fact** (mode B), as `platform_audit_logs` already does.
2. **Parameters in a JSON column**, validated against the catalog and constrained by the database.
3. **The catalog lives in `packages/shared`**, so the API, the web and a future PDF export use the same one.
4. **`request_id` comes with #220**, when the logs carry it: until then it would point at nothing.
5. Map decisions 2 (descriptions name the action, never a value) and 3 (people are ids, resolved when read) still hold; this module enforces 2 by construction instead of by review.

## Design

### 1. Codes are permanent

The rule every later module follows, and the reason for most of what is below:

- **An action code is never renamed, reused or removed** once a release has written it. Its Postgres enum value stays; a replaced code is marked *deprecated* in the catalog, which keeps a wording for it and refuses to write it.
- **The same holds for parameter values.** The catalog keeps its own list of the values each parameter accepts (`AUDIT_SCALE_TYPES`…), separate from the domain enums and from request validation, and that list only grows: a scale type the clinic stops offering still renders in the rows that name it, and dropping it from the domain does not let anyone create one again.
- **Parameters are additive, and optional for readers.** A new parameter may be required when writing, but every reader treats it as possibly missing: the rows written before it exist. Changing the meaning or type of an existing parameter is a new action.
- **Every code that was ever written renders**, with whatever parameters its row has.
- **The wording is presentation, the code is the record.** Rewording an action or a label changes how every past row reads, on purpose: the record never said "Sesión registrada", it said `SESSION_CREATED`.

Stripe solves the same problem with a version stamped on every event (`api_version`). Additive-only makes that column unnecessary here; if a breaking change is ever unavoidable, a version column is the escape hatch, not a rewrite.

**What is an action and what is a parameter.** A different verb, a different fact someone would look for, is an action: signing and revoking a consent. A classification of the object the fact is about is a parameter: the type of the scale applied, the type of the session, a payment's status (each is already a column of that object, and none is a measurement or an amount).

**Codes are unique per table, not globally.** Each audit table has its own enum (`AuditAction`, `PlatformAction`, and `clinic-audit`'s future `ClinicAction`), and the same fact done by different actors may use the same code in two tables: the operator's `USER_ROLE_CHANGED` and, later, the ADMIN's.

**`params` only holds codes.** A value that is not a code — an id, an IP, a device — goes in a typed column of its own table, decided by the spec of the module that needs it (as `target_user_id` and `auth_session_id` already do). `clinic-audit` and `account-audit` reference the reset link by id, and its IP and device stay in `password_reset_tokens`.

### 2. Data

**`audit_logs`**

| Column | Change |
|---|---|
| `action` (`AuditAction`) | Gains the domain values of §3. `CREATED`, `UPDATED`, `DELETED` stay in the enum, deprecated. |
| `entity` (`AuditEntity`) | Gains `SCALE`. Set by `recordAudit` from the catalog, never by the caller. |
| `params` (new) | `jsonb NOT NULL DEFAULT '{}'`, with the check below. |
| `description` | Release 1: nullable, and `@ignore` in `schema.prisma`. Release 2: dropped. |

**`platform_audit_logs`**: the same `params` and `description` changes. `PlatformAction` gains `USER_DEACTIVATED` and `USER_REACTIVATED`; `USER_ACTIVE_CHANGED` stays, deprecated.

**Why `@ignore` in release 1.** Prisma's `create` returns the row, so its `INSERT … RETURNING` names every column the client knows. If release 1's client still knew `description`, release 2's `DROP COLUMN` would make every audited write of release 1 — still serving during release 2's build — fail with "column does not exist". With `@ignore`, release 1's client never names it. The cost: from release 1 on, the old rows of `development`, `staging` and `ci` show their deprecated generic wording instead of their sentence.

**The `params` check**, on both tables, through a function so it does not depend on how `jsonb` prints:

```sql
CREATE FUNCTION audit_params_are_codes(p jsonb) RETURNS boolean
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  -- The CASE keeps jsonb_each off a non-object: SQL does not promise to
  -- short-circuit AND, and jsonb_each raises on an array.
  SELECT jsonb_typeof(p) = 'object' AND NOT EXISTS (
    SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(p) = 'object' THEN p ELSE '{}' END) AS e(key, value)
     WHERE e.key !~ '^[a-z][A-Za-z]{0,63}$'
        OR NOT CASE jsonb_typeof(e.value)
             -- a code: an enum value
             WHEN 'string' THEN e.value #>> '{}' ~ '^[A-Z][A-Z0-9_]{0,63}$'
                            AND e.value #>> '{}' !~ '[0-9]{3}'
             -- a list of field names
             WHEN 'array'  THEN jsonb_array_length(e.value) <= 64 AND NOT EXISTS (
               SELECT 1 FROM jsonb_array_elements(e.value) AS a(v)
                WHERE jsonb_typeof(a.v) <> 'string' OR a.v #>> '{}' !~ '^[a-z][A-Za-z]{0,63}$')
             ELSE false
           END)
$$;

ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_params_are_codes CHECK (audit_params_are_codes(params));
ALTER TABLE platform_audit_logs ADD CONSTRAINT platform_audit_logs_params_are_codes CHECK (audit_params_are_codes(params));
```

Keys are camelCase names; a value is an enum code (capitals, digits, `_`, never three digits in a row) or a list of camelCase field names. Its body was run against these values on `development` (2026-10-11), read-only:

| Accepted | Rejected |
|---|---|
| `{}`, `{"role": "ADMIN"}`, `{"scaleType": "SF36"}`, `{"scaleType": "PHQ9"}`, `{"changedFields": ["email", "phone"]}` | `{"amount": 15000}` (a number), `{"x": "ARS15000"}` and `{"x": "DNI30123456"}` (three digits in a row), `{"email": "juan@x.com"}`, `{"note": "dolor lumbar"}`, `{"x": "Juan_Perez"}` and `{"x": "dolor_lumbar"}` (lower case), a uuid, nested objects, booleans, an array at the top, `{"f": ["Email"]}` |

It stops amounts, document numbers, emails, ids, dates, sentences and anything in lower case. It cannot stop a word in capitals (`"JUAN"`), or a two-digit number glued to letters: that is the catalog's job (§3), which only accepts its own lists of values.

**Deprecated codes are refused by the catalog, not by the database.** A `CHECK (action NOT IN (…))` would repeat the list of deprecated codes in a third place (catalog, check, guard), and every later deprecation would have to drop and re-add it. The only writers are `recordAudit` and `recordPlatformAudit` (§4), plus the seed and the test helpers, which validate with the catalog too. *(Trade-off: a writer that bypasses all of them could write a deprecated code; the row would still render.)*

The `CHECK (description !~ '[0-9@$]')` planned in [`SPEC-audit-hardening.md`](SPEC-audit-hardening.md) (Rollout step 4) is **dropped**: there is no description left to check. The other check of that step (the session required with an author) is unchanged.

### 3. The catalog (`packages/shared/src/auditActions.ts`)

The third module of `packages/shared` with runtime values, after `postureFamilies.ts` and `slug.ts`, and on the same pattern: one definition, and everything else derived from it. One section per audit table:

```ts
export const AUDIT_ACTIONS = {
  audit_logs: {
    CONSENT_REVOKED: {
      entity: 'CONSENT',
      kind: 'update',                    // the timeline's colour: create / update / delete
      params: {},
      label: 'Consentimiento revocado',  // short: badges and filters
      describe: () => 'Revocó el consentimiento informado',
    },
    SCALE_APPLIED: {
      entity: 'SCALE',
      kind: 'create',
      params: { scaleType: z.enum(AUDIT_SCALE_TYPES) },
      label: 'Escala aplicada',
      describe: (p) => (p.scaleType ? `Aplicó la escala ${SCALE_TYPE_LABELS[p.scaleType]}` : 'Aplicó una escala'),
    },
    // …
  },
  platform_audit_logs: { /* … */ },
} satisfies AuditCatalog;
```

- **Writing is strict**: the parameters form a `strictObject`, every one required, each an enum from the catalog's own lists or a list of field names from an allowlist, never `z.string()`. Unknown keys fail.
- **Reading is lenient and per parameter** (`readAuditParams(table, action, json)`): each parameter is parsed on its own, so one value this version does not know (from a newer API) drops only that parameter; unknown keys are ignored; anything that is not an object reads as `{}`. `describe` receives only what parsed, and every wording handles each parameter missing.
- **Wordings say what was done, not who did it.** The screen adds the actor when it shows one.
- **The labels the wordings need** (`SCALE_TYPE_LABELS`, `SESSION_TYPE_LABELS`, `PAYMENT_STATUS_LABELS`, `ROLE_LABELS`) move to `packages/shared`, and the web imports them from there.
- **Deprecated codes** have `deprecated: true`, a generic wording and no parameters; writing one fails.
- **An unknown action** renders as "Acción registrada", and **an unknown entity** with a neutral badge, never the raw code or another entity's badge (today a `SCALE` would show as "Paciente").
- **The `PlatformAction` union in `packages/shared/src/index.ts`** is derived from the catalog instead of written by hand, and the web's `AuditLog` type follows the DTO.

**The actions** (✱ = new code; the others exist today):

`audit_logs`

| Action | Entity | Params | Replaces |
|---|---|---|---|
| `PATIENT_CREATED` ✱ | `PATIENT` | — | `PATIENT` + `CREATED` |
| `PATIENT_UPDATED` ✱ | `PATIENT` | — | `PATIENT` + `UPDATED` |
| `PATIENT_DELETED` ✱ | `PATIENT` | — | `PATIENT` + `DELETED` |
| `EVALUATION_CREATED` ✱ | `EVALUATION` | — | initial evaluation, `CREATED` |
| `EVALUATION_UPDATED` ✱ | `EVALUATION` | — | initial evaluation, `UPDATED` |
| `SCALE_APPLIED` ✱ | `SCALE` ✱ | `scaleType` | `EVALUATION` + `CREATED` + "Escala X aplicada" |
| `SESSION_CREATED` ✱ | `SESSION` | `sessionType` | `SESSION` + `CREATED` (session, note or discharge) |
| `SESSION_UPDATED` ✱ | `SESSION` | `sessionType` (after the update) | `SESSION` + `UPDATED` |
| `SESSION_DELETED` ✱ | `SESSION` | — | `SESSION` + `DELETED` |
| `PAYMENT_CREATED` ✱ | `PAYMENT` | `status` | `PAYMENT` + `CREATED` |
| `PAYMENT_UPDATED` ✱ | `PAYMENT` | `status` (after the update) | `PAYMENT` + `UPDATED` |
| `CONSENT_SIGNED` ✱ | `CONSENT` | — | `CONSENT` + `CREATED` |
| `CONSENT_REVOKED` ✱ | `CONSENT` | — | `CONSENT` + `UPDATED` |

The type and status *after* an update come from the write's own result, so a session turned into a discharge, or a payment marked paid, is findable (`params->>'sessionType' = 'DISCHARGE'`) without reading the previous state.

`platform_audit_logs`: as today, except `USER_ROLE_CHANGED` takes `{ role }` (old rows have none and read "Cambió el rol") and `USER_ACTIVE_CHANGED` splits into `USER_DEACTIVATED` ✱ and `USER_REACTIVATED` ✱.

Later modules add their sections and actions to the same catalog.

### 4. Writing

- **`AuditEntry` becomes `{ action, entityId, patientId, params }`**, typed from the catalog: `params` is inferred from the action, so a wrong parameter is a type error. The caller no longer passes `entity` or `description`.
- **`recordAudit` validates before inserting**: the action is in the `audit_logs` section, is not deprecated, and its `params` pass the strict schema. It fills `entity` from the catalog.
- **A validation failure is a server bug, not bad input.** `recordAudit` uses `safeParse` and throws a plain `AuditEntryError` — never a `ZodError`, which `errorHandler` would answer as a `400 Datos inválidos` with the parameter's details. It reaches `errorHandler` as an unknown error: logged, `500`, and the transaction rolls back with the action — the same guarantee as today when the audit insert fails.
- **`recordPlatformAudit(tx, op, entry)`** (new, `repositories/prisma/`) does the same for `platform_audit_logs`; the operator's repositories and `prismaSysadminAlertRepository` use it instead of `tx.platformAuditLog.create`.
- **The seed and `tests/helpers.ts`** (`insertAuditRowsAt`) write rows directly; they validate with the catalog too, so a fixture cannot drift from it.

### 5. Reading

- `AuditLogDTO` and `PlatformAuditLogDTO` gain `params`. `PlatformAuditLogDTO.targetUser` stays.
- **Release 1 keeps `description` in both DTOs, computed by the API** with the catalog. An open tab with the previous web keeps showing a sentence; release 2 removes it from the DTOs.
- **The new web uses the DTO's `description` when `params` is missing**: Netlify usually publishes before Render finishes a build, and until then the API is the old one.
- **`ActivityTimeline`**: badge from the entity, text from `describe`, colour from `kind` — which also fixes a deletion being painted the colour of an update today.
- **`PlatformTenantDetailPage`**: `label` · `describe` · target user. Its local `ACTION_LABELS` goes away.
- *(Accepted)* A tab still open with the web from before release 1 shows the new platform codes raw, and an empty badge on the timeline, until it reloads.

### 6. Checks and scans

- `prisma/audit-guards.sql` pins `audit_params_are_codes` by hash, the two `*_params_are_codes` checks by name and definition, and `params` as `NOT NULL`. Release 2 pins the absence of `description`.
- `tests/auditMigrationScan.test.ts`:
  - `audit_params_are_codes` joins `AUDIT_NAMES`, so a later migration that redefines it is caught in CI and not only by the guard, after it has run.
  - Entries for the migrations with DDL on the audit tables, with the exact violations allowed: release 1's table migration (`DROP NOT NULL` on `description` is an `ALTER COLUMN`) and release 2's (`DROP COLUMN`). The enum migration only adds values.
- **`tests/auditCatalog.test.ts`** (new) compares the catalog with `schema.prisma`, as `tenantScopeCoverage.test.ts` does:
  - every value of each table's action enum is in that table's section (deprecated or not), and the reverse;
  - every `audit_logs` entity exists in `AuditEntity`;
  - every value of a Prisma enum a parameter mirrors (`ScaleType`, `SessionType`, `PaymentStatus`, `UserRole`) is in the catalog's list for it, with a label — so adding a scale to Prisma without the catalog fails CI, not the clinical write. The catalog's list may hold more (values the domain dropped), never fewer.

### 7. Docs

- `CLAUDE.md`: the bullet "A description names the action, never a value" becomes the format rule — codes, `params`, catalog, codes and values are permanent — and the list of runtime modules of `packages/shared` gains `auditActions.ts`.
- `audit-map.md`: decision 2 rewritten; this module in the table and in the build order, before `clinic-audit`; `clinic-audit` and `account-audit` keep IPs and devices out of `params` (§1).
- `SPEC-audit-hardening.md`: Rollout step 4 notes that the description check was superseded here.
- #223 (wipe checklist): release 2 reaches `main` before the wipe.

### Out of scope

- **`changedFields`** (which fields an update changed, names only). Computing it needs the exact previous state of the row, read under a lock, which `clinical-history` reads anyway to store the version. It arrives there, as an optional parameter of the `*_UPDATED` actions; the check of §2 already accepts it. Until then the timeline says "Actualizó la ficha". *(See Open Questions.)*
- **`actor_type`** (`USER` / `OPERATOR` / `SYSTEM`). Every current writer is a user or the operator, so it would hold one value. The first module with a writer that is neither (`clinical-audit-coverage`: alerts created by the engine) adds it. *(See Open Questions.)*
- **`request_id`**: with #220.
- **Tying `entity` to `action` in the database.** `recordAudit` derives one from the other; a `CHECK` listing every pair would change with every new action.
- **Translations**: the catalog has Spanish only; a second language is a second wording table, not a schema change.

## Rollout

Two releases, as `CLAUDE.md` requires for destructive migrations: Render migrates in the build while the old code still serves, and the web and the API deploy independently.

1. **Release 1 (additive).**
   - Migration A adds the enum values alone: Postgres does not allow a value added by `ALTER TYPE … ADD VALUE` to be used in the same transaction.
   - Migration B adds `audit_params_are_codes`, `params` with its default and check, and drops `NOT NULL` from `description`. No column changes type: a type change breaks the pooler's cached plans (`docs/infra.md`).
   - The code writes the new format; `description` is `@ignore`d; the DTOs carry `params` and a computed `description`; the web renders from the catalog.
   - During the build, the old code keeps writing `description` and `CREATED`/…, which the database still accepts.
2. **Release 2**: `DROP COLUMN description` on both tables, with its scan entry (reason: fictitious data, before the wipe) and guard; `description` leaves the DTOs and `schema.prisma`.
   - **Its PR is merged to `dev` only after release 1 is on `main`.** A release PR promotes everything on `dev` at once; if both were there, production would drop the column under code that still reads it.
   - **It reaches `main` before the wipe (#223).** If delivery comes first, release 2 drops nothing: the column stays, empty and `@ignore`d, and the guard pins it as nullable instead of absent. Dropping audit text after delivery would erase a real record.

**What an older API does with new codes.** Prisma throws on an enum value its client does not know. During Render's handover the old instance can briefly fail to read a timeline that already has a new code; a rollback of the API to before release 1 would keep failing on it. A rollback is replaced by a fix forward.

The seed writes the new format. Rows already in `development`, `staging` and `ci` keep their old codes and render with the deprecated wordings from release 1 on; production loses them all in the wipe.

## Commands

As in [`SPEC-sysadmin-alerts.md`](SPEC-sysadmin-alerts.md): `npm test`, `npm test -w apps/web`, `npm run check`; migrations written with `prisma migrate diff` + `migrate deploy` (`migrate dev` hangs without a TTY).

## Testing Strategy

- **Database** (`auditHardening.test.ts` style): each rejected `params` of §2 fails the check on both tables, each accepted one passes.
- **Catalog**: `auditCatalog.test.ts` (§6); each write schema rejects unknown keys and free strings; the lenient reader accepts `{}`, unknown keys, unknown values and garbage without throwing, and every `describe` handles each parameter missing.
- **Writing**: `recordAudit` and `recordPlatformAudit` with a deprecated action or bad params answer `500`, log, and roll the action back (extends `auditTransactional.test.ts`).
- **Each route** records its new action and params: replaces the wording assertions of `auditDescriptions.test.ts` and `platformAuditDescriptions.test.ts` (a session with pain values records `SESSION_CREATED` with `{ sessionType }` and nothing else; a payment with an amount records `{ status }` and nothing else), and the exact-text assertions in the `sessionsCrud`, `disconnectDevices`, `passwordReset` and `platform` tests.
- **Web**: `ActivityTimeline` and the platform list render the wording of each action, a deprecated one, a row with missing params, a row with only a `description` (old API), and the fallbacks for an unknown action and entity.

## Boundaries

- **Always**: every new audited action goes through the catalog; run the full API suite locally before pushing.
- **Ask first**: a parameter that is not an enum or a field-name list; any change to an existing code or parameter.
- **Never**: rename, reuse or remove a written code or parameter value; a `z.string()` in a parameter schema; a value of a person or a measurement in `params`.

## Success Criteria

- [ ] No code path writes `description`; release 2 drops it from both tables before the wipe.
- [ ] Every audited write records an action from the catalog, and the database rejects numbers, ids, emails, lower-case text and nested values in `params`.
- [ ] `auditCatalog.test.ts` fails when an action or parameter value is missing from the catalog, or a catalog action from its enum.
- [ ] The timeline and the platform list show the same facts as today in Spanish, plus the ones only the text carried (revocation, note, discharge, scale type, deactivation, payment status).
- [ ] `audit-guards.sql` pins the new function and checks, and passes in CI, the Render build and at startup.

## Doubt review (2026-10-11)

Two fresh-context adversarial reviews. What changed because of them:

- `description` is `@ignore`d in release 1, so release 2's `DROP` cannot break release 1's writes; release 2 merges to `dev` only after release 1 is on `main`, and before the wipe.
- Parameters are optional for readers and parsed one by one; the API keeps a computed `description` in release 1, and the web falls back to it.
- The catalog has one section per table (the ADMIN's and the operator's role change share a code); `params` only holds codes, so IPs and devices stay in typed columns.
- The catalog keeps its own append-only lists of parameter values; a test checks them against the Prisma enums.
- The `params` check is a function, not a regex over the printed `jsonb`; codes are upper case, with no three digits in a row; the function is in the migration scan.
- Catalog failures are `500` and logged, not `400`.
- `SESSION_UPDATED` and `PAYMENT_UPDATED` carry the type and status after the update.
- Deprecated codes are refused by the catalog, not by a `NOT VALID` check (which the guard cannot pin today, and which would need dropping at each deprecation).

## Open Questions

1. **`changedFields` in `clinical-history`, not here** (Out of scope): agreed? Bringing it here means reading each row under a lock before every update, which `clinical-history` would do again.
2. **`actor_type` with the first system writer**, not here: agreed?
3. **The session type as a parameter** (`SESSION_CREATED { sessionType: "DISCHARGE" }`) and not three actions (`DISCHARGE_RECORDED`…): it follows the rule of §1, but a discharge is clinically significant. Agreed?
4. **Old rows in `staging` lose their sentence from release 1** and show the generic wording of their deprecated code ("Paciente · Actualización"): acceptable, since they are fictitious?
