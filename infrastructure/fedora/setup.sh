#!/usr/bin/env bash
# Bootstrap a fresh Fedora 40+ host for the FreeBlackMarket Docker Compose stack.
# Idempotent: safe to re-run.
#
# What this installs / configures:
#   - Docker CE + compose plugin
#   - nginx + certbot + python3-certbot-nginx
#   - firewalld with HTTP(S) open and direct app ports closed
#   - A 'fbm' deploy user in the docker group
#   - /opt/fbm working directory owned by fbm:fbm
#
# Run as root (or via sudo).

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: setup.sh must be run as root (use sudo)." >&2
  exit 1
fi

DEPLOY_USER="${DEPLOY_USER:-fbm}"
APP_DIR="${APP_DIR:-/opt/fbm}"

log() { echo -e "\033[1;34m[setup]\033[0m $*"; }

log "Updating dnf metadata"
dnf -y makecache

log "Installing baseline packages"
dnf -y install \
  dnf-plugins-core \
  curl \
  ca-certificates \
  gnupg2 \
  git \
  jq \
  rsync \
  htop \
  postgresql \
  firewalld \
  policycoreutils-python-utils \
  nginx \
  certbot \
  python3-certbot-nginx

log "Adding Docker CE repository"
if [[ ! -f /etc/yum.repos.d/docker-ce.repo ]]; then
  dnf -y config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
fi

log "Installing Docker Engine + Compose plugin"
dnf -y install \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin

log "Enabling and starting Docker"
systemctl enable --now docker

log "Enabling and starting firewalld"
systemctl enable --now firewalld

log "Configuring firewalld (open 22/tcp, 80/tcp, 443/tcp)"
firewall-cmd --permanent --add-service=ssh
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --reload

log "Creating deploy user '${DEPLOY_USER}'"
if ! id -u "${DEPLOY_USER}" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "${DEPLOY_USER}"
fi
usermod -aG docker "${DEPLOY_USER}"

log "Preparing application directory ${APP_DIR}"
mkdir -p "${APP_DIR}"
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${APP_DIR}"

log "Enabling and starting nginx"
systemctl enable --now nginx

log "Enabling SELinux booleans nginx needs to proxy to localhost"
setsebool -P httpd_can_network_connect 1 || true

log "Done. Next steps:"
echo
echo "  1. Authorize SSH key for ${DEPLOY_USER} (used by GitHub Actions deploys):"
echo "       sudo -u ${DEPLOY_USER} mkdir -p ~${DEPLOY_USER}/.ssh"
echo "       echo 'ssh-ed25519 AAAA...' | sudo tee -a ~${DEPLOY_USER}/.ssh/authorized_keys"
echo "       sudo chmod 700 ~${DEPLOY_USER}/.ssh && sudo chmod 600 ~${DEPLOY_USER}/.ssh/authorized_keys"
echo "       sudo chown -R ${DEPLOY_USER}:${DEPLOY_USER} ~${DEPLOY_USER}/.ssh"
echo
echo "  2. Clone this repo into ${APP_DIR} as ${DEPLOY_USER}:"
echo "       sudo -u ${DEPLOY_USER} git clone https://github.com/blackmarket-coa/free-black-market.git ${APP_DIR}"
echo
echo "  3. Write ${APP_DIR}/.env.production from your secret store"
echo "     (see .env.production.example for the full key list)."
echo
echo "  4. Install nginx vhost + obtain TLS certs:"
echo "       sudo bash ${APP_DIR}/infrastructure/fedora/nginx/install.sh"
echo "       sudo bash ${APP_DIR}/infrastructure/fedora/certbot/issue-certs.sh you@example.com"
echo
echo "  5. Run the first deploy:"
echo "       cd ${APP_DIR} && bash scripts/deploy-fedora.sh latest"
echo
echo "  6. Enable boot-time start:"
echo "       sudo cp ${APP_DIR}/infrastructure/fedora/systemd/fbm.service /etc/systemd/system/"
echo "       sudo systemctl daemon-reload && sudo systemctl enable --now fbm.service"
