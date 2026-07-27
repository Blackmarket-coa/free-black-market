#!/bin/bash
# =============================================================================
# PostgreSQL Backup Script for FreeBlackMarket.com
# =============================================================================
#
# Usage:
#   ./scripts/backup-db.sh                    # Backup with default settings
#   ./scripts/backup-db.sh --output /backups  # Custom output directory
#   ./scripts/backup-db.sh --compress         # Compress with gzip
#   ./scripts/backup-db.sh --upload s3        # Upload to S3 (requires AWS CLI)
#
# Environment Variables:
#   DATABASE_URL     - PostgreSQL connection URL (required)
#   BACKUP_RETENTION - Number of days to keep local backups (default: 7)
#   AWS_S3_BUCKET    - S3 bucket for remote backups (optional)
#
# =============================================================================

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${PROJECT_ROOT}/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
RETENTION_DAYS=${BACKUP_RETENTION:-7}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging functions
log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Parse command line arguments
OUTPUT_DIR=""
COMPRESS=false
UPLOAD_TO=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --output)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --compress)
      COMPRESS=true
      shift
      ;;
    --upload)
      UPLOAD_TO="$2"
      shift 2
      ;;
    --help)
      echo "Usage: $0 [--output DIR] [--compress] [--upload s3]"
      exit 0
      ;;
    *)
      log_error "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Set backup directory
if [[ -n "$OUTPUT_DIR" ]]; then
  BACKUP_DIR="$OUTPUT_DIR"
fi

# Validate environment
if [[ -z "${DATABASE_URL:-}" ]]; then
  log_error "DATABASE_URL environment variable is not set"
  exit 1
fi

# Extract database connection details from DATABASE_URL
# Format: postgres://user:password@host:port/database
parse_database_url() {
  local url="$1"
  
  # Remove protocol
  url="${url#postgres://}"
  url="${url#postgresql://}"
  
  # Extract user:password
  local userpass="${url%%@*}"
  DB_USER="${userpass%%:*}"
  DB_PASS="${userpass#*:}"
  
  # Extract host:port/database
  local hostdb="${url#*@}"
  local hostport="${hostdb%%/*}"
  DB_HOST="${hostport%%:*}"
  DB_PORT="${hostport#*:}"
  
  # Handle case where port is not specified
  if [[ "$DB_PORT" == "$DB_HOST" ]]; then
    DB_PORT="5432"
  fi
  
  DB_NAME="${hostdb#*/}"
  # Remove any query parameters
  DB_NAME="${DB_NAME%%\?*}"
}

parse_database_url "$DATABASE_URL"

log_info "Database: $DB_NAME on $DB_HOST:$DB_PORT"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Backup filename. We use pg_dump's custom format (-Fc), which is what the
# restore runbook (docs/runbooks/BACKUP_RESTORE.md) feeds to `pg_restore`.
# Custom format is a compressed binary archive, so the extension is .dump.
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.dump"
BACKUP_LOG="${BACKUP_FILE}.log"

log_info "Starting backup to: $BACKUP_FILE"

# Perform backup using pg_dump.
#
# IMPORTANT: --verbose writes progress to STDERR. It must NOT be merged into
# the dump stream (a previous version used `> "$BACKUP_FILE" 2>&1`, which
# interleaved pg_dump's log lines into the archive and corrupted every
# backup). Send the archive to the file and diagnostics to a sidecar log.
export PGPASSWORD="$DB_PASS"
if ! pg_dump \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --format=custom \
  --no-owner \
  --no-acl \
  --verbose \
  --file="$BACKUP_FILE" \
  2> "$BACKUP_LOG"; then
  log_error "pg_dump failed. Diagnostics:"
  tail -n 20 "$BACKUP_LOG" >&2 || true
  rm -f "$BACKUP_FILE"
  exit 1
fi

# Check if backup was successful (custom-format archives are binary but never
# empty on success).
if [[ ! -s "$BACKUP_FILE" ]]; then
  log_error "Backup failed - output file is empty"
  rm -f "$BACKUP_FILE"
  exit 1
fi

# Validate the archive is readable by pg_restore before we trust it. A dump
# that pg_restore cannot list is not a backup.
if ! pg_restore --list "$BACKUP_FILE" > /dev/null 2>> "$BACKUP_LOG"; then
  log_error "Backup archive failed pg_restore --list validation (corrupt dump). Diagnostics:"
  tail -n 20 "$BACKUP_LOG" >&2 || true
  rm -f "$BACKUP_FILE"
  exit 1
fi
rm -f "$BACKUP_LOG"

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
log_info "Backup completed and validated: $BACKUP_SIZE"

# Compress if requested. Custom-format dumps are ALREADY compressed, and a
# gzipped archive cannot be fed straight to `pg_restore`, so gzip-ing here
# would break the documented restore path. Treat --compress as a no-op and
# say so rather than silently producing an unrestorable file.
if [[ "$COMPRESS" == true ]]; then
  log_warn "--compress ignored: custom-format (-Fc) dumps are already compressed; gzip would break pg_restore."
fi

# Upload to cloud storage if requested
if [[ "$UPLOAD_TO" == "s3" ]]; then
  if [[ -z "${AWS_S3_BUCKET:-}" ]]; then
    log_error "AWS_S3_BUCKET environment variable is not set"
    exit 1
  fi
  
  log_info "Uploading to S3: s3://${AWS_S3_BUCKET}/backups/"
  aws s3 cp "$BACKUP_FILE" "s3://${AWS_S3_BUCKET}/backups/$(basename "$BACKUP_FILE")"
  log_info "Upload completed"
fi

# Clean up old backups
log_info "Cleaning up backups older than $RETENTION_DAYS days..."
find "$BACKUP_DIR" -name "${DB_NAME}_*.dump*" -type f -mtime +$RETENTION_DAYS -delete 2>/dev/null || true

# List current backups
BACKUP_COUNT=$(find "$BACKUP_DIR" -name "${DB_NAME}_*.dump*" -type f | wc -l)
log_info "Current backup count: $BACKUP_COUNT"

log_info "Backup complete: $(basename "$BACKUP_FILE")"
