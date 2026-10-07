#!/usr/bin/env bash
# Run from the repo root on your machine: host/deploy/push-secrets.sh <user@vm> <domain> [testnet|mainnet]
# Writes /etc/assay/host-<network>.env on the VM and restarts assay-host@<network>. Prints no values.
# The per-network settings follow the host's rule: NAME_<NETWORK> first, and plain NAME only for testnet.
set -euo pipefail
TARGET=${1:?usage: push-secrets.sh <user@vm> <domain> [testnet|mainnet]}
DOMAIN=${2:?usage: push-secrets.sh <user@vm> <domain> [testnet|mainnet]}
NET=${3:-testnet}
case "$NET" in testnet) PORT=8787; DATA=data; URL="https://$DOMAIN" ;; mainnet) PORT=8788; DATA=data-mainnet; URL="https://$DOMAIN/mainnet" ;; *) echo "network must be testnet or mainnet"; exit 1 ;; esac
SUFFIX="_${NET^^}"
# A missing key is empty, not an error: with pipefail a failed grep would stop the script silently.
val() { { grep "^$1=" .env || true; } | tail -1 | cut -d= -f2-; }
trap 'echo "push-secrets: failed at line $LINENO" >&2' ERR
net() { local v; v=$(val "$1$SUFFIX"); [ -z "$v" ] && [ "$NET" = testnet ] && v=$(val "$1"); echo "$v"; }

ENV_FILE=$(mktemp)
trap 'rm -f "$ENV_FILE"' EXIT
chmod 600 "$ENV_FILE"
{
  echo "ASSAY_NETWORK=$NET"
  echo "UPSTREAM_URL=https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
  echo "UPSTREAM_API_KEY=$(val GEMINI_API_KEY)"
  echo "UPSTREAM_MODEL=gemma-4-31b-it"
  for k in MONAD_RPC_URL ANCHOR_ADDRESS HOST_AGENT_ID VERIFIER_REGISTRY ACCOUNT_IMPL; do v=$(net $k); if [ -n "$v" ]; then echo "${k}_${NET^^}=$v"; fi; done
  # Shared settings may also be overridden per network (e.g. BATCH_SECONDS_MAINNET).
  for k in RELAYER_PRIVATE_KEY BATCH_SECONDS BATCH_MAX; do v=$(val "$k$SUFFIX"); [ -z "$v" ] && v=$(val $k); echo "$k=$v"; done | \
    # Every mainnet anchor costs real MON, so batch less often there unless told otherwise.
    { if [ "$NET" = mainnet ] && [ -z "$(val BATCH_SECONDS_MAINNET)" ]; then sed 's/^BATCH_SECONDS=.*/BATCH_SECONDS=120/'; else cat; fi; }
  echo "PORT=$PORT"
  echo "DATA_DIR=$DATA"
  echo "PUBLIC_URL=$URL"
} > "$ENV_FILE"

scp -q "$ENV_FILE" "$TARGET:/tmp/host-$NET.env"
scp -q host/.keys/host.jwk.json "$TARGET:/tmp/host.jwk.json"
# Receipts live on the VM; never overwrite them with an older copy from this machine.
ssh "$TARGET" "sudo install -m 640 -g assay /tmp/host-$NET.env /etc/assay/host-$NET.env &&
  sudo install -m 600 -o assay -g assay /tmp/host.jwk.json /opt/assay/host/.keys/host.jwk.json &&
  sudo install -d -o assay -g assay -m 700 /opt/assay/host/$DATA &&
  rm -f /tmp/host-$NET.env /tmp/host.jwk.json &&
  sudo systemctl enable -q assay-host@$NET && sudo systemctl restart assay-host@$NET && sleep 4 && systemctl --no-pager status assay-host@$NET | head -5"
echo "Check: curl $URL/health"
