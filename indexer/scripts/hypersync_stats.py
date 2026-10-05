#!/usr/bin/env python3
"""What anchoring actually costs, straight from HyperSync (no RPC, no indexer).

Pulls every Anchored event from ReceiptAnchor with its transaction's gas, then reports per host:
batches, receipts, MON spent and MON per receipt. Monad bills the gas limit, so `gas_used` is what was paid.

  ENVIO_API_TOKEN=... python3 indexer/scripts/hypersync_stats.py            # Monad testnet
  ENVIO_API_TOKEN=... python3 indexer/scripts/hypersync_stats.py --chain 143 # Monad mainnet
  python3 indexer/scripts/hypersync_stats.py --json > stats.json
"""
import argparse, json, os, sys, urllib.request
from collections import defaultdict

ANCHORED = "0x04bbcdc7e16eb0f626d6a53f7ef4fa57fd6e4207ba7d679d53b8f728a53a3408"  # Anchored(uint256,bytes32,uint32,bytes32)
NETWORKS = {
    10143: ("https://monad-testnet.hypersync.xyz", "0x63e4F42E6d254ed6aAE735F9F4169BbFd12c1a24", 67461080),
    143: ("https://monad.hypersync.xyz", "0x049A73755cA3508ef3Daa4752A3406f6e00CfB13", 110678733),
}


def query(url, token, body):
    req = urllib.request.Request(f"{url}/query", data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def fetch(url, token, anchor, from_block):
    """Pages through HyperSync until it reaches the archive head."""
    logs, txs, block = [], {}, from_block
    while True:
        res = query(url, token, {
            "from_block": block,
            "logs": [{"address": [anchor], "topics": [[ANCHORED]]}],
            "field_selection": {"log": ["block_number", "transaction_hash", "data", "topic1"],
                                "transaction": ["hash", "gas_used", "effective_gas_price"]},
        })
        for batch in res["data"]:
            logs += batch.get("logs", [])
            txs.update({t["hash"]: t for t in batch.get("transactions", [])})
        if res["next_block"] >= res["archive_height"] or res["next_block"] <= block:
            return logs, txs, res["archive_height"]
        block = res["next_block"]


def summarize(logs, txs):
    hosts = defaultdict(lambda: {"batches": 0, "receipts": 0, "gas": 0, "wei": 0})
    for log in logs:
        agent = int(log["topic1"], 16)
        count = int(log["data"][2:66], 16)  # first word of data: uint32 count
        tx = txs[log["transaction_hash"]]
        gas = int(tx["gas_used"], 16)
        h = hosts[agent]
        h["batches"] += 1
        h["receipts"] += count
        h["gas"] += gas
        h["wei"] += gas * int(tx["effective_gas_price"], 16)
    return dict(hosts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chain", type=int, default=10143, choices=sorted(NETWORKS))
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    token = os.environ.get("ENVIO_API_TOKEN")
    if not token:
        sys.exit("ENVIO_API_TOKEN is required (a HyperSync token from envio.dev/app/api-tokens)")
    url, anchor, start = NETWORKS[a.chain]
    logs, txs, head = fetch(url, token, anchor, start)
    hosts = summarize(logs, txs)
    if a.json:
        print(json.dumps({"chain": a.chain, "head": head, "anchor": anchor, "hosts": hosts}, indent=2))
        return
    print(f"ReceiptAnchor {anchor} on chain {a.chain}, blocks {start} to {head}, via HyperSync\n")
    print("| Host (agent) | Batches | Receipts | Gas per batch | MON spent | MON per receipt |")
    print("|---|---:|---:|---:|---:|---:|")
    for agent, h in sorted(hosts.items()):
        print(f"| {agent} | {h['batches']} | {h['receipts']} | {h['gas'] // h['batches']:,} | "
              f"{h['wei'] / 1e18:.6f} | {h['wei'] / 1e18 / h['receipts']:.6f} |")


if __name__ == "__main__":
    main()
