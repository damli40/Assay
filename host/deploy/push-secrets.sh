#!/usr/bin/env bash
# Run from the repo root on your machine: host/deploy/push-secrets.sh <user@vm> <domain>
# Copies the host's env, signing key and receipt store to the VM. Prints no values.
set -euo pipefail
TARGET=${1:?usage: push-secrets.sh <user@vm> <domain>}
DOMAIN=${2:?usage: push-secrets.sh <user@vm> <domain>}
val() { grep "^$1=" .env | cut -d= -f2-; }

ENV_FILE=$(mktemp)
trap 'rm -f "$ENV_FILE"' EXIT
chmod 600 "$ENV_FILE"
{
  echo "UPSTREAM_URL=https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
  echo "UPSTREAM_API_KEY=$(val GEMINI_API_KEY)"
  echo "UPSTREAM_MODEL=gemma-4-31b-it"
  for k in MONAD_RPC_URL RELAYER_PRIVATE_KEY HOST_AGENT_ID ANCHOR_ADDRESS BATCH_SECONDS BATCH_MAX; do echo "$k=$(val $k)"; done
  echo "PORT=8787"
  echo "PUBLIC_URL=https://$DOMAIN"
} > "$ENV_FILE"

scp "$ENV_FILE" "$TARGET:/tmp/host.env"
scp host/.keys/host.jwk.json "$TARGET:/tmp/host.jwk.json"
scp host/data/receipts.jsonl host/data/batches.jsonl "$TARGET:/tmp/"
ssh -t "$TARGET" 'sudo install -m 640 -g assay /tmp/host.env /etc/assay/host.env &&
  sudo install -m 600 -o assay -g assay /tmp/host.jwk.json /opt/assay/host/.keys/host.jwk.json &&
  sudo install -m 644 -o assay -g assay /tmp/receipts.jsonl /tmp/batches.jsonl /opt/assay/host/data/ &&
  rm -f /tmp/host.env /tmp/host.jwk.json /tmp/receipts.jsonl /tmp/batches.jsonl &&
  sudo systemctl restart assay-host && sleep 3 && systemctl --no-pager status assay-host | head -5'
echo "Check: curl https://$DOMAIN/health"
