> **Archived 2026-10-05.** Module done in #196.

# Implementation Plan: admin-revocation

Spec: [`docs/specs/SPEC-admin-revocation.md`](SPEC-admin-revocation.md) (approved 2026-10-05). Module 3 of the [authentication redesign](auth-redesign-map.md). Previous plans: [`PLAN-server-sessions.md`](PLAN-server-sessions.md), [`PLAN-my-sessions.md`](PLAN-my-sessions.md). Task checklist: below.

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

- [x] Task 3: Docs (CLAUDE.md, verify skill)

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

---

# Tasks: admin-revocation

Spec: [`docs/specs/SPEC-admin-revocation.md`](SPEC-admin-revocation.md)

Commands: `npm test` (API, Neon development branch, ~7 min) · `npm test -w apps/web` · `npm run check` (pre-commit hook). Migrations from `apps/api`: `prisma migrate diff` → `migration.sql`, then `prisma migrate deploy` and `prisma generate`.

## Task 1: ADMIN disconnects a user's devices

**Description:** `userRepository.disconnectDevices(ctx, userId)`: in one transaction, tenant-scoped user lookup, then revoke her unrevoked `auth_sessions` → `'disconnected' | 'not_found'`. Route `POST /api/users/:id/disconnect-devices` (behind the existing ADMIN guard): `204`, `404 Usuario no encontrado`, `400` for herself. Web: `usersApi.disconnectDevices`, a **Desconectar dispositivos** button on each active user other than yourself in `UsersCard`, with the spec's confirmation dialog and a toast.

**Acceptance criteria:**
- [ ] The target's tokens get `401`; she can log in again; the ADMIN's and a colleague's sessions are untouched.
- [ ] Another clinic's user → `404`, her sessions keep working; herself → `400`; a THERAPIST → `403`. The `204` has no body.
- [ ] The button shows only for other active users, confirms, and calls the endpoint.

**Verification:**
- [ ] `npx vitest run disconnectDevices users` (API) · `npx vitest run UsersCard` (web) · `npm run check`

**Dependencies:** None

**Files likely touched:** `apps/api/src/repositories/{userRepository.ts,prisma/prismaUserRepository.ts}`, `apps/api/src/routes/users.ts`, `apps/api/tests/disconnectDevices.test.ts` (new), `apps/web/src/services/users.ts`, `apps/web/src/components/clinic/UsersCard.tsx`, `apps/web/tests/UsersCard.test.tsx`

**Estimated scope:** Medium

## Task 2: Operator disconnects a user's devices, audited

**Description:** `PlatformAction.USER_DEVICES_DISCONNECTED` (migration). `platformRepository.disconnectUserDevices(op, tenantId, userId)`: in one transaction, lookup `{ id: userId, tenantId }`, revoke, audit row "Desconectó los dispositivos de <email>". Route `POST /api/platform/tenants/:tenantId/users/:userId/disconnect-devices`: `204` or `404`. Web: `platformApi` call and the same button and dialog in `PlatformTenantDetailPage`.

**Acceptance criteria:**
- [ ] The target's tokens get `401`; exactly one `USER_DEVICES_DISCONNECTED` audit row with operator and target.
- [ ] Wrong tenant → `404`, no audit row, sessions untouched.
- [ ] The platform page shows the action and calls the endpoint.

**Verification:**
- [ ] `npx vitest run disconnectDevices platform` (API) · `npx vitest run PlatformTenantDetailPage` (web) · `npm run check`

**Dependencies:** None (parallel with Task 1)

**Files likely touched:** `apps/api/prisma/schema.prisma` + migration, `apps/api/src/repositories/{platformRepository.ts,prisma/prismaPlatformRepository.ts}`, `apps/api/src/routes/platform.ts`, `apps/api/tests/disconnectDevices.test.ts`, `apps/web/src/services/platform.ts`, `apps/web/src/pages/platform/PlatformTenantDetailPage.tsx`, `apps/web/tests/PlatformTenantDetailPage.test.tsx`

**Estimated scope:** Medium

## Checkpoint A

- [ ] Full API and web suites green locally; `npm run check` clean
- [ ] Manual (skill `verify`): ADMIN and operator each disconnect a therapist logged in via API; her token `401`; the platform audit log shows the operator's action

## Task 3: Docs

**Description:** `CLAUDE.md` (operator capabilities list gains "disconnect a user's devices"; ADMIN can too), verify skill (where the buttons are).

**Acceptance criteria:**
- [ ] Both documents mention the action and its audit (operator) / pending audit (#186, ADMIN).

**Verification:**
- [ ] `npm run check`

**Dependencies:** Tasks 1–2

**Files likely touched:** `CLAUDE.md`, `.claude/skills/verify/SKILL.md`

**Estimated scope:** Small

## Checkpoint B: complete

- [ ] Spec success criteria met
- [ ] PR against `dev` open, CI green
