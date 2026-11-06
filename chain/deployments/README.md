# Deployment artifacts

No live deployments have been performed yet. After a successful broadcast, run
`python3 script/export_deployments.py hedera` or `python3 script/export_deployments.py 0g`
from `chain/`. Commit the resulting `hedera-testnet.json` and `0g-galileo.json`.
Each contains `{ "address": "0x...", "abi": [...] }` for its network's contract.

The exporter requires a successful matching creation receipt from Foundry's
non-dry-run broadcast directory. Build artifacts must be from the same source
revision used to deploy. Verify deployed bytecode and network in the explorer
before sharing these files. Do not invent addresses to unblock consumers.
