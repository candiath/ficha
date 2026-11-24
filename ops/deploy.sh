#!/usr/bin/env bash
# Deploys production if its image tag points at a new image, blue/green.
#   deploy.sh prod            deploy if the tag points at a new image
#   deploy.sh prod --force    redeploy even the same image (after a change to
#                             prod.env, or to retry a rejected image)
# Run every 5 minutes by ficha-deploy@prod.timer, and by hand to deploy now
# or to roll back (set PROD_TAG in .env to sha-<commit> first). Staging is not
# on this server: it runs on Render (docs/infra.md).
#
# Two slots, api-blue and api-green. Caddy sends every request to one of them,
# named in active/upstream.caddy. A deploy:
#   1. runs the migration while the active slot keeps serving;
#   2. starts the new image in the other slot and waits until it answers
#      /health from inside (it reaches the database);
#   3. points Caddy at it (a graceful reload) and checks that Caddy's live
#      config names it and that /health through Caddy reports the new commit;
#   4. stops the old slot, which finishes its open requests first.
# A failure in 1-3 leaves the old slot serving (switching Caddy back if it
# had moved), records the image as rejected so the timer does not retry it
# every 5 minutes, and sends an alert. ops/README.md, *Blue/green*.
set -euo pipefail

env_name="${1:?usage: deploy.sh prod [--force]}"
case "$env_name" in
  prod) ;;
  *) echo "unknown environment: $env_name" >&2; exit 2 ;;
esac
force=no
case "${2:-}" in
  "") ;;
  --force) force=yes ;;
  *) echo "usage: deploy.sh prod [--force]" >&2; exit 2 ;;
esac

cd /opt/ficha
# One deploy per environment at a time: the timer and a manual run never overlap.
exec 9>"/run/ficha-deploy-$env_name.lock"
flock -n 9 || exit 0
# Nothing here reads input. Run by hand from a terminal, `timeout` puts its
# command in a background process group, and a `docker compose exec` there
# that touches the terminal is stopped by SIGTTIN, where SIGTERM cannot end it
# (2026-11-24: the first blue/green run hung for minutes on the /health check).
exec </dev/null

# Every message is printed (the terminal, or the journal under systemd) and
# also sent through the host's Telegram notifier (/usr/local/bin/vps-notify,
# set up outside this repo; see ops/README.md) when it exists. A missing or
# failing notifier never hides why a deploy failed. Override with NOTIFY=...
NOTIFY="${NOTIFY:-/usr/local/bin/vps-notify}"
notify() {
  local msg="[ficha $env_name] $1"
  echo "$msg" >&2
  if command -v "$NOTIFY" >/dev/null 2>&1; then
    "$NOTIFY" "$msg" >/dev/null 2>&1 || echo "(notifier $NOTIFY failed)" >&2
  else
    echo "(no notifier at $NOTIFY: message not sent)" >&2
  fi
}
fail() { notify "deploy FAILED: $1"; exit 1; }
# Anything that fails outside an explicit check still alerts. An interrupted
# run leaves no lasting harm: the next run follows Caddy's live config and
# stops a slot left running (see "Which slot serves" below).
trap 'notify "deploy FAILED: unexpected error at deploy.sh line $LINENO"' ERR
trap 'notify "deploy interrupted; the next run reconciles Caddy and the slots"; exit 130' INT TERM

# HEALTH_CURL_OPTS=-k, only for a rehearsal whose Caddy has no public
# certificate. Never set on the server.
curl_opts=()
case "${HEALTH_CURL_OPTS:-}" in
  "") ;;
  -k) curl_opts=(-k) ;;
  *) fail "HEALTH_CURL_OPTS may only be -k" ;;
esac

UPSTREAM=active/upstream.caddy
REJECTED=active/rejected
# The same request as compose.yaml's healthcheck, run in the container.
PROBE="fetch('http://127.0.0.1:3001/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Replace the upstream file in one rename, so Caddy never reads half of it.
write_upstream() {
  mkdir -p active
  printf 'reverse_proxy %s:3001\n' "$1" > "$UPSTREAM.tmp"
  mv -f "$UPSTREAM.tmp" "$UPSTREAM"
}

reload_caddy() {
  docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >&2
}

# The slot Caddy is serving right now (blue, green, or prod for the single
# api-prod container before blue/green), from its live config through the
# admin API inside its container; empty if Caddy does not answer.
caddy_slot() {
  { docker compose exec -T caddy wget -qO- http://127.0.0.1:2019/config/ 2>/dev/null || true; } \
    | grep -o '"dial":"api-[a-z]*:3001"' | head -n 1 | sed 's/.*"api-\([a-z]*\):3001"/\1/' || true
}

file_slot() {
  [ -f "$UPSTREAM" ] || return 0
  sed -n 's/^reverse_proxy api-\(blue\|green\|prod\):3001$/\1/p' "$UPSTREAM"
}

running_id() { docker compose ps -q --status running "$1"; }

reject() { printf '%s\n' "$new" > "$REJECTED"; }

# --- Which slot serves --------------------------------------------------------
# Caddy's live config is what users reach, so it wins over the file: a run
# interrupted between rewriting the file and reloading Caddy must not make the
# next deploy recreate the slot that is actually serving.
live=$(caddy_slot)
recorded=$(file_slot)
if [ -f "$UPSTREAM" ] && [ -z "$recorded" ]; then
  fail "$UPSTREAM names no slot (api-blue, api-green or api-prod)"
fi
if [ -n "$live" ] && [ "$live" != "$recorded" ]; then
  [ -n "$recorded" ] && echo "$UPSTREAM said api-$recorded but Caddy serves api-$live: following Caddy" >&2
  write_upstream "api-$live" || fail "could not write $UPSTREAM"
  recorded=$live
fi
case "${recorded:-prod}" in
  prod) active=legacy ;;   # no file, or still api-prod: blue/green not reached yet
  blue|green) active=$recorded ;;
esac
case "$active" in
  blue) target=green ;;
  *) target=blue ;;
esac
old_upstream=$([ "$active" = legacy ] && echo api-prod || echo "api-$active")

# --- The image ---------------------------------------------------------------
unset API_IMAGE
tag_img=$(docker compose config --images api-blue) || fail "no image for api-blue in compose.yaml"
docker pull -q "$tag_img" >/dev/null || fail "could not pull $tag_img"
new=$(docker image inspect -f '{{.Id}}' "$tag_img")
# Everything below runs the exact image just pulled, by digest: a tag moved
# by another pull during the deploy cannot split migration and slot.
digest=$(docker image inspect -f '{{range .RepoDigests}}{{println .}}{{end}}' "$tag_img" \
  | grep -m 1 "^${tag_img%:*}@" || true)
[ -n "$digest" ] || fail "no registry digest for $tag_img"
export API_IMAGE="$digest"

# The loop waits for liveness (/health/live, the container check). Whether the
# new version reaches its database is asked once, through /health, before the switch.
if [ "$active" != legacy ] && [ "$force" = no ]; then
  serving=$(running_id "api-$active")
  if [ -n "$serving" ] && [ "$(docker inspect -f '{{.Image}}' "$serving")" = "$new" ]; then
    # Already serving this image. Stop a slot an interrupted deploy left running.
    if [ -n "$(running_id "api-$target")" ]; then
      docker compose stop "api-$target" >/dev/null \
        && notify "stopped api-$target, left running by an interrupted deploy; api-$active serves" \
        || notify "could not stop api-$target, left running by an interrupted deploy"
    fi
    exit 0
  fi
fi
if [ "$force" = no ] && [ -f "$REJECTED" ] && [ "$(cat "$REJECTED")" = "$new" ]; then
  exit 0   # this image already failed; alerted then. --force retries it.
fi

# What the check through Caddy needs, read before anything changes.
domain=$(docker compose exec -T caddy printenv PROD_DOMAIN | tr -d '\r') || true
[ -n "$domain" ] || fail "could not read PROD_DOMAIN from the Caddy container; nothing changed"
expected=$(docker image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$tag_img" \
  | sed -n 's/^RENDER_GIT_COMMIT=//p' | cut -c1-7)
expected=${expected:-local}   # what /health reports for an image built without a commit

# --- 1. Migration, 2. the new slot --------------------------------------------
if ! docker compose run --rm "migrate-$env_name"; then
  reject
  fail "migration of $tag_img; $old_upstream still serving. Fix, then deploy.sh prod --force"
fi

# --force-recreate: the slot may hold a stopped container of an older image.
if ! docker compose up -d --no-deps --force-recreate "api-$target"; then
  reject
  fail "could not start api-$target; $old_upstream still serving"
fi

healthy=no
for _ in $(seq 1 18); do
  if docker compose exec -T "api-$target" node -e "$PROBE" >/dev/null 2>&1; then
    healthy=yes
    break
  fi
  sleep 5
done
if [ "$healthy" != yes ]; then
  docker compose logs --no-color --tail 40 "api-$target" >&2 || true
  docker compose stop "api-$target" >/dev/null || true
  reject
  fail "api-$target not healthy after 90 s ($tag_img); $old_upstream still serving"
fi
# Healthy means liveness passed. Whether the new version reaches its database
# is asked once here, through /health, bounded so a hung check cannot hold the
# deploy lock. Failing it stops the new slot: the old one keeps serving.
if ! timeout -k 5 30 docker compose exec -T "api-$target" node -e \
  "fetch('http://127.0.0.1:3001/health',{signal:AbortSignal.timeout(15000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
  docker compose stop "api-$target" >/dev/null || true
  reject
  fail "api-$target cannot reach its database ($tag_img); $old_upstream still serving"
fi

# --- 3. Switch and check ------------------------------------------------------
# From legacy, Caddy's container is recreated to mount active/ (a second or
# two without answers, once); the reload after it covers a Caddy that was
# already recreated by an earlier, failed attempt.
switch_caddy() {
  if [ "$active" = legacy ]; then
    docker compose up -d --no-deps caddy >&2 && reload_caddy
  else
    reload_caddy
  fi
}

switched=no
write_upstream "api-$target" || fail "could not write $UPSTREAM; $old_upstream still serving"
if switch_caddy; then
  for _ in $(seq 1 10); do
    served=$(curl -fsS "${curl_opts[@]}" --max-time 3 --resolve "$domain:443:127.0.0.1" \
      "https://$domain/health" 2>/dev/null | sed -n 's/.*"buildMarker":"\([^"]*\)".*/\1/p' || true)
    if [ "$(caddy_slot)" = "$target" ] && [ "$served" = "$expected" ]; then
      switched=yes
      break
    fi
    sleep 2
  done
fi

if [ "$switched" != yes ]; then
  reject
  write_upstream "$old_upstream" || true
  # A Caddy that is not running (a recreate that failed) is started again: the
  # file now names the old slot, a valid config.
  if reload_caddy || { docker compose up -d --no-deps caddy >&2 && reload_caddy; }; then
    docker compose stop "api-$target" >/dev/null || true
    fail "Caddy did not serve api-$target with commit $expected; back on $old_upstream"
  fi
  # Never stop the new slot while Caddy may still point at it.
  fail "Caddy did not serve api-$target, and switching back to $old_upstream failed too: both left running, check Caddy now"
fi

# --- 4. The old slot ----------------------------------------------------------
# It finishes what Caddy had already sent it: SIGTERM, and the API closes once
# its open requests end (stop_grace_period in compose.yaml).
sleep 2
if [ "$active" = legacy ]; then
  legacy_ids=$(docker ps -aq --filter label=com.docker.compose.project=ficha-vps \
    --filter label=com.docker.compose.service=api-prod)
  if [ -n "$legacy_ids" ]; then
    # shellcheck disable=SC2086
    { docker stop -t 30 $legacy_ids >/dev/null && docker rm $legacy_ids >/dev/null; } \
      || notify "could not remove the old api-prod container: remove it by hand"
  fi
else
  docker compose stop "api-$active" >/dev/null \
    || notify "could not stop api-$active: api-$target serves, both are running"
fi

rm -f "$REJECTED"
docker image prune -f >/dev/null || true
notify "deployed $expected in api-$target ($tag_img)"
