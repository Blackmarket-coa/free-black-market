#!/usr/bin/env bash
# Deploy the FreeBlackMarket Docker Compose stack on the Fedora host.
#
# Usage:
#   bash scripts/deploy-fedora.sh [image_tag]
#
# image_tag defaults to "latest". Pass a specific sha-XXXXXXX or release
# tag to pin a deploy (or to roll back).
#
# Requires:
#   - Docker + compose plugin
#   - .env.production at repo root (gitignored), with at minimum:
#       IMAGE_TAG, GHCR_OWNER, GHCR_USERNAME, GHCR_TOKEN
#   - Run as the 'fbm' deploy user (member of the docker group).
#
# What this script does:
#   1. Login to GHCR (so private images can be pulled)
#   2. Pull all 4 app images at the requested tag
#   3. Run a one-shot migration container to bring the DB up to date
#      (railway-start.js also does this on first boot, but pre-running
#      shortens the window where backend restarts could collide with
#      schema changes).
#   4. `docker compose up -d` to roll all services
#   5. Poll healthchecks; print container logs on failure.

set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

IMAGE_TAG="${1:-latest}"
ENV_FILE="${REPO_ROOT}/.env.production"
COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.prod.yml)

log()  { echo -e "\033[1;34m[deploy]\033[0m $*"; }
warn() { echo -e "\033[1;33m[deploy]\033[0m $*"; }
err()  { echo -e "\033[1;31m[deploy]\033[0m $*" >&2; }

if [[ ! -f "$ENV_FILE" ]]; then
  err "${ENV_FILE} not found. Copy .env.production.example and fill it in."
  exit 1
fi

# Source .env.production into this shell so $GHCR_*, $IMAGE_TAG, etc. resolve
# for both compose interpolation and the docker login below.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# CLI arg overrides whatever .env.production has for IMAGE_TAG.
export IMAGE_TAG
export GHCR_OWNER="${GHCR_OWNER:-blackmarket-coa}"

log "Deploying tag '${IMAGE_TAG}' from ghcr.io/${GHCR_OWNER}/free-black-market-*"

# ---------- 1. GHCR login ------------------------------------------------
if [[ -n "${GHCR_USERNAME:-}" && -n "${GHCR_TOKEN:-}" ]]; then
  log "Logging in to ghcr.io as ${GHCR_USERNAME}"
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
else
  warn "GHCR_USERNAME / GHCR_TOKEN not set; relying on cached docker credentials."
fi

# ---------- 2. Pull images -----------------------------------------------
log "Pulling images"
docker compose "${COMPOSE_FILES[@]}" pull \
  backend storefront admin-panel vendor-panel

# Also make sure the data-service base images are present locally.
docker compose "${COMPOSE_FILES[@]}" pull --ignore-pull-failures \
  postgres redis minio minio-init || true

# ---------- 3. Bring up data services first ------------------------------
log "Starting data services (postgres, redis, minio)"
docker compose "${COMPOSE_FILES[@]}" up -d postgres redis minio minio-init

# Wait for postgres to be ready before migrating.
log "Waiting for postgres to report healthy"
for i in {1..30}; do
  status=$(docker compose "${COMPOSE_FILES[@]}" ps --format json postgres 2>/dev/null \
    | jq -r '.Health // "unknown"' 2>/dev/null || echo "unknown")
  if [[ "$status" == "healthy" ]]; then
    break
  fi
  sleep 2
done

# ---------- 4. Run DB migrations as a one-shot ---------------------------
log "Running medusa db:migrate (one-shot)"
docker compose "${COMPOSE_FILES[@]}" run --rm --no-deps \
  -e NODE_ENV=production \
  backend pnpm exec medusa db:migrate || {
    err "Migration failed. Inspect logs with:"
    err "  docker compose ${COMPOSE_FILES[*]} logs backend"
    exit 1
  }

# ---------- 5. Roll the app services -------------------------------------
log "Rolling app services"
docker compose "${COMPOSE_FILES[@]}" up -d \
  backend storefront admin-panel vendor-panel

# ---------- 6. Smoketests ------------------------------------------------
log "Smoke testing local healthchecks (90s budget)"

declare -A CHECKS=(
  ["backend"]="http://127.0.0.1:9000/health"
  ["storefront"]="http://127.0.0.1:3000/api/health"
  ["admin-panel"]="http://127.0.0.1:7000/healthz"
  ["vendor-panel"]="http://127.0.0.1:7001/healthz"
)

deadline=$(( $(date +%s) + 90 ))
failed=()
for name in "${!CHECKS[@]}"; do
  url="${CHECKS[$name]}"
  ok=0
  while [[ $(date +%s) -lt $deadline ]]; do
    if curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then
      log "  ${name}: OK (${url})"
      ok=1
      break
    fi
    sleep 2
  done
  if [[ $ok -eq 0 ]]; then
    err "  ${name}: FAILED (${url})"
    failed+=("$name")
  fi
done

if [[ ${#failed[@]} -gt 0 ]]; then
  err ""
  err "Deploy unhealthy. Last 50 lines from each failing container:"
  for name in "${failed[@]}"; do
    err "----- ${name} -----"
    docker compose "${COMPOSE_FILES[@]}" logs --tail=50 "$name" >&2 || true
  done
  exit 1
fi

log "Deploy complete: tag '${IMAGE_TAG}' is live."
