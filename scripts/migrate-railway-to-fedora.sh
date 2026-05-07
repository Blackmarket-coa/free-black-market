#!/usr/bin/env bash
# Migrate FreeBlackMarket data from Railway to the Fedora server.
#
# Two stateful systems are migrated:
#   1. Postgres (managed by Railway)  ->  in-compose Postgres on Fedora
#   2. MinIO    (Railway service)     ->  in-compose MinIO on Fedora
#
# Redis is intentionally NOT migrated (it holds cache + ephemeral session data).
#
# Usage:
#   bash scripts/migrate-railway-to-fedora.sh [--phase pg|minio|all] [--dry-run]
#
# Required environment (export before running, or place in ./railway-migration.env):
#   SOURCE_DATABASE_URL          Railway DATABASE_URL (postgres://...)
#   TARGET_DATABASE_URL          Fedora DATABASE_URL (e.g. postgres://medusa:...@127.0.0.1:5432/medusa)
#   SOURCE_MINIO_ENDPOINT        e.g. https://bucket-production-xxxx.up.railway.app
#   SOURCE_MINIO_ACCESS_KEY
#   SOURCE_MINIO_SECRET_KEY
#   SOURCE_MINIO_BUCKET          e.g. medusa-media
#   TARGET_MINIO_ENDPOINT        e.g. http://127.0.0.1:9100  (or https://media.freeblackmarket.com)
#   TARGET_MINIO_ACCESS_KEY
#   TARGET_MINIO_SECRET_KEY
#   TARGET_MINIO_BUCKET          e.g. medusa-media
#
# Optional:
#   FEDORA_HOST                  used to ssh in to stop/start backend during pg restore
#   FEDORA_USER                  default: fbm
#   FEDORA_SSH_PORT              default: 22
#
# Tooling required (locally or on the operator box):
#   - postgresql client v15+ (pg_dump, pg_restore, psql)
#   - mc (MinIO client) - install: https://min.io/docs/minio/linux/reference/minio-mc.html
#   - jq, ssh
#
# A transcript is written to migration-<timestamp>.log alongside this script.

set -euo pipefail

# -------------------- arg parsing ---------------------------------------
PHASE="all"
DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --phase) PHASE="$2"; shift 2;;
    --dry-run) DRY_RUN=1; shift;;
    -h|--help)
      sed -n '2,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0;;
    *) echo "Unknown arg: $1" >&2; exit 2;;
  esac
done

# -------------------- env loading ---------------------------------------
if [[ -f ./railway-migration.env ]]; then
  # shellcheck disable=SC1091
  set -a; source ./railway-migration.env; set +a
fi

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: required env var ${name} is not set" >&2
    exit 1
  fi
}

# -------------------- transcript ----------------------------------------
TS="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="migration-${TS}.log"
exec > >(tee -a "$LOG_FILE") 2>&1

log()   { echo -e "\033[1;34m[migrate]\033[0m $*"; }
warn()  { echo -e "\033[1;33m[migrate]\033[0m $*"; }
err()   { echo -e "\033[1;31m[migrate]\033[0m $*" >&2; }
prompt_continue() {
  local msg="$1"
  warn "$msg"
  if [[ $DRY_RUN -eq 1 ]]; then
    log "(dry-run) skipping confirmation"
    return 0
  fi
  read -r -p "Type 'yes' to continue: " ans
  if [[ "$ans" != "yes" ]]; then
    err "Aborted by operator"
    exit 130
  fi
}

ssh_fedora() {
  local user="${FEDORA_USER:-fbm}"
  local port="${FEDORA_SSH_PORT:-22}"
  if [[ -z "${FEDORA_HOST:-}" ]]; then
    warn "FEDORA_HOST not set; skipping remote command: $*"
    return 0
  fi
  ssh -p "$port" "${user}@${FEDORA_HOST}" "$@"
}

log "Transcript: ${LOG_FILE}"
log "Phase: ${PHASE} (dry_run=${DRY_RUN})"

# -------------------- Postgres phase ------------------------------------
postgres_phase() {
  require_var SOURCE_DATABASE_URL
  require_var TARGET_DATABASE_URL

  local dump_file="railway-fbm-${TS}.dump"

  # Tables that must exist post-restore. Used as canary for row-count diff.
  local CHECK_TABLES=("product" "customer" "order" "vendor" "cart")

  log "[pg] capturing source row counts"
  local pre_counts="counts-railway-${TS}.tsv"
  : > "$pre_counts"
  for tbl in "${CHECK_TABLES[@]}"; do
    local n
    n=$(psql "$SOURCE_DATABASE_URL" -tAc "SELECT count(*) FROM \"${tbl}\";" 2>/dev/null || echo "MISSING")
    echo -e "${tbl}\t${n}" | tee -a "$pre_counts"
  done

  log "[pg] dumping source -> ${dump_file}"
  if [[ $DRY_RUN -eq 0 ]]; then
    pg_dump "$SOURCE_DATABASE_URL" \
      --no-owner --no-privileges \
      --format=custom --compress=9 --verbose \
      --file="$dump_file"
  fi

  prompt_continue "About to STOP the Fedora backend container and DROP/RECREATE the public schema in TARGET_DATABASE_URL. This is destructive."

  log "[pg] stopping Fedora backend"
  ssh_fedora "cd /opt/fbm && docker compose -f docker-compose.yml -f docker-compose.prod.yml stop backend" || true

  log "[pg] resetting target schema"
  if [[ $DRY_RUN -eq 0 ]]; then
    psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 \
      -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
  fi

  log "[pg] restoring into target"
  if [[ $DRY_RUN -eq 0 ]]; then
    pg_restore --no-owner --no-privileges \
      --jobs=4 --verbose \
      --dbname="$TARGET_DATABASE_URL" \
      "$dump_file"
  fi

  log "[pg] capturing target row counts"
  local post_counts="counts-fedora-${TS}.tsv"
  : > "$post_counts"
  for tbl in "${CHECK_TABLES[@]}"; do
    local n
    n=$(psql "$TARGET_DATABASE_URL" -tAc "SELECT count(*) FROM \"${tbl}\";" 2>/dev/null || echo "MISSING")
    echo -e "${tbl}\t${n}" | tee -a "$post_counts"
  done

  log "[pg] diffing row counts"
  if diff -q "$pre_counts" "$post_counts" >/dev/null; then
    log "[pg] row counts match"
  else
    err "[pg] ROW COUNT MISMATCH"
    diff "$pre_counts" "$post_counts" || true
    err "[pg] backend will NOT be auto-restarted; investigate before continuing."
    return 1
  fi

  log "[pg] starting Fedora backend (railway-start.js will run idempotent migrations)"
  ssh_fedora "cd /opt/fbm && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d backend" || true

  log "[pg] phase complete"
}

# -------------------- MinIO phase ---------------------------------------
minio_phase() {
  require_var SOURCE_MINIO_ENDPOINT
  require_var SOURCE_MINIO_ACCESS_KEY
  require_var SOURCE_MINIO_SECRET_KEY
  require_var SOURCE_MINIO_BUCKET
  require_var TARGET_MINIO_ENDPOINT
  require_var TARGET_MINIO_ACCESS_KEY
  require_var TARGET_MINIO_SECRET_KEY
  require_var TARGET_MINIO_BUCKET

  if ! command -v mc >/dev/null 2>&1; then
    err "mc (MinIO client) not found. Install: https://min.io/docs/minio/linux/reference/minio-mc.html"
    return 1
  fi

  log "[minio] configuring aliases"
  if [[ $DRY_RUN -eq 0 ]]; then
    mc alias set fbm-railway "$SOURCE_MINIO_ENDPOINT" "$SOURCE_MINIO_ACCESS_KEY" "$SOURCE_MINIO_SECRET_KEY"
    mc alias set fbm-fedora  "$TARGET_MINIO_ENDPOINT" "$TARGET_MINIO_ACCESS_KEY" "$TARGET_MINIO_SECRET_KEY"
  fi

  local src_objs="objects-railway-${TS}.txt"
  local dst_objs="objects-fedora-${TS}.txt"

  log "[minio] enumerating source objects"
  if [[ $DRY_RUN -eq 0 ]]; then
    mc ls --recursive "fbm-railway/${SOURCE_MINIO_BUCKET}" \
      | awk '{print $NF}' | sort > "$src_objs"
  fi

  log "[minio] ensuring target bucket exists"
  if [[ $DRY_RUN -eq 0 ]]; then
    mc mb --ignore-existing "fbm-fedora/${TARGET_MINIO_BUCKET}"
    mc anonymous set download "fbm-fedora/${TARGET_MINIO_BUCKET}" || true
  fi

  log "[minio] mirroring (this can take a while)"
  if [[ $DRY_RUN -eq 0 ]]; then
    mc mirror --overwrite --preserve --quiet \
      "fbm-railway/${SOURCE_MINIO_BUCKET}" \
      "fbm-fedora/${TARGET_MINIO_BUCKET}"
  fi

  log "[minio] enumerating target objects"
  if [[ $DRY_RUN -eq 0 ]]; then
    mc ls --recursive "fbm-fedora/${TARGET_MINIO_BUCKET}" \
      | awk '{print $NF}' | sort > "$dst_objs"
  fi

  log "[minio] diffing object lists"
  if [[ $DRY_RUN -eq 0 ]]; then
    if diff -q "$src_objs" "$dst_objs" >/dev/null; then
      log "[minio] object lists match ($(wc -l <"$src_objs") objects)"
    else
      err "[minio] OBJECT LIST MISMATCH"
      diff "$src_objs" "$dst_objs" | head -30 || true
      return 1
    fi
  fi

  log "[minio] phase complete"
}

# -------------------- main ---------------------------------------------
case "$PHASE" in
  pg)    postgres_phase ;;
  minio) minio_phase ;;
  all)
    postgres_phase
    minio_phase
    ;;
  *)
    err "unknown phase: $PHASE (expected: pg | minio | all)"
    exit 2
    ;;
esac

log "Migration finished. Transcript: ${LOG_FILE}"
