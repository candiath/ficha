# Implementation Plan: my-sessions

Spec: [`docs/specs/SPEC-my-sessions.md`](../docs/specs/SPEC-my-sessions.md) (approved 2026-10-04). Module 2 of the [authentication redesign](../docs/specs/auth-redesign-map.md). Previous module's plan: [`docs/specs/PLAN-server-sessions.md`](../docs/specs/PLAN-server-sessions.md). Task checklist: [`tasks/todo.md`](todo.md).

## Overview

Session lifetime policy (normal vs trusted, idle + absolute), the throttled `last_used_at`, and the "Sesiones activas" screen. One PR against `dev` (`feat/my-sessions`), one commit per task. Nothing reaches `dev` until the module is done: intermediate commits may leave tests red, but each passes the pre-commit hook and the full API suite runs locally before the push.

## Architecture Decisions

- **API first, then web.** Tasks 1–4 finish the whole API contract (testable with supertest); tasks 5–7 build the web on top of it. The contract is the spec's `SessionDTO` and routes, so the web tasks do not wait on API details.
- **Policy in one module.** `lib/sessionPolicy.ts` holds every timeout, the cap and the throttle, and replaces `getSessionTtlMs()` / `SESSION_TTL_DAYS`. Repository and middleware import from it; nothing else hardcodes a duration.
- **Read side stays one query.** The idle rule joins `findSessionForAuth` as an `OR` by profile; the last-use refresh is a separate fire-and-forget conditioned write, never part of the decision.
- **Test helper grows options.** `createTestToken(user, { trusted, ttlMs, lastUsedAt })` lets tests place sessions anywhere on the timeline without waiting.
- **`sessionId` route param** registered with `router.param` in `routes/auth.ts`, as `idParamCoverage.test.ts` requires.

## Task List

### Phase 1: Policy and validation (API)
- [x] Task 1: Session policy module and the two new columns
- [x] Task 2: Idle expiry and throttled last use

### Phase 2: Trusted devices and the session list (API)
- [ ] Task 3: Trusted login with a per-user cap
- [ ] Task 4: List, close, close others, untrust

### Checkpoint A: API complete
- [ ] Every API test in the spec's Testing Strategy passes; full API suite green locally
- [ ] `npm run check` clean
- [ ] Review with Nath

### Phase 3: Web
- [ ] Task 5: User agent parser
- [ ] Task 6: "Sesiones activas" card on Mi cuenta
- [ ] Task 7: "Mantener la sesión iniciada" on the login

### Checkpoint B: end to end
- [ ] Web suite green
- [ ] Manual (skill `verify`): log in twice (one trusted), see both in the card with the right badge and device; untrust, close the other, close all others; log out from the card

### Phase 4: Docs
- [ ] Task 8: CLAUDE.md, `.env.example`, verify skill

### Checkpoint C: complete
- [ ] Spec success criteria met
- [ ] Full API and web suites green locally; PR against `dev` open, CI green

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Existing sessions (7-day, no `last_used_at`) on deploy | Low | Migration defaults `last_used_at` to now and `trusted` to false: they become normal sessions and die within the hour. No real users. |
| The idle `OR` makes the auth query slower | Low | Same row fetched by the unique `token_hash` index; the `OR` filters one row. |
| Fire-and-forget refresh fails silently | Low | Logged on failure; worst case a session idles out early. Throttle test pins the behavior. |
| Cap race: two trusted logins at once exceed 3 | Low | Demotion runs in the login transaction and keeps "newest 3 trusted"; a race can leave 4 until the next trusted login. Acceptable. |
| UA parser mislabels a browser | Low | Coarse labels, table-driven tests with real UA strings, raw string still available. |

## Open Questions

None. Spec decisions 1–6 approved.
