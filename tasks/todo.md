# Tasks: password-reset

Plan: [`tasks/plan.md`](plan.md) · Spec: [`docs/specs/SPEC-password-reset.md`](../docs/specs/SPEC-password-reset.md)

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
