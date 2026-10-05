# Spec: my-sessions

Module 2 of the [authentication redesign](auth-redesign-map.md). Builds on [`server-sessions`](SPEC-server-sessions.md) (#182). Issue #177.

> **Naming:** in the UI these are *dispositivos*; in code, `AuthSession`. "Sesión" alone is the clinical session (see `CLAUDE.md`).

## Objective

A clinic user sees where her account is logged in and closes any of those sessions, so a session left open on a shared or lost device can be ended without changing the password or asking an ADMIN.

From the statement of intent: each user sees **only her own** sessions — device and browser, IP, when it started, when it was last used — and closes the one she wants, including the current one. Nobody else (ADMIN or operator) sees this list.

This module also sets **how long a session lives**, with two profiles:

- **Normal** (default): short idle and absolute timeouts, so a session left open on a shared computer dies on its own within the hour.
- **Trusted device** ("Mantener la sesión iniciada en este dispositivo", opt-in at login): long timeouts for the user's own devices, capped at a few per user.

### Why two timeouts per session

Both OWASP and NIST require an absolute timeout on top of the idle one ([OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html); [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html) §2.1.3: "SHALL" at every level). The idle timeout kills an **abandoned** session; it does nothing against a **stolen** one, because every use by the attacker renews it. The absolute timeout caps that case. Ficha is password-only (NIST AAL1): absolute timeout no more than 30 days, idle timeout optional.

## Tech Stack

Same as `server-sessions`: Express 5, Prisma 5.22, Postgres on Neon, React 19 + TanStack Query + Base UI on the web. No new dependencies.

## Commands

```
npm test                    # API integration tests against the Neon development branch (~6 min, full suite before every push)
npm test -w apps/web        # web tests
npm run check               # lint + typecheck (pre-commit hook)
```

Migrations: `prisma migrate diff` + `migrate deploy` from `apps/api` (`migrate dev` hangs without a TTY).

## Design

### Session policy

| | Normal session | Trusted session |
|---|---|---|
| Idle timeout | 1 h | 7 days |
| Absolute timeout | 12 h (a working day) | 30 days (NIST AAL1 maximum) |
| How it starts | default login | login with "Mantener la sesión iniciada en este dispositivo" checked |
| Per user | unlimited | at most 3 |

The values live as constants in `apps/api/src/lib/authSessionPolicy.ts` (versioned policy, not deployment config). `SESSION_TTL_DAYS` from `server-sessions` is removed.

A "device" is really a session in one browser: there is no device fingerprint. Clearing browser data or switching browsers starts a new session; the cap counts trusted sessions, not machines.

### Data model

`auth_sessions` gains two columns:

```prisma
lastUsedAt DateTime @default(now()) @map("last_used_at")
trusted    Boolean  @default(false)
```

Existing rows (all from `server-sessions`, 7-day absolute) become normal sessions with `last_used_at` = migration time; their `expires_at` is left as is and they die by idle within the hour. No backfill.

### Validation (read side)

`findValidAuthSession` keeps deciding everything in one query; the idle condition depends on the profile:

```ts
where: {
  tokenHash, revokedAt: null, expiresAt: { gt: now },
  user: { isActive: true, tenant: { deactivatedAt: null } },
  OR: [
    { trusted: false, lastUsedAt: { gt: now - NORMAL_IDLE } },
    { trusted: true,  lastUsedAt: { gt: now - TRUSTED_IDLE } },
  ],
}
```

An idle session is denied exactly like an expired one (same `401`).

### Last use

`authenticate` refreshes `last_used_at` **at most once every 5 minutes** per session, with a conditioned write so concurrent requests do not pile up:

```ts
prisma.authSession.updateMany({
  where: { id: sessionId, lastUsedAt: { lt: fiveMinutesAgo } },
  data: { lastUsedAt: new Date() },
});
```

Fire-and-forget (logged on failure, never fails the request), like `touchLastLogin`. "Last used" is accurate to 5 minutes, and idle expiry can run up to 5 minutes late.

### Trusting and untrusting

- **Login** accepts `trustDevice?: boolean` (default `false`). With `true`, one transaction creates the session as trusted (30-day absolute) and, if the user now has more than 3 trusted sessions, **demotes the oldest** beyond the cap: `trusted = false` and `expires_at = least(expires_at, now + 12 h)`. A demoted session is not closed; it simply falls under the normal profile and dies within the hour if unused there.
- **Untrust** from the session list: same demotion, for one session of the user. There is no "trust this session" after login: trust is chosen when entering the password.
- `revokedAt`, idle and absolute rules apply to trusted sessions too: closing, logout, password change and deactivation revoke them like any other.

### Repository

Still `authRepository` (it owns sessions). New and changed methods, all scoped by an explicit `userId` — the same "filter by hand" exception as `tenantRepository`, since `auth_sessions` has no `tenantId`:

```ts
createAuthSession(input: { userId; trusted: boolean; ip; userAgent }): Promise<{ token: string }>; // expiry from the policy; enforces the cap in the same transaction
listAuthSessions(userId: string): Promise<AuthSessionDTO[]>;   // unrevoked, unexpired, not idle; most recently used first; capped at 50
revokeUserAuthSession(userId: string, sessionId: string): Promise<boolean>;      // condition in the where: id AND userId AND revokedAt null
revokeOtherAuthSessions(userId: string, keepSessionId: string): Promise<number>;
untrustUserAuthSession(userId: string, sessionId: string): Promise<boolean>;     // id AND userId AND trusted AND revokedAt null
```

```ts
interface AuthSessionDTO {
  id: string;
  createdAt: string;   // ISO
  lastUsedAt: string;  // ISO
  expiresAt: string;   // ISO
  trusted: boolean;
  ip: string | null;
  userAgent: string | null; // raw; parsed for display on the web
  current: boolean;    // computed by the route from req.authSessionId
}
```

Someone else's session id behaves as nonexistent (`false` → `404`): a user cannot learn whether another user's session exists.

### Routes

All behind `authenticate`; ids validated with `idParam` (UUID or 404).

| Route | Behavior |
|---|---|
| `POST /api/auth/login` | Accepts `trustDevice` (optional boolean). |
| `GET /api/auth/devices` | The user's active sessions, `current` marked. |
| `DELETE /api/auth/devices/:authSessionId` | Revokes one of the user's sessions → `204`. Someone else's or unknown → `404 {"error":"Dispositivo no encontrado"}`. Closing the current one equals logout. |
| `POST /api/auth/devices/:authSessionId/untrust` | Demotes one of the user's trusted sessions → `204`; not hers, unknown or not trusted → `404`. |
| `POST /api/auth/devices/revoke-others` | Revokes every session of the user except the current one → `200 { data: { revoked: n } }`. |

### User agent

Displayed as "Chrome en Windows", "Safari en iPhone", etc. A small parser in the web (`lib/userAgent.ts`) recognizes the common browsers (Edge, Chrome, Firefox, Safari, Opera, Samsung Internet) and systems (Windows, macOS, iPhone/iPad, Android, Linux, ChromeOS); anything else shows "Navegador desconocido". No dependency: the display only needs a coarse label, and the usual candidate (`ua-parser-js`) moved to AGPL in v2 — to be confirmed if this is ever reconsidered.

### Web

- **Login:** a checkbox "Mantener la sesión iniciada en este dispositivo", unchecked by default, with a one-line hint: "No la marques en computadoras compartidas".
- **"Dispositivos conectados" card** on *Mi cuenta*, below *Seguridad*:
  - One row per session: device label, IP, "Activo ahora" (used in the last 5 minutes) or "Última actividad hace X", "Iniciada el …", and a "De confianza" badge when trusted.
  - The current session first, marked "Este dispositivo".
  - Actions per row: **Desconectar** (the current one: **Cerrar sesión**, the normal logout) and, on trusted sessions, **Dejar de confiar**.
  - **Desconectar los demás** above the list when there is more than one session. It only revokes live sessions, so its count matches what the list showed.
  - Actions invalidate the list query; no confirmation dialogs (every action is undone by logging in again).

## Project Structure

```
apps/api/prisma/schema.prisma + migrations/<ts>_auth_sessions_last_used_trusted/
apps/api/src/lib/authSessionPolicy.ts                new: timeouts, cap, throttle (replaces getSessionTtlMs)
apps/api/src/repositories/authRepository.ts      + methods, AuthSessionDTO
apps/api/src/repositories/prisma/prismaAuthRepository.ts
apps/api/src/middlewares/auth.ts                 throttled last-use refresh
apps/api/src/routes/auth.ts                      trustDevice + session routes
apps/api/tests/myDevices.test.ts                new
packages/shared/src/index.ts                     AuthSessionDTO, LoginInput.trustDevice
apps/web/src/lib/userAgent.ts                    new
apps/web/src/services/auth.ts                    sessions calls, trustDevice
apps/web/src/pages/LoginPage.tsx                 checkbox
apps/web/src/components/account/ActiveSessionsCard.tsx   new
apps/web/src/pages/AccountPage.tsx
apps/web/tests/                                  userAgent, ActiveSessionsCard, login checkbox
```

## Code Style

New code in English; user-facing strings in Spanish. Repository conventions from `CLAUDE.md`: not found is `false`/`null`, conditions in the write's `where`, DTOs with ISO dates and no `tenantId`.

## Testing Strategy

API (`myDevices.test.ts`, against the development branch):

- **Policy:** a normal login expires in 12 h, a trusted one in 30 days. A normal session idle for more than 1 h → `401`; a trusted one idle for 2 h still works, idle for more than 7 days → `401` (timestamps set directly in the DB).
- **Cap:** a 4th trusted login demotes the oldest trusted session (it becomes normal with expiry ≤ 12 h), and the other three stay trusted.
- **List:** only the user's own active sessions (not another user's, not revoked, expired or idle), current marked.
- **Close:** another session → its token `401`, current keeps working; someone else's session (same clinic or another) → `404` and it keeps working; the current one → `401`.
- **Untrust:** demotes; someone else's or a normal session → `404`.
- **Revoke others:** every other session `401`, current works.
- **Throttle:** two requests within 5 minutes write `last_used_at` once; a stale `last_used_at` is refreshed.

Web: the user agent parser on a table of real UA strings; the login sends `trustDevice`; the card renders rows, the badge and the right action per row.

## Boundaries

- **Always:** filter by `userId` in the same query that reads or writes; the idle condition inside `findValidAuthSession`; the cap enforced in the same transaction as the login that exceeds it.
- **Ask first:** adding a UA-parsing dependency; changing the policy values once approved; showing anything about other users' sessions.
- **Never:** expose `token_hash`; let an ADMIN or the operator list someone else's sessions (`admin-revocation` only revokes all); a trusted absolute timeout above 30 days.

## Success Criteria

- [ ] A normal session dies after 1 h unused or 12 h total; a trusted one after 7 days unused or 30 days total.
- [ ] A user has at most 3 trusted sessions; exceeding the cap demotes the oldest.
- [ ] A user sees her active sessions with device, IP, start, last use and trust; she can close any (including the current), untrust a trusted one, and close all the others.
- [ ] `last_used_at` is written at most once per 5 minutes per session.
- [ ] Nobody can see, close or untrust another user's session (tests in both directions).

## Decisions (approved 2026-10-04)

1. **Policy values** as in the table: normal 1 h idle / 12 h absolute; trusted 7 days idle / 30 days absolute.
2. **Exceeding the cap of 3** demotes the oldest trusted session instead of revoking it.
3. **`last_used_at`** is written at most once every 5 minutes per session.
4. **"Desconectar los demás"** is included.
5. **In-house user agent parser**, no dependency.
6. **Policy as code constants** in `lib/authSessionPolicy.ts`; `SESSION_TTL_DAYS` is removed.
