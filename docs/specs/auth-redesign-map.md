# Capability Map: Authentication redesign

Approved 2026-10-04. Origin: issue #177, plus the statement of intent agreed in conversation (session list, admin revocation, password reset). Each module gets its own spec next to this file (`SPEC-<module-id>.md`) and its own PR against `dev`.

| Module id | Responsibility | Depends on |
|---|---|---|
| `server-sessions` | `auth_sessions` table with an opaque token (`randomBytes(32)`, only its SHA-256 stored). Login creates a session; `authenticate` validates it in one query joined to `users` and `tenants`; logout revokes the current session; password change revokes all others; deactivating a user or a clinic revokes their sessions in the same transaction. `JWT_SECRET` goes away. Transport stays `Authorization: Bearer`. | — |
| `operator-sessions` | Same scheme for the platform operator, in its own table. `PLATFORM_JWT_SECRET` goes away; `platformIsolation.test.ts` keeps proving both directions. | `server-sessions` |
| `my-sessions` | API and web screen: list own sessions (device and browser, IP, created and last used, which one is current) and close any of them. Owns the `last_used_at` column, its write throttling, and idle expiry (sessions last 7 days absolute, so idle expiry is what protects a session left open on a shared computer). | `server-sessions` |
| `admin-revocation` | An ADMIN (within her clinic) and the operator close all sessions of a user without deactivating her. Operator actions go to `platform_audit_logs`. | `server-sessions` |
| `password-reset` | `password_reset_tokens` table. ADMIN or operator generates a single-use link (24 h, token in the URL fragment); generating it revokes the user's sessions, disables her current password and invalidates earlier unused links. Public page to set the new password, with its own rate limit. | `server-sessions` |
| `session-cookie` | Move the token to an `HttpOnly; Secure; SameSite=Lax` cookie plus CSRF defense. Closes #147. **Blocked** until web and API share a site (own domain or Netlify proxy). | `server-sessions`, infrastructure |

Build order: `server-sessions` → `my-sessions`, `admin-revocation`, `password-reset`, `operator-sessions` (parallel) → `session-cookie` (when infrastructure allows).

Out of scope for the whole initiative: the mailer (reset links are shared by hand until it exists), IP geolocation, ADMIN or operator viewing other people's sessions, self-service reset (needs the mailer), password policy (#148).
