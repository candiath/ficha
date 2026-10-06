# Spec: password-reset

> **DRAFT, awaiting approval.** Written 2026-10-05; the first four open questions were answered the same day (see *Decisions*).

Module 4 of the [authentication redesign](auth-redesign-map.md). Builds on [`server-sessions`](SPEC-server-sessions.md); sits next to [`admin-revocation`](SPEC-admin-revocation.md). Issue #177.

> **Naming:** login sessions are *dispositivos* in the UI and `AuthSession` in code; "sesión" alone is the clinical one (`CLAUDE.md`).

## Objective

A user who forgot her password, or whose password may be compromised, gets back into her account **without anyone learning or choosing her new password**. Until the mailer exists, an ADMIN of her clinic (or the platform operator) generates a **single-use link** and hands it to her by another channel; she opens it and sets a new password herself.

From the statement of intent (2026-10-04):

- An ADMIN or the operator generates the link; it lasts **24 h** and can be used **once**.
- **Generating it** already revokes every session of the user, disables her current password and invalidates earlier unused links: if the account is compromised, the attacker is out from that moment, not when she gets around to using the link.
- A public page sets the new password, with its own rate limit.
- The mailer, self-service reset ("olvidé mi contraseña" on the login page) and a password policy (#148) are out of scope.

## Tech Stack, Commands, Code Style

As in `SPEC-my-sessions.md`. No new dependencies.

## Design

### Data

New table `password_reset_tokens`:

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` (v7) | |
| `user_id` | `uuid` → `users` | `ON DELETE CASCADE` |
| `token_hash` | `bytea`, unique | SHA-256 of the token, like `auth_sessions`: a leaked table or backup yields no usable link |
| `created_at` | timestamptz | |
| `expires_at` | timestamptz | `created_at + 24 h` |
| `used_at` | timestamptz, null | set when the password is changed with it |
| `invalidated_at` | timestamptz, null | set when a newer link is generated, or the password changes another way |
| `created_by_user_id` | `uuid` → `users`, null | the ADMIN who generated it (`SET NULL`) |
| `created_by_operator_id` | `uuid` → `platform_operators`, null | or the operator (`SET NULL`) |
| `created_ip`, `created_user_agent` | text, null | where the link was generated |
| `used_ip`, `used_user_agent` | text, null | where it was used |

The four network columns exist for one reason (decision 4): to leave evidence if an ADMIN **impersonates** a user by opening the link herself. A link generated and used from the same IP and browser is the trace of that. It can be evaded (another network, another browser), but not without some technical knowledge, and this is the only moment the data exists: it cannot be backfilled later. They are personal data, so their retention follows the audit retention decision in #186 (requirement 7). Reading and showing them is #186's job, not this module's.

No `tenant_id` (the owner is the user, as in `auth_sessions`): classified outside the guard like `AuthSession` and checked by `tenantScopeCoverage.test.ts` only if it gains one. Lives in `authRepository` (the token is consumed before any tenant context exists) plus one method each in `userRepository` (ADMIN) and `platformRepository` (operator) to generate it.

The token: `randomBytes(32)` base64url, the same generator as `AuthSession` (`lib/authSessionToken.ts`, generalized). A link is valid if its hash matches a row that is unused, not invalidated and not expired, **and** the user and her clinic are active — decided in one query, like `authenticate`.

### Disabling the current password

On generation, `users.password_hash` is replaced by a **bcrypt hash of random bytes** (cost 10), not by an empty or sentinel value. Login keeps running bcrypt against a real hash, so it takes the same time and gives the same `401 Email o contraseña incorrectos` as any wrong password: whether an account is in the middle of a reset is not observable from the login (issue #71's timing lesson).

### API

| Route | Who | Behavior |
|---|---|---|
| `POST /api/users/:id/password-reset` | ADMIN | In one transaction: tenant-scoped user lookup, invalidate her unused links, insert the new one, disable her password, revoke her sessions. → `201 { data: { token, expiresAt } }`, `Cache-Control: no-store`. Another clinic's or nonexistent user → `404`; herself → `400` ("Para cambiar tu contraseña usá Mi cuenta"); inactive user → `409` ("El usuario está desactivado"), nothing changes (decision 1). Another ADMIN of the clinic is allowed (decision 3). |
| `POST /api/platform/tenants/:tenantId/users/:userId/password-reset` | Operator | Same (`404`, `409` for an inactive user), with the explicit `tenantId` lookup, plus a `platform_audit_logs` row `PASSWORD_RESET_LINK_CREATED` ("Generó un enlace para restablecer la contraseña de <email>"). |
| `POST /api/auth/password-reset/check` | Public | Body `{ token }`. Valid → `200 { data: { email, name } }`, so the page can say whose account it is. Invalid, used, expired, or user/clinic inactive → one uniform `400 {"error":"El enlace no es válido o ya venció"}`. |
| `POST /api/auth/password-reset` | Public | Body `{ token, newPassword }` (`PasswordSchema`). In one transaction, conditioned on the same validity in the `where`: set the hash, mark the link used (with the request's IP and user agent), invalidate any other unused link of hers, revoke her sessions (defensive: generation already did). → `204`. Same uniform `400` otherwise. |

The token travels in the **body**, never in a query string or path: it must not reach access logs. The two public routes get their own `createLoginLimiter()` instance (per IP), and both run bcrypt only after the token matched, so an invalid token is cheap and a valid one is single-use: the limiter guards against request floods rather than guessing (a 256-bit token cannot be guessed).

The API returns the token, not a URL: the web knows its own origin and builds the link.

### The link

`https://<web>/restablecer-contrasena#<token>`. The token goes in the URL **fragment**, which the browser never sends to any server (not to Netlify, not in `Referer`), so it does not land in hosting logs. The page reads it from `location.hash` and immediately removes it from the address bar and history with `history.replaceState`.

### Web

- **Usuarios (`UsersCard`)** and **platform tenant detail**: a **Restablecer contraseña** action on each active user (not on your own row nor on inactive users), behind a confirmation dialog that states the effects at generation time: "Se cierran todas sus sesiones y su contraseña actual deja de funcionar ya. El enlace dura 24 horas y sirve una sola vez." Then a second dialog shows the link **once**, with a copy button and its expiry: "Compartilo por un canal seguro: quien tenga este enlace puede entrar a la cuenta."
- **Public page `/restablecer-contrasena`**, outside the authenticated layout (next to `/login`): calls `check`; shows "Nueva contraseña para <email>" with password and confirmation; on success, it sends her to `/login` with "Listo, ya podés ingresar con tu contraseña nueva" (decision 2): the login keeps its throttling and the "trusted device" choice. An invalid link shows the uniform message and suggests asking whoever sent it for a new one.

### Audit

- **Operator:** new `PlatformAction` `PASSWORD_RESET_LINK_CREATED`, same transaction.
- **ADMIN** and **using the link**: audit rows belong to #186 (decision 4). Until then `password_reset_tokens` itself is the record — who generated each link (`created_by_*`), when and from where, and when and from where it was used — so #186 can read it without anything having been lost.

## Testing Strategy

API (`passwordReset.test.ts`):

- Generation (ADMIN and operator): the user's tokens `401` at once; her old password fails at login with the standard message; an earlier unused link stops working; another clinic's user → `404` and nothing changes; an inactive user → `409` and nothing changes; another ADMIN → allowed; herself → `400`; a THERAPIST → `403`; the operator writes one audit row, a `404` writes none; the row stores the generator and her IP and user agent.
- Use stores the IP and user agent of the request that used the link.
- Use: a valid link sets the password and the user logs in with it; the same link a second time → `400`; an expired, invalidated or unknown token → the same `400`; a link of a deactivated user or clinic → `400`; the password is never changed by a failed attempt.
- `check` returns email and name only for a valid link.
- Timing property: login against a reset-pending account runs bcrypt against a real hash (assert the stored hash is a valid bcrypt hash that the old password does not match).
- The token never appears in a URL the API receives (routes take it in the body).

Web: the action and its two dialogs on both screens; the public page reads the fragment, clears it, handles invalid links, validates the confirmation, and submits.

## Boundaries

- **Always:** only the token's hash is stored; the token travels in the body and the URL fragment; generation and use are each one transaction with the validity in the `where`.
- **Ask first:** showing the link more than once; letting an ADMIN choose the user's new password; any self-service flow.
- **Never:** log a token; put it in a query string or path; tell from the login whether an account is mid-reset.

## Success Criteria

- [ ] An ADMIN or the operator generates a 24 h single-use link; from that moment the user's sessions and old password no longer work.
- [ ] The user sets her own password through the public page and logs in with it; the link then stops working.
- [ ] Invalid, used, expired or foreign links all fail with the same message, and cross-clinic generation is `404` and changes nothing.

## Decisions (2026-10-05)

1. **No link for an inactive user** (`409`): a deactivated user has no right to use the system, so there is nothing to reset. The UI does not offer the action on inactive users.
2. **After a successful reset she goes to `/login`**; no automatic login.
3. **An ADMIN can reset another ADMIN** of her clinic (not herself: she uses *Mi cuenta*).
4. **Audit rows for the ADMIN's action and for the use of the link go in the audit PR (#186)**; this module only stores the evidence: who generated each link, and the **IP and device** of whoever generated it and whoever used it, so an ADMIN impersonating a therapist leaves a trace.

## Open Questions

5. **Show a pending reset in *Usuarios*?** E.g. a "Restablecimiento pendiente, vence <fecha>" badge on the user while her link is unused. It would tell the ADMIN that the user cannot log in until she uses it. *Recommendation: yes* — it is one more field in the list and avoids "why can't she log in?" confusion; but it can wait if you prefer the smallest module.
