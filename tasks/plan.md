# Implementation Plan: admin-revocation

Spec: [`docs/specs/SPEC-admin-revocation.md`](../docs/specs/SPEC-admin-revocation.md) (approved 2026-10-05). Module 3 of the [authentication redesign](../docs/specs/auth-redesign-map.md). Previous plans: [`PLAN-server-sessions.md`](../docs/specs/PLAN-server-sessions.md), [`PLAN-my-sessions.md`](../docs/specs/PLAN-my-sessions.md). Task checklist: [`tasks/todo.md`](todo.md).

## Overview

ADMIN and platform operator can disconnect every device of a user without deactivating her. Small module: one PR against `dev` (`feat/admin-revocation`), one commit per task, full local API suite before the push.

## Architecture Decisions

- **Vertical slices by actor.** The ADMIN path (route, repository, UsersCard) and the operator path (route, repository, audit, tenant detail page) are independent; each slice is API + web together.
- **Scoping by the user lookup.** `auth_sessions` has no `tenantId`; the tenant-scoped (ADMIN) or tenant-explicit (operator) user lookup in the same transaction is what proves the user belongs to that clinic — the same mechanism deactivation already uses.
- **Enum migration first** (`USER_DEVICES_DISCONNECTED`), in the operator task: `ALTER TYPE ... ADD VALUE` is additive and safe.

## Task List

- [x] Task 1: ADMIN disconnects a user's devices (API + Usuarios card)
- [x] Task 2: Operator disconnects a user's devices, audited (API + tenant detail page)

### Checkpoint A
- [ ] Full API suite and web suite green locally; `npm run check` clean
- [ ] Manual (skill `verify`): as ADMIN, disconnect a therapist logged in via API → her token `401`, she logs in again; as operator, same, and the audit log shows it

- [ ] Task 3: Docs (CLAUDE.md, verify skill)

### Checkpoint B: complete
- [ ] Spec success criteria met; PR against `dev` open, CI green

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| An ADMIN disconnects a user of another clinic | High | Tenant-scoped lookup in the same transaction; test asserts `404` and that her sessions keep working |
| The response leaks how many devices she had | Low | `204` with no body; test asserts it |
| Two clinics' users with the same id race | — | Ids are UUIDs; not applicable |

## Open Questions

None.
