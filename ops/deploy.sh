#!/usr/bin/env bash
# Deploys production if its image tag points at a new image.
#   deploy.sh prod
# Run every 5 minutes by ficha-deploy@prod.timer, and by hand to deploy now
# or to roll back (set PROD_TAG in .env to sha-<commit> first). Staging is not
# on this server: it runs on Render (docs/infra.md).
#
# Order matters: the migration runs while the old version keeps serving, and
# the new version starts only if it succeeded. A failed migration or health
# check leaves the old version up and sends an alert.
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

api="api-$env_name"
img=$(docker compose config --images "$api") || fail "no image for $api in compose.yaml"

docker pull -q "$img" >/dev/null || fail "could not pull $img"
new=$(docker image inspect -f '{{.Id}}' "$img")
running=$(docker compose ps -q "$api")
current=none
if [ -n "$running" ]; then
  current=$(docker inspect -f '{{.Image}}' "$running")
fi
[ "$new" = "$current" ] && exit 0   # already serving this image

docker compose run --rm "migrate-$env_name" || fail "migration of $img"
docker compose up -d --no-deps "$api"

# Healthy means the container's own check passed: the API is up. That check
# is liveness only (it must not keep Neon awake), so whether the new version
# reaches its database is asked once here, through /health. Both from inside,
# so they do not depend on DNS or TLS.
for _ in $(seq 1 18); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q "$api")" 2>/dev/null || echo "not running")
  [ "$status" = healthy ] && break
  sleep 5
done
[ "$status" = healthy ] || fail "$api is $status after 90 s ($img)"
# Bounded twice: a hung check would hold the deploy lock and silence every
# later run of the timer.
timeout 30 docker compose exec -T "$api" node -e \
  "fetch('http://127.0.0.1:3001/health',{signal:AbortSignal.timeout(15000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
  || fail "$api cannot reach its database ($img)"

commit=$(docker image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$img" \
  | sed -n 's/^RENDER_GIT_COMMIT=//p' | cut -c1-7)
docker image prune -f >/dev/null
notify "deployed ${commit:-?} ($img)"
