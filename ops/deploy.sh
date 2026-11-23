#!/usr/bin/env bash
# Deploys production if its image tag points at a new image, blue/green.
#   deploy.sh prod
# Run every 5 minutes by ficha-deploy@prod.timer, and by hand to deploy now
# or to roll back (set PROD_TAG in .env to sha-<commit> first). Staging is not
# on this server: it runs on Render (docs/infra.md).
#
# Two slots, api-blue and api-green; active/upstream.caddy says which one
# Caddy sends traffic to, and is the only record of it. A deploy:
#   1. runs the migration while the active slot keeps serving;
#   2. starts the new image in the other slot and waits until it answers
#      /health from inside (it reaches the database);
#   3. points Caddy at it (a graceful reload) and checks, through Caddy, that
#      /health now reports the new commit;
#   4. waits for the requests in flight on the old slot, then stops it.
# A failure in 1-3 leaves the old slot serving (switching Caddy back if it
# had already moved), stops the new one and sends an alert. The stopped old
# slot keeps its container and image until the next deploy recreates it.
set -euo pipefail

env_name="${1:?usage: deploy.sh prod}"
case "$env_name" in
  prod) ;;
  *) echo "unknown environment: $env_name" >&2; exit 2 ;;
esac

cd /opt/ficha
# One deploy per environment at a time: the timer and a manual run never overlap.
exec 9>"/run/ficha-deploy-$env_name.lock"
flock -n 9 || exit 0

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

UPSTREAM=active/upstream.caddy
# The same request as compose.yaml's healthcheck, run in the container.
PROBE="fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

upstream_line() { printf 'reverse_proxy %s:3001\n' "$1"; }

# Replace the upstream file in one rename, so Caddy never reads half of it.
write_upstream() {
  mkdir -p active
  upstream_line "$1" > "$UPSTREAM.tmp"
  mv -f "$UPSTREAM.tmp" "$UPSTREAM"
}

reload_caddy() {
  docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
}

# The commit an image was built from, as /health reports it (7 characters).
image_commit() {
  docker image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" \
    | sed -n 's/^RENDER_GIT_COMMIT=//p' | cut -c1-7
}

# Which slot serves now: blue, green, or "legacy" for the single api-prod
# container this script ran before blue/green (no upstream file yet).
if [ -f "$UPSTREAM" ]; then
  active=$(sed -n 's/^reverse_proxy api-\(blue\|green\):3001$/\1/p' "$UPSTREAM")
  [ -n "$active" ] || fail "$UPSTREAM does not name api-blue or api-green"
else
  active=legacy
fi

img=$(docker compose config --images api-blue) || fail "no image for api-blue in compose.yaml"
docker pull -q "$img" >/dev/null || fail "could not pull $img"
new=$(docker image inspect -f '{{.Id}}' "$img")

if [ "$active" != legacy ]; then
  running=$(docker compose ps -q --status running "api-$active")
  if [ -n "$running" ] && [ "$(docker inspect -f '{{.Image}}' "$running")" = "$new" ]; then
    exit 0   # already serving this image
  fi
fi

case "$active" in
  blue) target=green ;;
  *) target=blue ;;
esac
old_upstream=$([ "$active" = legacy ] && echo api-prod || echo "api-$active")

docker compose run --rm "migrate-$env_name" || fail "migration of $img; api-$active still serving"

# --force-recreate: the slot may hold a stopped container of an older image.
docker compose up -d --no-deps --force-recreate "api-$target" || fail "could not start api-$target"

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
  fail "api-$target not healthy after 90 s ($img); $old_upstream still serving"
fi

# Switch. The first time (from legacy), Caddy's container has to be recreated
# to mount active/: a second or two without TLS answers, once.
write_upstream "api-$target"
if [ "$active" = legacy ]; then
  switched=$(docker compose up -d --no-deps caddy 2>&1) || switched=failed
else
  switched=$(reload_caddy 2>&1) || switched=failed
fi

# Through Caddy, as a user arrives: /health must now report the new commit.
domain=$(sed -n 's/^PROD_DOMAIN=//p' .env)
# HEALTH_CURL_OPTS: extra curl arguments, only for a rehearsal whose Caddy has
# no public certificate (-k). Never set on the server.
# shellcheck disable=SC2206
curl_opts=(${HEALTH_CURL_OPTS:-})
expected=$(image_commit "$img")
served=""
if [ "$switched" != failed ]; then
  for _ in $(seq 1 10); do
    served=$(curl -fsS "${curl_opts[@]}" --max-time 10 --resolve "$domain:443:127.0.0.1" "https://$domain/health" 2>/dev/null \
      | sed -n 's/.*"buildMarker":"\([^"]*\)".*/\1/p') || true
    [ -n "$served" ] && [ "$served" = "${expected:-local}" ] && break
    sleep 3
  done
fi
if [ "$switched" = failed ] || [ "$served" != "${expected:-local}" ]; then
  echo "$switched" >&2
  # From legacy, a recreated Caddy already mounts active/ and reaches the old
  # container by its network alias api-prod; a Caddy that failed to recreate
  # still runs the old config, and this reload just fails.
  write_upstream "$old_upstream"
  reload_caddy >&2 || notify "Caddy reload back to $old_upstream failed: check the API"
  docker compose stop "api-$target" >/dev/null || true
  fail "Caddy did not serve api-$target (health reported '${served:-nothing}', expected '${expected:-local}'); back on $old_upstream"
fi

# The old slot finishes what Caddy had already sent it, then stops: SIGTERM,
# and the API closes once its open requests end (stop_grace_period).
sleep 10
if [ "$active" = legacy ]; then
  legacy_ids=$(docker ps -aq --filter label=com.docker.compose.project=ficha-vps \
    --filter label=com.docker.compose.service=api-prod)
  if [ -n "$legacy_ids" ]; then
    # shellcheck disable=SC2086
    docker stop -t 30 $legacy_ids >/dev/null && docker rm $legacy_ids >/dev/null \
      || notify "could not remove the old api-prod container: remove it by hand"
  fi
else
  docker compose stop "api-$active" >/dev/null \
    || notify "could not stop api-$active: api-$target serves, both are running"
fi

docker image prune -f >/dev/null
notify "deployed ${expected:-?} in api-$target ($img)"
