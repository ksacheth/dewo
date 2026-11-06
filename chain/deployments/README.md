# Deployment artifacts

| File | Network | Contract | Address |
| --- | --- | --- | --- |
| `hedera-testnet.json` | Hedera testnet (296) | `MissionEscrow`, asset USDC `0.0.429274` | [`0x9aae6A883B4d16BF53Fa6339c606D18b47342631`](https://hashscan.io/testnet/contract/0.0.11337437) (`0.0.11337437`) |
| `0g-galileo.json` | 0G Galileo (16602) | `EpisodeRegistry` | not deployed yet |

Each file contains `{ "address": "0x...", "abi": [...] }` for its network's contract.
Export after a deployment with `python3 script/export_deployments.py hedera --tx <hash> --rpc-url <url>`
(Hedera, deployed with `forge create`; see `../README.md`) or `python3 script/export_deployments.py 0g`
(from the `forge script` broadcast).

`MissionEscrow` was deployed from Remix (Solidity 0.8.24, EVM paris, optimizer 200 runs, same
source revision) in tx `0xfdc94f6de90ff3ee956650ab13713cb4a9131e73ae1711229d6ba8edc76bafa6`
(block 42734243); its constructor associated the escrow with USDC (confirmed on the mirror node).

The exporter checks the chain ID and a successful contract creation. Build artifacts must be from the same source
revision used to deploy. Verify deployed bytecode and network in the explorer
before sharing these files. Do not invent addresses to unblock consumers.
