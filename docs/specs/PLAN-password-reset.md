> **Archived 2026-10-09.** Module done in #198.

# Implementation Plan: password-reset

Spec: [`docs/specs/SPEC-password-reset.md`](SPEC-password-reset.md) (approved 2026-10-05). Module 4 of the [authentication redesign](auth-redesign-map.md). Previous plans: [`PLAN-server-sessions.md`](PLAN-server-sessions.md), [`PLAN-my-sessions.md`](PLAN-my-sessions.md), [`PLAN-admin-revocation.md`](PLAN-admin-revocation.md). Task checklist: below.

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
- [x] Generate as ADMIN → old sessions and password dead → check → reset → login with the new password; full API suite green

### Phase 2: Remaining API
- [x] Task 3: Operator generation, audited
- [x] Task 4: Pending reset in the user lists

### Phase 3: Web
- [x] Task 5: Generate action, link dialog and pending badge (Usuarios and platform page)
- [x] Task 6: Public page `/restablecer-contrasena` and the message on `/login`

### Checkpoint B: end to end
- [ ] Full API and web suites green; `npm run check` clean
- [ ] Manual (skill `verify`): ADMIN generates a link for a therapist logged in elsewhere → her session dies; the link opens in a private window, sets the password, lands on `/login`, she logs in; the link fails a second time; the badge appears and disappears

### Phase 4: Docs
- [x] Task 7: `CLAUDE.md` and verify skill

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

---

# Tasks: password-reset

Plan: [`tasks/plan.md`](plan.md) · Spec: [`docs/specs/SPEC-password-reset.md`](SPEC-password-reset.md)

Commands: `npm test` (API, Neon development branch, ~8 min) · `npm test -w apps/web` · `npm run check` (pre-push hook). Migrations from `apps/api`: `prisma migrate diff` → `migration.sql`, then `prisma migrate deploy` and `prisma generate`.

## Task 1: Reset-link table and ADMIN generation

**Description:** Model `PasswordResetToken` (`password_reset_tokens`, spec *Data*) and its migration; generalize `lib/authSessionToken.ts` into `lib/opaqueToken.ts`, used by both. `userRepository.createPasswordReset(ctx, userId, { ip, userAgent })` → `{ ok: true, token, expiresAt } | { ok: false, reason: 'not_found' | 'inactive' }`: in one transaction, tenant-scoped lookup, invalidate her unused links, insert the new one (hash, 24 h, `created_by_user_id`, IP, user agent), replace her password hash with a bcrypt hash of random bytes, revoke her sessions. Route `POST /api/users/:id/password-reset`: `201 { data: { token, expiresAt } }` with `Cache-Control: no-store`; `404`, `409` inactive, `400` herself.

**Acceptance criteria:**
- [ ] After generation the user's tokens get `401` and her old password fails at login with the standard `401`; an earlier unused link is invalidated.
- [ ] Another clinic's user → `404` and nothing changes (sessions, hash, links); inactive → `409`, nothing changes; herself → `400`; another ADMIN → `201`; a THERAPIST → `403`.
- [ ] Only the SHA-256 is stored; the row has the generator, IP and user agent; the stored password hash is a valid bcrypt hash.

**Verification:** `npx vitest run passwordReset opaqueToken` · `npm run check`

**Dependencies:** None

**Files likely touched:** `apps/api/prisma/schema.prisma` + migration, `apps/api/src/lib/opaqueToken.ts` (was `authSessionToken.ts`), `apps/api/src/repositories/{userRepository.ts,prisma/prismaUserRepository.ts}`, a shared Prisma helper for the generation writes, `apps/api/src/routes/users.ts`, `apps/api/tests/passwordReset.test.ts` (new)

**Estimated scope:** Medium

## Task 2: Public check and reset

**Description:** `authRepository.checkPasswordReset(token)` → `{ email, name } | null` and `authRepository.resetPassword(token, passwordHash, { ip, userAgent })` → `boolean`: one conditioned transaction (link unused, not invalidated, not expired, user and clinic active, in the `where`) that sets the hash, marks the link used with IP and user agent, invalidates her other links and revokes her sessions. Routes `POST /api/auth/password-reset/check` and `POST /api/auth/password-reset` (token in the body, `PasswordSchema`), each behind its own `createLoginLimiter()`; uniform `400 El enlace no es válido o ya venció`.

**Acceptance criteria:**
- [ ] A valid link sets the password; she logs in with it; the same link again → `400`; two concurrent uses → exactly one `204`.
- [ ] Expired, invalidated, unknown, deactivated-user and deactivated-clinic links → the same `400`, and the password is unchanged.
- [ ] `check` returns email and name only for a valid link; neither route accepts the token outside the body; `errorHandler` does not log request bodies.

**Verification:** `npx vitest run passwordReset` · `npm run check`

**Dependencies:** Task 1

**Files likely touched:** `apps/api/src/repositories/{authRepository.ts,prisma/prismaAuthRepository.ts}`, `apps/api/src/routes/auth.ts`, `apps/api/tests/passwordReset.test.ts`

**Estimated scope:** Medium

## Checkpoint A: the flow works through the API

- [ ] Generate → old sessions and password dead → check → reset → login with the new password, in one test
- [ ] Full API suite green

## Task 3: Operator generation, audited

**Description:** `PlatformAction.PASSWORD_RESET_LINK_CREATED` (migration). `platformRepository.createUserPasswordReset(op, tenantId, userId, { ip, userAgent })`, reusing Task 1's helper with `created_by_operator_id`, plus the audit row "Generó un enlace para restablecer la contraseña de <email>" in the same transaction. Route `POST /api/platform/tenants/:tenantId/users/:userId/password-reset`: `201`, `404`, `409`.

**Acceptance criteria:**
- [ ] Same effects as the ADMIN's; exactly one audit row with operator and target.
- [ ] Wrong tenant → `404`, inactive → `409`: no audit row, nothing changes.

**Verification:** `npx vitest run passwordReset platform` · `npm run check`

**Dependencies:** Task 1

**Files likely touched:** `apps/api/prisma/schema.prisma` + migration, `apps/api/src/repositories/{platformRepository.ts,prisma/prismaPlatformRepository.ts}`, `apps/api/src/routes/platform.ts`, `packages/shared/src/index.ts` (`PlatformAction`), `apps/api/tests/passwordReset.test.ts`

**Estimated scope:** Medium

## Task 4: Pending reset in the user lists

**Description:** `TenantUserDTO` / `PlatformUserDTO` (and `TenantUser` / `PlatformUser` in `packages/shared`) gain `passwordResetExpiresAt: string | null` — the expiry of her valid link, computed in both list queries.

**Acceptance criteria:**
- [ ] Present while a valid link exists; `null` once it is used, invalidated or expired, and for users who never had one.
- [ ] No token or hash in any list response.

**Verification:** `npx vitest run passwordReset users platform` · `npm run check`

**Dependencies:** Tasks 1–2

**Files likely touched:** `apps/api/src/repositories/{userRepository.ts,prisma/prismaUserRepository.ts,platformRepository.ts,prisma/prismaPlatformRepository.ts}`, `packages/shared/src/index.ts`, `apps/api/tests/passwordReset.test.ts`

**Estimated scope:** Small

## Task 5: Generate action, link dialog and pending badge

**Description:** `usersApi.createPasswordReset` and `platformTenantsApi.createUserPasswordReset`. A shared component for the two dialogs (confirm with the effects; then the link, built from `window.location.origin`, shown once with a copy button and its expiry). **Restablecer contraseña** on each active user other than yourself in `UsersCard` and on each active user in `PlatformTenantDetailPage`; the "Restablecimiento pendiente · vence <fecha>" badge on both lists; the list refreshes after generating.

**Acceptance criteria:**
- [ ] The action shows only where the spec says; confirming calls the right endpoint; the link dialog shows `<origin>/restablecer-contrasena#<token>` and copies it.
- [ ] Closing the link dialog does not show the link again; the badge appears for users with `passwordResetExpiresAt`.

**Verification:** `npx vitest run UsersCard PlatformTenantDetailPage PasswordReset` (web) · `npm run check`

**Dependencies:** Tasks 1, 3, 4

**Files likely touched:** `apps/web/src/services/{users.ts,platform.ts}`, `apps/web/src/components/clinic/PasswordResetDialogs.tsx` (new), `apps/web/src/components/clinic/UsersCard.tsx`, `apps/web/src/pages/platform/PlatformTenantDetailPage.tsx`, `apps/web/tests/{UsersCard,PlatformTenantDetailPage,PasswordResetDialogs}.test.tsx`

**Estimated scope:** Medium

## Task 6: Public page and the message on /login

**Description:** Route `/restablecer-contrasena` outside the authenticated layout. The page reads the token from `location.hash`, removes it with `history.replaceState`, calls `check` (invalid → the uniform message and "pedile un enlace nuevo a quien te lo envió"), shows "Nueva contraseña para <email>" with password and confirmation, submits, and navigates to `/login` with "Listo, ya podés ingresar con tu contraseña nueva".

**Acceptance criteria:**
- [ ] The fragment is cleared from the address bar on load; the token never goes into a query string.
- [ ] Mismatched confirmation and short passwords are caught before submitting; an API `400` shows its message.
- [ ] Success lands on `/login` with the message.

**Verification:** `npx vitest run ResetPasswordPage LoginPage` (web) · `npm run check`

**Dependencies:** Task 2

**Files likely touched:** `apps/web/src/App.tsx`, `apps/web/src/pages/ResetPasswordPage.tsx` (new), `apps/web/src/pages/LoginPage.tsx`, `apps/web/src/services/auth.ts`, `apps/web/tests/{ResetPasswordPage,LoginPage}.test.tsx`

**Estimated scope:** Medium

## Checkpoint B: end to end

- [ ] Full API and web suites green; `npm run check` clean
- [ ] Manual (skill `verify`), as described in the plan

## Task 7: Docs

**Description:** `CLAUDE.md` (the reset flow under the `authRepository` exception: what generation does, single use, token only in bodies and the fragment, the evidence columns for #186; the operator's capabilities gain it), verify skill (how to generate and use a link locally).

**Acceptance criteria:**
- [ ] Both documents describe the flow and where the evidence lives.

**Verification:** `npm run check`

**Dependencies:** Tasks 1–6

**Files likely touched:** `CLAUDE.md`, `.claude/skills/verify/SKILL.md`

**Estimated scope:** Small

## Checkpoint C: complete

- [ ] Spec success criteria met
- [ ] PR against `dev` open, CI green
