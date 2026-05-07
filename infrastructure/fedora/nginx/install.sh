#!/usr/bin/env bash
# Install / reinstall the FreeBlackMarket nginx vhost on Fedora.
#
# Idempotent. Run as root.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: install.sh must be run as root (use sudo)." >&2
  exit 1
fi

SRC="$(cd "$(dirname "$0")" && pwd)/freeblackmarket.conf"
DST="/etc/nginx/conf.d/freeblackmarket.conf"

if [[ ! -f "$SRC" ]]; then
  echo "ERROR: ${SRC} not found." >&2
  exit 1
fi

echo "[install] copying ${SRC} -> ${DST}"
install -m 0644 "$SRC" "$DST"

echo "[install] nginx -t"
nginx -t

echo "[install] reloading nginx"
systemctl reload nginx

echo "[install] done"
