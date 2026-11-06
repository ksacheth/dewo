#!/usr/bin/env python3
"""Export I5 from successful Foundry broadcasts; never from dry-run addresses."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGETS = {
    "hedera": (296, "DeployHedera.s.sol", "MissionEscrow", "hedera-testnet.json"),
    "0g": (16602, "Deploy0G.s.sol", "EpisodeRegistry", "0g-galileo.json"),
}


def export(target):
    chain_id, script, contract, filename = TARGETS[target]
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
    artifact = json.loads((ROOT / "out" / f"{contract}.sol" / f"{contract}.json").read_text())
    output = ROOT / "deployments" / filename
    output.write_text(json.dumps({"address": address, "abi": artifact["abi"]}, indent=2) + "\n")
    print(f"Exported {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", choices=TARGETS)
    export(parser.parse_args().target)
