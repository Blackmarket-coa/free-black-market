#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAILURES=0
REFRESH_TRACKERS=0
REFRESH_NOTE="release_validation.sh pass"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --refresh-trackers)
      REFRESH_TRACKERS=1
      shift
      ;;
    --refresh-note)
      REFRESH_NOTE="${2:-$REFRESH_NOTE}"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 [--refresh-trackers] [--refresh-note <note>]" >&2
      exit 2
      ;;
  esac
done

log() { printf "\n[%s] %s\n" "$1" "$2"; }
warn() { log "WARN" "$1"; }
pass() { log "PASS" "$1"; }

run_cmd() {
  local label="$1"
  shift
  log "RUN" "$label"
  if "$@"; then
    pass "$label"
  else
    warn "$label failed"
    FAILURES=$((FAILURES + 1))
  fi
}

http_status() {
  local method="$1"
  local url="$2"
  local auth_header="${3:-}"
  local data="${4:-}"

  if [[ -n "$auth_header" && -n "$data" ]]; then
    curl -sS -o /tmp/release_validation_body.txt -w "%{http_code}" -X "$method" "$url" -H "$auth_header" -H "Content-Type: application/json" -d "$data"
  elif [[ -n "$auth_header" ]]; then
    curl -sS -o /tmp/release_validation_body.txt -w "%{http_code}" -X "$method" "$url" -H "$auth_header"
  elif [[ -n "$data" ]]; then
    curl -sS -o /tmp/release_validation_body.txt -w "%{http_code}" -X "$method" "$url" -H "Content-Type: application/json" -d "$data"
  else
    curl -sS -o /tmp/release_validation_body.txt -w "%{http_code}" -X "$method" "$url"
  fi
}

expect_status() {
  local label="$1"
  local expected="$2"
  local actual="$3"

  if [[ "$actual" =~ $expected ]]; then
    pass "$label (status=$actual expected=/$expected/)"
  else
    warn "$label (status=$actual expected=/$expected/)"
    warn "Response excerpt: $(head -c 240 /tmp/release_validation_body.txt || true)"
    FAILURES=$((FAILURES + 1))
  fi
}

log "INFO" "Phase 2 release validation starting"

if [[ -d "$ROOT_DIR/backend" ]]; then
  run_cmd "backend unit tests" bash -lc "cd '$ROOT_DIR/backend' && TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --silent --runInBand --forceExit --passWithNoTests"
  run_cmd "backend HTTP integration tests" bash -lc "cd '$ROOT_DIR/backend' && TEST_TYPE=integration:http NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --silent=false --runInBand --forceExit --passWithNoTests"
  run_cmd "backend module integration tests" bash -lc "cd '$ROOT_DIR/backend' && TEST_TYPE=integration:modules NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --silent=false --runInBand --forceExit --passWithNoTests"
else
  warn "backend directory not found"
  FAILURES=$((FAILURES + 1))
fi

if [[ -d "$ROOT_DIR/storefront" ]]; then
  if bash -lc "cd '$ROOT_DIR/storefront' && pnpm run | rg -q '^\s*test\s'"; then
    run_cmd "storefront tests" bash -lc "cd '$ROOT_DIR/storefront' && pnpm test"
  else
    warn "storefront has no test script; running lint as minimum validation"
    run_cmd "storefront lint" bash -lc "cd '$ROOT_DIR/storefront' && pnpm run lint"
  fi
  run_cmd "storefront internal-link route validation" bash -lc "cd '$ROOT_DIR/storefront' && pnpm qa:internal-links"
else
  warn "storefront directory not found"
  FAILURES=$((FAILURES + 1))
fi

if [[ -z "${BACKEND_URL:-}" ]]; then
  warn "BACKEND_URL not set; skipping API smoke checks"
else
  BACKEND_URL="${BACKEND_URL%/}"
  log "INFO" "Running API smoke checks against $BACKEND_URL"

  status="$(http_status GET "$BACKEND_URL/health")"
  expect_status "health endpoint" "^200$" "$status"

  if [[ -n "${STORE_TOKEN:-}" ]]; then
    status="$(http_status GET "$BACKEND_URL/store/hawala/wallet" "Authorization: Bearer $STORE_TOKEN")"
    expect_status "store hawala wallet (valid token)" "^2[0-9]{2}$" "$status"

    status="$(http_status GET "$BACKEND_URL/store/hawala/wallet" "Authorization: Bearer invalid-token")"
    expect_status "store hawala wallet (invalid token failure-path)" "^(401|403)$" "$status"

    status="$(http_status GET "$BACKEND_URL/store/hawala/transactions" "Authorization: Bearer $STORE_TOKEN")"
    expect_status "store hawala transactions" "^2[0-9]{2}$" "$status"

    status="$(http_status POST "$BACKEND_URL/store/hawala/deposit" "Authorization: Bearer invalid-token" '{"amount":100,"currency_code":"usd"}')"
    expect_status "store hawala deposit failure-path" "^(400|401|403)$" "$status"
  else
    warn "STORE_TOKEN not set; skipping store hawala checks"
  fi

  if [[ -n "${VENDOR_TOKEN:-}" ]]; then
    status="$(http_status GET "$BACKEND_URL/vendor/hawala/dashboard" "Authorization: Bearer $VENDOR_TOKEN")"
    expect_status "vendor hawala dashboard" "^2[0-9]{2}$" "$status"
  else
    warn "VENDOR_TOKEN not set; skipping vendor hawala checks"
  fi

  if [[ -n "${ADMIN_TOKEN:-}" ]]; then
    status="$(http_status GET "$BACKEND_URL/admin/hawala/summary" "Authorization: Bearer $ADMIN_TOKEN")"
    expect_status "admin hawala summary" "^2[0-9]{2}$" "$status"

    status="$(http_status GET "$BACKEND_URL/admin/hawala/summary" "Authorization: Bearer invalid-token")"
    expect_status "admin hawala summary failure-path" "^(401|403)$" "$status"
  else
    warn "ADMIN_TOKEN not set; skipping admin hawala checks"
  fi
fi

if [[ -n "${BACKEND_URL:-}" && -n "${INTEGRATION_ENDPOINTS:-}" ]]; then
  IFS=',' read -ra endpoints <<< "$INTEGRATION_ENDPOINTS"
  for endpoint in "${endpoints[@]}"; do
    endpoint="${endpoint#${endpoint%%[![:space:]]*}}"
    endpoint="${endpoint%${endpoint##*[![:space:]]}}"
    [[ -z "$endpoint" ]] && continue

    url="${BACKEND_URL%/}$endpoint"

    if [[ -n "${ADMIN_TOKEN:-}" ]]; then
      status="$(http_status GET "$url" "Authorization: Bearer $ADMIN_TOKEN")"
      expect_status "integration contract check $endpoint" "^(2[0-9]{2}|4[0-9]{2})$" "$status"

      status="$(http_status GET "$url" "Authorization: Bearer invalid-token")"
      expect_status "integration failure-path $endpoint" "^(401|403)$" "$status"
    else
      warn "ADMIN_TOKEN missing; cannot validate integration endpoint $endpoint"
      FAILURES=$((FAILURES + 1))
    fi
  done
else
  warn "INTEGRATION_ENDPOINTS not set; skipping integration contract/failure-path checks"
fi

cat <<'EOT'

Release gate reminder (must all pass for complete status):
1) Structure pass
2) Test pass
3) Health pass
4) Regression pass
EOT

if [[ "$FAILURES" -eq 0 ]]; then
  if [[ "$REFRESH_TRACKERS" -eq 1 ]]; then
    run_cmd "refresh readiness trackers" "$ROOT_DIR/scripts/refresh_readiness_trackers.sh" "$REFRESH_NOTE"
  fi

  if [[ "$FAILURES" -eq 0 ]]; then
    pass "Phase 2 release validation finished with zero failures"
    exit 0
  fi
fi

warn "Phase 2 release validation finished with $FAILURES failure(s)"
exit 1
