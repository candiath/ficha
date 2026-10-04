# Tasks: server-sessions

Plan: [`tasks/plan.md`](plan.md) · Spec: [`docs/specs/SPEC-server-sessions.md`](../docs/specs/SPEC-server-sessions.md)

Commands: `npm test` (API, hits Neon) · `npm test -w apps/web` · `npm run check` (lint + typecheck, also the pre-commit hook) · `npm run db:migrate` (development branch only).

## Task 1: `auth_sessions` table and token library

**Description:** Add the `AuthSession` model and its migration, and `lib/sessionToken.ts` with `generateSessionToken()` (`randomBytes(32)` base64url) and `hashSessionToken(token)` (SHA-256 → `Buffer`). Nothing uses them yet.

**Acceptance criteria:**
- [x] `auth_sessions` exists per the spec's data model (uuid v7 id, `user_id` FK with cascade, `token_hash` bytea unique, `expires_at`, `revoked_at`, `ip`, `user_agent`, index on `user_id`), with no `tenant_id`.
- [x] `tenantScopeCoverage.test.ts` still passes without classifying the model.
- [x] Unit test: tokens are 43 chars and distinct; the hash is 32 bytes and deterministic; a row inserted with the hash is found by it.

**Verification:**
- [x] `npm test -- sessionToken tenantScopeCoverage`
- [x] `npm run check`
- [x] `npx prisma migrate diff` against the schema shows no drift

**Dependencies:** None

**Files likely touched:** `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/<ts>_auth_sessions/migration.sql`, `apps/api/src/lib/sessionToken.ts`, `apps/api/tests/sessionToken.test.ts`

**Estimated scope:** Small

## Task 2: Async test token helper (mechanical)

**Description:** Replace the synchronous `signTestToken(user)` with `await createTestToken(user)` in `tests/helpers.ts` and every suite. For now the helper still signs a JWT, so behavior is unchanged; this only makes the cut-over a one-file change for the tests. The `iatOffsetSeconds` option stays on a separate helper used only by `authenticate.test.ts` and `changePassword.test.ts`, which Task 3 rewrites.

**Acceptance criteria:**
- [x] No suite calls `signTestToken` except the two JWT-semantics suites.
- [x] Full API suite green with no other change.

**Verification:**
- [x] `npm test`
- [x] `npm run check`

**Dependencies:** None (parallel with Task 1)

**Files likely touched:** `apps/api/tests/helpers.ts` and ~33 suites (one-line `await` edits; the only task allowed past ~5 files, because the edit is mechanical)

**Estimated scope:** Medium (many files, trivial edits)

## Task 3: Login issues sessions; `authenticate` validates them

**Description:** The cut-over. Login creates an `auth_sessions` row (7-day TTL from `SESSION_TTL_DAYS`, IP and user agent) and returns its token. `authenticate` hashes the bearer token and calls `authRepo.findSessionForAuth`, the single query joining `users` and `tenants`; it sets `req.context` as today plus `req.authSessionId`. `createTestToken` now inserts a session. `change-password` is left broken until Task 5 (allowed: nothing reaches `dev` before the module is done).

**Acceptance criteria:**
- [x] Login → token authenticates; the DB holds only the hash (asserted).
- [x] Unknown, malformed and old-JWT tokens → `401` with the same message; an expired session → `401`.
- [x] Safety net: `users.is_active = false` set directly with Prisma (no revocation) → `401`; same for a deactivated tenant.

**Verification:**
- [x] `npm test` (full: every suite now authenticates through sessions; `changePassword.test.ts` may fail until Task 5)
- [x] `npm run check`

**Dependencies:** Tasks 1, 2

**Files likely touched:** `apps/api/src/repositories/authRepository.ts`, `apps/api/src/repositories/prisma/prismaAuthRepository.ts`, `apps/api/src/middlewares/auth.ts`, `apps/api/src/routes/auth.ts`, `apps/api/src/types/express.d.ts`, `apps/api/tests/helpers.ts`, `apps/api/tests/authenticate.test.ts`, new `apps/api/tests/authSessions.test.ts`

**Estimated scope:** Large — kept whole because login and `authenticate` must switch together; Tasks 1–2 already removed what could be split off.

## Checkpoint A: after Tasks 1–3

- [x] `npm test`, `npm test -w apps/web`, `npm run check` green
- [x] Manual (skill `verify`): log in on the web, navigate, reload; `auth_sessions` has the row, hash only
- [ ] Review with Nath

## Task 4: Logout revokes the current session

**Description:** `POST /api/auth/logout` (authenticated) revokes `req.authSessionId` with a conditioned `updateMany` and answers `204`. The web's `logout` calls it and clears the token whatever the outcome.

**Acceptance criteria:**
- [ ] After logout the same token gives `401`; a second logout with it gives `401`, not `500`.
- [ ] Another session of the same user keeps working.
- [ ] Web test: logout calls the endpoint and clears the token even when the call fails.

**Verification:**
- [ ] `npm test -- authSessions` · `npm test -w apps/web -- AuthContext`
- [ ] `npm run check`

**Dependencies:** Task 3

**Files likely touched:** `apps/api/src/routes/auth.ts`, `apps/api/src/repositories/authRepository.ts`, `apps/api/src/repositories/prisma/prismaAuthRepository.ts`, `apps/web/src/contexts/AuthContext.tsx`, tests

**Estimated scope:** Medium

## Task 5: Change password keeps the current session (`204`)

**Description:** `change-password` updates the hash and revokes every other session of the user in one transaction, keeping `req.authSessionId`; it answers `204`. `ChangePasswordDialog` stops calling `setToken`. It also stops stamping `password_changed_at`.

**Acceptance criteria:**
- [ ] The session that made the change keeps working; another session of the same user gets `401`.
- [ ] Wrong current password still answers `400` and revokes nothing.
- [ ] Web test: the dialog closes with success and the stored token is unchanged.

**Verification:**
- [ ] `npm test -- changePassword` · `npm test -w apps/web -- ChangePasswordDialog`
- [ ] `npm run check`

**Dependencies:** Task 3 (parallel with Task 4)

**Files likely touched:** `apps/api/src/routes/auth.ts`, `apps/api/src/repositories/authRepository.ts`, `apps/api/src/repositories/prisma/prismaAuthRepository.ts`, `apps/web/src/components/account/ChangePasswordDialog.tsx`, tests

**Estimated scope:** Medium

## Task 6: Deactivating a user or a clinic revokes their sessions

**Description:** Inside their existing transactions, the user update with `isActive: false` (`prismaUserRepository`, `prismaPlatformRepository`) and the tenant deactivation (`prismaPlatformRepository`) revoke the open sessions involved.

**Acceptance criteria:**
- [ ] Deactivate a user via the ADMIN route and via the platform route → `401`; reactivate → the old token is still `401`.
- [ ] Deactivate a clinic → its users' tokens `401`; reactivate → still `401`.
- [ ] A failed deactivation (e.g. last active ADMIN) revokes nothing.

**Verification:**
- [ ] `npm test -- users platform authSessions`
- [ ] `npm run check`

**Dependencies:** Task 3 (parallel with Tasks 4–5)

**Files likely touched:** `apps/api/src/repositories/prisma/prismaUserRepository.ts`, `apps/api/src/repositories/prisma/prismaPlatformRepository.ts`, tests

**Estimated scope:** Medium

## Checkpoint B: after Tasks 4–6

- [ ] Every test in the spec's Testing Strategy passes
- [ ] Manual: two browsers, same user — change the password in one, the other goes to login; logout in one leaves the other alive

## Task 7: Remove the clinic JWT and `JWT_SECRET`

**Description:** Delete `lib/jwt.ts`; move `JWT_ALGORITHM` into `platformJwt.ts`; the platform secret check becomes a plain length check; drop `JWT_SECRET` from the `app.ts` startup check, `.env.example`, `tests/setup.ts` and the CI workflow; trim `jwtAlgorithm.test.ts` to the platform half; remove the leftover `signTestToken`. Update `CLAUDE.md` (authRepository exception, per-environment secrets). File the follow-up issue for `DROP password_changed_at`.

**Acceptance criteria:**
- [ ] `grep -r JWT_SECRET` finds only `PLATFORM_JWT_SECRET`.
- [ ] The API starts and the full suite passes with `JWT_SECRET` unset.
- [ ] `platformIsolation.test.ts` passes: a clinic session token is rejected by `/api/platform/*`, an operator JWT by `/api/*`.

**Verification:**
- [ ] `npm test` · `npm test -w apps/web` · `npm run check`
- [ ] CI green on the PR (the workflow change is called out in the description)

**Dependencies:** Tasks 4, 5, 6

**Files likely touched:** `apps/api/src/lib/jwt.ts` (deleted), `apps/api/src/lib/platformJwt.ts`, `apps/api/src/app.ts`, `apps/api/.env.example`, `apps/api/tests/setup.ts`, `apps/api/tests/jwtAlgorithm.test.ts`, `apps/api/tests/helpers.ts`, `.github/workflows/test.yml`, `CLAUDE.md`

**Estimated scope:** Medium (many files, small deletions)

## Checkpoint C: complete

- [ ] Spec success criteria met
- [ ] PR against `dev` open, CI green
- [ ] After deploy: remove `JWT_SECRET` from both Render services and `CI_JWT_SECRET` from GitHub secrets
