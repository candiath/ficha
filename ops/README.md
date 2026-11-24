# ops/ — the production API on the VPS

The production API runs as a Docker container on one VPS, behind Caddy.
Staging does not run here: it is on Render (`docs/infra.md`). This folder is
everything the server needs from the repository: it is
copied to `/opt/ficha` as is. The host itself (users, SSH, firewall, VPN,
Docker, the Telegram notifier) is set up from a private runbook, not from here:
this repository is public.

**Status:** production has been live here since 2026-11-14, on an AWS Lightsail
instance (`api.cliniplus.com.ar`). Staging ran here too until 2026-11-18 and went
back to Render, so that a staging failure cannot reach production's host
(`docs/infra.md`, *Production on AWS*).

## How a change reaches the server

```
PR → main ─push─▶ image.yml ─▶ ghcr.io/candiath/ficha-api:main ─▶ api-prod
```

1. Every push to `main` or `dev` builds the image (`apps/api/Dockerfile`)
   and publishes it with two tags: the branch and `sha-<commit>`. No server
   pulls `dev`: it proves the Dockerfile still builds before a release.
2. On the server, `ficha-deploy@prod.timer` runs `deploy.sh prod` every
   5 minutes. When the tag points at a new image:
   pull it, run `migrate-prod` (the same `npm run migrate:prod` Render ran:
   audit checks, `migrate deploy`, audit checks), start the new container,
   wait until it is healthy, and check once that it reaches its database.
   The container's healthcheck is `/health/live`, which never queries the
   database, so that Neon's compute can scale to zero; the database check is
   `/health`, run once from inside the container. A database outage after the
   deploy therefore does not mark the container unhealthy.
3. A failed migration leaves the previous version serving. A failed health or
   database check does not: the new container has already replaced the old one
   and stays running. Either way an alert is sent. Every outcome goes to
   Telegram through `/usr/local/bin/vps-notify`.

The VPS pulls; GitHub never connects to the server and holds no credential of
it.

## Files

| File | On the server | What it is |
| --- | --- | --- |
| `compose.yaml` | `/opt/ficha/compose.yaml` | The API, its migration and Caddy |
| `Caddyfile` | `/opt/ficha/Caddyfile` | TLS for the API's domain |
| `deploy.sh` | `/opt/ficha/deploy.sh` (mode 750) | One deploy |
| `.env.example` | `/opt/ficha/.env` | Domain and image tag: no secrets |
| `app.env.example` | `/opt/ficha/prod.env` (root, 600) | Production's secrets |
| `systemd/ficha-deploy@.*` | `/etc/systemd/system/` | The 5-minute deploy check (instance `prod`) |

## Rolling back

Set `PROD_TAG` in `/opt/ficha/.env` to the previous
commit's tag, `sha-` plus the **full** 40-character SHA
(`git log --format=%H -n 5 main`), then run `sudo /opt/ficha/deploy.sh prod`.
While a tag is pinned, new images are ignored; put back `main` once
the fix is merged.

Rolling back the image does not roll back a migration. That is why
destructive migrations take two releases (`CLAUDE.md`, *Reglas*).

## Gotchas

- Docker publishes ports past the host firewall. Only Caddy publishes any
  (80, 443); the API only `expose`s its own.
- `ops/**` is checked out with LF (`.gitattributes`): copied from a Windows
  checkout with CRLF, `deploy.sh` fails with `bash\r`.
- The app labels alerts with `RENDER_SERVICE_NAME` and reports the commit in
  `/health` from `RENDER_GIT_COMMIT`; the image sets the second, the env files
  the first. Renaming them to platform-neutral names is a separate change.
