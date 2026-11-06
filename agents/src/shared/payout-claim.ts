// Claims a deferred payout (R11). settle() and rescue() never revert on a recipient that cannot
// receive the token (an unassociated or frozen HTS account): the amount is parked in owed[recipient]
// and the recipient calls withdraw() once it can. This is best effort and never blocks a tick.
import type { Hex } from "../formats";
import type { TxResult } from "../worker/ports";

/** What a Worker or Requester needs from the escrow to claim a deferred payout. */
export interface WithdrawalPort {
  /** Payouts parked for `account` because delivery failed during settle() or rescue(). */
  owed(account: Hex): Promise<bigint>;
  /** Claims everything owed to the caller; reverts while delivery still fails. */
  withdraw(): Promise<TxResult>;
}

export class PayoutClaimer {
  /** Starts due, so the first tick after a (re)start checks once: a crash may have left a payout unclaimed. */
  private due = true;

  constructor(
    private readonly escrow: WithdrawalPort,
    private readonly account: Hex,
    private readonly label: string,
  ) {}

  /** A Mission just settled or was rescued: check what is owed on the next claim. */
  markDue(): void {
    this.due = true;
  }

  /** Checks owed(account) and withdraws if anything is parked. Errors are logged and retried on the next call. */
  async claim(): Promise<void> {
    if (!this.due) return;
    try {
      const amount = await this.escrow.owed(this.account);
      if (amount > 0n) {
        const { txHash } = await this.escrow.withdraw();
        console.log(`${this.label}: withdrew deferred payout of ${amount} base units in ${txHash}`);
      }
      this.due = false;
    } catch (error) {
      console.error(`${this.label}: claiming the deferred payout failed, will retry:`, error);
    }
  }
}
