# Implementation Plan: server-sessions

Spec: [`docs/specs/SPEC-server-sessions.md`](../docs/specs/SPEC-server-sessions.md) (approved 2026-10-04). Module 1 of the [authentication redesign](../docs/specs/auth-redesign-map.md). Task checklist: [`tasks/todo.md`](todo.md).

## Overview

Replace the clinic JWT with opaque server-side sessions (`auth_sessions`). Delivered as one PR against `dev` (`feat/server-sessions`), one commit per task. Nothing reaches `dev` until the whole module is done, so intermediate commits may leave tests red or the app broken; each commit still passes the pre-commit hook (lint + typecheck), and the PR as a whole must be green.

## Architecture Decisions

- **Cut-over in one task, prepared by two.** Login and `authenticate` must switch together, so that task is the largest. Two tasks before it shrink it: the table and token library land first (no behavior change), and the 34 test suites move to an async token helper while it still returns a JWT. At cut-over only the helper's body changes, not 34 files.
- **No interim behavior.** Since intermediate commits need not work, `change-password` goes straight from the JWT version to its final form in Task 5; between Tasks 3 and 5 it is simply broken.
- **`req.authSessionId`, not `req.context.sessionId`.** `TenantContext` is what repositories receive; they never need the session id. Only the auth routes do.
- **IP and user agent come from the same source as `login_events`** (`req.ip` with `trust proxy`, `req.get('user-agent')`), reusing the loginGuard approach.
- **`password_changed_at` is left in place.** It stops being read at cut-over (Task 3) and stops being written in Task 5; its `DROP` goes in a later release (destructive migrations take two releases). A follow-up issue tracks it.

## Task List

### Phase 1: Foundation
- [x] Task 1: `auth_sessions` table and token library
- [x] Task 2: Async test token helper (mechanical)

### Phase 2: Cut-over
- [x] Task 3: Login issues sessions; `authenticate` validates them

### Checkpoint A: after Tasks 1–3
- [x] `npm test` green except `changePassword.test.ts` (expected until Task 5); `npm run check` clean
- [x] Manual (skill `verify`): log in on the web, navigate, reload; a row appears in `auth_sessions` with a hash and no raw token
- [ ] Review with Nath before continuing

### Phase 3: Revocation paths
- [x] Task 4: Logout revokes the current session
- [x] Task 5: Change password keeps the current session (`204`)
- [x] Task 6: Deactivating a user or a clinic revokes their sessions

### Checkpoint B: after Tasks 4–6
- [x] All spec tests listed under Testing Strategy pass
- [x] Manual: two browsers logged in as the same user; change the password in one, the other is sent to login; logout in one leaves the other alive

### Phase 4: Removal
- [ ] Task 7: Remove the clinic JWT and `JWT_SECRET`

### Checkpoint C: complete
- [ ] Spec success criteria met; `CLAUDE.md` updated
- [ ] PR open against `dev`; CI green
- [ ] After merge and deploy: remove `JWT_SECRET` from both Render services and the `CI_JWT_SECRET` GitHub secret (manual)

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Cut-over breaks every suite at once | High | Task 2 isolates the mechanical helper migration; Task 3 changes only the helper body for existing suites |
| Login gains a DB write; CI against Neon already runs ~1 s per login | Med | One `INSERT` in the same round trip budget; watch the login-heavy suites' timeouts in Task 3 |
| A write path that cuts access forgets to revoke | Med | The read-side join denies access anyway; Task 6 has a test that deactivates without revoking |
| `Bytes` (`bytea`) handling for `token_hash` in Prisma | Low | Task 1 unit-tests hash round-trip and the unique lookup |
| Deploy logs everyone out | Low | Accepted: production has no real users |
| Task 7 edits the CI workflow (spec: "ask first") | Low | Change is limited to removing `JWT_SECRET`; called out in the PR |

## Open Questions

None blocking. Follow-ups to file during the work: `DROP password_changed_at` (next release).
