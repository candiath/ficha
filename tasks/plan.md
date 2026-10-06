# Implementation Plan: password-reset

Spec: [`docs/specs/SPEC-password-reset.md`](../docs/specs/SPEC-password-reset.md) (approved 2026-10-05). Module 4 of the [authentication redesign](../docs/specs/auth-redesign-map.md). Previous plans: [`PLAN-server-sessions.md`](../docs/specs/PLAN-server-sessions.md), [`PLAN-my-sessions.md`](../docs/specs/PLAN-my-sessions.md), [`PLAN-admin-revocation.md`](../docs/specs/PLAN-admin-revocation.md). Task checklist: [`tasks/todo.md`](todo.md).

## Overview

An ADMIN or the operator generates a 24 h single-use link that immediately closes the user's sessions and disables her password; she sets a new one on a public page. One PR against `dev` (`feat/password-reset`), one commit per task. Intermediate commits may leave the app incomplete (nothing reaches `dev` until the module is done), but each passes the pre-commit hook, and the full API suite runs locally before the push.

## Architecture Decisions

- **API first, by risk.** The security-critical part — generation (revoke, disable, invalidate) and consumption (one conditioned transaction) — is built and tested before any UI. The web slices consume a finished, tested API.
- **One token generator for both secrets.** `lib/authSessionToken.ts` becomes the generic `lib/opaqueToken.ts` (`randomBytes(32)` base64url, SHA-256 hash), used by `AuthSession` and by reset links; no second implementation of the same thing.
- **Ownership.** Generation lives with each actor's repository (`userRepository` for the ADMIN, tenant-scoped; `platformRepository` for the operator, explicit `tenantId`) and shares one Prisma helper for the writes; consumption lives in `authRepository`, which runs before any tenant context exists.
- **Disabling the password** replaces the hash with a bcrypt hash of random bytes (cost 10), so login timing does not reveal a pending reset.
- **The evidence columns** (`created_by_*`, `created_ip/user_agent`, `used_ip/user_agent`) are written from day one; audit rows that read them are #186.

## Task List

### Phase 1: Core API
- [x] Task 1: Reset-link table and ADMIN generation
- [x] Task 2: Public check and reset

### Checkpoint A: the flow works through the API
- [ ] Generate as ADMIN → old sessions and password dead → check → reset → login with the new password; full API suite green

### Phase 2: Remaining API
- [ ] Task 3: Operator generation, audited
- [ ] Task 4: Pending reset in the user lists

### Phase 3: Web
- [ ] Task 5: Generate action, link dialog and pending badge (Usuarios and platform page)
- [ ] Task 6: Public page `/restablecer-contrasena` and the message on `/login`

### Checkpoint B: end to end
- [ ] Full API and web suites green; `npm run check` clean
- [ ] Manual (skill `verify`): ADMIN generates a link for a therapist logged in elsewhere → her session dies; the link opens in a private window, sets the password, lands on `/login`, she logs in; the link fails a second time; the badge appears and disappears

### Phase 4: Docs
- [ ] Task 7: `CLAUDE.md` and verify skill

### Checkpoint C: complete
- [ ] Spec success criteria met; PR against `dev` open, CI green

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| A token ends up in a log (URL, error log) | High | Token only in bodies and the URL fragment; test that routes take it in the body; check that `errorHandler` never logs request bodies (Task 2) |
| A link is used twice (double click, race) | High | `used_at: null` and validity in the `where` of the consuming `updateMany`; count 0 → uniform 400; test with two concurrent requests |
| An ADMIN resets a user of another clinic | High | Tenant-scoped lookup in the generation transaction; test asserts 404 and nothing changed (sessions, hash, links) |
| Login timing reveals a pending reset | Medium | Random bcrypt hash instead of a sentinel; test asserts the stored hash is valid bcrypt |
| The link is lost before it reaches the user | Low | Generating a new one is always possible and invalidates the old; the badge shows the pending state |

## Open Questions

None.
