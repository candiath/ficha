# Spec: operator-sessions

Module of the [authentication redesign](auth-redesign-map.md) (issue #177). **Status: draft, awaiting approval.**

## Objective

Move the platform operator off its JWT onto server-side sessions, the same scheme the clinic uses since `server-sessions`, in a table of its own. After this module:

- The operator's login creates a row in `platform_operator_sessions` and returns an opaque token.
- `authenticateOperator` accepts a token only if its session is unrevoked, within its idle and absolute timeouts, and belongs to an active operator — decided in one query.
- Logout revokes the session on the server; today it only clears the browser.
- Changing the password revokes every other session of the operator; the current one keeps working and no new token is issued.
- `PLATFORM_JWT_SECRET`, `lib/platformJwt.ts` and the `jsonwebtoken` dependency go away: the system has no JWT left.

Why it matters more for the operator than for anyone: hers is the most powerful account in the system, and today its token lives in the same origin's `localStorage` as the clinic's, so an XSS in the clinic app can read it. Its 2 h lifetime is the only bound on the damage, because it cannot be revoked. A session can.

No new screen. The web changes only in what logout and change-password do.

## Tech Stack, Commands, Code Style

As in [`SPEC-server-sessions.md`](SPEC-server-sessions.md): Express 5, Prisma 5.22, Postgres on Neon, Zod 4, `node:crypto`. No new dependencies; one removed (`jsonwebtoken`, with `@types/jsonwebtoken`). Commands: `npm test`, `npm test -w apps/web`, `npm run check`; migrations with `prisma migrate diff` + `migrate deploy` (`migrate dev` hangs without a TTY).

## Design

### Data

```prisma
// The operator's login sessions. A table of its own and not a nullable
// operatorId on auth_sessions: the two populations never share a query, a
// row, or a code path (isolation of #153).
model PlatformOperatorSession {
  id         String    @id @default(uuid(7)) @db.Uuid
  operatorId String    @map("operator_id") @db.Uuid
  tokenHash  Bytes     @unique @map("token_hash") // sha256(token)
  createdAt  DateTime  @default(now()) @map("created_at")
  expiresAt  DateTime  @map("expires_at")        // absolute timeout
  lastUsedAt DateTime  @default(now()) @map("last_used_at")
  revokedAt  DateTime? @map("revoked_at")
  ip         String?
  userAgent  String?   @map("user_agent")

  operator PlatformOperator @relation(fields: [operatorId], references: [id], onDelete: Cascade)

  @@index([operatorId])
  @@map("platform_operator_sessions")
}
```

- No `tenantId`, so no guard classification (`tenantScopeCoverage.test.ts` only inspects models with one).
- No `trusted` column: the operator has one profile (below).
- `ip` and `user_agent` are captured at login, as for the clinic: there is no screen to list them yet, but they cannot be backfilled, and they are what an audit of "who used the operator account from where" would read.
- `platform_operators.password_changed_at` stops being read and written. Its `DROP` goes in a later release (destructive migrations take two releases).

### Token

The same generator as clinic sessions and reset links: `generateOpaqueToken()` / `hashOpaqueToken()` from `lib/opaqueToken.ts` (`randomBytes(32)`, base64url, 43 characters; only the SHA-256 is stored). Transport unchanged: `Authorization: Bearer`, and the web keeps it in `localStorage` under `ficha_platform_token` until `session-cookie`.

**Isolation** no longer rests on two secrets but on two tables: an operator token's hash is looked up only in `platform_operator_sessions`, a clinic token's only in `auth_sessions`. Both are 256 random bits, so a hash of one cannot exist in the other table. `platformIsolation.test.ts` keeps proving both directions with real tokens of each kind.

### Lifetime

One profile, as code constants in `lib/authSessionPolicy.ts` next to the clinic's:

```ts
// The operator: "log in, do one thing, leave". Short idle so a session left
// open dies quickly; the absolute keeps today's 2 h JWT lifetime.
export const OPERATOR_SESSION: AuthSessionProfile = { idleMs: 30 * MINUTE, absoluteMs: 2 * HOUR };
```

`last_used_at` is written at most every `LAST_USED_THROTTLE_MS` (5 minutes), as for the clinic, so idle expiry can fire up to 5 minutes late.

### Repository

`platformRepository` already holds the operator's pre-auth reads (`findOperatorByEmailForLogin`, `findOperatorForAuth`); the session methods join them, and `findOperatorForAuth` and `updateOperatorPassword` go away:

```ts
createOperatorSession(input: { operatorId: string; ip: string | null; userAgent: string | null }): Promise<{ token: string }>;
// One query: session unrevoked, unexpired, not idle, operator active.
findValidOperatorSession(token: string): Promise<{ operatorSessionId: string; operatorId: string; lastUsedAt: Date } | null>;
touchOperatorSession(operatorSessionId: string): Promise<void>;          // throttled last_used_at
revokeOperatorSession(operatorSessionId: string): Promise<boolean>;      // logout
// New hash + revoke every other session of hers, in one transaction.
changeOperatorPassword(operatorId: string, passwordHash: string, keepSessionId: string): Promise<void>;
```

### API

| Route | Today | After |
|---|---|---|
| `POST /api/platform/auth/login` | `{ token, operator }`, JWT | Same shape; opaque token, a session row |
| `POST /api/platform/auth/logout` | — | **New.** Revokes the current session. `204` |
| `POST /api/platform/auth/change-password` | `{ data: { token } }`, a new JWT | `204`: the current session survives, the rest are revoked (as `/api/auth/change-password`) |
| `GET /api/platform/auth/me` | | Unchanged |

`authenticateOperator` sets `req.operator = { operatorId, operatorSessionId }`. Its `401` messages stay as they are.

**Deactivating an operator** has no route today (it is done in SQL); the `isActive` join in `findValidOperatorSession` is what cuts her sessions on the next request. Whoever deactivates one by hand should also revoke her sessions, and the docs say so.

### Removals

- `lib/platformJwt.ts`, `tests/platformJwt.test.ts`, `tests/jwtAlgorithm.test.ts`, and the `getPlatformJwtSecret()` startup check in `app.ts`.
- `jsonwebtoken` and `@types/jsonwebtoken` from `apps/api/package.json`.
- `PLATFORM_JWT_SECRET` and `PLATFORM_JWT_EXPIRES_IN` from `.env.example`, `tests/setup.ts`, `README.md`, `docs/infra.md`, `CLAUDE.md` and the verify skill.
- Test helper `signOperatorTestToken` becomes `createOperatorTestSession` (a real row, like `createTestToken` for the clinic).
- **After the deploy**, the `PLATFORM_JWT_SECRET` env var on both Render services is dead; removing it is a manual step listed in the PR (decision 2).

### Web

- Logout calls `POST /api/platform/auth/logout` and then clears the token; a network error still clears it (the session dies on its own within 30 minutes).
- Change password no longer stores a new token: the current one keeps working.

### Rollout

Deploying invalidates every outstanding operator JWT: the operator logs in again once. No data migration.

## Testing Strategy

Vitest + supertest against Neon, in `tests/operatorSessions.test.ts` (new) plus the existing `platform*.test.ts`:

- Login creates a session row with the hash, IP and user agent; the token works on `/api/platform/*`.
- Logout: that token gets `401`; another session of hers keeps working.
- Change password: other sessions `401`, the current one `200`; the old password fails at login.
- Idle (31 min since last use) and absolute (past `expiresAt`) → `401`; a deactivated operator → `401`.
- `last_used_at` is refreshed only after the throttle window.
- Isolation, both ways, with real tokens: an operator token on `/api/patients` → `401`, a clinic token on `/api/platform/tenants` → `401`.
- `grep -r jsonwebtoken apps/api/src` finds nothing.

Web: logout calls the API and clears the token even when the call fails; change-password does not touch the stored token.

## Boundaries

- **Always:** only the hash is stored; access is decided in one query with the operator's `isActive` in the `where`; lifetimes are code constants.
- **Ask first:** sharing a table or a code path with clinic sessions; a "trusted device" for the operator; letting the operator see or close clinic users' sessions.
- **Never:** log a token; issue a JWT anywhere.

## Success Criteria

- [ ] No JWT left in the system: `jsonwebtoken` is not a dependency and `PLATFORM_JWT_SECRET` is read nowhere.
- [ ] Operator logout and password change revoke on the server, as for the clinic.
- [ ] An operator session dies after 30 minutes idle or 2 hours, whichever comes first.
- [ ] `platformIsolation.test.ts` passes with real tokens of both kinds.
- [ ] `CLAUDE.md`, `README.md`, `docs/infra.md` and the verify skill no longer mention `PLATFORM_JWT_SECRET`.

## Open Questions

1. **Lifetime.** Proposed: 30 min idle / 2 h absolute. Today it is 2 h absolute and nothing else. Shorter idle means logging in again after a coffee break; it is the most powerful account, so I recommend it.
2. **`PLATFORM_JWT_SECRET` on Render.** After the deploy it is unused. I can remove it from `ficha-staging` and `Ficha` through the Render MCP (each with your approval), or you remove it from the dashboard. Leaving it costs nothing but confuses whoever reads the env later.
