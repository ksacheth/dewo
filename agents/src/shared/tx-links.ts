// Block-explorer links for the `txUrl` of I8 events (R6). One module so every event links the same way.
import type { Hex } from "../formats";

/** A Hedera testnet transaction (MissionEscrow writes), on HashScan. */
export function hederaTxUrl(txHash: Hex): string {
  return `https://hashscan.io/testnet/transaction/${txHash}`;
}

/** A 0G Galileo testnet transaction (EpisodeRegistry writes), on Chainscan. */
export function zeroGTxUrl(txHash: Hex): string {
  return `https://chainscan-galileo.0g.ai/tx/${txHash}`;
}
