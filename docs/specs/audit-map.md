# Capability Map: Audit every action

Origin: issue #186 (decided 2026-10-05: every action leaves an audit trail), its security review comment (requirements 1–9) and the input from `password-reset`. Decisions below taken 2026-10-09. **Status: awaiting final review.** Each module gets its own spec next to this file (`SPEC-<module-id>.md`) and its own PR against `dev`.

## Where we stand

Three tables audit today:

- `audit_logs` — a patient's history. Transactional since #189. Covers patients, initial evaluations, clinical sessions, payments, consents and functional scales (the last ones recorded as `EVALUATION`). Some descriptions carry values: a session's pain score, a scale's score, a payment's amount.
- `platform_audit_logs` — every platform operator action, in the same transaction. The operator's own password change is not one of them.
- `login_events` — login attempts, clinic and operator. A success is recorded fire-and-forget; attempts rejected by the per-account throttle are not recorded.

Write routes with no audit row (23):

| Area | Routes |
|---|---|
| Users (ADMIN) | `POST /api/users`, `PATCH /api/users/:id`, `POST …/:id/disconnect-devices`, `POST …/:id/password-reset` |
| Clinic configuration | `PATCH /api/tenant` |
| Own account | `POST /api/auth/change-password`, `/logout`, `/devices/revoke-others`, `DELETE /devices/:id`, `POST /devices/:id/untrust`, `POST /password-reset` (using a link); operator `POST /api/platform/auth/change-password` |
| Clinical | episodes (`POST`, `PATCH`), appointments (`POST`, `PATCH`, `POST …/cancel-series`), alerts (`POST`, `PATCH …/read`, `PATCH /read-all`), packages (`POST`, `DELETE`), `DELETE` of a functional scale |

Plus writes outside any write route: the alert engine creates alerts on `GET /api/alerts` and `/stats`.

Reads are not recorded at all, and `GET /api/sessions` returns the observations, notes and pain scores of every session of every patient in one unpaginated response.

## Decisions

1. **One table per meaning** (option 2 of the issue). Each table has its own readers, permissions and retention:

   | Table | Holds | Read by |
   |---|---|---|
   | `audit_logs` | Writes to a patient's history (every clinical entity has a `patientId`) | The patient's record |
   | `clinic_audit_logs` (new) | Clinic administration and account security: no patient | The clinic's ADMIN; each user, the events on her own account |
   | `record_access_logs` (new) | Reads of a patient's clinical record | The clinic's ADMIN |
   | `platform_audit_logs` | Operator actions | The operator |
   | `login_events` | Login attempts | The per-account throttle |

2. **A description names the action, never the values.** "X changed Z's email", not the email; no scores, pain or amounts. People are ids (`target_user_id`), and screens resolve names when they read, so an anonymized user shows as such.
3. **Audit rows keep user ids.** The app never deletes users, so actor and target foreign keys become `RESTRICT` instead of `SET NULL`, and no `UPDATE` ever touches an audit row. Requirement 3 (actor email and name copied into each row) is dropped: it would put identity into rows that cannot change. Erasure is decided table by table; the author of a clinical entry stays identifiable (Ley 26.529), which is part of the legal question below.
4. **`auth_session_id` on every row that has one**: a plain nullable uuid with no foreign key, because `auth_sessions` is deleted with its user and #178 will prune it. Null for the operator, system writes and the use of a reset link.
5. **Reading a clinical record is audited**, from the repositories and for every clinical read path. If the read cannot be recorded it is denied and the sysadmin is alerted.
6. **Global lists carry no clinical text.** Clinical detail is read only inside a patient's record, so a single request cannot carry the whole clinic's notes.
7. **Sysadmin alerts go to Telegram.** The message carries the kind of event, ids and counts, never personal data.
8. **Retention lives in code constants** (`lib/retentionPolicy.ts`, like `authSessionPolicy.ts`): `login_events` keeps 180 days. Purging is by age only, never "keep the newest N", which failed logins on made-up emails could push out. It runs throttled inside the app, like `refreshAlerts`: Render free has no cron.
9. **A login attempt the throttle rejects is recorded as `THROTTLED`**, and the throttle ignores those rows; counting them would let anyone keep an account locked forever with one request every ~90 s. The successful login event is written in the transaction that creates the session, with its id.
10. **The append-only trigger protects against application bugs**, not against a compromised app connection: the app's role owns the tables. The boundary for that is a separate database role, #206, before onboarding real clinics.

## Modules

| Module id | Responsibility | Depends on |
|---|---|---|
| `audit-coverage` | A manifest that classifies every write route as audited (and in which table) or exempt with a reason, and a test that compares it against the router, as `idParamCoverage.test.ts` does for params. It starts with the 23 routes above listed as known debt; each module deletes its entries. It is an inventory, not a proof: each module's own tests check that the row is written. The rule "every write leaves an audit row" goes into `CLAUDE.md`. | — |
| `audit-hardening` | On the existing tables: actor and target foreign keys to `RESTRICT`; `auth_session_id`; an append-only trigger for row `UPDATE`/`DELETE` and for `TRUNCATE`, with a narrow bypass (`SET LOCAL`, never a session-level `SET` through the pooler) for test cleanup and the pre-launch wipe, and the 26 test files that delete audit rows moved onto one helper; the composite foreign key `(tenant_id, patient_id) → patients`, which needs `@@unique([tenantId, id])` on `patients`; descriptions without values (session pain, scale score, payment amount). | — |
| `sysadmin-alerts` | A Telegram notifier (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`): at most one message per kind of event every 15 minutes, sent off the request path; a failed send is logged and never fails the request. | — |
| `list-minimization` | Global lists stop returning clinical text: `GET /api/sessions` without observations, notes, pain, patient response or main complaint, and the same review for the agenda and alerts. *Sesiones* shows what is left and links into each record. | — |
| `clinic-audit` | `clinic_audit_logs` and a `ClinicAction` enum. ADMIN actions on users (create, role, active, disconnect devices, generate a reset link with its IP and device) and clinic configuration, each in the same transaction as the action. Its tenant-guard classification is decided in the spec (`authRepository` writes it without a `ctx`). | `audit-hardening` |
| `clinical-audit-coverage` | Episodes, appointments, alerts and packages into `audit_logs` (new `AuditEntity` values), plus the missing scale deletion with an entity of its own. Alerts the engine creates are recorded with no actor. | `audit-hardening` |
| `record-access-log` | `record_access_logs`: one row per user, patient and hour, written by the repositories on every clinical read; the read is denied, and the sysadmin alerted, when the row cannot be written. A burst detector counts the distinct patients a user read in a window (constants) and alerts the sysadmin. | `audit-hardening`, `sysadmin-alerts`, `list-minimization` |
| `account-audit` | Account events into `clinic_audit_logs`: password change, logout, closing one or the other devices, untrusting one. A reset link used has no actor (it is whoever holds the link): the target is the user, with the link's id and `used_ip` / `used_user_agent`. The operator's password change goes to `platform_audit_logs`. *Mi cuenta* shows each user the events on her own account. | `clinic-audit` |
| `security-events` | Login: `THROTTLED`, and the success in the session's transaction. Failures attributable to an account: wrong current password (with a per-account cap), invalid reset links, use of a revoked or expired session. Every 403; 404s on well-formed ids, rate-limited. A per-IP limiter on 401s answers 429 before touching the database. Alert thresholds as constants; the `login_events` purge. | `clinic-audit`, `sysadmin-alerts` |
| `audit-viewer` | ADMIN screen (*Clínica → Actividad*): `clinic_audit_logs` paginated, filtered by user and action; in each record, who opened it. A reset link generated and used from the same IP and browser is shown as a hint, not a verdict: a clinic's shared network produces it too. | `clinic-audit`, `account-audit`, `record-access-log` |

Build order: `audit-coverage`, `audit-hardening`, `sysadmin-alerts`, `list-minimization` → `clinic-audit`, `clinical-audit-coverage`, `record-access-log` → `account-audit`, `security-events` → `audit-viewer`.

## Not in this initiative

- **Secretary role.** When it exists, every clinical read is a 403 for her, which `security-events` records and alerts on. Until then the burst detector is the only control over users who may read every record.
- **Separate database role**: #206.
- **Retention of the audit tables and erasure per table.** Waiting on the legal question (Ley 26.529, Ley 25.326). It overlaps #178, which covers `auth_sessions`.
