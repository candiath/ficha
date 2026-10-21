# ops/ — the API on the VPS

Production and staging of the API run as Docker containers on one VPS, behind
Caddy. This folder is everything the server needs from the repository: it is
copied to `/opt/ficha` as is. The host itself (users, SSH, firewall, VPN,
Docker, the Telegram notifier) is set up from a private runbook, not from here:
this repository is public.

**Status:** prepared, not live. Render still serves both environments until
the cutover; `docs/infra.md` changes when it happens.

## How a change reaches the server

```
PR → dev ─push─▶ image.yml ─▶ ghcr.io/candiath/ficha-api:dev  ─▶ api-staging
PR → main ─push─▶ image.yml ─▶ ghcr.io/candiath/ficha-api:main ─▶ api-prod
```

1. A push to `main` or `dev` that touches the API builds the image
   (`apps/api/Dockerfile`) and publishes it with two tags: the branch and
   `sha-<commit>`.
2. On the server, `ficha-deploy@prod.timer` and `ficha-deploy@staging.timer`
   run `deploy.sh <env>` every 5 minutes. When the tag points at a new image:
   pull it, run `migrate-<env>` (the same `npm run migrate:prod` Render ran:
   audit checks, `migrate deploy`, audit checks), start the new container, and
   wait until it is healthy.
3. A failed migration or health check leaves the previous version serving and
   sends an alert. Every outcome goes to Telegram through
   `/usr/local/bin/vps-notify`.

The VPS pulls; GitHub never connects to the server and holds no credential of
it.

## Files

| File | On the server | What it is |
| --- | --- | --- |
| `compose.yaml` | `/opt/ficha/compose.yaml` | Both APIs, their migrations and Caddy |
| `Caddyfile` | `/opt/ficha/Caddyfile` | TLS for both domains |
| `deploy.sh` | `/opt/ficha/deploy.sh` (mode 750) | One deploy of one environment |
| `.env.example` | `/opt/ficha/.env` | Domains and image tags: no secrets |
| `app.env.example` | `/opt/ficha/prod.env`, `/opt/ficha/staging.env` (root, 600) | Each environment's secrets |
| `systemd/ficha-deploy@.*` | `/etc/systemd/system/` | The 5-minute deploy check, one instance per environment |

## Rolling back

Set `PROD_TAG` (or `STAGING_TAG`) in `/opt/ficha/.env` to the previous
commit's tag, `sha-` plus the **full** 40-character SHA
(`git log --format=%H -n 5 main`), then run `sudo /opt/ficha/deploy.sh prod`.
While a tag is pinned, new images are ignored; put back `main` / `dev` once
the fix is merged.

Rolling back the image does not roll back a migration. That is why
destructive migrations take two releases (`CLAUDE.md`, *Reglas*).

## Gotchas

- Docker publishes ports past the host firewall. Only Caddy publishes any
  (80, 443); the APIs only `expose` theirs.
- `ops/**` is checked out with LF (`.gitattributes`): copied from a Windows
  checkout with CRLF, `deploy.sh` fails with `bash\r`.
- The app labels alerts with `RENDER_SERVICE_NAME` and reports the commit in
  `/health` from `RENDER_GIT_COMMIT`; the image sets the second, the env files
  the first. Renaming them to platform-neutral names is a separate change.
