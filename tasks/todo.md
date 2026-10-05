# Tasks: my-sessions

Plan: [`tasks/plan.md`](plan.md) · Spec: [`docs/specs/SPEC-my-sessions.md`](../docs/specs/SPEC-my-sessions.md)

Commands: `npm test` (API, Neon development branch, ~6 min) · `npm test -w apps/web` · `npm run check` (pre-commit hook). Migrations from `apps/api`: `prisma migrate diff` → `migration.sql`, then `prisma migrate deploy` and `prisma generate`.

## Task 1: Session policy module and the two new columns

**Description:** Add `last_used_at` (`NOT NULL DEFAULT now()`) and `trusted` (`DEFAULT false`) to `auth_sessions`. Create `lib/authSessionPolicy.ts` with the normal/trusted idle and absolute timeouts, the cap (3) and the throttle (5 min); remove `getSessionTtlMs()` and its startup call. `createAuthSession` takes `trusted` and computes `expires_at` from the policy (login still always creates normal sessions until Task 3). `createTestToken` gains `{ trusted, ttlMs, lastUsedAt }`.

**Acceptance criteria:**
- [x] Migration applied to development; no drift between schema and DB.
- [x] A login creates a normal session expiring in 12 h (the 7-day assertion in `authSessions.test.ts` updated).
- [x] `SESSION_TTL_DAYS` no longer read anywhere.

**Verification:**
- [x] `npx vitest run sessionToken authSessions` · `npm run check`

**Dependencies:** None

**Files likely touched:** `apps/api/prisma/schema.prisma`, new migration, `apps/api/src/lib/authSessionPolicy.ts` (new), `apps/api/src/lib/authSessionToken.ts`, `apps/api/src/app.ts`, `apps/api/src/repositories/{authRepository.ts,prisma/prismaAuthRepository.ts}`, `apps/api/src/routes/auth.ts`, `apps/api/tests/{helpers.ts,authSessionToken.test.ts,authSessions.test.ts}`

**Estimated scope:** Medium

## Task 2: Idle expiry and throttled last use

**Description:** `findValidAuthSession` adds the idle condition as an `OR` by profile and returns `lastUsedAt`. `authenticate` fires a conditioned `updateMany` (`lastUsedAt < now - 5 min`) after a successful lookup, logging failures.

**Acceptance criteria:**
- [x] Normal session idle > 1 h → `401`; trusted session idle 2 h → `200`; trusted idle > 7 days → `401`.
- [x] Two requests within 5 minutes write `last_used_at` once; a stale value is refreshed.

**Verification:**
- [x] `npx vitest run authenticate mySessions` · `npm run check`

**Dependencies:** Task 1

**Files likely touched:** `apps/api/src/repositories/prisma/prismaAuthRepository.ts`, `apps/api/src/repositories/authRepository.ts`, `apps/api/src/middlewares/auth.ts`, `apps/api/tests/myDevices.test.ts` (new)

**Estimated scope:** Small

## Task 3: Trusted login with a per-user cap

**Description:** `LoginSchema` accepts `trustDevice` (optional boolean; shared `LoginInput` updated). `createAuthSession` with `trusted: true` creates a 30-day session and, in the same transaction, demotes trusted sessions beyond the newest 3 (`trusted = false`, `expires_at = least(expires_at, now + 12 h)`).

**Acceptance criteria:**
- [x] `trustDevice: true` → trusted session, 30-day expiry; absent or `false` → normal, 12 h.
- [x] A 4th trusted login demotes exactly the oldest trusted session; it keeps working as normal; the other three stay trusted.
- [x] Non-boolean `trustDevice` → `400`.

**Verification:**
- [x] `npx vitest run mySessions authSessions login` · `npm run check`

**Dependencies:** Task 1

**Files likely touched:** `apps/api/src/routes/auth.ts`, `apps/api/src/repositories/prisma/prismaAuthRepository.ts`, `apps/api/src/repositories/authRepository.ts`, `packages/shared/src/index.ts`, `apps/api/tests/myDevices.test.ts`

**Estimated scope:** Medium

## Task 4: List, close, close others, untrust

**Description:** Repository methods `listAuthSessions`, `revokeUserAuthSession`, `revokeOtherAuthSessions`, `untrustUserAuthSession` (all filtered by `userId` in the same query). Routes `GET /api/auth/devices`, `DELETE /api/auth/devices/:authSessionId`, `POST /api/auth/devices/revoke-others`, `POST /api/auth/devices/:authSessionId/untrust`; `router.param('authSessionId', idParam('Dispositivo no encontrado'))`. `AuthSessionDTO` in `packages/shared`.

**Acceptance criteria:**
- [x] The list has only the user's active sessions, most recently used first, current marked, no `tokenHash`.
- [x] Closing another session → its token `401`, current works; the current one → `401`; someone else's (same clinic and another clinic) → `404` and it keeps working.
- [x] Revoke-others → others `401`, current works, `{ revoked: n }`.
- [x] Untrust demotes; someone else's or a normal session → `404`.

**Verification:**
- [x] `npx vitest run mySessions idParamCoverage` · `npm run check`

**Dependencies:** Tasks 2, 3

**Files likely touched:** `apps/api/src/routes/auth.ts`, `apps/api/src/repositories/{authRepository.ts,prisma/prismaAuthRepository.ts}`, `packages/shared/src/index.ts`, `apps/api/tests/myDevices.test.ts`

**Estimated scope:** Medium

## Checkpoint A: API complete

- [x] Full API suite green locally (`npm test`); `npm run check` clean
- [x] Review with Nath

## Task 5: User agent parser

**Description:** `apps/web/src/lib/userAgent.ts`: `describeUserAgent(ua: string | null): string` → "Chrome en Windows", "Safari en iPhone", … or "Navegador desconocido". Order matters (Edge and Opera before Chrome; Chrome before Safari).

**Acceptance criteria:**
- [x] Table-driven test with real UA strings for each browser × system in the spec, plus null and garbage.

**Verification:**
- [x] `npx vitest run userAgent` (web) · `npm run check`

**Dependencies:** None

**Files likely touched:** `apps/web/src/lib/userAgent.ts`, `apps/web/tests/userAgent.test.ts`

**Estimated scope:** Small

## Task 6: "Dispositivos conectados" card on Mi cuenta

**Description:** `authApi` gains `listSessions`, `closeSession`, `closeOtherSessions`, `untrustSession`. `ActiveSessionsCard` renders the list (device label, IP, activity, start, "De confianza" badge, current first as "Esta sesión") with **Cerrar** / **Cerrar sesión** / **Dejar de confiar** and **Cerrar las demás**; actions invalidate the query; closing the current one calls the normal `logout`.

**Acceptance criteria:**
- [x] Rows, badge and per-row actions render from a mocked list.
- [x] Each button calls the right endpoint; **Cerrar sesión** runs `logout`.
- [x] "Cerrar las demás" only with more than one session.

**Verification:**
- [x] `npx vitest run ActiveSessionsCard` (web) · `npm run check`

**Dependencies:** Tasks 4, 5

**Files likely touched:** `apps/web/src/services/auth.ts`, `apps/web/src/components/account/ActiveSessionsCard.tsx` (new), `apps/web/src/pages/AccountPage.tsx`, `apps/web/tests/ActiveSessionsCard.test.tsx`

**Estimated scope:** Medium

## Task 7: "Mantener la sesión iniciada" on the login

**Description:** A checkbox on `LoginPage`, unchecked by default, hint "No la marques en computadoras compartidas"; `login` sends `trustDevice`.

**Acceptance criteria:**
- [x] Unchecked → request without `trustDevice: true`; checked → `trustDevice: true`.

**Verification:**
- [x] `npm test -w apps/web` · `npm run check`

**Dependencies:** Task 3

**Files likely touched:** `apps/web/src/pages/LoginPage.tsx`, `apps/web/src/contexts/AuthContext.tsx`, `apps/web/src/services/auth.ts`, a web test

**Estimated scope:** Small

## Checkpoint B: end to end

- [x] Web suite green
- [x] Manual (skill `verify`): two logins (one trusted) visible in the card with badge and device; untrust, close the other, close all others; log out from the card

## Task 8: CLAUDE.md, `.env.example`, verify skill

**Description:** Document the session policy (two profiles, cap, throttle) next to the sessions paragraph in `CLAUDE.md`; remove `SESSION_TTL_DAYS` from `.env.example`; mention the card and the trusted checkbox in the verify skill.

**Acceptance criteria:**
- [ ] No reference to `SESSION_TTL_DAYS` left outside archived docs.

**Verification:**
- [ ] `grep -r SESSION_TTL_DAYS` · `npm run check`

**Dependencies:** Tasks 1–7

**Files likely touched:** `CLAUDE.md`, `apps/api/.env.example`, `.claude/skills/verify/SKILL.md`

**Estimated scope:** Small

## Checkpoint C: complete

- [ ] Spec success criteria met
- [ ] Full API and web suites green locally; PR against `dev` open, CI green
