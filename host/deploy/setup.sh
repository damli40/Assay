#!/usr/bin/env bash
# Run once on a fresh Ubuntu 24.04 VM as root: bash setup.sh <domain>
# <domain> must resolve to this VM, e.g. 203-0-113-7.sslip.io for IP 203.0.113.7.
set -euo pipefail
DOMAIN=${1:?usage: setup.sh <domain>}

apt-get update
apt-get install -y curl git debian-keyring debian-archive-keyring apt-transport-https gnupg
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y nodejs caddy

id assay >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin assay
[ -d /opt/assay ] || git clone https://github.com/trudransh/Assay.git /opt/assay
chown -R assay:assay /opt/assay
cd /opt/assay
sudo -u assay COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm install --frozen-lockfile --filter @assay/host...
install -d -o assay -g assay -m 700 host/.keys host/data
install -d -m 750 -g assay /etc/assay

install -m 644 host/deploy/assay-host.service /etc/systemd/system/assay-host.service
printf '%s {\n\treverse_proxy 127.0.0.1:8787\n}\n' "$DOMAIN" > /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable assay-host
systemctl reload-or-restart caddy

# Only SSH and HTTPS from outside; the host port stays behind Caddy.
if command -v ufw >/dev/null; then ufw allow 22/tcp; ufw allow 80/tcp; ufw allow 443/tcp; ufw --force enable; fi
echo "Next, from your machine: host/deploy/push-secrets.sh <ssh-target> $DOMAIN"
