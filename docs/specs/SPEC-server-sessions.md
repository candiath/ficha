# Spec: server-sessions

Module 1 of the [authentication redesign](auth-redesign-map.md). Issue #177.

## Objective

Replace the clinic JWT with server-side sessions identified by an opaque token, so a single session can be revoked and every revocation takes effect on the next request.

Today the API signs a JWT (HS256, 12 h) and keeps nothing; revocation is all-or-nothing (`isActive`, `tenants.deactivated_at`, `passwordChangedAt` vs `iat`). `authenticate` already reads `users` on every request, so we pay the cost of state without its benefit. After this module:

- Login creates a row in `auth_sessions` and returns an opaque token.
- `authenticate` accepts a token only if its session is unexpired, unrevoked, and belongs to an active user of an active clinic — decided in one query.
- Logout revokes the current session on the server.
- Changing the password revokes every other session of the user; the current one keeps working.
- Deactivating a user or a clinic revokes their sessions in the same transaction, so reactivating does not resurrect old sessions.

This module adds no UI. It is the base for `my-sessions`, `admin-revocation` and `password-reset`.

## Tech Stack

Express 5, Prisma 5.22, Postgres on Neon (moving to 18 with the planned wipe), Zod 4, `node:crypto` (`randomBytes`, `createHash`). No new dependencies. `jsonwebtoken` stays until `operator-sessions` removes the last JWT.

## Commands

```
npm run dev                 # shared + api (:3001) + web (:5173)
npm run db:migrate          # generate the migration against the Neon development branch
npm test                    # API integration tests (vitest + supertest, hit the DB)
npm test -w apps/web        # web tests
npm run check               # build shared, lint and typecheck both apps (pre-commit hook)
```

## Design

### Data model

```prisma
// Named AuthSession because Session is the clinical therapy session.
model AuthSession {
  id        String    @id @default(uuid(7)) @db.Uuid
  userId    String    @map("user_id") @db.Uuid
  tokenHash Bytes     @unique @map("token_hash") // sha256(token); the token itself is never stored
  createdAt DateTime  @default(now()) @map("created_at")
  expiresAt DateTime  @map("expires_at")
  revokedAt DateTime? @map("revoked_at")
  ip        String?
  userAgent String?   @map("user_agent")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("auth_sessions")
}
```

- **No `tenantId` column.** The owner is the user; the tenant comes from the join. A copied `tenantId` could drift from `users.tenant_id`, and without the column the model needs no guard classification (`tenantScopeCoverage.test.ts` only inspects models with `tenantId`).
- `ip` and `user_agent` are captured at login now because they cannot be backfilled; `my-sessions` displays them. `last_used_at` belongs to `my-sessions`.
- `users.password_changed_at` stops being read and written. The `DROP` goes in a later release (destructive migrations take two releases).

### Token

`randomBytes(32).toString('base64url')` (43 chars, 256 bits). The DB stores `sha256(token)`; lookup is by hash, so a leaked table or backup yields no usable sessions. Transport is unchanged: `Authorization: Bearer <token>`, kept by the web in `localStorage` until `session-cookie`.

### Repository

`authRepository` stays the pre-tenant exception (no `ctx`); it gains these (and `updatePassword` is replaced by `changePassword`):

```ts
createSession(input: { userId: string; expiresAt: Date; ip: string | null; userAgent: string | null }): Promise<{ token: string }>;
findSessionForAuth(token: string): Promise<SessionAuth | null>; // hashes the raw token inside; { sessionId, userId, tenantId, role }
revokeSession(sessionId: string): Promise<boolean>;
changePassword(userId: string, passwordHash: string, keepSessionId: string): Promise<void>; // revokes every other session
```

Token generation and hashing live in `lib/sessionToken.ts`, together with `getSessionTtlMs()`, which validates `SESSION_TTL_DAYS` (positive whole days, default 7) and runs at startup in `app.ts`: a malformed value fails the deploy instead of every login.

`findSessionForAuth` is the single query that decides access:

```ts
await prisma.authSession.findFirst({
  where: {
    tokenHash,
    revokedAt: null,
    expiresAt: { gt: new Date() },
    user: { isActive: true, tenant: { deactivatedAt: null } },
  },
  select: { id: true, user: { select: { id: true, tenantId: true, role: true } } },
});
```

Writes carry their condition in the `where` (repository convention):

```ts
// revokeSession: revoking twice is a no-op, not an error.
const { count } = await prisma.authSession.updateMany({
  where: { id: sessionId, revokedAt: null },
  data: { revokedAt: new Date() },
});
return count > 0;
```

Deactivation paths revoke inside their existing transactions:

- `userRepository.update` with `isActive: false` → revoke the user's open sessions.
- `platformRepository` user update with `isActive: false` → same.
- `platformRepository` tenant deactivation → revoke open sessions of every user in the tenant.

### Why revoke on write *and* validate on read

Write-side revocation keeps the table truthful, makes "close this session" possible, and prevents a reactivated user from getting old sessions back. Read-side validation (the join) is the safety net: if a future write path forgets to revoke, access is still denied. Validating only against `auth_sessions` would turn authorization into derived state that must be invalidated by hand — a silent bug of the same kind `tenantScopeCoverage.test.ts` exists to catch.

### Routes

| Route | Change |
|---|---|
| `POST /api/auth/login` | Creates the session (absolute TTL `SESSION_TTL_DAYS`, default 7). Response shape unchanged: `{ data: { token, user } }`. |
| `POST /api/auth/logout` | **New.** Authenticated; revokes the current session; `204`. |
| `POST /api/auth/change-password` | One transaction: new hash + revoke all sessions of the user except `req.authSessionId`. Responds `204`; no new token (the current session stays valid). |
| `authenticate` middleware | Hashes the bearer token, calls `findSessionForAuth`; `null` → `401 {"error":"Sesión expirada o inválida"}` (same message for every failure). Sets `req.context = { tenantId, userId, role }` as today, plus `req.authSessionId` (typed in `types/express.d.ts`). The session id stays out of `TenantContext` because repositories never need it; only the auth routes do. |

### Web

- `AuthContext.logout` calls `POST /api/auth/logout` and clears the token whatever the result (a failed logout must not trap the user logged in locally).
- `ChangePasswordDialog` stops calling `setToken`: the response no longer carries one.
- The 401 handling in `lib/api.ts` is unchanged.

### Removed

- `apps/api/src/lib/jwt.ts`, `JWT_SECRET` (env, `.env.example`, CI secret `CI_JWT_SECRET`, `tests/setup.ts`, the startup check in `app.ts`). `JWT_ALGORITHM` moves to `platformJwt.ts`; the check that `PLATFORM_JWT_SECRET` differs from `JWT_SECRET` becomes a plain length check.
- `signTestToken` in `tests/helpers.ts` is replaced by `createTestSession(user)`, which inserts a session row and returns its token (no `/login`, so the rate limiter budget is untouched).
- `jwtAlgorithm.test.ts` keeps only the platform half until `operator-sessions`.

### Rollout

Deploying invalidates every existing JWT: everyone logs in once. Acceptable before the wipe. After deploy, remove `JWT_SECRET` from both Render services and from the CI secrets.

## Project Structure

```
apps/api/prisma/schema.prisma                          AuthSession model
apps/api/prisma/migrations/<ts>_auth_sessions/          generated, reviewed by hand
apps/api/src/lib/sessionToken.ts                        generateSessionToken(), hashSessionToken(), getSessionTtlMs()
apps/api/src/repositories/authRepository.ts             port: new methods and DTOs
apps/api/src/repositories/prisma/prismaAuthRepository.ts
apps/api/src/repositories/prisma/prismaUserRepository.ts       revoke on deactivate
apps/api/src/repositories/prisma/prismaPlatformRepository.ts   revoke on user/tenant deactivate
apps/api/src/middlewares/auth.ts
apps/api/src/routes/auth.ts                             login, logout, change-password
apps/api/tests/                                         see Testing Strategy
apps/web/src/contexts/AuthContext.tsx
apps/web/src/components/account/ChangePasswordDialog.tsx
```

## Code Style

New code in English (identifiers, comments, tests, commits); user-facing strings stay in Spanish. Follow the repository pattern in `CLAUDE.md`: not-found returns `null`/`false`, conditioned writes put the condition in the `where`, DTOs expose ISO dates and no `tenantId`.

## Testing Strategy

Integration tests (vitest + supertest against the Neon `ci` branch), in `apps/api/tests/authSessions.test.ts` unless a case clearly belongs to an existing suite:

- Login creates a session; the token authenticates; the DB holds the hash and never the token.
- Unknown token, malformed token and an old JWT → `401` with the same message.
- Expired session → `401`.
- Logout → reusing the token gives `401`; a second logout is harmless.
- Change password → another session of the same user gets `401`; the current one still works.
- Deactivate a user (ADMIN route and platform route) → `401`; reactivate → the old token is still `401`.
- Deactivate a clinic → its users' tokens get `401`.
- **Safety net:** set `users.is_active = false` directly with Prisma (no revocation) → `401`.
- `platformIsolation.test.ts`: a clinic session token is rejected by `/api/platform/*`; an operator JWT is rejected by `/api/*`.

Web (vitest + testing-library): logout calls the endpoint and clears the token even if the call fails; the change-password dialog no longer stores a token.

## Boundaries

- **Always:** keep the read-side join even where the write side revokes; one transaction for every write that also revokes; same `401` message for every authentication failure.
- **Ask first:** changing the session TTL default; adding columns beyond the model above; touching the operator's auth (that is `operator-sessions`).
- **Never:** store or log the raw token; copy `role` or `tenantId` into the session; drop `password_changed_at` in this release.

## Success Criteria

- [ ] No clinic route depends on `JWT_SECRET`; the app starts without it.
- [ ] Every test listed in Testing Strategy passes in CI.
- [ ] `auth_sessions` contains only token hashes (asserted by a test).
- [ ] Logout, password change, user deactivation and clinic deactivation take effect on the next request.
- [ ] `CLAUDE.md` updated: the `authRepository` exception mentions sessions, and the Infraestructura section lists only `PLATFORM_JWT_SECRET` among per-environment secrets.

## Decisions

1. **TTL: 7 days absolute** (was 12 h with the JWT). Longer is reasonable now that a session can be revoked individually. Until `my-sessions` adds idle expiry, a session left open on a shared clinic computer lives up to 7 days; `my-sessions` must ship idle expiry.
2. **No refresh token.** A refresh token exists to keep a non-revocable access token short-lived; here every request already checks the session in the DB, so revocation is immediate and a second token adds nothing. Sensitive account actions use **re-authentication** instead: `change-password` already requires the current password. If more actions need it later, add a `reauthenticated_at` to the session with a short validity window — a separate module, not this one.
3. **Cleanup of expired and revoked rows:** deferred to #178.
4. **Deploy-window incompatibility accepted.** Render and Netlify deploy minutes apart; if the new API (`204`, no token) talks to the old web, the old change-password dialog shows an error although the password *was* changed. Accepted: production has no real users yet (it is a dry run to verify the pipeline), and the release logs everyone out anyway.
