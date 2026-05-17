#!/usr/bin/env bash
# Obtain Let's Encrypt certificates for all four FreeBlackMarket hostnames
# and let certbot's nginx plugin inject the TLS server blocks + HTTP->HTTPS
# redirect into the existing freeblackmarket.conf vhost.
#
# Usage:
#   sudo bash issue-certs.sh you@example.com [--staging]
#
# Use --staging while testing to avoid Let's Encrypt rate limits.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: issue-certs.sh must be run as root (use sudo)." >&2
  exit 1
fi

EMAIL="${1:-}"
STAGING_FLAG=""

if [[ -z "$EMAIL" ]]; then
  echo "Usage: $0 <email> [--staging]" >&2
  exit 2
fi

if [[ "${2:-}" == "--staging" ]]; then
  STAGING_FLAG="--staging"
  echo "[certbot] using Let's Encrypt STAGING environment"
fi

DOMAINS=(
  "freeblackmarket.com"
  "www.freeblackmarket.com"
  "api.freeblackmarket.com"
  "admin.freeblackmarket.com"
  "vendor.freeblackmarket.com"
)

DOMAIN_ARGS=()
for d in "${DOMAINS[@]}"; do
  DOMAIN_ARGS+=("-d" "$d")
done

echo "[certbot] requesting certs for: ${DOMAINS[*]}"

certbot --nginx \
  --non-interactive \
  --agree-tos \
  --redirect \
  --email "$EMAIL" \
  "${DOMAIN_ARGS[@]}" \
  $STAGING_FLAG

echo "[certbot] enabling automatic renewal timer"
systemctl enable --now certbot-renew.timer 2>/dev/null || \
  systemctl enable --now certbot.timer

echo "[certbot] done. Verify renewal with: certbot renew --dry-run"
