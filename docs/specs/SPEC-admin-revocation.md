# Spec: admin-revocation

Module 3 of the [authentication redesign](auth-redesign-map.md). Builds on [`server-sessions`](SPEC-server-sessions.md) and [`my-sessions`](SPEC-my-sessions.md). Issue #177.

> **Naming:** login sessions are *dispositivos* in the UI and `AuthSession` in code; "sesión" alone is the clinical one (`CLAUDE.md`).

## Objective

An ADMIN can **disconnect every device of a user of her clinic** without deactivating her — for a lost or stolen phone, a therapist who left a session open somewhere, or a suspicion of a shared password — and the platform operator can do the same for any user of any clinic. The user keeps her account and logs in again on her next attempt.

From the statement of intent: ADMIN and operator **revoke all** of someone's sessions; nobody but the user herself **sees** her session list. So this module only revokes, and does not reveal how many devices she had.

## Tech Stack, Commands, Code Style

As in `SPEC-my-sessions.md`. No new dependencies.

## Design

### API

| Route | Who | Behavior |
|---|---|---|
| `POST /api/users/:id/disconnect-devices` | ADMIN (existing `requireRole('ADMIN')` on `/api/users`) | Revokes every unrevoked `AuthSession` of that user → `204`. Not in her clinic or nonexistent → `404 {"error":"Usuario no encontrado"}`. Herself → `400 {"error":"Para desconectar tus propios dispositivos usá Mi cuenta"}`. |
| `POST /api/platform/tenants/:tenantId/users/:userId/disconnect-devices` | Platform operator | Same revocation → `204`; user not in that tenant → `404`. Writes a `platform_audit_logs` row in the same transaction. |

Both answer `204` with no count: a number of revoked sessions would tell the ADMIN how many devices the user had, which is the user's own business.

Inactive users can be disconnected too (it is a no-op today, because deactivation already revokes, but there is no reason to refuse it).

### Repository

- `userRepository.disconnectDevices(ctx, userId): Promise<'disconnected' | 'not_found'>` — in one transaction, a tenant-scoped existence check on the user (`forTenant(ctx)`, so a user of another clinic is `not_found`), then `authSession.updateMany({ where: { userId, revokedAt: null } })`. `auth_sessions` has no `tenantId`; the scoped user lookup is what proves she is in this clinic, the same way deactivation already does it.
- `platformRepository.disconnectUserDevices(op, tenantId, userId): Promise<boolean>` — explicit `tenantId` like the rest of the platform repository; existence check `{ id: userId, tenantId }`, revocation, and the audit row, in one transaction.

### Audit

- **Operator:** new `PlatformAction` value `USER_DEVICES_DISCONNECTED`, description `Desconectó los dispositivos de <email>`. Migration: `ALTER TYPE "PlatformAction" ADD VALUE`.
- **ADMIN:** not audited, consistent with today: an ADMIN changing a user's role or deactivating her is not audited either (`audit_logs` is the clinical audit of a patient, with a required `patientId`). Auditing ADMIN actions on users (and every other unaudited action) is #186.

### Web

- **Usuarios (Clínica page, `UsersCard`)**: a **Desconectar dispositivos** button on each active user other than yourself, behind a confirmation dialog — "¿Desconectar los dispositivos de <nombre>?" / "Se cierra su sesión en todos los dispositivos. Su cuenta sigue activa: puede volver a ingresar con su contraseña." Toast on success.
- **Platform tenant detail (`PlatformTenantDetailPage`)**: the same action and dialog on each user.

## Project Structure

```
apps/api/prisma/schema.prisma + migrations/<ts>_platform_action_devices_disconnected/
apps/api/src/repositories/{userRepository.ts,prisma/prismaUserRepository.ts}
apps/api/src/repositories/{platformRepository.ts,prisma/prismaPlatformRepository.ts}
apps/api/src/routes/{users.ts,platform.ts}
apps/api/tests/disconnectDevices.test.ts          new
apps/web/src/services/{users.ts,platform.ts}
apps/web/src/components/clinic/UsersCard.tsx
apps/web/src/pages/platform/PlatformTenantDetailPage.tsx
apps/web/tests/{UsersCard,PlatformTenantDetailPage}.test.tsx
```

## Testing Strategy

API (`disconnectDevices.test.ts`):

- ADMIN disconnects a therapist: all her tokens `401`; she can log in again; the ADMIN's own session and a colleague's are untouched.
- ADMIN on a user of another clinic → `404`, her sessions keep working. On herself → `400`. A THERAPIST → `403`.
- Operator disconnects a user: tokens `401`, one `USER_DEVICES_DISCONNECTED` audit row with the operator and target; wrong tenant → `404` and no audit row.
- Responses carry no count.

Web: the button appears for other active users only, the dialog confirms, and the right endpoint is called (both screens).

## Boundaries

- **Always:** tenant scoping by the user lookup in the same transaction as the revocation; the operator's audit row in the same transaction.
- **Ask first:** returning a count; letting an ADMIN see a user's devices.
- **Never:** reveal another user's sessions; deactivate the user as part of this action.

## Success Criteria

- [ ] ADMIN and operator can disconnect every device of a user without deactivating her; she can log in again.
- [ ] Cross-clinic attempts are `404` and change nothing.
- [ ] Every operator disconnection leaves an audit row; responses reveal no count.

## Decisions (approved 2026-10-05)

1. **An ADMIN disconnecting herself** gets `400` pointing to *Mi cuenta*.
2. **The ADMIN action is not audited here**; every unaudited action (ADMIN actions on users, clinic configuration, account security, remaining clinical entities) is #186 — the rule is that every action leaves an audit trail.
3. **`204` without a count** (privacy).
