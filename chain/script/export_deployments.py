#!/usr/bin/env python3
"""Export I5 from a successful deployment; never from dry-run addresses.

Default: read Foundry's `forge script` broadcast. With `--tx <hash> --rpc-url <url>`: verify a deployment
sent another way (Hedera needs `forge create`, see README) by fetching its receipt from the chain.
"""
import argparse
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGETS = {
    "hedera": (296, "DeployHedera.s.sol", "MissionEscrow", "hedera-testnet.json"),
    "0g": (16602, "Deploy0G.s.sol", "EpisodeRegistry", "0g-galileo.json"),
}


def rpc(url, method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    request = urllib.request.Request(url, body, {"content-type": "application/json", "user-agent": "dewo-export-deployments"})
    with urllib.request.urlopen(request, timeout=30) as response:
        reply = json.load(response)
    if reply.get("error"):
        raise ValueError(f"{method} failed: {reply['error']}")
    return reply["result"]


def deployed_by_tx(chain_id, tx_hash, rpc_url):
    """Address created by a successful deployment transaction, checked against the expected chain."""
    if int(rpc(rpc_url, "eth_chainId", []), 16) != chain_id:
        raise ValueError("RPC is not on the expected chain")
    receipt = rpc(rpc_url, "eth_getTransactionReceipt", [tx_hash])
    if not receipt or int(receipt["status"], 16) != 1 or not receipt.get("contractAddress"):
        raise ValueError("Transaction is not a successful contract deployment")
    return receipt["contractAddress"]


def deployed_by_broadcast(chain_id, script, contract):
    source = ROOT / "broadcast" / script / str(chain_id) / "run-latest.json"
    broadcast = json.loads(source.read_text())
    if int(broadcast["chain"]) != chain_id:
        raise ValueError("Unexpected broadcast chain")
    deployments = [tx for tx in broadcast["transactions"]
                   if tx.get("contractName") == contract and tx.get("transactionType") == "CREATE"]
    if len(deployments) != 1:
        raise ValueError("Expected exactly one contract deployment")
    transaction = deployments[0]
    address = transaction["contractAddress"]
    receipts = [r for r in broadcast.get("receipts", [])
                if r.get("transactionHash", "").lower() == transaction["hash"].lower()
                and r.get("contractAddress", "").lower() == address.lower()]
    if len(receipts) != 1 or int(str(receipts[0]["status"]), 0) != 1:
        raise ValueError("Deployment has no successful matching receipt")
    return address


def export(target, tx_hash=None, rpc_url=None):
    chain_id, script, contract, filename = TARGETS[target]
    if tx_hash:
        if not rpc_url:
            raise ValueError("--tx needs --rpc-url")
        address = deployed_by_tx(chain_id, tx_hash, rpc_url)
    else:
        address = deployed_by_broadcast(chain_id, script, contract)
    artifact = json.loads((ROOT / "out" / f"{contract}.sol" / f"{contract}.json").read_text())
    output = ROOT / "deployments" / filename
    output.write_text(json.dumps({"address": address, "abi": artifact["abi"]}, indent=2) + "\n")
    print(f"Exported {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", choices=TARGETS)
    parser.add_argument("--tx", help="deployment transaction hash (for deployments not made by forge script)")
    parser.add_argument("--rpc-url", help="RPC used to fetch the --tx receipt")
    args = parser.parse_args()
    export(args.target, args.tx, args.rpc_url)
