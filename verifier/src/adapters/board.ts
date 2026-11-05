import type { BoardPort, EscrowPort, SeedPort, VerdictSink } from "../ports.js";

export interface BoardAdapters { board: BoardPort; escrow: EscrowPort; seeds: SeedPort; verdicts: VerdictSink }

/**
 * Real Arkiv (@dewo/board, M3) and Hedera MissionEscrow (M2) adapters. Neither module has landed on main, so this
 * fails loudly instead of guessing their APIs. Implement against I4/I5 at integration.
 */
export function loadBoardAdapters(): BoardAdapters {
  throw new Error(
    "board/escrow adapters are not implemented yet: need @dewo/board (listBids, openBid, listVerdicts, writeVerdict, seed reveal) " +
      "and chain/deployments/hedera-testnet.json (MissionEscrow award and stake events).",
  );
}
