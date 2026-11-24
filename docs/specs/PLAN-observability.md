# Plan: logging and statistics (observability)

Status: **approved** (2026-11-24). The decisions are in §9.

## 1. What we want to know, and what we have today

| Question | Today |
| --- | --- |
| Did the deploy timer run? What did each run do? | Silent on a no-op run; one Telegram line on a deploy or a failure; journald, which rotates |
| Which slot serves, which started, which was stopped, how long the health check took | Scattered `notify` lines, no record per run |
| Is the API up, from outside? | Nobody checks; a user finds out |
| Request rate, latency, 5xx | Nothing |
| Errors in the API | `console.error`, lost when a container is recreated |
| Errors in the browser | `AppErrorBoundary` calls `console.error`; nothing reaches us |
| Host memory and disk (1 GB instance, 320 MB per slot) | Measured by hand once (2026-11-23) |
| Does Neon's compute sleep? | Neon console only |
| How each clinic uses the product | Nothing (the clinic's own dashboard is per clinic) |

Decided with Nath (2026-11-24): operational stats, product usage and frontend
errors; logs may go to an external SaaS hosted in the US; **US$0** (free
plans only); an **external dashboard**.

## 2. Principles

1. **Logs are operational, not audit.** Who did what to which record stays in
   `audit_logs`, the revisions and the planned `security-events` and
   `record-access-log` modules (`audit-map.md`). Logs may be lost, sampled or
   expire in 14 days; nothing legal or clinical depends on them.
2. **No clinical text, no personal data in any log line.** Allowed: ids
   (tenant, user, request, aggregate), route patterns (`/api/patients/:patientId`),
   status codes, durations, error codes and names, build version. Never:
   bodies, query strings, raw URLs, error messages from libraries or Postgres,
   names, emails, document numbers, IPs, user agents, tokens. A test enforces it
   (§4.4), as `listMinimization.test.ts` does for lists.
3. **One JSON object per line, to stdout.** The process never manages files or
   ships logs; the host collects them.
4. **One collector, one vendor.** Grafana Cloud Free (logs, metrics, dashboards,
   alerting, synthetic checks) and Fluent Bit on the host (a host package, §9 D2). No second SaaS
   unless §9 decides otherwise.
5. **History that must outlive 14 days lives in our own storage**: product
   usage in Postgres (it already is), deploy history in a file on the host.
6. **Alert on symptoms that need action.** The existing channels stay:
   `deploy.sh` → `vps-notify`, the API → sysadmin alerts. Grafana alerts only
   on what neither can see (the host or the timer dead, the API unreachable
   from outside, error rates).
7. **Nothing polls the database to observe it** (#351): liveness is
   `/health/live`.

## 3. Architecture

```
API slot (pino JSON) ─┐
Caddy                 ├─ Docker journald driver ─┐
deploy.sh (JSON)  ────┘    + systemd units       ├─ journald (persistent, 500 MB cap)
container stats timer ───────────────────────────┘          │
                                                  Fluent Bit (systemd input + node exporter)
                                                     │ Loki push        │ Prometheus remote write
                                                     ▼                  ▼
                                   Grafana Cloud Free: Loki (50 GB/mo, 14 d) · Prometheus (10k series, 14 d)
                                   dashboards · alert rules → Telegram · synthetic checks (100k/mo)
                                   Postgres data source → Neon `stats` views (read-only role)
Browser → POST /api/client-errors → API log line (same path as above)
```

Free-tier figures are from Grafana's pricing page as reported on 2026-11-24;
check them again at sign-up (§9, D5).

## 4. Phases

Each phase is one PR against `dev`, usable on its own. Order by value per
effort.

### Phase 0 — Heartbeat and outside view (no code in the app)

- Grafana Cloud stack, region closest to us-east-2 (Lightsail and Neon).
- **Access policies**: one write-only token (logs:write, metrics:write) for the
  host; nothing else holds a write token.
- **Synthetic checks** (HTTP): `https://api.cliniplus.com.ar/health/live` every
  5 min from 2 locations (~17k executions/month); `https://fichita.netlify.app`
  every 15 min; `https://api.cliniplus.com.ar/health` (the one that reaches
  Neon) **every 6 h**, to notice a broken database credential with no traffic,
  at the cost of four wake-ups a day.
- **Telegram contact point** (Grafana's alerting has a Telegram integration;
  confirm it on the free plan at sign-up): a bot of its own (not the sysadmin-alert bot or
  `vps-notify`'s), so a leaked token only lets someone send ops noise.
- Alerts: `/health/live` failing from both locations for 10 min; the web
  failing for 15 min; `/health` failing twice in a row.

Done when: stopping the serving slot by hand produces a Telegram message within
10 minutes and its recovery another.

### Phase 1 — Host: journald, Fluent Bit, deploy records

**Host (private runbook, mirrored in `ops/README.md`):**
- journald persistent: `Storage=persistent`, `SystemMaxUse=500M`,
  `MaxRetentionSec=30day`.
- Docker: `log-driver: journald` in `compose.yaml` for the slots, Caddy and the
  collector, with `tag: "{{.Name}}"`. The default `json-file` driver has no
  rotation and is lost when a slot is recreated; journald fixes both.

**Fluent Bit** as a host package (Fluent Bit's apt repository, version
pinned), run by systemd with `MemoryMax=48M` and `Restart=on-failure`; its
config lives in `ops/fluent-bit/` and is copied like the rest of `ops/`. Not a
container: the `systemd` input reads the journal through the libsystemd it was
built with, and a container image's can be older than the host's journal
format (Ubuntu's recent systemd writes compact journals), which fails or skips
entries silently. The host package matches the host.
- input `systemd`: units `docker.service` and `ficha-deploy@prod.service`;
  `DB` file under `/var/lib/fluent-bit` so a restart resumes and does not
  re-send.
- input `node_exporter_metrics`, collectors limited to `cpu`, `meminfo`,
  `loadavg`, `filesystem`, `diskstats`, `netdev` (a few hundred series).
- filter: parse the API's JSON; **drop** `/health*` request lines; from
  Caddy's lines keep only `level`, `msg`, `status`, `upstream`, `duration` and
  drop the `request` object (it carries the client IP, URI and headers); add labels
  `env=prod`, `host`, `service` (`api-blue`, `api-green`, `caddy`, `deploy`).
  Only low-cardinality values become Loki labels; ids stay in the line.
- outputs: `loki` and `prometheus_remote_write` to Grafana Cloud, token from
  `/opt/ficha/observability.env` (root, 600).
- **Memory**: `deploy.sh` requires 350 MB available before starting a second
  slot; 428 MB were measured with two APIs. 48 MB for Fluent Bit leaves ~380.
  Measure after installing; if the margin is gone, the collector is the first
  thing to stop during a deploy (`deploy.sh` can `systemctl stop fluent-bit`
  around the switch and start it after — its `DB` file resumes).

**`deploy.sh`** — this phase starts after `feat/ops-blue-green` is merged
(it rewrites the same script) and after #351 (the healthcheck):
- `log_event` writes one JSON line per step to stderr (journald):
  `{"event":"deploy.step","run":"<id>","step":"migrate","result":"ok","ms":…}`.
- **One summary line per run, no-ops included**, written from an `EXIT` trap
  that reads a `result` variable the run sets as it goes: the script has
  several `exit 0` paths (lock taken, image unchanged, image rejected, low
  memory) and every one must produce the line, or the heartbeat alert below
  fires on a healthy host. Only a run that cannot take the lock writes
  nothing, which is fine: the run holding it will.
  `{"event":"deploy.run","run":"<id>","result":"noop|deployed|failed|rejected|low_memory","image":"sha-…","from":"api-blue","to":"api-green","migration":"applied|none|skipped","health_s":12,"switch_s":4,"total_s":61,"mode":"blue_green|no_blue_green"}`.
- The summary is also appended to `/var/log/ficha/deploys.jsonl` (logrotate:
  monthly, keep 24). That is the long-term deploy history and the source of
  the DORA numbers.
- `run` is a random id per run, so the steps of a run group in Loki.

**Container memory**: a systemd timer every minute runs `docker stats
--no-stream --format json` and logs one line per container (name, memory used
and limit, CPU %). The 320 MB limit is the number most likely to bite.

**Alert rules** (Loki/Prometheus → Telegram):
- no `deploy.run` line for 15 min (timer stopped, host down, collector down:
  absence is detected outside the host);
- `deploy.run` with `result=failed` is already sent by `vps-notify`: **no**
  second alert;
- available memory < 150 MB for 5 min; disk > 85 %.

Done when: Grafana shows each run of the last day with its result, a deploy's
steps under one `run`, and memory per container.

### Phase 2 — API: structured logs

- `apps/api/src/lib/logger.ts`: `pino` (JSON, level from `LOG_LEVEL`,
  `info` by default; pretty output only when `NODE_ENV=development`, through
  `pino-pretty` as a dev dependency). `redact` for `req.headers.authorization`,
  `*.password`, `*.token` as a last net, not as the policy.
- **Request middleware**, first in `app.ts`: a request id (`randomUUID`), also
  sent back as `X-Request-Id` and accepted from nobody (never read from the
  request: a client could forge correlations). On `finish`, one line:
  `{"event":"http","reqId","method","route","status","ms","tenantId","userId","build"}`,
  where `route` is `req.baseUrl + req.route.path` (the pattern; `unmatched`
  when no route answered). No IP, no user agent, no query. Express rewrites
  `req.baseUrl` while routing and restores it when a router hands an error on,
  so the route is recorded when a handler matches (a tiny wrapper on each
  router's `param`/`all` stage, or `res.locals.route` set by the matched
  layer) rather than read on `finish`; a test pins it for a nested router, a
  404 and an error path.
- `/health*`: logged at `debug` only.
- **Error lines**: `errorHandler` and every `console.error` in `src` go
  through `logger.error` with `reqId`, the error's `name`, its Prisma `code`
  when there is one, and the **stack without its first line** (the first line
  is the message). The message itself is not logged: a `JSON.parse` error
  quotes its input, a Prisma error quotes the row (`errorHandler.ts` already
  says why). Errors are grouped by name and top stack frame, not by a hash of
  the message: a hash of a short clinical string can be guessed back.
- ESLint `no-console` in `apps/api/src`, except `lib/logger.ts`.
- Startup lines (`[api]`, `[alerts]`, `[audit]`, `[deploy]`) become events
  with the same content.
- `X-Request-Id` is shown in the web's generic error message ("Código:
  …"), so a user's report leads to the line.

### Phase 3 — Browser errors

- `POST /api/client-errors` (before `authenticate`; it uses the session if
  there is one, for `tenantId`/`userId`): body `strictObject` with `name`,
  `stack` (first line dropped by the web before sending, 4 KB cap), `route`
  (react-router's pattern, not the URL), `build`, `kind`
  (`boundary|onerror|unhandledrejection`). Answers `204`. Rate limited per IP
  (`express-rate-limit`, e.g. 20/min) and globally (e.g. 300/min for every
  client together, so many IPs cannot flood the journal and push out deploy
  history), and logged as `event: client_error`.
  `auditCoverageManifest`: `exempt` ("operational log line, no data written").
- Web: `AppErrorBoundary`, `window.onerror` and `unhandledrejection` call a
  `reportError()` that dedupes per page load and never throws.
- Vite `build.sourcemap: 'hidden'`, and a `scripts/symbolicate.mjs` that maps a
  logged stack back to the source for a given build. The repository is public,
  so publishing the maps reveals nothing new.
- CSP unchanged: the endpoint is on the API origin `connect-src` already lists.

### Phase 4 — Dashboards and API alerts

Dashboards (in the repository as JSON under `ops/grafana/`, imported by hand;
no Grafana credential in CI):
- **Deploys**: runs per day by result, deploy duration, health-check time,
  last deploy, DORA (deploy frequency, change failure rate, time to restore)
  from `deploy.run`.
- **API**: requests/min, 5xx rate, p50/p95 by route (LogQL `unwrap ms`),
  top error names, client errors by build.
- **Host**: memory available, per-container memory against 320 MB, disk, load.
- **Neon**: cold starts show as p95 spikes on the first request after idle;
  whether the compute sleeps is read in Neon's console (§9, D6).

Alert rules: 5xx > 5 % of requests for 10 min with at least 20 requests;
client errors > 20 in 10 min; p95 > 3 s for 15 min with at least 30 requests
(the floor keeps Neon's 1–2 s cold starts from alerting on a quiet night).

### Phase 5 — Product usage

Long-term, so it lives in Postgres and Grafana reads it:
- Migration: schema `stats` with views that **aggregate per clinic and day**,
  never per patient and never text:
  - `stats.audit_actions_daily`: `tenant_id`, day (clinic time zone), `action`,
    count — from `audit_logs` (action codes only, catalog-defined);
  - `stats.active_users_daily`: distinct authors per clinic and day;
  - `stats.logins_daily`: successful and failed logins per clinic and day,
    from `login_events`;
  - `stats.appointments_daily`: appointments by status per clinic and day;
  - `stats.clinics`: id, name, created, active.
- Role `stats_reader`: `LOGIN`, `USAGE` on `stats`, `SELECT` on its views,
  nothing else (views run with their owner's rights, so no grant on the
  tables; no migration enables row-level security today, so the owner reads
  every row — check again if one ever does). A view that reads `audit_logs`
  is checked against `tests/auditMigrationScan.test.ts`, which scans DDL that
  touches the audit tables, and against `prisma/audit-guards.sql`. Created per environment by hand (the password is not versioned),
  documented in `docs/infra.md`.
- Grafana's Postgres data source points at Neon's pooled endpoint with that
  role. Viewing the dashboard wakes Neon; nothing polls it.
- Per clinic, not per user: per-user counts would be a productivity report on
  each therapist, which is not what this is for (§9, D4).

## 5. Staging and local

- Staging (Render free) uses the same `pino` output; its logs stay in Render's
  dashboard. No shipping: no cost, and staging holds only test data.
- Local: pretty logs. The Fluent Bit config is tested by running it locally in
  Docker against the stack with `env=dev`, then removing that label's data.

## 6. Tests and guards

- `logger` unit tests: the request line has exactly the allowed keys; the
  error line has no message; `X-Request-Id` is new on every request and an
  incoming one is ignored.
- **No clinical text in logs**: a test runs requests over a clinic whose
  clinical columns hold markers (reusing `listMinimization`'s fixture), with a
  failing write forced, captures every log line, and fails on any marker, IP or
  email.
- `client-errors`: strict body, size cap, rate limit, `204`.
- `stats` views: a test that their columns are only ids, dates, codes and
  counts (a column list pinned, like `listScopeManifest`).
- `deploy.sh`: `bash -n` and `shellcheck` in CI; the JSON lines checked with
  `jq` in a dry run if the script gains one.

## 7. Cost and volume

- Logs: ~300 deploy lines/day, ~1.5k container-stats lines/day, request lines
  at current traffic in the low thousands: far under 50 GB/month.
- Metrics: a few hundred node series; no app metrics (they come from logs).
- Synthetic: ~17k + ~3k + ~120 executions/month of 100k.
- Neon: four `/health` wake-ups a day plus dashboard views.

## 8. Risks

- **Memory on the 1 GB host** (§4, Phase 1). Measured, not assumed.
- **Vendor lock-in and free-tier changes**: the logs are plain JSON and the
  collector is vendor-neutral; moving means changing two outputs.
- **A credential outside the host**: Grafana holds `stats_reader` (read-only,
  aggregates only). The production database credential stays only on the host
  and in the backups repository.
- **Grafana Cloud down**: no outside alerts meanwhile; `vps-notify` and the
  sysadmin alerts still work.

## 9. Decisions

Taken with Nath on 2026-11-24:

- **D1 — Browser errors: own endpoint** (Phase 3), not Sentry: Sentry's
  browser SDK would see the clinical screens, needs a CSP change and is a
  second vendor.
- **D3 — Synthetic `/health` every 6 h**: four Neon wake-ups a day buy
  noticing a broken database credential with no traffic.
- **D4 — Product usage per clinic only**: per-user counts would be a
  productivity report on each therapist.
- **D6 — Neon consumption from the console only**: no Neon API key on the
  host, no Phase 6.
- **D7 — `stats_reader` in Grafana Cloud**: production's third credential
  holder, read-only and limited to the `stats` views. Phase 5 adds it to
  `CLAUDE.md` (*Infraestructura*) and `docs/infra.md` beside the host and the
  backups repository.

Taken in the plan, reversible:

- **D2 — Fluent Bit as a host package**, not a container: its libsystemd
  matches the host's journal (§10).
- **D5 — Grafana Cloud region and free-tier limits**: checked at sign-up
  (Phase 0); the region closest to us-east-2.

## 10. Review (2026-11-24)

A pass over the first draft against the code changed:

- Fluent Bit moved from a container to a host package: the container's
  libsystemd may not read the host's journal format (D2 flipped).
- `deploy.sh`'s summary line comes from an `EXIT` trap: it has four
  `exit 0` paths, and a missing line would make the heartbeat alert lie.
- Phase 1 waits for `feat/ops-blue-green` and #351, which rewrite the same
  files.
- The request's route is recorded when the handler matches, not on `finish`:
  Express restores `req.baseUrl` on the way out of a router.
- Errors are grouped by name and top frame, not by a hash of their message.
- Caddy's lines lose their `request` object (client IP, URI, headers) before
  they leave the host.
- `/api/client-errors` gets a global cap besides the per-IP one.
- D7 added: Phase 5 would put a production credential outside the host.
- Still unverified: Grafana's Telegram integration and the free-tier figures
  on the free plan today (D5); Fluent Bit's real memory on this host; whether
  Neon's pooler accepts a role created by SQL (else the direct endpoint).
