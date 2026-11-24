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
PR → main ─push─▶ image.yml ─▶ ghcr.io/candiath/ficha-api:main ─▶ api-blue / api-green
```

1. Every push to `main` or `dev` builds the image (`apps/api/Dockerfile`)
   and publishes it with two tags: the branch and `sha-<commit>`. No server
   pulls `dev`: it proves the Dockerfile still builds before a release.
2. On the server, `ficha-deploy@prod.timer` runs `deploy.sh prod` every
   5 minutes. When the tag points at a new image, it deploys it blue/green
   (below): migration, the new image in the idle slot, Caddy switched to it
   once it is healthy, the old slot stopped.
3. A failed migration, health check or switch leaves the previous version
   serving and sends an alert. Every outcome goes to Telegram through
   `/usr/local/bin/vps-notify`.
   The container healthcheck is `/health/live`, which never queries the
   database, so that Neon's compute can scale to zero. The database check
   is `/health`, run once from inside the new container before the switch;
   if it fails, the new slot is stopped and the old one keeps serving.

The VPS pulls; GitHub never connects to the server and holds no credential of
it.

## Files

| File | On the server | What it is |
| --- | --- | --- |
| `compose.yaml` | `/opt/ficha/compose.yaml` | The API's two slots, its migration and Caddy |
| `Caddyfile` | `/opt/ficha/Caddyfile` | TLS for the API's domain |
| — | `/opt/ficha/active/upstream.caddy` | Which slot serves; written by `deploy.sh`, not copied |
| `deploy.sh` | `/opt/ficha/deploy.sh` (mode 750) | One deploy |
| `.env.example` | `/opt/ficha/.env` | Domain and image tag: no secrets |
| `app.env.example` | `/opt/ficha/prod.env` (root, 600) | Production's secrets |
| `systemd/ficha-deploy@.*` | `/etc/systemd/system/` | The 5-minute deploy check (instance `prod`) |

## Blue/green

The API has two slots, `api-blue` and `api-green`, with the same image tag.
One serves; the other is stopped. Caddy sends every request to the slot named
in `active/upstream.caddy`, a single line (`reverse_proxy api-green:3001`): the
two never share traffic, so a user never gets answers from two versions at
once. When the file and Caddy's live config disagree (a deploy interrupted
between the two), the next run follows Caddy, since that is what users reach,
and rewrites the file.

A deploy (`deploy.sh prod`), when the tag points at an image the serving slot
does not run:

1. Runs the migration (`migrate-prod`) while the serving slot keeps serving.
   From here on it uses the image by the digest it just pulled, so a tag moved
   mid-deploy cannot split migration and slot.
2. Starts the image in the idle slot and waits up to 90 s until `/health`
   answers from inside it (it reaches the database). If it does not, the slot
   is stopped and the old one never stopped serving.
3. Rewrites `active/upstream.caddy` and reloads Caddy. A reload is graceful:
   requests already sent to the old slot finish there; new ones go to the new
   slot. Within about 50 s, Caddy's live config must name the new slot and
   `/health` through Caddy must report the new image's commit. If not, Caddy is
   switched back (started again if it is down) and the new slot stopped; if
   switching back fails too, both slots are left running, never the one Caddy
   points at stopped.
4. Stops the old slot. The API closes on `SIGTERM` once its open requests end
   (`apps/api/src/lib/gracefulShutdown.ts`, up to 25 s; Docker waits 30 s). The
   stopped container stays until the next deploy recreates that slot.

A failure in 1–3 records the image in `active/rejected` and alerts once: the
timer does not retry that image every 5 minutes. A new image on the tag is
deployed as usual; `deploy.sh prod --force` retries the same one (after a
Neon outage, say). A failed deploy leaves the old version serving **on the
new schema** when the migration had already run: the same reason as for
rollbacks below that destructive migrations take two releases.

`--force` also redeploys the image already serving, blue/green: that is how a
change to `prod.env` takes effect without dropping requests.

Both slots run from the start of step 2 to the end of step 4: usually under a
minute, at most about three. Measured on 2026-11-23, with two APIs running the
1 GB instance had 428 MB available. A run that finds a slot left running
beside the serving one (an interrupted deploy) stops it and says so.

Never run a bare `docker compose up -d`: it starts both slots. Start a service
by name (`docker compose up -d --no-deps caddy`). Which slot serves is
`cat /opt/ficha/active/upstream.caddy`.

### Moving a server from the single container

Before blue/green, production ran one service, `api-prod`. The first run of
the new `deploy.sh` moves it on its own: with no `active/upstream.caddy`, it
starts `api-blue`, recreates Caddy (to mount `active/`; a second or two
without answers, once) and removes the old `api-prod` container. If the
switch fails, Caddy goes back to `api-prod`, which is still running, and
the image is rejected: fix the cause and run `deploy.sh prod --force`.

1. `sudo systemctl stop ficha-deploy@prod.timer`
2. Copy `compose.yaml`, `Caddyfile` and `deploy.sh` to `/opt/ficha`.
3. `sudo /opt/ficha/deploy.sh prod`, and watch it finish.
4. `cat /opt/ficha/active/upstream.caddy` says `api-blue`.
5. `sudo systemctl start ficha-deploy@prod.timer`

Run step 3 right after step 2: until it does, a restart of the old Caddy
container would read the new `Caddyfile` without the `active/` mount, and
fail.

## Rolling back

Set `PROD_TAG` in `/opt/ficha/.env` to the previous
commit's tag, `sha-` plus the **full** 40-character SHA
(`git log --format=%H -n 5 main`), then run `sudo /opt/ficha/deploy.sh prod`.
It is an ordinary deploy of that image, blue/green: the current version keeps
serving until the older one is healthy, and nothing changes if it is not.
While a tag is pinned, new images are ignored; put back `main` once
the fix is merged.

Rolling back the image does not roll back a migration. That is why
destructive migrations take two releases (`CLAUDE.md`, *Reglas*). The
migration step still runs on a rollback; `migrate deploy` with an older image
finds nothing to apply and the audit checks pass, unless the newer migration
changed what they check: then the rollback stops there, with an alert, and the
current version keeps serving, and the rollback has to be done by hand.

## Gotchas

- Docker publishes ports past the host firewall. Only Caddy publishes any
  (80, 443); the API only `expose`s its own.
- `ops/**` is checked out with LF (`.gitattributes`): copied from a Windows
  checkout with CRLF, `deploy.sh` fails with `bash\r`.
- The app labels alerts with `RENDER_SERVICE_NAME` and reports the commit in
  `/health` from `RENDER_GIT_COMMIT`; the image sets the second, the env files
  the first. Renaming them to platform-neutral names is a separate change.
